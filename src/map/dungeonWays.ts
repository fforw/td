import { faceCenter, SEGMENT_SIZE } from "./dungeonLights"
import type { DungeonLevel } from "./generateDungeon"
import { FaceType } from "./geometry"
import type PatchWorld from "./PatchWorld"
import { LOCAL_MASK } from "./PatchWorld"
import { faceOf, next } from "./QuadPatch"
import { findRoute, slotOf } from "./route"
import { SCALE } from "./scale"

/**
 * Most faces between someone and the floor face they go by
 */
const MAX_CROSSINGS = 32

const PUSH_PASSES = 3

/**
 * Size of the grid cells of the walls in world units
 */
const CELL_SIZE = 1

/**
 * Keeps the columns of the grid apart, far more than a level has rows
 */
const CELL_FACTOR = 1 << 16

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
 * Walls of a level as they got built, sorted into a grid for finding the ones close to someone
 */
export interface FloorWalls
{
    segments: Float64Array

    /**
     * Room someone needs around them, in world units
     */
    radius: number

    /**
     * Offsets of the segments within reach of each cell of the grid
     */
    cells: Map<number, number[]>
}


function cellKey(x: number, z: number): number
{
    return Math.floor(x / CELL_SIZE) * CELL_FACTOR + Math.floor(z / CELL_SIZE)
}


/**
 * Prepares the walls of a level for moveOnFloor().
 *
 * @param segments  walls from findWallSegments()
 * @param radius    how much room someone needs around them, in world units
 */
export function createFloorWalls(segments: Float64Array, radius: number): FloorWalls
{
    const cells = new Map<number, number[]>()
    for (let s = 0; s < segments.length; s += SEGMENT_SIZE)
    {
        const minX = Math.min(segments[s], segments[s + 2]) - radius, maxX = Math.max(segments[s], segments[s + 2]) + radius
        const minZ = Math.min(segments[s + 1], segments[s + 3]) - radius, maxZ = Math.max(segments[s + 1], segments[s + 3]) + radius
        for (let x = Math.floor(minX / CELL_SIZE); x <= Math.floor(maxX / CELL_SIZE); x++)
        {
            for (let z = Math.floor(minZ / CELL_SIZE); z <= Math.floor(maxZ / CELL_SIZE); z++)
            {
                const key = x * CELL_FACTOR + z
                const cell = cells.get(key)
                if (cell)
                {
                    cell.push(s)
                }
                else
                {
                    cells.set(key, [s])
                }
            }
        }
    }
    return { segments, radius, cells }
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
 * Returns the face a point lies on when coming from a nearby face, whatever is in between, null if there is no such face
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
        const twin = world.twin(crossed)
        if (twin < 0)
        {
            return null
        }
        face = faceOf(twin)
    }
    return null
}


/**
 * Returns the floor face to go by for someone at a point. Walls don't fill their faces, so someone close to one can be on a
 * wall face, and then goes by the floor next to it if that is closer than the one they came from.
 */
function floorFaceAt(world: PatchWorld, from: number, x: number, z: number): number
{
    const face = faceAt(world, from, x, z)
    if (face === null)
    {
        return from
    }
    if (world.faceType(face) === FaceType.PAVED.index)
    {
        return face
    }

    const [fromX, fromZ] = faceCenter(world, from)
    let closest = from
    let shortest = Math.hypot(fromX - x, fromZ - z)
    for (let h = face * 4; h < face * 4 + 4; h++)
    {
        const twin = world.twin(h)
        if (twin >= 0 && world.faceType(faceOf(twin)) === FaceType.PAVED.index)
        {
            const [cx, cz] = faceCenter(world, faceOf(twin))
            const distance = Math.hypot(cx - x, cz - z)
            if (distance < shortest)
            {
                closest = faceOf(twin)
                shortest = distance
            }
        }
    }
    return closest
}


/**
 * Returns whether a step would go into or through a wall. Walls with a side can be left, for someone who came in on a way
 * that cuts a corner to be able to get out again.
 */
function hitsWall({ segments, cells }: FloorWalls, x0: number, z0: number, x1: number, z1: number): boolean
{
    const dx = x1 - x0, dz = z1 - z0
    for (const cell of [cells.get(cellKey(x0, z0)), cells.get(cellKey(x1, z1))])
    {
        for (const s of cell ?? [])
        {
            if (segments[s + 4] * dx + segments[s + 5] * dz > 0)
            {
                continue
            }
            const ax = segments[s], az = segments[s + 1], ex = segments[s + 2] - ax, ez = segments[s + 3] - az
            const across = dx * ez - dz * ex
            if (across !== 0)
            {
                const t = ((ax - x0) * ez - (az - z0) * ex) / across
                const u = ((ax - x0) * dz - (az - z0) * dx) / across
                if (t >= 0 && t <= 1 && u >= 0 && u <= 1)
                {
                    return true
                }
            }
        }
    }
    return false
}


/**
 * Moves someone over the floor of a level. They slide along the walls in their way, and stay out of them by their radius.
 *
 * @param world     world with all patches of the level
 * @param walls     walls of the level
 * @param spot      where they are, gets changed to where they end up
 * @param dx        movement in world units
 * @param dz        movement in world units
 */
export function moveOnFloor(world: PatchWorld, walls: FloorWalls, spot: FloorSpot, dx: number, dz: number): void
{
    const { segments, radius, cells } = walls
    // small enough steps can't jump over a wall
    const steps = Math.ceil(Math.hypot(dx, dz) / radius)
    for (let i = 0; i < steps; i++)
    {
        let x = spot.x + dx / steps
        let z = spot.z + dz / steps
        // getting out of one wall can get into another one in a corner
        for (let pass = 0; pass < PUSH_PASSES; pass++)
        {
            for (const s of cells.get(cellKey(x, z)) ?? [])
            {
                const x0 = segments[s], z0 = segments[s + 1]
                const ex = segments[s + 2] - x0, ez = segments[s + 3] - z0
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
        // a gap too narrow pushes back and forth, and can end up on the far side of a wall
        if (Math.hypot(x - spot.x, z - spot.z) > radius * 2 || hitsWall(walls, spot.x, spot.z, x, z))
        {
            return
        }
        spot.face = floorFaceAt(world, spot.face, x, z)
        spot.x = x
        spot.z = z
    }
}
