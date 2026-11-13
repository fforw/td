import {
    BufferGeometry,
    Color,
    Float32BufferAttribute,
    type InstancedMesh,
    Matrix4,
    Mesh,
    MeshStandardMaterial,
    Quaternion,
    Vector3
} from "three"
import { FaceType } from "../map/geometry"
import { GROUND_PRIORITY, marchingSquaresPatch } from "../map/marchingSquares"
import type { PointOfInterest } from "../map/patchGenerators"
import type PatchWorld from "../map/PatchWorld"
import type { QuadPatch } from "../map/QuadPatch"
import { patchSeed } from "../math/random"
import { GROUND_COLORS, instanceModel, type ModelName, SCALE } from "./scene3d"

/*
 * Meshes of packed patches: the ground and the models standing on faces
 */

const TAU = Math.PI * 2

/**
 * Models per face type with the range of their random scale
 */
const FACE_MODELS = new Map<FaceType, { names: ModelName[], scale: [number, number] }>([
    [FaceType.TREE, { names: ["tree", "treeOak"], scale: [0.4, 0.6] }],
    [FaceType.TREE2, { names: ["pine", "pine2"], scale: [0.4, 0.6] }],
    [FaceType.ROCK, { names: ["rock", "rock2", "rock3"], scale: [1, 1] }],
])

/**
 * Size of the model that stands in for the way into a sub-level
 */
const ENTRANCE_SCALE = 1



/**
 * Random numbers that only depend on the patch and face, so a patch looks the same whenever it gets loaded
 */
function faceRandom(patch: QuadPatch, face: number): () => number
{
    let s = patchSeed(face, patch.q, patch.r)
    return () => {
        // mulberry32
        s = (s + 0x6d2b79f5) | 0
        let t = Math.imul(s ^ (s >>> 15), 1 | s)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}


/**
 * Returns the transformation of the model for an entrance on a face. The doorway model is half a unit thick on its
 * negative x-side, has its battlements on that side and runs along its local z-axis. It stands in the middle of the
 * face with its battlements towards the half edge of the entrance.
 */
export function entranceMatrix({ positions, vertex }: QuadPatch, entrance: number): Matrix4
{
    const face = entrance >> 2
    let x = 0
    let z = 0
    for (let h = face * 4; h < face * 4 + 4; h++)
    {
        x += positions[vertex[h] * 3] / 4
        z += positions[vertex[h] * 3 + 1] / 4
    }

    const next = face * 4 + (entrance + 1) % 4
    const dx = (positions[vertex[entrance] * 3] + positions[vertex[next] * 3]) / 2 - x
    const dz = (positions[vertex[entrance] * 3 + 1] + positions[vertex[next] * 3 + 1]) / 2 - z
    const length = Math.hypot(dx, dz)
    const shift = -0.25 * ENTRANCE_SCALE / SCALE / length

    return new Matrix4().compose(
        new Vector3((x + dx * shift) * SCALE, 0, (z + dz * shift) * SCALE),
        new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(-dz, dx) + Math.PI),
        new Vector3().setScalar(ENTRANCE_SCALE)
    )
}


/**
 * Returns the faces in front of entrances, which stay without models to not block the view of the door. An entrance
 * opening over the border of the patch has no such face.
 */
export function entranceFronts({ twin }: QuadPatch, pois: readonly PointOfInterest[]): Set<number>
{
    const fronts = new Set<number>()
    for (const { entrance } of pois)
    {
        if (entrance !== undefined && twin[entrance] >= 0)
        {
            fronts.add(twin[entrance] >> 2)
        }
    }
    return fronts
}


export function createModels(patch: QuadPatch, pois: readonly PointOfInterest[]): InstancedMesh[]
{
    const { positions, vertex, faceType } = patch
    const matrices = new Map<ModelName, Matrix4[]>()
    const fronts = entranceFronts(patch, pois)

    const entrances = pois.flatMap(({ entrance }) => entrance === undefined ? [] : [entranceMatrix(patch, entrance)])
    if (entrances.length > 0)
    {
        matrices.set("gateway", entrances)
    }

    const pos = new Vector3()
    const rotation = new Quaternion()
    const scale = new Vector3()
    const up = new Vector3(0, 1, 0)

    for (let f = 0; f < faceType.length; f++)
    {
        const models = FACE_MODELS.get(FaceType.byIndex(faceType[f]))
        if (!models || fronts.has(f))
        {
            continue
        }

        let x = 0
        let z = 0
        for (let h = f * 4; h < f * 4 + 4; h++)
        {
            x += positions[vertex[h] * 3]
            z += positions[vertex[h] * 3 + 1]
        }

        const random = faceRandom(patch, f)
        const name = models.names[Math.floor(random() * models.names.length)]
        const [min, max] = models.scale
        const s = min + random() * (max - min)

        const matrix = new Matrix4().compose(
            pos.set(x / 4 * SCALE, 0, z / 4 * SCALE),
            rotation.setFromAxisAngle(up, random() * TAU),
            scale.setScalar(s)
        )

        let list = matrices.get(name)
        if (!list)
        {
            list = []
            matrices.set(name, list)
        }
        list.push(matrix)
    }

    return [...matrices].flatMap(([name, list]) => instanceModel(name, list))
}


const groundMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 1 })

/**
 * Creates the ground of the packed patch in the given slot of the world
 *
 * @param world     world with the patch
 * @param slot      slot of the patch
 * @param priority  ground types from background to foreground
 * @param groundColors colors of the ground by type, in place of those of the types
 */
export function createGround(
    world: PatchWorld,
    slot: number,
    priority = GROUND_PRIORITY,
    groundColors: ReadonlyMap<FaceType, string> = GROUND_COLORS
): Mesh
{
    const positions: number[] = []
    const colors: number[] = []
    const color = new Color()

    marchingSquaresPatch(world, slot, (type, x0, z0, x1, z1, x2, z2) => {
        color.set(groundColors.get(type) ?? type.color)

        // wind the triangle so the normal points up
        if ((x1 - x0) * (z2 - z0) - (z1 - z0) * (x2 - x0) < 0)
        {
            positions.push(x0 * SCALE, 0, z0 * SCALE, x1 * SCALE, 0, z1 * SCALE, x2 * SCALE, 0, z2 * SCALE)
        }
        else
        {
            positions.push(x0 * SCALE, 0, z0 * SCALE, x2 * SCALE, 0, z2 * SCALE, x1 * SCALE, 0, z1 * SCALE)
        }
        colors.push(color.r, color.g, color.b, color.r, color.g, color.b, color.r, color.g, color.b)
    }, priority)

    const geometry = new BufferGeometry()
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3))
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3))
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()

    const mesh = new Mesh(geometry, groundMaterial)
    mesh.receiveShadow = true
    return mesh
}
