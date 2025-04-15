import domready from "domready"
import "./style.css"
import HexagonPatch, { PATCH_SIZE } from "./HexagonPatch"
import { randomSeed, resetRandom, rng } from "./util"
import Castle, { filterNeighbors, getNeighbors } from "./Castle"
import concaveman from "concaveman"
import { FaceType } from "./geometry"
import queryString from "query-string"

const PHI = (1 + Math.sqrt(5)) / 2;
const TAU = Math.PI * 2;
const DEG2RAD_FACTOR = TAU / 360;

const config = {
    width: 0,
    height: 0
};

/**
 * @type CanvasRenderingContext2D
 */
let ctx;
let canvas;

function drawArrow(x0, y0, x1, y1)
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


function renderDebugFace(face, drawNext = false, ids = false)
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

function markFaceOnClick(ev)
{
    const { width, height} = config

    const cx = width >> 1
    const cy = height >> 1

    const x = ev.clientX - cx
    const y = ev.clientY - cy

    let min = Infinity
    let best = null

    theFaces.forEach(f => {

        const [x2, y2] = f.centroid

        const dx = x - x2
        const dy = y - y2

        const d = Math.sqrt(dx * dx + dy * dy)

        if (d < min)
        {
            min = d
            best = f
        }
    })

    console.log("CLICKED ON #" + best.id, best.type.name, best)

    ctx.fillStyle = "rgba(255,0,255,0.1)"
    renderDebugFace(best)

}

let theFaces


function getSegmentCentroids(segment)
{
    const { width, height } = config

    const cx = width >> 1
    const cy = height >> 1

    const pts = []

    for (let i = 0; i < segment.length; i++)
    {
        const [x,y] = segment[i].centroid

        pts.push([
            cx + x,
            cy + y
        ])
    }

    return pts
}


function sortPairs(a,b)
{
    return a[1] - b[1]
}

function sortCandidatesDesc(a,b)
{
    const d = b[2] - a[2]
    if (d !== 0)
    {
        return d;
    }
    return b[1] - a[1]
}

function distance(ptA, ptB)
{
    const [x0,y0] = ptA
    const [x1,y1] = ptB
    const dx = x1-x0
    const dy = y1-y0
    return Math.sqrt(dx*dx+dy*dy)
}


function simplify(segmentCentroids, centroidX, centroidY)
{
    const anglePairs = segmentCentroids.map(p => ([p, Math.atan2(p[1]-centroidY,p[0]-centroidX)]))
    anglePairs.sort(sortPairs)
    let prev = null
    const out = []

    let inserted
    for (let j = 0; j < anglePairs.length; j++)
    {
        const [pt,a] = anglePairs[j]

        inserted = false
        if (!prev || distance(pt,prev) > 30)
        {
            inserted = true
            out.push(pt)
            prev = pt
        }
    }
    if (!inserted)
    {
        out.push(anglePairs[anglePairs.length-1][0])
    }
    return out;
}


function countType(faces, type)
{
    let count = 0
    for (let i = 0; i < faces.length; i++)
    {
        const face = faces[i]
        if (face.type === type)
        {
            count++
        }
    }
    return count
}


function countNeighborsOfType(face, type)
{
    const first = face.halfEdge;
    let curr = first;

    let count = 0
    do
    {
        const next = curr.next;

        const { twin } = curr
        if (twin && twin.face.type === type)
        {
            count++
        }
        curr = next
    }  while (curr !== first)

    return count
}


function followEnd(pts, face, visited, prev, endId)
{
    const limit = 25 * 25

    console.log("followEnd", face.id, endId)

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
    if (d >= limit)
    {
        pts.push(face.centroid)
    }

    const refs = pts.slice(-3)
    prev = refs[0]

    const first = face.halfEdge;
    let curr = first;

    const candidates = []
    do
    {
        const next = curr.next;

        const { twin } = curr
        if (twin && twin.face.type === FaceType.WALL && !visited.has(twin.face))
        {
            const dist = distance(prev, twin.face.centroid)
            const count = countNeighborsOfType(twin.face, FaceType.WALL)
            candidates.push([twin.face, dist, count >=2 ? 2 : count])
        }
        curr = next
    }  while (curr !== first)

    if (candidates.length)
    {
        if (candidates.length > 1)
        {
            candidates.sort(sortCandidatesDesc)
            console.log("BEST CANDIDATE: face #" + candidates[0][0].id, "at", candidates[0][1], "(walls = " + candidates[0][2] + ")")
        }

        followEnd(pts, candidates[0][0], visited, face.centroid, endId)
    }
    else
    {
        const first = face.halfEdge;
        let curr = first;
        do
        {
            const next = curr.next;

            const { twin } = curr
            if (twin)
            {
                const neighbors = getNeighbors(twin.face, face)
                if (neighbors[1].type === FaceType.WALL && !visited.has(neighbors[1]))
                {

                    console.log("NO CANDIDATES, JUMP 1")
                    followEnd(pts, neighbors[1], visited, face.centroid, endId)
                    break
                }
                else if (neighbors[3].type === FaceType.WALL && !visited.has(neighbors[3]))
                {
                    console.log("NO CANDIDATES, JUMP 3")
                    followEnd(pts, neighbors[3], visited, face.centroid, endId)
                    break
                }
            }
            curr = next
        }  while (curr !== first)
    }
}


domready(
    () => {

        canvas = document.getElementById("screen");
        ctx = canvas.getContext("2d");

        const width = (window.innerWidth) | 0;
        const height = (window.innerHeight) | 0;

        config.width = width;
        config.height = height;

        canvas.width = width;
        canvas.height = height;

        const args = queryString.parse(location.search)

        const paint = () => {

            //resetRandom(14121970)
            resetRandom(randomSeed(args.seed && +args.seed))

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


            faces
                // .concat(p0.build())
                // .concat(p1.build())
                // .concat(p2.build())
                // .concat(p3.build())
                // .concat(p4.build())
                // .concat(p5.build())
                // .concat(p6.build())
                // .concat(p7.build())
                .forEach( f => {
                ctx.fillStyle = f.type.color
                renderDebugFace(f)
            })

            const { segments, centerFace } = c

            console.log("WALL SEGMENTS", segments)

            const [centroidX, centroidY] = centerFace.centroid

            const visited = new Set()

            for (let i = 0; i < segments.length; i++)
            {
                const segment = segments[i]
                const ends = []


                for (let j = 0; j < segment.length; j++)
                {
                    const face = segment[j]
                    const gates = filterNeighbors(face, FaceType.GATE)
                    if (gates.length > 0)
                    {
                        ends.push([face, gates[0]])
                    }
                }

                console.log("ENDS", ends)

                const cx = width >> 1
                const cy = height >> 1

                for (let j = 0; j < ends.length; j++)
                {
                    const [face,prev] = ends[j]

                    if (!visited.has(face))
                    {
                        const points = []
                        followEnd(points, face, visited, prev.centroid, j)

                        ctx.strokeStyle = `hsla(${Math.round(j * PHI * 360)} 80% 50% / 0.7)`
                        ctx.lineWidth = 10
                        ctx.beginPath()
                        for (let k = 0; k < points.length; k++)
                        {
                            const [x,y] = points[k]

                            if (k === 0)
                            {
                                ctx.moveTo(cx + x, cy + y)
                            }
                            else
                            {
                                ctx.lineTo(cx + x, cy + y)
                            }
                        }
                        ctx.stroke()


                        ctx.fillStyle = "#f0f"
                        ctx.fillRect(cx + points[0][0] - 1, cy + points[0][1] - 1, 2, 2)
                    }


                    // renderDebugFace(face)
                }
            }


            theFaces = faces
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


    }
);
