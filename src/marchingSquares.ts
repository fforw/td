import { FaceType } from "./geometry"
import type { Face, HalfEdge, Vertex } from "./geometry"

/**
 * Marching squares for the ground of a face mesh, ported from the node based version in "islands".
 *
 * The ground types live on the faces, but marching squares needs values on the corners of its cells. So every face is
 * split into one quad cell per corner: the face vertex, the midpoint of the next edge, the face centroid and the
 * midpoint of the previous edge. The centroid always has the type of the face, edges and vertices between faces of
 * different types fall back to the background type, so ground features stay within their faces.
 */

/**
 * Ground types from background to foreground. Foreground types win diagonal connections in saddle cells, background
 * types win the contested edge and vertex samples.
 */
export const GROUND_PRIORITY: FaceType[] = [
    FaceType.GRASS,
    FaceType.TREE,
    FaceType.TREE2,
    FaceType.ROCK,
    FaceType.FOREST_FLOOR,
    FaceType.SAND,
    FaceType.DIRT,
    FaceType.PLOT,
    FaceType.HOUSE,
    FaceType.WATER,
    FaceType.MARKET,
    FaceType.WALL,
    FaceType.GATE,
    FaceType.PAVED,
]

/**
 * Receives a triangle of the given ground type in 2D plan coordinates. The winding is not specified.
 */
export type TriangleCallback = (type: FaceType, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) => void

function rank(type: FaceType): number
{
    return GROUND_PRIORITY.indexOf(type)
}

function background(a: FaceType, b: FaceType): FaceType
{
    return rank(a) <= rank(b) ? a : b
}

/**
 * Most common face type around every vertex, ties going to the background type
 */
function vertexGround(faces: Face[]): Map<Vertex, FaceType>
{
    const counts = new Map<Vertex, Map<FaceType, number>>()
    for (const face of faces)
    {
        const first = face.halfEdge
        let curr = first
        do
        {
            let map = counts.get(curr.vertex)
            if (!map)
            {
                map = new Map()
                counts.set(curr.vertex, map)
            }
            map.set(face.type, (map.get(face.type) ?? 0) + 1)
            curr = curr.next
        } while (curr !== first)
    }

    const ground = new Map<Vertex, FaceType>()
    counts.forEach((map, vertex) => {
        let best: FaceType | null = null
        let bestCount = 0
        map.forEach((count, type) => {
            if (!best || count > bestCount || (count === bestCount && rank(type) < rank(best)))
            {
                best = type
                bestCount = count
            }
        })
        ground.set(vertex, best!)
    })
    return ground
}

function edgeGround(he: HalfEdge): FaceType
{
    const { type } = he.face
    return he.twin ? background(type, he.twin.face.type) : type
}

// cell corner coordinates in order around the cell
const xs = new Float64Array(4)
const ys = new Float64Array(4)
const ground: FaceType[] = new Array(4)

// polygon in unit cell coordinates
const us: number[] = []
const vs: number[] = []

/**
 * Bilinear interpolation of the cell corners. Edge midpoints only depend on the two corners of the edge, so cells
 * sharing an edge also share the points on it.
 */
function emitPolygon(type: FaceType, cb: TriangleCallback): void
{
    const px: number[] = []
    const py: number[] = []
    for (let i = 0; i < us.length; i++)
    {
        const u = us[i]
        const v = vs[i]
        const w0 = (1 - u) * (1 - v)
        const w1 = u * (1 - v)
        const w2 = u * v
        const w3 = (1 - u) * v
        px.push(w0 * xs[0] + w1 * xs[1] + w2 * xs[2] + w3 * xs[3])
        py.push(w0 * ys[0] + w1 * ys[1] + w2 * ys[2] + w3 * ys[3])
    }

    // all case polygons are convex
    for (let i = 2; i < px.length; i++)
    {
        cb(type, px[0], py[0], px[i - 1], py[i - 1], px[i], py[i])
    }

    us.length = 0
    vs.length = 0
}

// unit cell corners matching the corner order
const CU = [0, 1, 1, 0]
const CV = [0, 0, 1, 1]

function corner(i: number): void
{
    us.push(CU[i])
    vs.push(CV[i])
}

function mid(i: number, j: number): void
{
    us.push((CU[i] + CU[j]) / 2)
    vs.push((CV[i] + CV[j]) / 2)
}

function center(): void
{
    us.push(0.5)
    vs.push(0.5)
}

/**
 * Single corner case, the islands "case-1" to "case-8". If the neighboring corners are of different types, the corner
 * takes the whole quadrant ("case-m1" to "case-m4") to not leave a gap in the middle.
 */
function single(i: number, cb: TriangleCallback): void
{
    const next = (i + 1) & 3
    const prev = (i + 3) & 3
    corner(i)
    mid(i, next)
    if (ground[next] !== ground[prev])
    {
        center()
    }
    mid(prev, i)
    emitPolygon(ground[i], cb)
}

function marchCell(cb: TriangleCallback): void
{
    for (let i = 0; i < 4; i++)
    {
        const type = ground[i]

        // handle every type once, at its first corner
        if (ground.indexOf(type) !== i)
        {
            continue
        }

        let mask = 0
        let count = 0
        for (let j = 0; j < 4; j++)
        {
            if (ground[j] === type)
            {
                mask |= 1 << j
                count++
            }
        }

        if (count === 1)
        {
            single(i, cb)
            continue
        }

        if (mask === 5 || mask === 10)
        {
            // saddle: the type stays disconnected ("case-5-2", "case-10-2") if the other diagonal is a single
            // foreground type that connects instead.
            const other = ground[i + 1]
            if (other === ground[(i + 3) & 3] && rank(other) > rank(type))
            {
                single(i, cb)
                single(i + 2, cb)
                continue
            }
        }

        for (let j = 0; j < 4; j++)
        {
            const next = (j + 1) & 3
            const inside = (mask & (1 << j)) !== 0
            if (inside)
            {
                corner(j)
            }
            if (inside !== ((mask & (1 << next)) !== 0))
            {
                mid(j, next)
            }
        }
        emitPolygon(type, cb)
    }
}

/**
 * Creates the ground triangles for the given faces.
 */
export default function marchingSquares(faces: Face[], cb: TriangleCallback): void
{
    const vertices = vertexGround(faces)

    for (const face of faces)
    {
        const [cx, cy] = face.centroid

        const first = face.halfEdge
        let curr = first
        let prev = first.prev
        do
        {
            const { vertex } = curr
            const next = curr.next.vertex

            xs[0] = vertex.x
            ys[0] = vertex.y
            xs[1] = (vertex.x + next.x) / 2
            ys[1] = (vertex.y + next.y) / 2
            xs[2] = cx
            ys[2] = cy
            xs[3] = (prev.vertex.x + vertex.x) / 2
            ys[3] = (prev.vertex.y + vertex.y) / 2

            ground[0] = vertices.get(vertex)!
            ground[1] = edgeGround(curr)
            ground[2] = face.type
            ground[3] = edgeGround(prev)

            marchCell(cb)

            prev = curr
            curr = curr.next
        } while (curr !== first)
    }
}
