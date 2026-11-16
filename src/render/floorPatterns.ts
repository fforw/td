import Prando from "prando"
import {
    AddEquation,
    BufferGeometry,
    CustomBlending,
    DoubleSide,
    DstColorFactor,
    Float32BufferAttribute,
    Mesh,
    NoColorSpace,
    RepeatWrapping,
    ShaderMaterial,
    SrcColorFactor,
    type Texture,
    TextureLoader
} from "three"
import type PatchWorld from "../map/PatchWorld"
import { SCALE } from "./scene3d"

/*
 * Patterns laid over the floor of some rooms, to vary them a little. See plans/discovery.md, 3.4.
 */

const PATTERN_DIR = import.meta.env.BASE_URL + "media/patterns/"

/**
 * Patterns from the Kenney Pattern Pack that pass for floors, with the mean of their texels. The overlay shifts the floor
 * by the difference to the mean, so a room keeps its brightness whatever share of a pattern is dark.
 */
export const FLOOR_PATTERNS: readonly (readonly [name: string, mean: number])[] = [
    ["pattern_14", 0.121],
    ["pattern_15", 0.5],
    ["pattern_18", 0.82],
    ["pattern_20", 0.762],
    ["pattern_22", 0.692],
    ["pattern_23", 0.463],
    ["pattern_24", 0.315],
    ["pattern_37", 0.609],
    ["pattern_61", 0.498],
    ["pattern_72", 0.379],
    ["pattern_74", 0.134],
    ["pattern_79", 0.287],
    ["pattern_80", 0.263]
]

/**
 * Share of the rooms that get a pattern
 */
export const PATTERN_SHARE = 0.35

/**
 * How much a pattern changes the floor: the light parts multiply it by up to 1 + strength, the dark ones by down to
 * 1 - strength.
 */
export const PATTERN_STRENGTH = 0.18

/**
 * Number of faces of a room that the flood fill of its texture coordinates starts from, see floodRoom()
 */
export const PATTERN_STARTS = 12

/**
 * Corners of a face in texture space, in the order of its half edges
 */
const START_UVS = [0, 0, 1, 0, 1, 1, 0, 1]


/**
 * Returns the corners of the face across the edge from corner k to k + 1 of a face laid out at the given corners, so the
 * pattern continues over that edge
 *
 * @param uv    integer u and v of the 4 corners of the face
 * @param k     corner where the edge starts
 * @param kt    corner of the other face where its half edge of the edge starts
 */
function across(uv: Int32Array, k: number, kt: number): Int32Array
{
    // the twin runs the other way, from our corner k + 1 to our corner k
    const a = k * 2, b = ((k + 1) & 3) * 2
    const au = uv[a], av = uv[a + 1], bu = uv[b], bv = uv[b + 1]
    // the far side is the shared edge turned by a quarter, as it is for the start face
    const du = -(av - bv), dv = au - bu
    const out = new Int32Array(8)
    const set = (corner: number, u: number, v: number) => {
        out[(corner & 3) * 2] = u
        out[(corner & 3) * 2 + 1] = v
    }
    set(kt, bu, bv)
    set(kt + 1, au, av)
    set(kt + 2, au + du, av + dv)
    set(kt + 3, bu + du, bv + dv)
    return out
}


/**
 * Texture coordinates of the faces of a room
 */
export interface RoomUVs
{
    /**
     * Global face id to the integer u and v of its 4 corners, in the order of its half edges. Every face is one tile of
     * the pattern.
     */
    uvs: Map<number, Int32Array>
    /**
     * Number of edges inside the room
     */
    edges: number
    /**
     * Number of those where the pattern continues, the faces on both sides agree on where their shared corners are
     */
    matching: number
}


/**
 * Lays out the faces of a room in texture space, flooding out from the given face. Each face reached gets its corners from
 * the edge it was reached over, so it continues the pattern there. In a regular grid it then fits its other neighbors as
 * well, but going around a vertex with more or fewer than 4 quads turns the pattern, and somewhere along the way two faces
 * that got reached over different paths meet with the pattern at an angle. Those edges don't match.
 *
 * @param world     world with all patches of the level
 * @param faces     global face ids of the room, connected over their edges
 * @param start     face of the room to start from
 */
export function floodRoom(world: PatchWorld, faces: readonly number[], start: number): RoomUVs
{
    const room = new Set(faces)
    const uvs = new Map<number, Int32Array>([[start, Int32Array.from(START_UVS)]])
    const queue = [start]
    for (let i = 0; i < queue.length; i++)
    {
        const face = queue[i]
        for (let k = 0; k < 4; k++)
        {
            const twin = world.twin((face << 2) | k)
            const other = twin >> 2
            if (twin >= 0 && room.has(other) && !uvs.has(other))
            {
                uvs.set(other, across(uvs.get(face)!, k, twin & 3))
                queue.push(other)
            }
        }
    }

    let edges = 0, matching = 0
    for (const [face, own] of uvs)
    {
        for (let k = 0; k < 4; k++)
        {
            const h = (face << 2) | k
            const twin = world.twin(h)
            // count each edge once
            if (twin < h || !uvs.has(twin >> 2))
            {
                continue
            }
            edges++
            const uv = uvs.get(twin >> 2)!
            const a = k * 2, b = ((k + 1) & 3) * 2
            const ta = (twin & 3) * 2, tb = (((twin & 3) + 1) & 3) * 2
            // with a tile per face, any whole shift of the shared edge continues the pattern, as long as it is the same at
            // both of its ends
            if (uv[ta] - own[b] === uv[tb] - own[a] && uv[ta + 1] - own[b + 1] === uv[tb + 1] - own[a + 1])
            {
                matching++
            }
        }
    }
    return { uvs, edges, matching }
}


/**
 * Lays out the faces of a room in texture space from some of its faces, see floodRoom(), and returns the layout where the
 * most edges match.
 *
 * @param world     world with all patches of the level
 * @param faces     global face ids of the room, connected over their edges
 */
export function layOutRoom(world: PatchWorld, faces: readonly number[]): RoomUVs
{
    let best: RoomUVs | null = null
    const starts = Math.min(PATTERN_STARTS, faces.length)
    for (let i = 0; i < starts; i++)
    {
        const layout = floodRoom(world, faces, faces[Math.floor(i * faces.length / starts)])
        if (!best || layout.matching > best.matching)
        {
            best = layout
        }
    }
    return best!
}


const textures = new Map<string, Texture>()

function patternTexture(name: string): Texture
{
    let texture = textures.get(name)
    if (!texture)
    {
        texture = new TextureLoader().load(PATTERN_DIR + name + ".png")
        texture.wrapS = texture.wrapT = RepeatWrapping
        texture.colorSpace = NoColorSpace
        textures.set(name, texture)
    }
    return texture
}


const VERTEX_SHADER = `
varying vec2 vUv;

void main()
{
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

// blended as 2 * src * dst, so 0.5 leaves the floor as it is
const FRAGMENT_SHADER = `
uniform sampler2D map;
uniform float mean;
uniform float strength;
varying vec2 vUv;

void main()
{
    float shift = strength * (texture2D(map, vUv).r - mean);
    gl_FragColor = vec4(vec3(0.5 + 0.5 * shift), 1.0);
}
`


/**
 * Creates the material of a pattern over the lit floor. It multiplies what is already there, so it needs no light of its
 * own.
 */
function patternMaterial(name: string, mean: number): ShaderMaterial
{
    return new ShaderMaterial({
        uniforms: {
            map: { value: patternTexture(name) },
            mean: { value: mean },
            strength: { value: PATTERN_STRENGTH }
        },
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        blending: CustomBlending,
        blendEquation: AddEquation,
        blendSrc: DstColorFactor,
        blendDst: SrcColorFactor,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        side: DoubleSide
    })
}


/**
 * Picks the rooms that get a pattern and which one
 *
 * @param rooms     global face ids per room
 * @param seed      seed of the choice
 *
 * @return index into FLOOR_PATTERNS per room, -1 for the rooms without one
 */
export function choosePatterns(rooms: readonly (readonly number[])[], seed: number): number[]
{
    const random = new Prando(seed)
    return rooms.map(() => {
        const pattern = random.nextInt(0, FLOOR_PATTERNS.length - 1)
        return random.next() < PATTERN_SHARE ? pattern : -1
    })
}


/**
 * Creates the geometry of the patterns over the floors of some of the rooms
 *
 * @param world     world with all patches of the level
 * @param rooms     global face ids per room
 * @param seed      seed of the choice of the rooms and their patterns
 *
 * @return geometry by index into FLOOR_PATTERNS, for the patterns that got chosen
 */
export function createPatternGeometries(
    world: PatchWorld,
    rooms: readonly (readonly number[])[],
    seed: number
): Map<number, BufferGeometry>
{
    const chosen = choosePatterns(rooms, seed)
    const position = [0, 0, 0]
    const geometries = new Map<number, BufferGeometry>()
    FLOOR_PATTERNS.forEach((_, pattern) => {
        const positions: number[] = []
        const uvs: number[] = []
        rooms.forEach((faces, room) => {
            if (chosen[room] !== pattern)
            {
                return
            }
            for (const [face, uv] of layOutRoom(world, faces).uvs)
            {
                for (const k of [0, 1, 2, 0, 2, 3])
                {
                    world.position((face << 2) | k, position)
                    positions.push(position[0] * SCALE, 0, position[1] * SCALE)
                    uvs.push(uv[k * 2], uv[k * 2 + 1])
                }
            }
        })
        if (positions.length)
        {
            const geometry = new BufferGeometry()
            geometry.setAttribute("position", new Float32BufferAttribute(positions, 3))
            geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2))
            geometry.computeBoundingSphere()
            geometries.set(pattern, geometry)
        }
    })
    return geometries
}


/**
 * Creates the patterns over the floors of some of the rooms, a mesh per pattern. They are drawn after the floor and the
 * walls and before the meeples.
 *
 * @param world     world with all patches of the level
 * @param rooms     global face ids per room
 * @param seed      seed of the choice of the rooms and their patterns
 */
export function createFloorPatterns(world: PatchWorld, rooms: readonly (readonly number[])[], seed: number): Mesh[]
{
    return [...createPatternGeometries(world, rooms, seed)].map(([pattern, geometry]) => {
        const mesh = new Mesh(geometry, patternMaterial(...FLOOR_PATTERNS[pattern]))
        // after the floor and the walls, which are 0, and before the meeples, whose groups are 1
        mesh.renderOrder = 0.5
        return mesh
    })
}
