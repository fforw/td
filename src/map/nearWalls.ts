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
 * Least elevation of the line of sight to the floor in degrees that counts, which is toward the top of the screen
 */
const LEAST_ELEVATION = 18

/**
 * How much the line of sight goes to the side for each unit it goes away, in the perspective from the left to the right of
 * the screen
 */
const VIEW_SPREAD = [0, 0.35, -0.35, 0.7, -0.7]

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
 * Returns the spaces the corners of thick walls are near for, which is the first floor straight behind them as the view
 * has it, and the next space behind that within the depth of the cut. A narrow strip of another space between a wall and
 * the open one would else leave the wall standing in front of the open space. Looking any other way finds floor on the
 * other side of thin walls, or spreads the cut along the wall to where it stands in front of another space.
 *
 * @param triangles corners of the wall ground as from wallGround(), in patch units
 * @param near      tells the near walls
 *
 * @return spaces by "x,z" of the corners as they are in the wall ground, only for those that are near for some space
 */
export function thickWallSpaces(triangles: readonly number[], { spaceAt, away }: NearWalls): Map<string, NearSpaces>
{
    const spaces = new Map<string, NearSpaces>()
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
    for (let i = 0; i < triangles.length; i += 2)
    {
        const x = triangles[i], z = triangles[i + 1]
        const key = x + "," + z
        if (spaces.has(key))
        {
            continue
        }
        const wx = x * SCALE, wz = z * SCALE
        const step = firstFloor(wx, wz, steps)
        if (step
            && firstFloor(wx + asideX, wz + asideZ, step + slack)
            && firstFloor(wx - asideX, wz - asideZ, step + slack))
        {
            const first = spaceAt(wx + away[0] * step * FLOOR_STEP, wz + away[1] * step * FLOOR_STEP)
            let second = 0
            for (let next = step + 1; next <= steps && !second; next++)
            {
                const space = spaceAt(wx + away[0] * next * FLOOR_STEP, wz + away[1] * next * FLOOR_STEP)
                if (space !== first)
                {
                    second = space
                }
            }
            spaces.set(key, [first, second])
        }
    }
    return spaces
}


/**
 * Cells per world unit to find the triangles of walls in, which are a lot smaller than the faces
 */
const CUT_CELLS = 4


/**
 * Tells the spaces a place in the thick walls of a level gets cut for
 */
export type CutFinder = (x: number, z: number) => readonly number[]


/**
 * Returns what tells the spaces places in the thick walls get cut for
 *
 * @param grounds   triangles of the wall ground of each patch as from wallGround(), in patch units, and what
 *                  thickWallSpaces() gives for them
 */
export function createCutFinder(
    grounds: readonly { triangles: readonly number[], spaces: ReadonlyMap<string, NearSpaces> }[]
): CutFinder
{
    // each triangle is in all cells that the box around it touches
    const cells = new Map<number, { corners: number[], cutFor: number[] }[]>()
    for (const { triangles, spaces } of grounds)
    {
        for (let i = 0; i < triangles.length; i += 6)
        {
            const corners: number[] = []
            const cutFor: number[] = []
            for (let j = i; j < i + 6; j += 2)
            {
                corners.push(triangles[j] * SCALE, triangles[j + 1] * SCALE)
                for (const space of spaces.get(triangles[j] + "," + triangles[j + 1]) ?? [])
                {
                    if (space && !cutFor.includes(space))
                    {
                        cutFor.push(space)
                    }
                }
            }
            if (cutFor.length)
            {
                addToCells(cells, corners, { corners, cutFor }, CUT_CELLS)
            }
        }
    }

    return (x, z) => cells.get(cellKey(x * CUT_CELLS, z * CUT_CELLS))?.find(({ corners }) => isInside(corners, x, z))?.cutFor ?? []
}


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
 * Distance between the places to look for cut wall at, in world units
 */
const CUT_STEP = 0.05


/**
 * Returns whether the inside of a side of a thick wall can ever be seen while it has to stay solid: the wall in front of
 * it gets cut for a space, and there is floor of another space behind it. Most of them never are. Which parts of it stay
 * solid then depends on the view, see applyInsideCut().
 *
 * @param x         x of the place on the side in world units
 * @param z         z of the place on the side in world units
 * @param top       height of the wall
 * @param cutAt     tells what gets cut
 * @param near      tells the near walls
 */
export function isExposed(x: number, z: number, top: number, cutAt: CutFinder, { spaceAt, away }: NearWalls): boolean
{
    const reach = top / Math.tan(LEAST_ELEVATION * Math.PI / 180)
    const behind = new Set<number>()
    for (const spread of VIEW_SPREAD)
    {
        const dx = away[0] - away[1] * spread, dz = away[1] + away[0] * spread
        for (let along = 0; along <= reach; along += FLOOR_STEP)
        {
            const space = spaceAt(x + dx * along, z + dz * along)
            if (space)
            {
                behind.add(space)
            }
        }
    }
    if (!behind.size)
    {
        return false
    }

    return VIEW_SPREAD.some(spread => {
        const dx = away[1] * spread - away[0], dz = -away[0] * spread - away[1]
        // from a bit off the side, which is the edge of the triangles
        for (let along = CUT_STEP * 0.1; along <= reach; along += CUT_STEP)
        {
            if (cutAt(x + dx * along, z + dz * along).some(space => behind.size > 1 || !behind.has(space)))
            {
                return true
            }
        }
        return false
    })
}


/**
 * Returns whether the inside of a side of a thick wall is turned to the camera anywhere on the screen
 *
 * @param nx        x of the way out of the wall
 * @param nz        z of the way out of the wall
 * @param near      tells the near walls
 */
export function isFarSide(nx: number, nz: number, { away }: NearWalls): boolean
{
    return VIEW_SPREAD.some(spread => nx * (away[0] - away[1] * spread) + nz * (away[1] + away[0] * spread) > 0)
}


/**
 * Spaces of a level as a grid over its floor
 */
export interface SpaceGrid
{
    /** where the grid starts in world units */
    minX: number
    minZ: number
    /** number of cells */
    width: number
    height: number
    /**
     * two numbers for each cell, row by row along x: the space at its middle, 0 for no floor and -1 for a thick wall
     * there, and for cells with a thin wall one more than the space it is near for, else 0. Thick walls stay clear of the
     * floor a bit, so a cell can have neither.
     */
    cells: Float32Array
}

/**
 * Size of the cells of a space grid in world units
 */
export const SPACE_CELL = 0.05


/**
 * Returns the spaces and thin walls of a level as a grid
 *
 * @param world         world with all patches of the level
 * @param near          tells the near walls
 * @param inThickWall   tells whether a place in world units is inside of the thick walls
 */
export function createSpaceGrid(world: PatchWorld, near: NearWalls, inThickWall: (x: number, z: number) => boolean): SpaceGrid
{
    const { spaceOf, spaceAt } = near
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
    for (const face of spaceOf.keys())
    {
        const { positions, vertex } = world.getPatch(face >> (SLOT_SHIFT - 2))
        const first = (face * 4) & LOCAL_MASK
        for (let h = first; h < first + 4; h++)
        {
            const x = positions[vertex[h] * 3] * SCALE, z = positions[vertex[h] * 3 + 1] * SCALE
            minX = Math.min(minX, x)
            minZ = Math.min(minZ, z)
            maxX = Math.max(maxX, x)
            maxZ = Math.max(maxZ, z)
        }
    }
    const width = Math.ceil((maxX - minX) / SPACE_CELL), height = Math.ceil((maxZ - minZ) / SPACE_CELL)
    const cells = new Float32Array(width * height * 2)
    for (let row = 0; row < height; row++)
    {
        for (let column = 0; column < width; column++)
        {
            const x = minX + (column + 0.5) * SPACE_CELL, z = minZ + (row + 0.5) * SPACE_CELL
            cells[(row * width + column) * 2] = spaceAt(x, z) || (inThickWall(x, z) ? -1 : 0)
        }
    }

    for (const face of spaceOf.keys())
    {
        const slot = face >> (SLOT_SHIFT - 2)
        const { positions, vertex, edgeType } = world.getPatch(slot)
        const first = (face * 4) & LOCAL_MASK
        for (let h = first; h < first + 4; h++)
        {
            if (edgeType[h] !== EdgeType.WALL.index)
            {
                continue
            }
            const value = thinWallSpace(world, (slot << SLOT_SHIFT) | h, near) + 1
            const v0 = vertex[h] * 3, v1 = vertex[next(h)] * 3
            const x = positions[v0] * SCALE, z = positions[v0 + 1] * SCALE
            const dx = positions[v1] * SCALE - x, dz = positions[v1 + 1] * SCALE - z
            // close enough for neighboring cells to touch at least at their corners
            const steps = Math.ceil(Math.hypot(dx, dz) / SPACE_CELL * 2) * 2
            for (let i = 0; i <= steps; i++)
            {
                const column = Math.floor((x + dx * i / steps - minX) / SPACE_CELL)
                const row = Math.floor((z + dz * i / steps - minZ) / SPACE_CELL)
                if (column >= 0 && column < width && row >= 0 && row < height)
                {
                    cells[(row * width + column) * 2 + 1] = value
                }
            }
        }
    }
    return { minX, minZ, width, height, cells }
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
