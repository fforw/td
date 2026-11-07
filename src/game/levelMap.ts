import { EdgeType } from "../map/geometry"
import { createManuscriptMap, type InkEdge } from "../map/mapRegions"
import { SLOT_SHIFT } from "../map/PatchWorld"
import { faceCount, next } from "../map/QuadPatch"
import { FACE_SIZE, SCALE } from "../map/scale"
import { loadMapAtlas, type MapAtlas } from "../render/mapAtlas"
import { loadMapPaper } from "../render/mapPaper"
import drawOldMap, { type InkStroke, mapProjection, type MapView } from "../render/manuscriptMap"
import { areaAround, BLOCKED_REGION, OPEN_REGION, VISITED_REGION, visitedRegions } from "./exploration"
import type { LevelMapState } from "./levelScene"

/**
 * Map units per plan unit of the level. The wobble of the old map is made for the overworld, at this size it moves the
 * walls by a bit of a face instead of half of one.
 */
const ZOOM = 4

/**
 * Distance of the raster points of the map in pixels
 */
const RASTER_PIXELS = 6

/**
 * Faces of paper around what's known, and the fewest faces the sheet shows across
 */
const MARGIN_FACES = 1.5
const MIN_FACES = 10

/**
 * Most pixels a face takes up on the sheet, so a small known part doesn't come out huge
 */
const MAX_FACE_PIXELS = 48

/**
 * Line between visited floor and what can't be walked through, walls and thin walls. There is none between visited floor
 * and floor nobody has been to, the gap shows where there is more to find.
 */
const BLOCKED_STROKE: InkStroke = { width: 3.2, color: "#120c06" }

/**
 * Fill of what isn't known, whether it's open or blocked. A shade darker than the paper, so the lines carry the outline
 * and the gaps in it show.
 */
const UNKNOWN_FILL = "#cdb68a"

const HERO_ARROW_SVG = '<svg viewBox="0 0 100 100"><polygon points="50,6 88,90 50,70 12,90"/></svg>'


/**
 * The map of a level as a sheet of old paper with what the heroes know: the floor they have seen, the chests and the exits
 * on it, and where the hero the view is with is looking. It shows what the level is like at the moment it gets updated.
 */
export default class LevelMap
{
    readonly element = document.createElement("div")

    /** for whoever owns the sheet, to put things onto it that move along with its corners */
    readonly extras = document.createElement("div")

    private readonly canvas = document.createElement("canvas")
    private readonly markers = document.createElement("div")

    private assets: Promise<[MapAtlas, HTMLCanvasElement]> | null = null

    /** counts the updates, so only the last one gets drawn */
    private updates = 0

    /**
     * @param seed  seed of the level, for the wobble and the stains
     */
    constructor(private readonly seed: number)
    {
        this.element.className = "map-sheet level-map"
        this.markers.className = "markers"
        this.extras.className = "extras"
        this.element.append(this.canvas, this.markers, this.extras)
    }

    /**
     * Draws the map as large as it fits into the given size in pixels
     */
    update(state: LevelMapState, maxWidth: number, maxHeight: number): void
    {
        const { world, slots, floor, exploration, chests, exits, hero } = state

        // all faces go into the regions, the walls keep the floor from reaching into them
        const centers: number[] = []
        const visited: boolean[] = []
        const isFloor: boolean[] = []
        const known: number[] = []
        // thin walls along visited floor, as lines in map units
        const thinWalls: InkEdge[] = []
        for (const slot of slots)
        {
            const patch = world.getPatch(slot)
            const { positions, vertex } = patch
            const count = faceCount(patch)
            for (let local = 0; local < count; local++)
            {
                let x = 0, y = 0
                for (let h = local * 4; h < local * 4 + 4; h++)
                {
                    x += positions[vertex[h] * 3] / 4
                    y += positions[vertex[h] * 3 + 1] / 4
                }
                const face = (slot << (SLOT_SHIFT - 2)) | local
                const isVisited = exploration.has(face)
                centers.push(x, y)
                visited.push(isVisited)
                isFloor.push(floor.has(face))
                if (isVisited)
                {
                    known.push(x * ZOOM, y * ZOOM)
                    this.addThinWalls(state, slot, local, thinWalls)
                }
            }
        }
        if (hero)
        {
            known.push(hero.x / SCALE * ZOOM, hero.z / SCALE * ZOOM)
        }

        const area = areaAround(known, MARGIN_FACES * FACE_SIZE * ZOOM)
        const least = MIN_FACES * FACE_SIZE * ZOOM
        if (area.width < least)
        {
            area.x -= (least - area.width) / 2
            area.width = least
        }
        if (area.height < least)
        {
            area.y -= (least - area.height) / 2
            area.height = least
        }
        const scale = Math.min(maxWidth / area.width, maxHeight / area.height, MAX_FACE_PIXELS / (FACE_SIZE * ZOOM))
        const width = Math.round(area.width * scale)
        const height = Math.round(area.height * scale)
        const view: MapView = { x: area.x, y: area.y, scale }
        this.element.style.width = width + "px"
        this.element.style.height = height + "px"

        const project = mapProjection(this.seed, view)
        const place = (elem: HTMLElement, x: number, z: number) => {
            const [px, py] = project(x / SCALE * ZOOM, z / SCALE * ZOOM)
            elem.style.left = px + "px"
            elem.style.top = py + "px"
            return elem
        }
        const marker = (className: string, icon: string, title: string) => {
            const elem = document.createElement("span")
            elem.className = "marker level-marker " + className
            elem.textContent = icon
            elem.title = title
            return elem
        }
        const elements: HTMLElement[] = [
            ...chests.filter(({ face }) => exploration.has(face)).map(({ x, z, opened }) =>
                place(marker(opened ? "chest opened" : "chest", "🧰", opened ? "Opened chest" : "Chest"), x, z)
            ),
            ...exits.filter(({ face }) => exploration.has(face)).map(({ x, z }) => place(marker("exit", "🪜", "Exit"), x, z))
        ]
        if (hero)
        {
            const arrow = document.createElement("span")
            arrow.className = "hero-arrow"
            arrow.title = "You are here"
            arrow.innerHTML = HERO_ARROW_SVG
            // facing 0 looks along z, which is down on the map
            arrow.style.setProperty("--angle", Math.PI - hero.facing + "rad")
            elements.push(place(arrow, hero.x, hero.z))
        }
        this.markers.replaceChildren(...elements)

        const update = ++this.updates
        this.assets ??= Promise.all([loadMapAtlas(), loadMapPaper()])
        this.assets.then(([atlas, paper]) => {
            // lets the popup show first
            requestAnimationFrame(() => setTimeout(() => {
                if (update !== this.updates)
                {
                    return
                }
                const regions = visitedRegions(centers, visited, isFloor)
                const map = createManuscriptMap(
                    { faceType: (x, y) => regions.faceType(x / ZOOM, y / ZOOM) },
                    area,
                    RASTER_PIXELS / scale,
                    [],
                    this.seed
                )
                const ratio = window.devicePixelRatio
                const { canvas } = this
                canvas.width = width * ratio
                canvas.height = height * ratio
                const ctx = canvas.getContext("2d")!
                ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
                drawOldMap(
                    ctx,
                    [{
                        // the rock of what's unknown would get mountains all over
                        map: { ...map, ink: [...map.ink, ...thinWalls], symbols: [] },
                        reveal: [area],
                        fills: new Map([[OPEN_REGION, UNKNOWN_FILL], [BLOCKED_REGION, UNKNOWN_FILL]]),
                        ink: ({ type, other }) => {
                            const beside = type === VISITED_REGION ? other : other === VISITED_REGION ? type : null
                            return beside === BLOCKED_REGION ? BLOCKED_STROKE : null
                        }
                    }],
                    view,
                    width,
                    height,
                    atlas,
                    paper,
                    this.seed,
                    ratio
                )
            }))
        }).catch(e => console.error("Can't draw the map", e))
    }

    /**
     * Adds the thin walls on the sides of a visited face, each one once, as lines from visited floor to something blocked
     */
    private addThinWalls({ world, exploration }: LevelMapState, slot: number, local: number, out: InkEdge[]): void
    {
        const { positions, vertex, edgeType } = world.getPatch(slot)
        for (let h = local * 4; h < local * 4 + 4; h++)
        {
            if (edgeType[h] !== EdgeType.WALL.index && edgeType[h] !== EdgeType.DESTRUCTIBLE.index)
            {
                continue
            }
            const global = (slot << SLOT_SHIFT) | h
            const twin = world.twin(global)
            // a wall between two visited faces comes from the one with the lower id
            if (twin >= 0 && twin < global && exploration.has(twin >> 2))
            {
                continue
            }
            const v0 = vertex[h] * 3, v1 = vertex[next(h)] * 3
            out.push({
                x0: positions[v0] * ZOOM,
                y0: positions[v0 + 1] * ZOOM,
                x1: positions[v1] * ZOOM,
                y1: positions[v1 + 1] * ZOOM,
                type: VISITED_REGION,
                other: BLOCKED_REGION
            })
        }
    }
}
