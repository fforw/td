import { FaceType } from "../map/geometry"
import type { MapArea } from "../map/mapRegions"
import type PatchWorld from "../map/PatchWorld"
import { LOCAL_MASK, SLOT_SHIFT } from "../map/PatchWorld"
import { faceCount } from "../map/QuadPatch"
import { faceCenter } from "../map/dungeonLights"
import { FACE_SIZE } from "../map/scale"

/**
 * Regions on the map of a level, see regionOf(): visited floor, floor nobody has been to yet, and walls and whatever is
 * beyond the level. The last two look the same, only the line along visited floor tells them apart.
 */
export const VISITED_REGION = FaceType.GRASS
export const OPEN_REGION = FaceType.SAND
export const BLOCKED_REGION = FaceType.ROCK


/**
 * Which faces of a level heroes have been to, one bit per face. The faces are counted through the patches in the order they
 * were added to the world, so the bits stay valid as long as generation doesn't change. Saves keep them as base64 with
 * the trailing zero bytes left out, see encode().
 */
export default class Exploration
{
    private readonly bits: Uint8Array

    /** first bit of each patch by slot */
    private readonly offsets: number[] = []

    /**
     * @param world     world with the patches of the level
     * @param slots     slots of the patches in the order they were added
     * @param saved     what encode() returned before, nothing known without it
     */
    constructor(world: PatchWorld, slots: readonly number[], saved?: string)
    {
        let count = 0
        for (const slot of slots)
        {
            this.offsets[slot] = count
            count += faceCount(world.getPatch(slot))
        }
        this.bits = new Uint8Array(Math.ceil(count / 8))
        if (saved)
        {
            const bytes = atob(saved)
            for (let i = 0; i < Math.min(bytes.length, this.bits.length); i++)
            {
                this.bits[i] = bytes.charCodeAt(i)
            }
        }
    }

    private bitOf(face: number): number
    {
        return this.offsets[face >> (SLOT_SHIFT - 2)] + (face & (LOCAL_MASK >> 2))
    }

    has(face: number): boolean
    {
        const bit = this.bitOf(face)
        return (this.bits[bit >> 3] & (1 << (bit & 7))) !== 0
    }

    /**
     * Marks a face as visited
     *
     * @returns true if it wasn't before
     */
    visit(face: number): boolean
    {
        const bit = this.bitOf(face)
        const mask = 1 << (bit & 7)
        if (this.bits[bit >> 3] & mask)
        {
            return false
        }
        this.bits[bit >> 3] |= mask
        return true
    }

    /**
     * Returns whether all of the given faces have been visited
     */
    hasAll(faces: Iterable<number>): boolean
    {
        for (const face of faces)
        {
            if (!this.has(face))
            {
                return false
            }
        }
        return true
    }

    encode(): string
    {
        let end = this.bits.length
        while (end > 0 && this.bits[end - 1] === 0)
        {
            end--
        }
        return btoa(String.fromCharCode(...this.bits.subarray(0, end)))
    }
}


/**
 * Returns those of the monsters placed in a level that are where no hero has been yet. Whatever lived on floor the heroes
 * know is gone for good, so a level only has monsters left where there is something left to find out.
 *
 * @param placed        who goes where, by the face they start on
 * @param exploration   faces the heroes visited
 */
export function inUnexplored<T extends { face: number }>(placed: readonly T[], exploration: Exploration): T[]
{
    return placed.filter(({ face }) => !exploration.has(face))
}


/**
 * Returns the region at a point of the map of a level for createManuscriptMap(), the one of the face with the closest center,
 * which is close enough to the shape of the faces once the map wobbles.
 *
 * @param centers   centers of all faces in map units, as x and y pairs
 * @param visited   whether each of these faces has been visited
 * @param floor     whether each of these faces can be walked on
 */
export function visitedRegions(
    centers: readonly number[],
    visited: readonly boolean[],
    floor: readonly boolean[]
): { faceType(x: number, y: number): FaceType }
{
    const cells = new Map<string, number[]>()
    const cellKey = (column: number, row: number) => column + "/" + row
    for (let i = 0; i < visited.length; i++)
    {
        const key = cellKey(Math.floor(centers[i * 2] / FACE_SIZE), Math.floor(centers[i * 2 + 1] / FACE_SIZE))
        const cell = cells.get(key)
        if (cell)
        {
            cell.push(i)
        }
        else
        {
            cells.set(key, [i])
        }
    }
    return {
        faceType(x: number, y: number): FaceType
        {
            const column = Math.floor(x / FACE_SIZE)
            const row = Math.floor(y / FACE_SIZE)
            // beyond the faces at the border of the level there is nothing
            let shortest = FACE_SIZE
            let closest = -1
            for (let dy = -1; dy <= 1; dy++)
            {
                for (let dx = -1; dx <= 1; dx++)
                {
                    for (const i of cells.get(cellKey(column + dx, row + dy)) ?? [])
                    {
                        const distance = Math.hypot(centers[i * 2] - x, centers[i * 2 + 1] - y)
                        if (distance < shortest)
                        {
                            shortest = distance
                            closest = i
                        }
                    }
                }
            }
            if (closest < 0 || !floor[closest])
            {
                return BLOCKED_REGION
            }
            return visited[closest] ? VISITED_REGION : OPEN_REGION
        }
    }
}


/**
 * Returns the area around the given points in map units with a margin
 */
export function areaAround(points: readonly number[], margin: number): MapArea
{
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let i = 0; i < points.length; i += 2)
    {
        x0 = Math.min(x0, points[i])
        y0 = Math.min(y0, points[i + 1])
        x1 = Math.max(x1, points[i])
        y1 = Math.max(y1, points[i + 1])
    }
    return { x: x0 - margin, y: y0 - margin, width: x1 - x0 + margin * 2, height: y1 - y0 + margin * 2 }
}


/**
 * Returns where to jump to in the rooms with visited floor: the visited face closest to the middle of each room, in world
 * units. The room the hero is in is left out.
 *
 * @param world         world with all patches of the level
 * @param rooms         global face ids per room
 * @param exploration   faces the heroes visited
 * @param at            face the hero is on
 */
export function jumpTargets(
    world: PatchWorld,
    rooms: readonly number[][],
    exploration: Exploration,
    at: number
): { face: number, x: number, z: number }[]
{
    const targets: { face: number, x: number, z: number }[] = []
    for (const room of rooms)
    {
        if (room.includes(at))
        {
            continue
        }
        const visited = room.filter(face => exploration.has(face))
        if (!visited.length)
        {
            continue
        }
        const centers = room.map(face => faceCenter(world, face))
        const midX = centers.reduce((sum, [x]) => sum + x, 0) / centers.length
        const midZ = centers.reduce((sum, [, z]) => sum + z, 0) / centers.length
        let best = { face: visited[0], x: 0, z: 0 }
        let shortest = Infinity
        for (const face of visited)
        {
            const [x, z] = faceCenter(world, face)
            const distance = Math.hypot(x - midX, z - midZ)
            if (distance < shortest)
            {
                best = { face, x, z }
                shortest = distance
            }
        }
        targets.push(best)
    }
    return targets
}
