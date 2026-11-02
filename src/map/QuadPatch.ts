import type { Face, HalfEdge, Vertex } from "./geometry"
import type HexagonPatch from "./HexagonPatch"

/**
 * Number of ints per border entry: q, r and direction of the hexagon edge, position of the neighbor hexagon outside
 * the patch and the first of the two half edges the hexagon edge got subdivided into. The second one is always next
 * on the border, its index is stored as well so we don't have to search for it.
 */
export const BORDER_STRIDE = 7

export const BORDER_Q = 0
export const BORDER_R = 1
export const BORDER_DIR = 2
export const BORDER_NQ = 3
export const BORDER_NR = 4
export const BORDER_FIRST = 5
export const BORDER_SECOND = 6

/**
 * Maximum number of half edges per patch, half edge indexes must fit into the lower bits of a global half edge id.
 */
export const MAX_HALF_EDGES = 1 << 16

/**
 * Packed, immutable form of a finished hexagon patch, made of typed arrays only, so it can be transferred from a worker
 * without copying.
 *
 * All faces are quads. The half edges of face f are 4f to 4f + 3 in loop order, which makes next, prev and the face of
 * a half edge implicit, see next(), prev() and faceOf().
 *
 * Border half edges have no twin inside the patch. Their twin entry holds -2 - the index of the half edge in the seam
 * list instead, which is two entries per border entry, first and second half edge. The twins in neighboring patches are
 * stored outside of the patch, see PatchWorld.
 */
export interface QuadPatch
{
    /**
     * Hexagon position of the patch center
     */
    q: number
    r: number

    /**
     * x/y/z per vertex in integer map units
     */
    positions: Int32Array<ArrayBuffer>

    /**
     * Start vertex per half edge
     */
    vertex: Int32Array<ArrayBuffer>

    /**
     * Twin half edge per half edge or -2 - seam index for border half edges
     */
    twin: Int32Array<ArrayBuffer>

    /**
     * FaceType index per face
     */
    faceType: Uint8Array<ArrayBuffer>

    /**
     * Border entries of BORDER_STRIDE ints per outer hexagon edge
     */
    border: Int32Array<ArrayBuffer>
}


export function next(h: number): number
{
    return (h & ~3) | ((h + 1) & 3)
}


export function prev(h: number): number
{
    return (h & ~3) | ((h + 3) & 3)
}


export function faceOf(h: number): number
{
    return h >> 2
}


/**
 * Returns the seam index of the given border half edge or -1 for half edges with a twin inside the patch.
 */
export function seamIndex(patch: QuadPatch, h: number): number
{
    const twin = patch.twin[h]
    return twin < 0 ? -2 - twin : -1
}


export function faceCount(patch: QuadPatch): number
{
    return patch.faceType.length
}


/**
 * Returns the buffers of the given patch for transferring it.
 */
export function transferables(patch: QuadPatch): ArrayBuffer[]
{
    return [
        patch.positions.buffer,
        patch.vertex.buffer,
        patch.twin.buffer,
        patch.faceType.buffer,
        patch.border.buffer
    ]
}


/**
 * Packs the faces of a finished patch.
 *
 * @param patch     hexagon patch
 * @param faces     quad faces the patch built
 *
 * @return packed patch
 */
export function packPatch(patch: HexagonPatch, faces: Face[]): QuadPatch
{
    const halfEdgeCount = faces.length * 4
    if (halfEdgeCount > MAX_HALF_EDGES)
    {
        throw new Error("Too many half edges for one patch: " + halfEdgeCount)
    }

    const halfEdgeIndexes = new Map<HalfEdge, number>()
    const vertexIndexes = new Map<Vertex, number>()
    const vertexList: Vertex[] = []

    const faceType = new Uint8Array(faces.length)
    for (let f = 0; f < faces.length; f++)
    {
        const face = faces[f]
        faceType[f] = face.type.index

        let curr = face.halfEdge
        for (let i = 0; i < 4; i++)
        {
            halfEdgeIndexes.set(curr, f * 4 + i)
            if (!vertexIndexes.has(curr.vertex))
            {
                vertexIndexes.set(curr.vertex, vertexList.length)
                vertexList.push(curr.vertex)
            }
            curr = curr.next
        }
        if (curr !== face.halfEdge)
        {
            throw new Error("Not a quad: face #" + face.id)
        }
    }

    const border = new Int32Array(patch.border.size * BORDER_STRIDE)
    const seams = new Map<HalfEdge, number>()
    let off = 0
    patch.border.forEach(({ q, r, dir, nq, nr, first, second }) => {
        seams.set(first, off / BORDER_STRIDE * 2)
        seams.set(second, off / BORDER_STRIDE * 2 + 1)

        border[off + BORDER_Q] = q
        border[off + BORDER_R] = r
        border[off + BORDER_DIR] = dir
        border[off + BORDER_NQ] = nq
        border[off + BORDER_NR] = nr
        border[off + BORDER_FIRST] = halfEdgeIndexes.get(first)!
        border[off + BORDER_SECOND] = halfEdgeIndexes.get(second)!
        off += BORDER_STRIDE
    })

    const vertex = new Int32Array(halfEdgeCount)
    const twin = new Int32Array(halfEdgeCount)
    halfEdgeIndexes.forEach((h, he) => {
        const { vertex: v, twin: t } = he
        vertex[h] = vertexIndexes.get(v)!
        if (t)
        {
            twin[h] = halfEdgeIndexes.get(t)!
        }
        else
        {
            const seam = seams.get(he)
            if (seam === undefined)
            {
                throw new Error("Border half edge without border entry")
            }
            twin[h] = -2 - seam
        }
    })

    const positions = new Int32Array(vertexList.length * 3)
    for (let i = 0; i < vertexList.length; i++)
    {
        const { x, y, z } = vertexList[i]
        positions[i * 3] = x
        positions[i * 3 + 1] = y
        positions[i * 3 + 2] = z
    }

    return {
        q: patch.q,
        r: patch.r,
        positions,
        vertex,
        twin,
        faceType,
        border
    }
}
