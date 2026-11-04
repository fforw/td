import "./style.css"
import { PATCH_DEPTH, PATCH_WIDTH } from "./game/patchImages"
import { PATCH_SIZE } from "./map/HexagonPatch"
import { createManuscriptMap } from "./map/mapRegions"
import type { QuadPatch } from "./map/QuadPatch"
import { FACE_SIZE } from "./map/scale"
import { randomSeed } from "./math/random"
import { loadMapAtlas } from "./render/mapAtlas"
import { loadMapPaper } from "./render/mapPaper"
import drawOldMap from "./render/oldMap"
import MapWorkerClient from "./worker/MapWorkerClient"

/*
 * Test page for the old map: the patches around the castle, all at once. "seed" sets the world seed, "rings" how many
 * patches to show in every direction of the castle.
 */

const DEFAULT_RINGS = 3

const params = new URLSearchParams(location.search)

// module scripts are deferred, so the DOM is ready at this point
const canvas = document.getElementById("screen") as HTMLCanvasElement
const ctx = canvas.getContext("2d")!

const seedLink = document.createElement("a")
seedLink.appendChild(document.createTextNode("seed"))
const footer = document.getElementById("footer")!
footer.appendChild(document.createTextNode(" "))
footer.appendChild(seedLink)

const rings = Number(params.get("rings") ?? DEFAULT_RINGS)
const client = new MapWorkerClient()
const assets = Promise.all([loadMapAtlas(), loadMapPaper()])

let generation = 0


function patchCenter(patch: QuadPatch): [number, number]
{
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let i = 0; i < patch.positions.length; i += 3)
    {
        minX = Math.min(minX, patch.positions[i])
        maxX = Math.max(maxX, patch.positions[i])
        minY = Math.min(minY, patch.positions[i + 1])
        maxY = Math.max(maxY, patch.positions[i + 1])
    }
    return [(minX + maxX) / 2, (minY + maxY) / 2]
}


async function show(seed: number): Promise<void>
{
    const current = ++generation
    seedLink.href = "map.html?seed=" + seed + "&rings=" + rings

    const requests = []
    for (let r = -rings; r <= rings; r++)
    {
        for (let q = -rings; q <= rings; q++)
        {
            requests.push(client.buildPatch(q * PATCH_SIZE, r * PATCH_SIZE, seed, FACE_SIZE, q === 0 && r === 0))
        }
    }
    const patches = (await Promise.all(requests)).map(built => built.patch)
    const [atlas, paper] = await assets
    if (current !== generation)
    {
        return
    }

    const width = window.innerWidth
    const height = window.innerHeight
    const ratio = window.devicePixelRatio
    canvas.width = width * ratio
    canvas.height = height * ratio
    canvas.style.width = width + "px"
    canvas.style.height = height + "px"
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)

    // zoomed in just enough to not show the open, jagged border of the patches
    const scale = Math.max(width / (2 * rings * PATCH_WIDTH), height / (2 * rings * PATCH_DEPTH))
    const [cx, cy] = patchCenter(patches[patches.length >> 1])
    const view = { x: cx - width / 2 / scale, y: cy - height / 2 / scale, scale }

    drawOldMap(ctx, createManuscriptMap(patches, seed), view, width, height, atlas, paper, seed, ratio)
}


show(randomSeed(params.has("seed") ? Number(params.get("seed")) : null)).catch(console.error)

canvas.addEventListener("click", () => {
    show(randomSeed()).catch(console.error)
})
