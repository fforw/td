import { faceCenter } from "./dungeonLights"
import type { Corridor } from "./dungeonCorridors"
import { EdgeType } from "./geometry"
import PatchWorld, { SLOT_SHIFT } from "./PatchWorld"
import { faceCount, next } from "./QuadPatch"
import { SCALE } from "./scale"

/**
 * Direction on the ground the fixed view of a level looks along, away from the camera, as x and z
 */
export const VIEW_AWAY: readonly [number, number] = [0, -1]

/**
 * Least a wall has to face away from the camera to count as near, as the cosine of the angle between the view and the way
 * from the wall to the floor behind it. Walls running along the view hide next to nothing and stay up.
 */
export const NEAR_WALL_FACING = 0.35

/**
 * How far behind the outline of a thick wall to look for the floor it hides, in world units. The outline comes from
 * marching squares and doesn't run along the edges of the faces.
 */
const FLOOR_PROBES = [0.25, 0.5, 0.75]

/**
 * How far into a thick wall the cut reaches from the floor it is near for, in world units, about a face. Only cutting the
 * edge would do for seeing the floor, but leaves the camera side of the wall standing as a block next to the room.
 */
export const THICK_WALL_CUT_DEPTH = 0.9

/**
 * The spaces a wall is near for, 0 for none. A wall is near for a space if it stands between the camera and floor of the
 * space right behind it. Walls are lower than a face is wide and the view is steep, so nothing further away gets hidden,
 * and it takes no more than looking at what's next to a wall.
 */
export type NearSpaces = [number, number]

/**
 * The floor of a level by space, as in DungeonLevel
 */
export interface LevelSpaces
{
    rooms: readonly (readonly number[])[]
    corridors: readonly Pick<Corridor, "faces">[]
}

/**
 * What it takes to tell which walls are near for which space
 */
export interface NearWalls
{
    /** space by global face id, from 1: the rooms in their order, then the corridors */
    spaceOf: ReadonlyMap<number, number>
    /** returns the space at a place in world units, 0 if there is no floor */
    spaceAt: (x: number, z: number) => number
    /** direction on the ground the view looks along, a unit vector */
    away: readonly [number, number]
}


/**
 * Returns the space of each floor face of a level, from 1: the rooms in their order, then the corridors
 */
export function findSpaces({ rooms, corridors }: LevelSpaces): Map<number, number>
{
    const spaceOf = new Map<number, number>()
    rooms.forEach((faces, room) => faces.forEach(face => spaceOf.set(face, room + 1)))
    corridors.forEach(({ faces }, corridor) => {
        for (const face of faces)
        {
            if (!spaceOf.has(face))
            {
                spaceOf.set(face, rooms.length + corridor + 1)
            }
        }
    })
    return spaceOf
}


/**
 * Returns a function that gives the space at a place in world units, 0 if there is no floor. It goes by the closest
 * middle of a face, which is the face around the place for faces that are close to squares.
 */
function createSpaceFinder(world: PatchWorld, slots: readonly number[], spaceOf: ReadonlyMap<number, number>): NearWalls["spaceAt"]
{
    const cells = new Map<string, number[]>()
    for (const slot of slots)
    {
        const count = faceCount(world.getPatch(slot))
        for (let local = 0; local < count; local++)
        {
            const [x, z] = faceCenter(world, (slot << (SLOT_SHIFT - 2)) | local)
            const key = Math.floor(x) + "," + Math.floor(z)
            const cell = cells.get(key)
            const entry = [x, z, spaceOf.get((slot << (SLOT_SHIFT - 2)) | local) ?? 0]
            if (cell)
            {
                cell.push(...entry)
            }
            else
            {
                cells.set(key, entry)
            }
        }
    }

    return (x, z) => {
        let best = 1, space = 0
        const cx = Math.floor(x), cz = Math.floor(z)
        for (let ix = cx - 1; ix <= cx + 1; ix++)
        {
            for (let iz = cz - 1; iz <= cz + 1; iz++)
            {
                const cell = cells.get(ix + "," + iz)
                for (let i = 0; cell && i < cell.length; i += 3)
                {
                    const distance = (cell[i] - x) ** 2 + (cell[i + 1] - z) ** 2
                    if (distance < best)
                    {
                        best = distance
                        space = cell[i + 2]
                    }
                }
            }
        }
        return space
    }
}


/**
 * Returns what tells the near walls of a level for a view that looks along the given direction on the ground
 */
export function createNearWalls(
    world: PatchWorld,
    slots: readonly number[],
    level: LevelSpaces,
    away: readonly [number, number] = VIEW_AWAY
): NearWalls
{
    const spaceOf = findSpaces(level)
    return { spaceOf, spaceAt: createSpaceFinder(world, slots, spaceOf), away }
}


function addSpace(spaces: Map<string, NearSpaces>, key: string, space: number): void
{
    const at = spaces.get(key)
    if (!at)
    {
        spaces.set(key, [space, 0])
    }
    else if (at[0] !== space && at[1] === 0)
    {
        at[1] = space
    }
}


/**
 * Returns the spaces the corners of thick walls are near for. A point on the outline takes after the outline segments it
 * ends, and the cut then reaches from there into the wall on the side of the camera.
 *
 * @param triangles corners of the wall ground as from wallGround(), in patch units
 * @param outline   segments as from wallGround(), in patch units, with the wall on their left
 * @param near      tells the near walls
 *
 * @return spaces by "x,z" of the corners as they are in the wall ground, only for those that are near for some space
 */
export function thickWallSpaces(
    triangles: readonly number[],
    outline: readonly (readonly number[])[],
    { spaceAt, away }: NearWalls
): Map<string, NearSpaces>
{
    const spaces = new Map<string, NearSpaces>()
    for (const [x0, z0, x1, z1] of outline)
    {
        // out of the wall, see findWallSegments()
        const length = Math.hypot(x1 - x0, z1 - z0)
        const nx = (z0 - z1) / length, nz = (x1 - x0) / length
        if (!(nx * away[0] + nz * away[1] >= NEAR_WALL_FACING))
        {
            continue
        }

        const mx = (x0 + x1) / 2 * SCALE, mz = (z0 + z1) / 2 * SCALE
        for (const probe of FLOOR_PROBES)
        {
            const space = spaceAt(mx + nx * probe, mz + nz * probe)
            if (space)
            {
                addSpace(spaces, x0 + "," + z0, space)
                addSpace(spaces, x1 + "," + z1, space)
                break
            }
        }
    }

    const edge = [...spaces].map(([key, [space]]) => [...key.split(",").map(Number), space])
    const depth = (THICK_WALL_CUT_DEPTH / SCALE) ** 2
    for (let i = 0; i < triangles.length; i += 2)
    {
        const x = triangles[i], z = triangles[i + 1]
        const key = x + "," + z
        if (spaces.get(key)?.[1])
        {
            continue
        }
        for (const [ex, ez, space] of edge)
        {
            const dx = x - ex, dz = z - ez
            if (dx * away[0] + dz * away[1] <= 0 && dx * dx + dz * dz <= depth)
            {
                addSpace(spaces, key, space)
            }
        }
    }
    return spaces
}


/**
 * Returns the space the thin wall on the given global half edge is near for, 0 for none: that of the face behind it as
 * the view has it, if the wall faces the view enough.
 */
export function thinWallSpace(world: PatchWorld, h: number, { spaceOf, away }: NearWalls): number
{
    const twin = world.twin(h)
    if (twin < 0)
    {
        return 0
    }

    const [ax, az] = faceCenter(world, h >> 2)
    const [bx, bz] = faceCenter(world, twin >> 2)
    const behind = (bx - ax) * away[0] + (bz - az) * away[1] > 0 ? twin : h

    const { positions, vertex } = world.getPatch(h >> SLOT_SHIFT)
    const local = h & ((1 << SLOT_SHIFT) - 1)
    const v0 = vertex[local] * 3, v1 = vertex[next(local)] * 3
    const dx = positions[v1] - positions[v0], dz = positions[v1 + 1] - positions[v0 + 1]
    const facing = Math.abs(-dz * away[0] + dx * away[1]) / Math.hypot(dx, dz)

    return facing >= NEAR_WALL_FACING ? spaceOf.get(behind >> 2) ?? 0 : 0
}


/**
 * Returns the spaces the ends of thin walls are near for, which is what the corners between them go by
 *
 * @return spaces by "x,z" of the ends in world units, only for ends of walls that are near for some space
 */
export function thinWallEndSpaces(world: PatchWorld, slots: readonly number[], near: NearWalls): Map<string, NearSpaces>
{
    const spaces = new Map<string, NearSpaces>()
    for (const slot of slots)
    {
        const { positions, vertex, edgeType } = world.getPatch(slot)
        const base = slot << SLOT_SHIFT
        for (let h = 0; h < edgeType.length; h++)
        {
            if (edgeType[h] !== EdgeType.WALL.index || (base | h) > world.twin(base | h))
            {
                continue
            }
            const space = thinWallSpace(world, base | h, near)
            if (space)
            {
                const v0 = vertex[h] * 3, v1 = vertex[next(h)] * 3
                addSpace(spaces, positions[v0] * SCALE + "," + positions[v0 + 1] * SCALE, space)
                addSpace(spaces, positions[v1] * SCALE + "," + positions[v1 + 1] * SCALE, space)
            }
        }
    }
    return spaces
}
