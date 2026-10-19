import "./style.css"
import HexagonPatch, { PATCH_SIZE } from "./HexagonPatch"
import { countNeighbors, countNeighborsInSet, countNeighborsOfType, randomSeed, resetRandom, rng } from "./util"
import Castle, { filterNeighbors, getNeighbors } from "./Castle"
import { FaceType } from "./geometry"
import type { Face, HalfEdge, Point, Vertex } from "./geometry"

const PHI = (1 + Math.sqrt(5)) / 2;
const TAU = Math.PI * 2;
const DEG2RAD_FACTOR = TAU / 360;

const config = {
    width: 0,
    height: 0
};

let ctx: CanvasRenderingContext2D;
let canvas: HTMLCanvasElement;

function drawArrow(x0: number, y0: number, x1: number, y1: number): void
{
    const { width, height} = config;

    const cx = width/2;
    const cy = height/2;

    const dy = y1 - y0;
    const dx = x1 - x0;

    if (dx * dx + dy * dy > 2)
    {
        const nx = dy * 0.08
        const ny = -dx * 0.08

        const start = 0.01
        const end = 0.5

        const x2 = x0 + (x1 - x0) * start
        const y2 = y0 + (y1 - y0) * start
        const x3 = x0 + (x1 - x0) * end
        const y3 = y0 + (y1 - y0) * end

        const x4 = x0 + (x1 - x0) * (start + (end - start) * 0.6)
        const y4 = y0 + (y1 - y0) * (start + (end - start) * 0.6)

        ctx.beginPath()
        ctx.moveTo(cx + x2, cy + y2)
        ctx.lineTo(cx + x3, cy + y3)

        ctx.moveTo(cx + x3, cy + y3)
        ctx.lineTo(cx + x4 + nx, cy + y4 + ny)
        ctx.moveTo(cx + x3, cy + y3)
        ctx.lineTo(cx + x4 - nx, cy + y4 - ny)
        ctx.stroke()
    }
}


function renderDebugFace(face: Face, drawNext = false, ids = false): void
{
    const { width, height} = config;

    const cx = width/2;
    const cy = height/2;

    const faceCentroid = face.centroid

    ctx.save()
    if (ids)
    {
        const label = String(face.id);
        const tm = ctx.measureText(label);
        ctx.fillStyle = "#ccc"
        ctx.fillText(label, cx + faceCentroid[0] - tm.width/2, cy + faceCentroid[1] + 4)
    }
    // else
    // {
    //     ctx.fillStyle = "#0f0"
    //     ctx.fillRect(cx + faceCentroid[0] - 1, cy + faceCentroid[1] - 1, 2, 2)
    // }
    ctx.restore()

    const first = face.halfEdge;
    let curr = first;

    ctx.save()

    ctx.strokeStyle = "#fff"
    ctx.beginPath()

    do
    {
        const next = curr.next;

        const x0 = 0|(cx + curr.vertex.x)
        const y0 = 0|(cy + curr.vertex.y)
        const x1 = 0|(cx + next.vertex.x)
        const y1 = 0|(cy + next.vertex.y)

        if (curr === first)
        {
            ctx.moveTo(x0, y0)
        }
        ctx.lineTo(x1, y1)

        curr = next
    }  while (curr !== first)
    ctx.fill()
    //ctx.stroke()
    ctx.restore()

    if (drawNext)
    {
        curr = first
        do
        {
            const next = curr.next

            const x0 = 0 | (cx + curr.vertex.x)
            const y0 = 0 | (cy + curr.vertex.y)
            const x1 = 0 | (cx + next.vertex.x)
            const y1 = 0 | (cy + next.vertex.y)

            const x2 = 0 | ((x0 + x1) / 2 - cx)
            const y2 = 0 | ((y0 + y1) / 2 - cy)

            const {twin} = curr
            if (twin)
            {
                const [x0, y0] = faceCentroid
                ctx.strokeStyle = "#666"
                drawArrow(x2, y2, x0, y0)
            }

            curr = next
        } while (curr !== first)
    }
}

function markFaceOnClick(ev: MouseEvent): void
{
    const { width, height} = config

    const cx = width >> 1
    const cy = height >> 1

    const x = ev.clientX - cx
    const y = ev.clientY - cy

    let min = Infinity
    let best: Face | null = null

    for (const f of theFaces)
    {
        const [x2, y2] = f.centroid

        const dx = x - x2
        const dy = y - y2

        const d = Math.sqrt(dx * dx + dy * dy)

        if (d < min)
        {
            min = d
            best = f
        }
    }

    if (!best)
    {
        return
    }

    console.log("CLICKED ON #" + best.id, best.type.name, best)




    ctx.fillStyle = "rgba(255,0,255,0.1)"
    renderDebugFace(best)
    
    ctx.fillStyle = "#fff"
    ctx.fillRect(cx + best.centroid[0]-1, cy + best.centroid[1]-1, 2, 2)
}

let theFaces: Face[]

/**
 * Wall face candidate with its distance and whether it borders the inside of the wall (1) or not (0)
 */
type Candidate = [Face, number, number]

/**
 * Face with the gate point next to it
 */
type Gate = [Face, Point]

function sortCandidatesDesc(a: Candidate, b: Candidate): number
{
    const insideWallNeighbors = b[2] - a[2]
    if (insideWallNeighbors !== 0)
    {
        return insideWallNeighbors;
    }

    return b[1] - a[1]
}

function distance(ptA: Point, ptB: Point): number
{
    const [x0,y0] = ptA
    const [x1,y1] = ptB
    const dx = x1-x0
    const dy = y1-y0
    return Math.sqrt(dx*dx+dy*dy)
}


function followEnd(pts: Point[], face: Face, visited: Set<Face>, prev: Point, endId: number, insideWall: Set<Face>): boolean
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


function midPoint(vertexA: Vertex, vertexB: Vertex): Point
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


function findGate(face: Face): Gate[]
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

let fixed: HTMLAnchorElement | undefined

const SQRT_2 = Math.sqrt(2)
const TAU_8TH = TAU/8

function squareFace(face: Face): [Point, number, number]
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
        20,//minDistance * 1.9,
        Math.atan2(vertex!.y - centroid[1],vertex!.x - centroid[0]) - TAU_8TH
    ]
}


// module scripts are deferred, so the DOM is ready at this point
canvas = document.getElementById("screen") as HTMLCanvasElement;
ctx = canvas.getContext("2d")!;

const width = (window.innerWidth) | 0;
const height = (window.innerHeight) | 0;

config.width = width;
config.height = height;

canvas.width = width;
canvas.height = height;

const seedParam = new URLSearchParams(location.search).get("seed")


const cx = width >> 1
const cy = height >> 1

const paint = () => {

    //resetRandom(14121970)
    const seed = randomSeed(seedParam ? +seedParam : null)

    if (!fixed)
    {
        fixed = document.createElement("a")
        fixed.href = "index.html?seed=" + seed
        fixed.appendChild(document.createTextNode("seed"))
        const footer = document.getElementById("footer")!
        footer.appendChild(document.createTextNode(""))
        footer.appendChild(fixed)
    }
    else
    {
        fixed.href = "index.html?seed=" + seed
    }

    resetRandom(seed)

    ctx.fillStyle = "#000";
    ctx.fillRect(0,0, width, height);

    const size = 40

    const p = new HexagonPatch(0,0,size)
    const faces = p.build()
    const c = new Castle(faces)



    const p0 = new HexagonPatch(PATCH_SIZE,0,size)
    const p1 = new HexagonPatch(0,PATCH_SIZE,size)
    const p2 = new HexagonPatch(-PATCH_SIZE,0,size)
    const p3 = new HexagonPatch(0,-PATCH_SIZE,size)

    const p4 = new HexagonPatch(PATCH_SIZE,PATCH_SIZE,size)
    const p5 = new HexagonPatch(PATCH_SIZE,-PATCH_SIZE,size)
    const p6 = new HexagonPatch(-PATCH_SIZE,-PATCH_SIZE,size)
    const p7 = new HexagonPatch(-PATCH_SIZE,PATCH_SIZE,size)


    theFaces = faces
        // .concat(p0.build())
        // .concat(p1.build())
        // .concat(p2.build())
        // .concat(p3.build())
        // .concat(p4.build())
        // .concat(p5.build())
        // .concat(p6.build())
        // .concat(p7.build())

    theFaces.forEach(
        f => {

            if (f.type === FaceType.HOUSE)
            {

                const [pt, size, angle] = squareFace(f)

                ctx.strokeStyle = f.type.color
                const r = size/2
                ctx.beginPath()
                ctx.moveTo(cx + pt[0] + Math.cos(angle - TAU_8TH) * r, cy + pt[1] + Math.sin(angle - TAU_8TH) * r)
                ctx.lineTo(cx + pt[0] + Math.cos(angle - TAU_8TH + TAU/4) * r, cy + pt[1] + Math.sin(angle - TAU_8TH + TAU/4) * r)
                ctx.lineTo(cx + pt[0] + Math.cos(angle - TAU_8TH + TAU/2) * r, cy + pt[1] + Math.sin(angle - TAU_8TH + TAU/2) * r)
                ctx.lineTo(cx + pt[0] + Math.cos(angle - TAU_8TH + 3*TAU/4) * r, cy +  pt[1] + Math.sin(angle - TAU_8TH + 3*TAU/4) * r)
                ctx.lineTo(cx + pt[0] + Math.cos(angle - TAU_8TH) * r, cy + pt[1] + Math.sin(angle - TAU_8TH) * r)
                ctx.stroke()


            }
            else
            {
                ctx.fillStyle = f.type.color
                renderDebugFace(f)
            }

        }
    )

    const { segments, centerFace, insideWall } = c

    //console.log("WALL SEGMENTS", segments)

    const [centroidX, centroidY] = centerFace.centroid

    const visited = new Set<Face>()

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

        //ends = filterGates(ends)

        console.log("ENDS", ends)

        const cx = width >> 1
        const cy = height >> 1

        let segmentCounter = 0
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

                ctx.lineWidth = 10
                ctx.strokeStyle = "#432"
                ctx.lineJoin = "bevel"
                ctx.beginPath()
                const [x, y] = points[0]
                ctx.moveTo(cx + x, cy + y)
                const last = points.length - 1
                for (let k = 1; k < points.length; k++)
                {
                    const scale = k !== last ? 1.02 : 1
                    const [x, y] = points[k]
                    ctx.lineTo(cx + x* scale, cy + y* scale)
                }
                ctx.stroke()

                ctx.fillStyle = "#f0f"
                ctx.fillRect(cx + points[0][0] - 1, cy + points[0][1] - 1, 2, 2)

            }

            // renderDebugFace(face)
        }
    }


}

paint()

canvas.addEventListener("click", ev => {
    if (ev.ctrlKey)
    {
        markFaceOnClick(ev)
        return
    }

    paint()


}, true)
