import { faceCenter } from "./dungeonLights"
import type { DungeonLevel } from "./generateDungeon"
import type PatchWorld from "./PatchWorld"
import { LOCAL_MASK } from "./PatchWorld"
import { faceOf, next } from "./QuadPatch"
import { DEFAULT_COSTS, EDGE_COSTS, findRoute, slotOf } from "./route"
import { SCALE } from "./scale"

/**
 * How many faces out from someone's face the walls they can bump into are looked for. It takes two for those that only
 * touch a corner of the face.
 */
const WALL_RINGS = 2

/**
 * Most faces a single small step goes over
 */
const MAX_CROSSINGS = 4

const PUSH_PASSES = 3

const corner = [0, 0, 0]
const ends = [0, 0, 0, 0]


/**
 * Returns the face of a level someone comes in at: the one closest to the middle of its largest room, which is the first
 * to get a light.
 */
export function entranceFace(world: PatchWorld, { rooms }: Pick<DungeonLevel, "rooms">): number
{
    const centers = rooms[0].map(face => faceCenter(world, face))
    const midX = centers.reduce((sum, [x]) => sum + x, 0) / centers.length
    const midZ = centers.reduce((sum, [, z]) => sum + z, 0) / centers.length
    const distances = centers.map(([x, z]) => Math.hypot(x - midX, z - midZ))
    return rooms[0][distances.indexOf(Math.min(...distances))]
}


/**
 * Returns the faces of the shortest way between two faces of a level, null if there is none
 *
 * @param world     world with all patches of the level
 * @param slots     slots of the patches of the level
 * @param from      global id of the face to start on
 * @param to        global id of the face to get to
 */
export function findFaces(world: PatchWorld, slots: readonly number[], from: number, to: number): number[] | null
{
    const { reachable, paths } = findRoute(world, from, slotOf(to), [to & (LOCAL_MASK >> 2)], slots)
    return reachable ? paths[0] : null
}


/**
 * Spot on the floor of a level, in world units, with the face it lies on
 */
export interface FloorSpot
{
    face: number
    x: number
    z: number
}


/**
 * Returns whether someone can get across a half edge from its own face
 */
function canCross(world: PatchWorld, h: number): boolean
{
    const twin = world.twin(h)
    return twin >= 0 && EDGE_COSTS[world.edgeType(h)] + DEFAULT_COSTS[world.faceType(faceOf(twin))] < Infinity
}


/**
 * Writes the two ends of a half edge in world units into the given array, as x and z
 */
function edgeEnds(world: PatchWorld, h: number, out: number[]): void
{
    world.position(h, corner)
    out[0] = corner[0] * SCALE
    out[1] = corner[1] * SCALE
    world.position(next(h), corner)
    out[2] = corner[0] * SCALE
    out[3] = corner[1] * SCALE
}


/**
 * Returns the half edges around a face and the ones next to it that nobody can get across, which is every wall someone on
 * the face can bump into as long as they are less wide than a face.
 */
function wallsAround(world: PatchWorld, face: number): number[]
{
    const walls = new Set<number>()
    const faces = new Set([face])
    for (let ring = 0; ring < WALL_RINGS; ring++)
    {
        for (const f of [...faces])
        {
            for (let h = f * 4; h < f * 4 + 4; h++)
            {
                if (canCross(world, h))
                {
                    faces.add(faceOf(world.twin(h)))
                }
                else
                {
                    walls.add(h)
                }
            }
        }
    }
    return [...walls]
}


/**
 * Returns the face a point is on when coming from a nearby face, null if it would take going through a wall
 */
function faceAt(world: PatchWorld, from: number, x: number, z: number): number | null
{
    let face = from
    for (let i = 0; i < MAX_CROSSINGS; i++)
    {
        const [cx, cz] = faceCenter(world, face)
        let crossed = -1
        let furthest = 0
        for (let h = face * 4; h < face * 4 + 4; h++)
        {
            edgeEnds(world, h, ends)
            const [x0, z0, x1, z1] = ends
            const side = (x1 - x0) * (z - z0) - (z1 - z0) * (x - x0)
            const inner = (x1 - x0) * (cz - z0) - (z1 - z0) * (cx - x0)
            // the edge the point is furthest behind, going by the height of the triangle with it
            const behind = side * inner < 0 ? Math.abs(side) / Math.hypot(x1 - x0, z1 - z0) : 0
            if (behind > furthest)
            {
                crossed = h
                furthest = behind
            }
        }
        if (crossed < 0)
        {
            return face
        }
        if (!canCross(world, crossed))
        {
            return null
        }
        face = faceOf(world.twin(crossed))
    }
    return null
}


/**
 * Moves someone over the floor of a level. They slide along the walls in their way, and stay out of them by their radius.
 *
 * @param world     world with all patches of the level
 * @param spot      where they are, gets changed to where they end up
 * @param dx        movement in world units
 * @param dz        movement in world units
 * @param radius    how much room they need around them, in world units and less than half a face
 */
export function moveOnFloor(world: PatchWorld, spot: FloorSpot, dx: number, dz: number, radius: number): void
{
    // small enough steps can't jump over a wall
    const steps = Math.ceil(Math.hypot(dx, dz) / radius)
    for (let i = 0; i < steps; i++)
    {
        let x = spot.x + dx / steps
        let z = spot.z + dz / steps
        const walls = wallsAround(world, spot.face)
        // getting out of one wall can get into another one in a corner
        for (let pass = 0; pass < PUSH_PASSES; pass++)
        {
            for (const h of walls)
            {
                edgeEnds(world, h, ends)
                const [x0, z0, x1, z1] = ends
                const ex = x1 - x0, ez = z1 - z0
                const t = Math.max(0, Math.min(1, ((x - x0) * ex + (z - z0) * ez) / (ex * ex + ez * ez)))
                const ox = x - (x0 + t * ex), oz = z - (z0 + t * ez)
                const distance = Math.hypot(ox, oz)
                if (distance > 0 && distance < radius)
                {
                    x += ox * (radius / distance - 1)
                    z += oz * (radius / distance - 1)
                }
            }
        }
        const face = faceAt(world, spot.face, x, z)
        if (face === null)
        {
            return
        }
        spot.face = face
        spot.x = x
        spot.z = z
    }
}


/**
 * Returns the face next to the given one that lies most in the given direction and can be walked to, if any.
 *
 * @param world     world with all patches of the level
 * @param face      global id of the face
 * @param x         direction in world units
 * @param z         direction in world units
 */
export function nextFace(world: PatchWorld, face: number, x: number, z: number): number | null
{
    const [cx, cz] = faceCenter(world, face)
    const length = Math.hypot(x, z)
    let best: number | null = null
    // at least closer to the direction than to a right angle of it
    let bestShare = Math.SQRT1_2
    for (let h = face * 4; h < face * 4 + 4; h++)
    {
        const twin = world.twin(h)
        if (twin < 0)
        {
            continue
        }
        const other = faceOf(twin)
        if (EDGE_COSTS[world.edgeType(h)] + DEFAULT_COSTS[world.faceType(other)] < Infinity)
        {
            const [ox, oz] = faceCenter(world, other)
            const share = ((ox - cx) * x + (oz - cz) * z) / (Math.hypot(ox - cx, oz - cz) * length)
            if (share > bestShare)
            {
                best = other
                bestShare = share
            }
        }
    }
    return best
}
