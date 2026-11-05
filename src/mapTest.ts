import "./style.css"
import { PATCH_DEPTH, PATCH_WIDTH } from "./game/patchImages"
import { FaceType } from "./map/geometry"
import { createManuscriptMap } from "./map/mapRegions"
import { FACE_SIZE, SCALE } from "./map/scale"
import Terrain from "./map/terrain"
import { randomSeed } from "./math/random"
import { loadMapAtlas } from "./render/mapAtlas"
import { loadMapPaper } from "./render/mapPaper"
import drawManuscriptMap from "./render/manuscriptMap"
import MapWorkerClient from "./worker/MapWorkerClient"

/*
 * Test page for the manuscript map around the castle. "seed" sets the world seed, "rings" how many patches to show in every
 * direction of the castle.
 */

const DEFAULT_RINGS = 3

/**
 * Distance of the raster points of the map in pixels
 */
const RASTER_PIXELS = 8

/**
 * Map units to scan around the view, as the wobble of the map must not show the open border of the raster
 */
const AREA_MARGIN = 30

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


async function show(seed: number): Promise<void>
{
    const current = ++generation
    seedLink.href = "map.html?seed=" + seed + "&rings=" + rings

    const { castle } = await client.buildPatch(0, 0, seed, FACE_SIZE, true)
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

    const cx = castle!.fountain[0] / SCALE
    const cy = castle!.fountain[1] / SCALE
    const scale = Math.max(width / (2 * rings * PATCH_WIDTH), height / (2 * rings * PATCH_DEPTH))
    const view = { x: cx - width / 2 / scale, y: cy - height / 2 / scale, scale }

    const area = {
        x: view.x - AREA_MARGIN,
        y: view.y - AREA_MARGIN,
        width: width / scale + AREA_MARGIN * 2,
        height: height / scale + AREA_MARGIN * 2
    }
    const map = createManuscriptMap(new Terrain(seed), area, RASTER_PIXELS / scale, [{ x: cx, y: cy, type: FaceType.WALL }], seed)
    drawManuscriptMap(ctx, map, view, width, height, atlas, paper, seed, ratio)
}


show(randomSeed(params.has("seed") ? Number(params.get("seed")) : null)).catch(console.error)

canvas.addEventListener("click", () => {
    show(randomSeed()).catch(console.error)
})
