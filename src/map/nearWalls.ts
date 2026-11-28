import { faceCenter } from "./dungeonLights"
import type { Corridor } from "./dungeonCorridors"
import { EdgeType } from "./geometry"
import PatchWorld, { LOCAL_MASK, SLOT_SHIFT } from "./PatchWorld"
import { next } from "./QuadPatch"
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
 * How far into a thick wall the cut reaches from the floor it is near for, in world units, against the view. Only cutting
 * the edge would do for seeing the floor, but leaves the camera side of the wall standing as a block next to the room. It
 * counts from the faces of the floor, which the outline of the wall from marching squares stays clear of a bit.
 */
export const THICK_WALL_CUT_DEPTH = 1.2

/**
 * Distance between the places to look for floor at behind a thick wall, in world units
 */
const FLOOR_STEP = 0.1

/**
 * How far to both sides there has to be floor as well, in world units, or else the wall runs along the view there
 */
const FLOOR_ASIDE = 0.15

/**
 * Makes one key of the two coordinates of a cell, more than levels are wide in world units
 */
const CELL_STRIDE = 1 << 16

/**
 * The spaces a wall is near for, 0 for none. A wall is near for a space if it stands between the camera and floor of the
 * space right behind it. At the angle of the view a wall hides about a face of floor behind it, so it takes no more than
 * looking at what's next to a wall, as deep as THICK_WALL_CUT_DEPTH.
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


function cellKey(x: number, z: number): number
{
    return Math.floor(x) * CELL_STRIDE + Math.floor(z)
}


/**
 * Adds an entry to all cells touched by the box around the given corners, x and z of each. There are as many
 * cells to a world unit as the scale says.
 */
function addToCells<T>(cells: Map<number, T[]>, corners: readonly number[], entry: T, scale = 1): void
{
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
    for (let i = 0; i < corners.length; i += 2)
    {
        minX = Math.min(minX, Math.floor(corners[i] * scale))
        maxX = Math.max(maxX, Math.floor(corners[i] * scale))
        minZ = Math.min(minZ, Math.floor(corners[i + 1] * scale))
        maxZ = Math.max(maxZ, Math.floor(corners[i + 1] * scale))
    }
    for (let cx = minX; cx <= maxX; cx++)
    {
        for (let cz = minZ; cz <= maxZ; cz++)
        {
            const key = cellKey(cx, cz)
            const cell = cells.get(key)
            if (cell)
            {
                cell.push(entry)
            }
            else
            {
                cells.set(key, [entry])
            }
        }
    }
}


/**
 * Returns a function that gives the space at a place in world units, 0 if there is no floor
 */
function createSpaceFinder(world: PatchWorld, spaceOf: ReadonlyMap<number, number>): NearWalls["spaceAt"]
{
    // each face is in all cells of a world unit that the box around it touches
    const cells = new Map<number, { corners: number[], space: number }[]>()
    for (const [face, space] of spaceOf)
    {
        const { positions, vertex } = world.getPatch(face >> (SLOT_SHIFT - 2))
        const first = (face * 4) & LOCAL_MASK
        const corners: number[] = []
        for (let h = first; h < first + 4; h++)
        {
            corners.push(positions[vertex[h] * 3] * SCALE, positions[vertex[h] * 3 + 1] * SCALE)
        }
        addToCells(cells, corners, { corners, space })
    }

    // a plain loop over number keys, this gets called a few 100,000 times per level
    return (x, z) => {
        const cell = cells.get(cellKey(x, z))
        if (cell)
        {
            for (const { corners, space } of cell)
            {
                if (isInside(corners, x, z))
                {
                    return space
                }
            }
        }
        return 0
    }
}


/**
 * Returns whether a place is inside of the polygon with the given corners, x and z of each
 */
function isInside(corners: readonly number[], x: number, z: number): boolean
{
    let inside = false
    for (let i = 0, j = corners.length - 2; i < corners.length; j = i, i += 2)
    {
        const xi = corners[i], zi = corners[i + 1], xj = corners[j], zj = corners[j + 1]
        if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi)
        {
            inside = !inside
        }
    }
    return inside
}


/**
 * Returns what tells the near walls of a level for a view that looks along the given direction on the ground
 */
export function createNearWalls(
    world: PatchWorld,
    level: LevelSpaces,
    away: readonly [number, number] = VIEW_AWAY
): NearWalls
{
    const spaceOf = findSpaces(level)
    return { spaceOf, spaceAt: createSpaceFinder(world, spaceOf), away }
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
 * Returns the spaces each triangle of the thick walls gets cut for, which is the first floor straight behind its middle as
 * the view has it, and the next space behind that within the depth of the cut. A narrow strip of another space between a
 * wall and the open one would else leave the wall standing in front of the open space. Looking any other way finds floor
 * on the other side of thin walls, or spreads the cut along the wall to where it stands in front of another space.
 *
 * Whole triangles get cut, so that the thick walls can be made of closed pieces that each get cut or not, see
 * createThickWalls(). Cutting by corners leaves the edge of the cut to fall across triangles.
 *
 * @param triangles corners of the wall ground as from wallGround(), in patch units
 * @param near      tells the near walls
 *
 * @return spaces for each triangle, [0, 0] for those that stay
 */
export function thickWallCuts(triangles: readonly number[], { spaceAt, away }: NearWalls): NearSpaces[]
{
    const cuts: NearSpaces[] = []
    const steps = Math.round(THICK_WALL_CUT_DEPTH / FLOOR_STEP)
    // the edge of a wall that barely faces enough gets this much further away to the side
    const slack = Math.ceil(FLOOR_ASIDE * Math.sqrt(1 / NEAR_WALL_FACING ** 2 - 1) / FLOOR_STEP)

    // the step the first floor is at, 0 for none
    const firstFloor = (x: number, z: number, count: number): number => {
        for (let step = 1; step <= count; step++)
        {
            const reach = step * FLOOR_STEP
            if (spaceAt(x + away[0] * reach, z + away[1] * reach))
            {
                return step
            }
        }
        return 0
    }

    const asideX = -away[1] * FLOOR_ASIDE, asideZ = away[0] * FLOOR_ASIDE
    for (let i = 0; i < triangles.length; i += 6)
    {
        const x = (triangles[i] + triangles[i + 2] + triangles[i + 4]) / 3 * SCALE
        const z = (triangles[i + 1] + triangles[i + 3] + triangles[i + 5]) / 3 * SCALE
        const step = firstFloor(x, z, steps)
        if (step
            && firstFloor(x + asideX, z + asideZ, step + slack)
            && firstFloor(x - asideX, z - asideZ, step + slack))
        {
            const first = spaceAt(x + away[0] * step * FLOOR_STEP, z + away[1] * step * FLOOR_STEP)
            let second = 0
            for (let next = step + 1; next <= steps && !second; next++)
            {
                const space = spaceAt(x + away[0] * next * FLOOR_STEP, z + away[1] * next * FLOOR_STEP)
                if (space !== first)
                {
                    second = space
                }
            }
            cuts.push([first, second])
        }
        else
        {
            cuts.push([0, 0])
        }
    }
    return cuts
}


/**
 * Cells per world unit to find the triangles of walls in, which are a lot smaller than the faces
 */
const CUT_CELLS = 4


/**
 * Returns a function that tells whether a place in world units is inside of the thick walls
 *
 * @param grounds   wall ground of each patch as from wallGround()
 */
export function createWallFinder(grounds: readonly { triangles: readonly number[] }[]): (x: number, z: number) => boolean
{
    const cells = new Map<number, number[][]>()
    for (const { triangles } of grounds)
    {
        for (let i = 0; i < triangles.length; i += 6)
        {
            const corners = triangles.slice(i, i + 6).map(v => v * SCALE)
            addToCells(cells, corners, corners, CUT_CELLS)
        }
    }
    return (x, z) => cells.get(cellKey(x * CUT_CELLS, z * CUT_CELLS))?.some(corners => isInside(corners, x, z)) ?? false
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
