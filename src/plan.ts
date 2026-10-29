import { countNeighborsInSet } from "./util"
import type Castle from "./Castle"
import { getNeighbors } from "./Castle"
import type { Face, HalfEdge, Point, Vertex } from "./geometry"
import { FaceType } from "./geometry"

const TAU = Math.PI * 2;

/**
 * Wall face candidate with its distance and whether it borders the inside of the wall (1) or not (0)
 */
type Candidate = [Face, number, number]

/**
 * Face with the gate point next to it
 */
export type Gate = [Face, Point]

function sortCandidatesDesc(a: Candidate, b: Candidate): number
{
    const insideWallNeighbors = b[2] - a[2]
    if (insideWallNeighbors !== 0)
    {
        return insideWallNeighbors;
    }

    return b[1] - a[1]
}

export function distance(ptA: Point, ptB: Point): number
{
    const [x0,y0] = ptA
    const [x1,y1] = ptB
    const dx = x1-x0
    const dy = y1-y0
    return Math.sqrt(dx*dx+dy*dy)
}


export function followEnd(pts: Point[], face: Face, visited: Set<Face>, prev: Point, endId: number, insideWall: Set<Face>): boolean
{

    const limit = 32 * 32

    //console.log("followEnd", face.id, "endId=",endId)

    visited.add(face)

    const [centroidX,centroidY] = face.centroid

    let d = limit
    if (pts.length)
    {
        const [prevX,prevY] = pts[pts.length-1]
        const dx = centroidX - prevX
        const dy = centroidY - prevY
        d = (dx * dx + dy * dy)
    }
    const aboveLimit = d >= limit
    if (aboveLimit)
    {
        pts.push(face.centroid)
    }

    if (pts.length > 2)
    {
        let first = face.halfEdge
        let curr = first
        do
        {
            const next = curr.next
            const { twin } = curr
            if (twin)
            {
                if (twin.face.type === FaceType.GATE)
                {
                    if (!aboveLimit)
                    {
                        // don't want to skip our last point
                        pts.push(face.centroid)
                    }
                    pts.push(midPoint(curr.vertex, next.vertex))
                    return true

                }
            }
            
            curr = next
        } while (curr !== first)

        first = face.halfEdge
        curr = first
        do
        {
            const next = curr.next
            const { twin } = curr
            if (twin)
            {
                if (twin.face.type !== FaceType.WALL)
                {
                    const first = twin.face.halfEdge

                    let curr = first
                    do
                    {
                        const next = curr.next
                        const { twin: nextTwin } = curr

                        if (nextTwin && nextTwin.face.type === FaceType.GATE)
                        {
                            if (!aboveLimit)
                            {
                                // don't want to skip our last point
                                pts.push(face.centroid)
                            }
                            pts.push(midPoint(curr.vertex, next.vertex))
                            return true
                        }

                        curr = next
                    } while (curr !== first)
                }
            }
            curr = next
        } while (curr !== first)
    }

    const refs = pts.slice(-3)
    prev = refs[0]

    let first = face.halfEdge;
    let curr = first;

    const candidates: Candidate[] = []
    const rejects: Face[] = []
    do
    {
        const next = curr.next;

        const { twin } = curr
        if (twin && !visited.has(twin.face))
        {
            if (twin.face.type === FaceType.WALL)
            {
                const dist = distance(prev, twin.face.centroid)
                const inside = countNeighborsInSet(twin.face, insideWall)
                candidates.push([twin.face, dist, inside && 1])
            }
            else
            {
                rejects.push(twin.face)
            }
        }

        curr = next
    }  while (curr !== first)

    for (let i = 0; i < rejects.length; i++)
    {
        const reject = rejects[i]

        // we get the neighbors so that the face we're coming from is at 0
        const neighbors = getNeighbors(reject, face)

        // this makes offset 1 going left
        const leftNeighbor = neighbors[1]
        // and offset 3 going right... and we ignore 2 (topologically straight-ahead)
        const rightNeighbor = neighbors[3]

        const leftInside = countNeighborsInSet(leftNeighbor, insideWall)

        if (leftNeighbor.type === FaceType.WALL && !visited.has(leftNeighbor))
        {
            const dist = distance(prev, leftNeighbor.centroid)
            candidates.push([leftNeighbor, dist, leftInside && 1])
            break
        }
        else
        {
            const rightInside = countNeighborsInSet(rightNeighbor, insideWall)
            if (rightNeighbor.type === FaceType.WALL && !visited.has(rightNeighbor))
            {
                const dist = distance(prev, rightNeighbor.centroid)
                candidates.push([rightNeighbor, dist, rightInside && 1])
                break
            }
        }

    }

    if (candidates.length)
    {
        if (candidates.length > 1)
        {
            candidates.sort(sortCandidatesDesc)
            //console.log("BEST: #" + candidates[0][0].id, "CANDIDATES", candidates)
        }

        let attempt = 0

        while (attempt < candidates.length)
        {
            if (followEnd(pts, candidates[attempt][0], visited, face.centroid, endId, insideWall))
            {
                return true
            }
            else
            {
                console.log("BACKTRACK")
                attempt++
            }
        }
    }
    return false
}


export function midPoint(vertexA: Vertex, vertexB: Vertex): Point
{
    return [
        (vertexA.x + vertexB.x) >> 1,
        (vertexA.y + vertexB.y) >> 1,
        (vertexA.z + vertexB.z) >> 1
    ]
}


function findHalfEge(first: HalfEdge, face: Face): HalfEdge
{
    let curr = first
    do
    {
        const { twin } = curr
        if (twin)
        {
            if (twin.face === face)
            {
                return curr
            }
        }
        curr = curr.next
    } while (curr !== first)

    throw new Error("Could not find face #" + face.id + " in halfEdge loop.")
}


export function findGate(face: Face): Gate[]
{
    const first = face.halfEdge;
    let curr = first;

    const out: Gate[] = []
    const rejects: Face[] = []
    do
    {
        const next = curr.next;

        const { twin } = curr
        if (twin)
        {
            if (twin.face.type === FaceType.GATE)
            {
                out.push([twin.face, midPoint(curr.vertex,next.vertex)])
            }
            else
            {
                rejects.push(twin.face)
            }
        }

        curr = next
    }  while (curr !== first)

    for (let i = 0; i < rejects.length; i++)
    {
        const reject = rejects[i]


        const first = reject.halfEdge;

        const he0 = findHalfEge(first,face)

        const he1 = he0.next
        const he3 = he1.next.next

        if (he1.twin && he1.twin.face.type === FaceType.GATE)
        {
            out.push([reject, midPoint(he1.vertex,he1.next.vertex)])
        }
        else if (he3.twin && he3.twin.face.type === FaceType.GATE)
        {
            out.push([reject, midPoint(he3.vertex,he3.next.vertex)])
        }
    }

    return out
}

export const TAU_8TH = TAU/8

export function squareFace(face: Face): [Point, number, number]
{
    const { centroid } = face

    const first = face.halfEdge
    let curr = first

    let minDistance = Infinity
    let vertex: Vertex | undefined

    do
    {
        const next = curr.next
        const { twin } = curr
        if (twin)
        {
            const dx = centroid[0] - curr.vertex.x
            const dy = centroid[1] - curr.vertex.y

            const d = Math.sqrt(dx * dx + dy * dy)
            if (d < minDistance)
            {
                minDistance = d
                vertex = curr.vertex
            }
        }

        curr = next
    } while (curr !== first)

    return [
        centroid,
        16,//minDistance * 1.4,
        Math.atan2(vertex!.y - centroid[1],vertex!.x - centroid[0]) - TAU_8TH
    ]
}


/**
 * Follows the wall segments of the given castle from gate to gate and returns the resulting wall paths. The first
 * point of every path is the midpoint of the edge to the gate it starts at.
 */
export function wallPaths(castle: Castle): Point[][]
{
    const { segments, insideWall } = castle

    const visited = new Set<Face>()
    const paths: Point[][] = []

    for (let i = 0; i < segments.length; i++)
    {
        const segment = segments[i]
        let ends: [Face, Gate][] = []

        for (let j = 0; j < segment.length; j++)
        {
            const face = segment[j]
            const gates = findGate(face)
            if (gates.length > 0)
            {
                ends.push([face, gates[0]])
                break;
            }
        }

        //console.log("ENDS", ends)

        for (let j = 0; j < ends.length; j++)
        {
            const [face,[prev,pt]] = ends[j]

            if (!visited.has(face) && countNeighborsInSet(face, visited) === 0)
            {
                const points = [ pt ]
                followEnd(  // entry
                    points,
                    face,
                    visited,
                    prev.centroid,
                    j,
                    insideWall
                )
                paths.push(points)
            }
        }
    }
    return paths
}
