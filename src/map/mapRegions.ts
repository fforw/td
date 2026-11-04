import Prando from "prando"
import { FaceType } from "./geometry"
import { marchingSquaresPatch } from "./marchingSquares"
import PatchWorld, { LOCAL_MASK, SLOT_SHIFT } from "./PatchWorld"
import { faceCount, faceOf, type QuadPatch } from "./QuadPatch"

/*
 * Generalization of the faces for the old map: what the marching squares draw there are not face types but travel
 * regions, areas that are about the same to cross. Face types of the same cost become one region and a few passes of a
 * majority filter remove what is too small for a map, like a lone tree or a clearing.
 */

/**
 * Face type standing in for the regions of the other face types. All regions are their own stand-in.
 */
const REGIONS = new Map<FaceType, FaceType>([
    [FaceType.PRAIRIE, FaceType.GRASS],
    [FaceType.TREE2, FaceType.TREE],
    [FaceType.FOREST_FLOOR, FaceType.TREE],
    // the castle is a symbol and its walls, the inside is just open land
    [FaceType.DIRT, FaceType.GRASS],
    [FaceType.PAVED, FaceType.GRASS],
    [FaceType.MARKET, FaceType.GRASS],
    [FaceType.PLOT, FaceType.GRASS],
    [FaceType.GATE, FaceType.GRASS],
    [FaceType.HOUSE, FaceType.GRASS],
    [FaceType.TAVERN, FaceType.GRASS]
])

/**
 * Number of majority filter passes
 */
const FILTER_PASSES = 2

/**
 * Connected areas of fewer faces than this are too small to be on the map, the majority filter leaves some of them
 */
const MIN_REGION_FACES = 6

/**
 * Maximum random offset of symbols from their face centroid in map units
 */
const SYMBOL_JITTER = 10

/**
 * Face types shown as symbols where there are many of them, with the minimum distance to other symbols in map units.
 * Between two types the larger distance counts.
 */
const SYMBOL_SPACING = new Map([
    [FaceType.TREE, 240],
    [FaceType.TREE2, 240],
    [FaceType.ROCK, 100],
    [FaceType.SWAMP, 100]
])

/**
 * Cell size of the grid for finding close symbols, the largest spacing
 */
const SYMBOL_GRID = Math.max(...SYMBOL_SPACING.values())


export function regionOf(type: FaceType): FaceType
{
    return REGIONS.get(type) ?? type
}


/**
 * Boundary between two regions, or the part of one next to two others where marching squares has a T-junction. In that
 * case `other` is null and the shorter edges of the other regions are on top of it.
 */
export interface InkEdge
{
    x0: number
    y0: number
    x1: number
    y1: number
    type: FaceType
    other: FaceType | null
}


export interface MapSymbol
{
    x: number
    y: number
    type: FaceType
}


/**
 * Everything the old map shows, in map units
 */
export interface OldMap
{
    /**
     * Outlines per region as closed loops of flat coordinates. Holes run the other way round, so they are holes for the
     * nonzero rule.
     */
    outlines: Map<FaceType, number[][]>
    ink: InkEdge[]
    /**
     * Symbols from north to south, so the ones further south overlap the ones behind them
     */
    symbols: MapSymbol[]
}


/**
 * Calls the given callback with every half edge of a face and the region on its other side. Half edges on the open
 * border of the world are left out.
 */
function forNeighbors(world: PatchWorld, slot: number, face: number, cb: (region: number) => void): void
{
    const base = slot << SLOT_SHIFT
    for (let h = face * 4; h < face * 4 + 4; h++)
    {
        const twin = world.twin(base | h)
        if (twin >= 0)
        {
            cb(world.faceType(faceOf(twin)))
        }
    }
}


/**
 * Returns the region the face should have in the next filter pass
 */
function majorityRegion(world: PatchWorld, slot: number, face: number, counts: Int32Array): number
{
    const own = world.getPatch(slot).faceType[face]
    if (own === FaceType.WALL.index)
    {
        // walls are thin and would be gone otherwise
        return own
    }

    counts.fill(0)
    counts[own] = 1
    forNeighbors(world, slot, face, region => counts[region]++)

    let best = own
    for (let i = 0; i < counts.length; i++)
    {
        if (counts[i] > counts[best] && i !== FaceType.WALL.index)
        {
            best = i
        }
    }
    return best
}


/**
 * Gives connected areas that are too small the region most common around them. Walls stay.
 */
function removeSmallAreas(world: PatchWorld, slots: number, counts: Int32Array): void
{
    const seen = new Set<number>()
    for (let slot = 0; slot < slots; slot++)
    {
        const { faceType } = world.getPatch(slot)
        for (let f = 0; f < faceType.length; f++)
        {
            const start = faceOf((slot << SLOT_SHIFT) | (f * 4))
            if (seen.has(start))
            {
                continue
            }
            seen.add(start)

            const region = faceType[f]
            const area = [start]
            counts.fill(0)
            for (let i = 0; i < area.length; i++)
            {
                const first = area[i] << 2
                for (let h = first; h < first + 4; h++)
                {
                    const twin = world.twin(h)
                    if (twin < 0)
                    {
                        continue
                    }
                    const other = faceOf(twin)
                    const type = world.faceType(other)
                    if (type !== region)
                    {
                        counts[type]++
                    }
                    else if (!seen.has(other))
                    {
                        seen.add(other)
                        area.push(other)
                    }
                }
            }

            if (region !== FaceType.WALL.index && area.length < MIN_REGION_FACES)
            {
                counts[FaceType.WALL.index] = 0
                const best = counts.indexOf(Math.max(...counts))
                for (const face of area)
                {
                    world.getPatch(face >> (SLOT_SHIFT - 2)).faceType[face & (LOCAL_MASK >> 2)] = best
                }
            }
        }
    }
}


/**
 * Returns a world of the same patches in the same order with faces holding generalized regions instead of face types.
 * The given patches stay as they are.
 *
 * @param patches   patches to show together, later patches can change the regions on the seams
 *
 * @return world with the slots being the indexes in the given array
 */
export function generalize(patches: QuadPatch[]): PatchWorld
{
    const world = new PatchWorld()
    for (const patch of patches)
    {
        world.add({ ...patch, faceType: patch.faceType.map(i => regionOf(FaceType.byIndex(i)).index) })
    }

    const counts = new Int32Array(FaceType.typeNames().length)
    for (let pass = 0; pass < FILTER_PASSES; pass++)
    {
        const filtered = patches.map((patch, slot) => {
            const out = new Uint8Array(faceCount(patch))
            for (let f = 0; f < out.length; f++)
            {
                out[f] = majorityRegion(world, slot, f, counts)
            }
            return out
        })
        filtered.forEach((out, slot) => world.getPatch(slot).faceType.set(out))
    }
    removeSmallAreas(world, patches.length, counts)
    return world
}


/**
 * Runs the marching squares over all patches of the world.
 *
 * @return triangles per region as flat lists of six coordinates each
 */
export function marchRegions(world: PatchWorld, slots: number): Map<FaceType, number[]>
{
    const triangles = new Map<FaceType, number[]>()
    for (let slot = 0; slot < slots; slot++)
    {
        marchingSquaresPatch(world, slot, (type, x0, y0, x1, y1, x2, y2) => {
            let list = triangles.get(type)
            if (!list)
            {
                list = []
                triangles.set(type, list)
            }
            list.push(x0, y0, x1, y1, x2, y2)
        })
    }
    return triangles
}


/**
 * Numbers points in map units, which are multiples of 1/16 for everything the marching squares create. Two ids make an
 * edge key that is much faster than strings for the hundreds of thousands of edges of a map.
 */
class PointIds
{
    private ids = new Map<number, number>()

    get(x: number, y: number): number
    {
        const key = Math.round(x * 16) * 0x400000 + Math.round(y * 16)
        let id = this.ids.get(key)
        if (id === undefined)
        {
            id = this.ids.size
            this.ids.set(key, id)
        }
        return id
    }
}


const EDGE_KEY_FACTOR = 0x4000000


/**
 * Finds the boundaries of the regions in their triangles. Edges inside of a region belong to two of its triangles and
 * cancel each other out, the ones left are between regions or on the open border of the world.
 */
export function inkEdges(triangles: Map<FaceType, number[]>): InkEdge[]
{
    const ids = new PointIds()
    const edges = new Map<number, InkEdge>()

    const addEdge = (type: FaceType, x0: number, y0: number, x1: number, y1: number) => {
        const a = ids.get(x0, y0)
        const b = ids.get(x1, y1)
        const key = a < b ? a * EDGE_KEY_FACTOR + b : b * EDGE_KEY_FACTOR + a
        const edge = edges.get(key)
        if (!edge)
        {
            edges.set(key, { x0, y0, x1, y1, type, other: null })
        }
        else if (edge.type === type)
        {
            edges.delete(key)
        }
        else
        {
            edge.other = type
        }
    }

    triangles.forEach((list, type) => {
        for (let i = 0; i < list.length; i += 6)
        {
            addEdge(type, list[i], list[i + 1], list[i + 2], list[i + 3])
            addEdge(type, list[i + 2], list[i + 3], list[i + 4], list[i + 5])
            addEdge(type, list[i + 4], list[i + 5], list[i], list[i + 1])
        }
    })
    return [...edges.values()]
}


/**
 * Traces the closed loops around the triangles of one region. With all triangles running the same way round, the edges
 * inside of the region are there in both directions and cancel each other out, the rest connects to loops.
 */
function traceLoops(list: number[]): number[][]
{
    const ids = new PointIds()

    // directed edges as start point id, end point id and end point coordinates
    const edges = new Map<number, [number, number, number, number]>()
    const addEdge = (x0: number, y0: number, x1: number, y1: number) => {
        const a = ids.get(x0, y0)
        const b = ids.get(x1, y1)
        if (!edges.delete(b * EDGE_KEY_FACTOR + a))
        {
            edges.set(a * EDGE_KEY_FACTOR + b, [a, b, x1, y1])
        }
    }

    for (let i = 0; i < list.length; i += 6)
    {
        const x0 = list[i], y0 = list[i + 1], x1 = list[i + 2], y1 = list[i + 3], x2 = list[i + 4], y2 = list[i + 5]
        if ((x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0) > 0)
        {
            addEdge(x0, y0, x1, y1)
            addEdge(x1, y1, x2, y2)
            addEdge(x2, y2, x0, y0)
        }
        else
        {
            addEdge(x0, y0, x2, y2)
            addEdge(x2, y2, x1, y1)
            addEdge(x1, y1, x0, y0)
        }
    }

    const outgoing = new Map<number, [number, number, number, number][]>()
    edges.forEach(edge => {
        const out = outgoing.get(edge[0])
        if (out)
        {
            out.push(edge)
        }
        else
        {
            outgoing.set(edge[0], [edge])
        }
    })

    const loops: number[][] = []
    outgoing.forEach((out, start) => {
        while (out.length > 0)
        {
            const loop: number[] = []
            let curr = start
            do
            {
                // where loops touch in a point any continuation works, all of them end up in closed loops
                const [, end, x, y] = outgoing.get(curr)!.pop()!
                loop.push(x, y)
                curr = end
            } while (curr !== start)
            loops.push(loop)
        }
    })
    return loops
}


/**
 * Returns the outlines of the regions in the given triangles
 */
export function regionOutlines(triangles: Map<FaceType, number[]>): Map<FaceType, number[][]>
{
    const outlines = new Map<FaceType, number[][]>()
    triangles.forEach((list, type) => outlines.set(type, traceLoops(list)))
    return outlines
}


/**
 * Places symbols on faces that really have the thing the symbol stands for and that are surrounded by their region, so
 * that symbols only show up where there are many of them, and not on the boundaries.
 */
export function placeSymbols(patches: QuadPatch[], world: PatchWorld, seed: number): MapSymbol[]
{
    const prando = new Prando(seed)
    const candidates: MapSymbol[] = []
    let wallX = 0
    let wallY = 0
    let wallCount = 0

    patches.forEach((patch, slot) => {
        const { positions, vertex } = patch
        const regions = world.getPatch(slot).faceType
        for (let f = 0; f < regions.length; f++)
        {
            const type = FaceType.byIndex(patch.faceType[f])
            const region = regions[f]
            const isWall = type === FaceType.WALL
            if (!isWall && (!SYMBOL_SPACING.has(type) || regionOf(type).index !== region))
            {
                continue
            }

            let cx = 0
            let cy = 0
            for (let h = f * 4; h < f * 4 + 4; h++)
            {
                cx += positions[vertex[h] * 3] / 4
                cy += positions[vertex[h] * 3 + 1] / 4
            }

            if (isWall)
            {
                wallX += cx
                wallY += cy
                wallCount++
                continue
            }

            let inside = true
            forNeighbors(world, slot, f, other => inside &&= other === region)
            if (inside)
            {
                candidates.push({
                    x: cx + (prando.next() * 2 - 1) * SYMBOL_JITTER,
                    y: cy + (prando.next() * 2 - 1) * SYMBOL_JITTER,
                    type
                })
            }
        }
    })

    // Fisher-Yates, going through the faces in order would line up the symbols
    for (let i = candidates.length - 1; i > 0; i--)
    {
        const j = prando.nextInt(0, i)
        const tmp = candidates[i]
        candidates[i] = candidates[j]
        candidates[j] = tmp
    }

    const symbols: MapSymbol[] = []
    const grid = new Map<string, MapSymbol[]>()
    for (const symbol of candidates)
    {
        const spacing = SYMBOL_SPACING.get(symbol.type)!
        const gx = Math.floor(symbol.x / SYMBOL_GRID)
        const gy = Math.floor(symbol.y / SYMBOL_GRID)
        let free = true
        for (let y = gy - 1; free && y <= gy + 1; y++)
        {
            for (let x = gx - 1; free && x <= gx + 1; x++)
            {
                free = !grid.get(x + "/" + y)?.some(s =>
                    Math.hypot(s.x - symbol.x, s.y - symbol.y) < Math.max(spacing, SYMBOL_SPACING.get(s.type)!)
                )
            }
        }
        if (free)
        {
            symbols.push(symbol)
            const key = gx + "/" + gy
            grid.set(key, [...(grid.get(key) ?? []), symbol])
        }
    }

    symbols.sort((a, b) => a.y - b.y)
    if (wallCount > 0)
    {
        // the castle stands for its walls, in the middle of them and on top of everything
        symbols.push({ x: wallX / wallCount, y: wallY / wallCount, type: FaceType.WALL })
    }
    return symbols
}


/**
 * Creates an old manuscript style map of the given patches.
 *
 * @param patches   patches to show
 * @param seed      seed for the placement of the symbols
 */
export function createManuscriptMap(patches: QuadPatch[], seed: number): OldMap
{
    const world = generalize(patches)
    const triangles = marchRegions(world, patches.length)
    return { outlines: regionOutlines(triangles), ink: inkEdges(triangles), symbols: placeSymbols(patches, world, seed) }
}
             
