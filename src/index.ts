import "./style.css"
import HexagonPatch, { PATCH_SIZE } from "./HexagonPatch"
import { randomSeed, resetRandom } from "./util"
import Castle from "./Castle"
import type { Face } from "./geometry"
import { FaceType } from "./geometry"
import { squareFace, TAU_8TH, wallPaths } from "./plan"

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

let fixed: HTMLAnchorElement | undefined



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

    // const p0 = new HexagonPatch(PATCH_SIZE,0,size)
    // const p1 = new HexagonPatch(0,PATCH_SIZE,size)
    // const p2 = new HexagonPatch(-PATCH_SIZE,0,size)
    // const p3 = new HexagonPatch(0,-PATCH_SIZE,size)
    //
    // const p4 = new HexagonPatch(PATCH_SIZE,PATCH_SIZE,size)
    // const p5 = new HexagonPatch(PATCH_SIZE,-PATCH_SIZE,size)
    // const p6 = new HexagonPatch(-PATCH_SIZE,-PATCH_SIZE,size)
    // const p7 = new HexagonPatch(-PATCH_SIZE,PATCH_SIZE,size)

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

    const paths = wallPaths(c)

    ctx.save()
    for (let i = 0; i < paths.length; i++)
    {
        const points = paths[i]

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
    ctx.restore()


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
