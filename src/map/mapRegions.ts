import Prando from "prando"
import { FaceType } from "./geometry"
import type Terrain from "./terrain"

/*
 * The manuscript map doesn't look at any faces. It scans the climate noise the faces get their types from in a raster of its
 * own and runs marching squares over that, so its cost depends on the size of the raster and not on the size of the part
 * of the world it shows. What the builders change on the faces only shows up as the symbols given as points of interest.
 *
 * What the map draws are not face types but travel regions, areas that are about the same to cross. Face types of the
 * same cost become one region.
 */

/**
 * Face type standing in for the regions of the other face types. All regions are their own stand-in.
 */
const REGIONS = new Map<FaceType, FaceType>([
    [FaceType.PRAIRIE, FaceType.GRASS],
    [FaceType.TREE2, FaceType.TREE]
])

/**
 * Random number that gets the most common face type out of the mixes of the terrain: rock on mountains, trees in forests
 * and no trees in grassland
 */
const TYPICAL = 0.25

/**
 * Number of bisections to find the place on a raster edge where the region changes
 */
const CROSSING_STEPS = 3

/**
 * Face types shown as symbols where there are many of them, with the minimum distance to other symbols in map units.
 * Between two types the larger distance counts. Walls stand for the castle, which keeps the trees away from it.
 */
const SYMBOL_SPACING = new Map([
    [FaceType.TREE, 240],
    [FaceType.TREE2, 240],
    [FaceType.ROCK, 100],
    [FaceType.SWAMP, 100],
    [FaceType.WALL, 240]
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
 * Boundary between two regions
 */
export interface InkEdge
{
    x0: number
    y0: number
    x1: number
    y1: number
    type: FaceType
    other: FaceType
}


export interface MapSymbol
{
    x: number
    y: number
    type: FaceType
}


/**
 * Part of the world in map units
 */
export interface MapArea
{
    x: number
    y: number
    width: number
    height: number
}


/**
 * Everything the old map shows, in map units
 */
export interface ManuscriptMap
{
    /**
     * Outlines per region as closed loops of flat coordinates. Holes run the other way round, so they are holes for the
     * nonzero rule.
     */
    outlines: Map<FaceType, number[][]>
    ink: InkEdge[]
    /**
     * Symbols from north to south, so the ones further south overlap the ones behind them. The points of interest come
     * last, on top of everything.
     */
    symbols: MapSymbol[]
}


/**
 * Face types at the points of a regular grid
 */
interface Raster
{
    area: MapArea
    step: number
    columns: number
    rows: number
    /**
     * Most common face type per grid point, row by row
     */
    types: FaceType[]
}


function scan(terrain: Pick<Terrain, "faceType">, area: MapArea, step: number): Raster
{
    const columns = Math.ceil(area.width / step)
    const rows = Math.ceil(area.height / step)
    const types: FaceType[] = new Array((columns + 1) * (rows + 1))
    for (let row = 0, i = 0; row <= rows; row++)
    {
        for (let column = 0; column <= columns; column++, i++)
        {
            types[i] = terrain.faceType(area.x + column * step, area.y + row * step, () => TYPICAL)
        }
    }
    return { area, step, columns, rows, types }
}


/**
 * Runs marching squares over the regions of the raster.
 */
function marchRaster(terrain: Pick<Terrain, "faceType">, raster: Raster): Pick<ManuscriptMap, "outlines" | "ink">
{
    const { area, step, columns, rows, types } = raster
    const stride = columns + 1
    const regions = types.map(regionOf)

    // coordinates of all points on the boundaries, with their position in here as id
    const points: number[] = []
    const addPoint = (x: number, y: number) => {
        points.push(x, y)
        return (points.length >> 1) - 1
    }

    const crossing = (from: number, to: number) => {
        if (regions[from] === regions[to])
        {
            return -1
        }
        const row = Math.floor(from / stride)
        const x = area.x + (from - row * stride) * step
        const y = area.y + row * step
        const dx = to - from === 1 ? step : 0
        const dy = to - from === 1 ? 0 : step
        let low = 0
        let high = 1
        for (let i = 0; i < CROSSING_STEPS; i++)
        {
            const mid = (low + high) / 2
            if (regionOf(terrain.faceType(x + dx * mid, y + dy * mid, () => TYPICAL)) === regions[from])
            {
                low = mid
            }
            else
            {
                high = mid
            }
        }
        const t = (low + high) / 2
        return addPoint(x + dx * t, y + dy * t)
    }

    // crossing point ids of the grid edges to the right of and below every grid point, -1 where the region stays the same
    const right = new Int32Array(regions.length).fill(-1)
    const down = new Int32Array(regions.length).fill(-1)
    for (let row = 0, i = 0; row <= rows; row++)
    {
        for (let column = 0; column <= columns; column++, i++)
        {
            if (column < columns)
            {
                right[i] = crossing(i, i + 1)
            }
            if (row < rows)
            {
                down[i] = crossing(i, i + stride)
            }
        }
    }

    // directed boundary edges per region as lists of end points by start point, with the region always on the same side
    const directed = new Map<FaceType, Map<number, number[]>>()
    const addDirected = (type: FaceType, from: number, to: number) => {
        let edges = directed.get(type)
        if (!edges)
        {
            edges = new Map()
            directed.set(type, edges)
        }
        const ends = edges.get(from)
        if (ends)
        {
            ends.push(to)
        }
        else
        {
            edges.set(from, [to])
        }
    }

    const ink: InkEdge[] = []
    const addInk = (a: number, b: number, type: FaceType, other: FaceType) => {
        ink.push({ x0: points[a * 2], y0: points[a * 2 + 1], x1: points[b * 2], y1: points[b * 2 + 1], type, other })
    }

    const corners = [0, 0, 0, 0]
    const edges = [0, 0, 0, 0]
    const open: number[] = []
    for (let row = 0; row < rows; row++)
    {
        for (let column = 0; column < columns; column++)
        {
            // clockwise, every edge running from the corner of the same index to the next one
            const i = row * stride + column
            corners[0] = i
            corners[1] = i + 1
            corners[2] = i + stride + 1
            corners[3] = i + stride
            edges[0] = right[i]
            edges[1] = down[i + 1]
            edges[2] = right[i + stride]
            edges[3] = down[i]

            open.length = 0
            for (let e = 0; e < 4; e++)
            {
                if (edges[e] >= 0)
                {
                    open.push(e)
                }
            }

            if (open.length === 2)
            {
                const [e0, e1] = open
                const inner = regions[corners[(e0 + 1) & 3]]
                const outer = regions[corners[(e1 + 1) & 3]]
                addDirected(inner, edges[e1], edges[e0])
                addDirected(outer, edges[e0], edges[e1])
                addInk(edges[e0], edges[e1], inner, outer)
            }
            else if (open.length > 2)
            {
                // three regions or the same two on opposite corners meet in the middle
                let x = 0
                let y = 0
                for (const e of open)
                {
                    x += points[edges[e] * 2] / open.length
                    y += points[edges[e] * 2 + 1] / open.length
                }
                const center = addPoint(x, y)
                open.forEach((e, n) => {
                    const next = open[(n + 1) % open.length]
                    const type = regions[corners[(e + 1) & 3]]
                    addDirected(type, edges[next], center)
                    addDirected(type, center, edges[e])
                    addInk(edges[e], center, regions[corners[e]], type)
                })
            }
        }
    }

    // the open border of the raster closes the outlines of the regions touching it
    const cornerIds = new Map<number, number>()
    const cornerId = (i: number) => {
        let id = cornerIds.get(i)
        if (id === undefined)
        {
            const row = Math.floor(i / stride)
            id = addPoint(area.x + (i - row * stride) * step, area.y + row * step)
            cornerIds.set(i, id)
        }
        return id
    }
    const addBorder = (from: number, to: number, edge: number) => {
        if (edge < 0)
        {
            addDirected(regions[from], cornerId(from), cornerId(to))
        }
        else
        {
            addDirected(regions[from], cornerId(from), edge)
            addDirected(regions[to], edge, cornerId(to))
        }
    }
    for (let column = 0; column < columns; column++)
    {
        addBorder(column, column + 1, right[column])
        const bottom = rows * stride + column
        addBorder(bottom + 1, bottom, right[bottom])
    }
    for (let row = 0; row < rows; row++)
    {
        const first = row * stride
        addBorder(first + columns, first + columns + stride, down[first + columns])
        addBorder(first + stride, first, down[first])
    }

    const outlines = new Map<FaceType, number[][]>()
    directed.forEach((edges, type) => outlines.set(type, traceLoops(edges, points)))
    return { outlines, ink }
}


/**
 * Connects directed edges to closed loops of flat coordinates.
 */
function traceLoops(edges: Map<number, number[]>, points: number[]): number[][]
{
    const loops: number[][] = []
    edges.forEach((ends, start) => {
        while (ends.length > 0)
        {
            const loop: number[] = []
            let curr = start
            do
            {
                // where loops touch in a point any continuation works, all of them end up in closed loops
                curr = edges.get(curr)!.pop()!
                loop.push(points[curr * 2], points[curr * 2 + 1])
            } while (curr !== start)
            loops.push(loop)
        }
    })
    return loops
}


/**
 * Places symbols on raster points surrounded by their region, so that symbols only show up where there are many of them,
 * and not on the boundaries.
 */
function placeSymbols(raster: Raster, pois: MapSymbol[], seed: number): MapSymbol[]
{
    const { area, step, columns, rows, types } = raster
    const stride = columns + 1
    const prando = new Prando(seed)
    const candidates: MapSymbol[] = []

    for (let row = 1; row < rows; row++)
    {
        for (let column = 1; column < columns; column++)
        {
            const i = row * stride + column
            const type = types[i]
            if (!SYMBOL_SPACING.has(type))
            {
                continue
            }

            const region = regionOf(type)
            let inside = true
            for (let y = -1; inside && y <= 1; y++)
            {
                for (let x = -1; inside && x <= 1; x++)
                {
                    inside = regionOf(types[i + y * stride + x]) === region
                }
            }
            if (inside)
            {
                candidates.push({
                    x: area.x + (column + prando.next() - 0.5) * step,
                    y: area.y + (row + prando.next() - 0.5) * step,
                    type
                })
            }
        }
    }

    // Fisher-Yates, going through the raster in order would line up the symbols
    for (let i = candidates.length - 1; i > 0; i--)
    {
        const j = prando.nextInt(0, i)
        const tmp = candidates[i]
        candidates[i] = candidates[j]
        candidates[j] = tmp
    }

    const grid = new Map<string, MapSymbol[]>()
    const add = (symbol: MapSymbol) => {
        const key = Math.floor(symbol.x / SYMBOL_GRID) + "/" + Math.floor(symbol.y / SYMBOL_GRID)
        grid.set(key, [...(grid.get(key) ?? []), symbol])
    }
    pois.forEach(add)

    const symbols: MapSymbol[] = []
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
                    Math.hypot(s.x - symbol.x, s.y - symbol.y) < Math.max(spacing, SYMBOL_SPACING.get(s.type) ?? 0)
                )
            }
        }
        if (free)
        {
            symbols.push(symbol)
            add(symbol)
        }
    }

    symbols.sort((a, b) => a.y - b.y)
    symbols.push(...pois)
    return symbols
}


/**
 * Creates an old manuscript style map of a part of the world.
 *
 * @param terrain   terrain of the world
 * @param area      part of the world to show
 * @param step      distance of the raster points in map units
 * @param pois      symbols of the things builders put into the world
 * @param seed      seed for the placement of the symbols
 */
export function createManuscriptMap(
    terrain: Pick<Terrain, "faceType">,
    area: MapArea,
    step: number,
    pois: MapSymbol[],
    seed: number
): ManuscriptMap
{
    const raster = scan(terrain, area, step)
    return { ...marchRaster(terrain, raster), symbols: placeSymbols(raster, pois, seed) }
}
