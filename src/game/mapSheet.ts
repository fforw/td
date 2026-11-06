import { FaceType } from "../map/geometry"
import { PATCH_SIZE } from "../map/HexagonPatch"
import { createManuscriptMap, type MapArea, type MapSymbol } from "../map/mapRegions"
import type { QuadPatch } from "../map/QuadPatch"
import { FACE_SIZE, SCALE } from "../map/scale"
import Terrain from "../map/terrain"
import { type MapAtlas, loadMapAtlas } from "../render/mapAtlas"
import { loadMapPaper } from "../render/mapPaper"
import drawOldMap, { type MapLayer, mapProjection, type MapView } from "../render/manuscriptMap"
import MapWorkerClient from "../worker/MapWorkerClient"
import type { PatchNode } from "./campaign"
import {
    type BorderArrow,
    borderArrow,
    type ExploreTarget,
    fitSheet,
    type MapContent,
    type MapMarker,
    patchArea,
    patchCenter,
    PATCH_DEPTH
} from "./mapContent"

/**
 * Distance of the raster points of the map in pixels, for known patches and for patches only passed through
 */
const RASTER_PIXELS = 8
const ROUGH_RASTER_PIXELS = 128

/**
 * Map units to scan around the view, as the wobble of the map must not show the open border of the raster
 */
const AREA_MARGIN = 30

/**
 * How far from a side of a patch in pixels the pointer gets an arrow, and the largest share of the patch depth for that
 */
const ARROW_BAND = 72
const MAX_BAND_SHARE = 0.4

/**
 * Size of an arrow in pixels and its gap to the border
 */
const ARROW_SIZE = 72
const ARROW_GAP = 4

const ARROW_SVG = '<svg viewBox="0 0 100 100"><polygon points="8,34 52,34 52,10 94,50 52,90 52,66 8,66"/></svg>'

/**
 * How far in pixels from its center a marker has to stay on the screen when its patch is beyond the known part, enough for
 * the head over it
 */
const MARKER_REACH = 36


function faceCenter({ positions, vertex }: QuadPatch, face: number): [number, number]
{
    let x = 0, y = 0
    for (let i = 0; i < 4; i++)
    {
        const v = vertex[face * 4 + i] * 3
        x += positions[v] / 4
        y += positions[v + 1] / 4
    }
    return [x, y]
}


function areasOf(nodes: PatchNode[]): MapArea[]
{
    return nodes.map(({ q, r }) => patchArea(q, r))
}


function grow({ x, y, width, height }: MapArea, margin: number): MapArea
{
    return { x: x - margin, y: y - margin, width: width + margin * 2, height: height + margin * 2 }
}


/**
 * The map of a campaign as a sheet of old paper with markers on it. Drawing the sheet takes a moment, so it only happens
 * when the patches on it or its size changed; the markers are rendered by whoever owns the sheet.
 */
export default class MapSheet
{
    readonly element = document.createElement("div")

    /** for whoever owns the sheet, to put things onto it that move along with its corners */
    readonly extras = document.createElement("div")

    private readonly canvas = document.createElement("canvas")
    private readonly markers = document.createElement("div")
    private readonly arrow = document.createElement("button")
    private readonly allArrows = document.createElement("div")

    private readonly client = new MapWorkerClient()
    private readonly terrain: Terrain

    /** the same as the castle of the 3D view, loaded when first needed */
    private assets: Promise<[MapAtlas, HTMLCanvasElement, MapSymbol]> | null = null

    /** positions of the points of interest by patch key, null while the patch is being built */
    private readonly pois = new Map<string, [number, number] | null>()

    private content: MapContent | null = null
    private renderMarker: ((marker: MapMarker) => HTMLElement) | null = null
    private onExplore: ((target: ExploreTarget) => void) | null = null

    private view: MapView | null = null

    /** what the arrow shows */
    private shown: BorderArrow | null = null

    /** there is no pointer to bring up the arrow, so all targets have theirs out */
    private showingAll = false

    /** element the pointer is watched on, the popup around the sheet with the gap */
    private surroundings: HTMLElement | null = null

    /** what the sheet shows or is about to show */
    private drawn = ""

    private readonly observer = new ResizeObserver(() => this.layout())

    /**
     * @param seed      campaign seed
     * @param clearTop  returns the pixels at the top of the screen an arrow must stay out of
     */
    constructor(private readonly seed: number, private readonly clearTop: () => number)
    {
        this.terrain = new Terrain(seed)
        this.element.className = "map-sheet"
        this.markers.className = "markers"
        this.extras.className = "extras"
        this.allArrows.className = "all-arrows"
        this.arrow.type = "button"
        this.arrow.hidden = true
        this.arrow.innerHTML = ARROW_SVG
        this.arrow.addEventListener("click", () => {
            if (this.shown)
            {
                this.onExplore?.(this.shown.target)
            }
        })
        this.element.append(this.canvas, this.markers, this.allArrows, this.extras, this.arrow)
    }

    /**
     * Sets whether every target of an explorer has its arrow out, instead of the one under the pointer
     */
    showAllArrows(showingAll: boolean): void
    {
        if (showingAll !== this.showingAll)
        {
            this.showingAll = showingAll
            this.showArrow(null)
            this.layout()
        }
    }

    /**
     * Shows what the map has to show
     *
     * @param content       patches and markers
     * @param renderMarker  creates the element of a marker, which gets put in place
     * @param onExplore     called when an arrow is clicked
     */
    update(
        content: MapContent,
        renderMarker: (marker: MapMarker) => HTMLElement,
        onExplore: (target: ExploreTarget) => void
    ): void
    {
        this.content = content
        this.renderMarker = renderMarker
        this.onExplore = onExplore
        this.showArrow(null)
        this.watchPointer()
        this.layout()
    }

    private watchPointer(): void
    {
        const surroundings = this.element.parentElement
        if (surroundings && surroundings !== this.surroundings)
        {
            this.surroundings = surroundings
            this.observer.observe(surroundings)
            const track = (ev: PointerEvent) => this.pointerAt(ev)
            surroundings.addEventListener("pointermove", track)
            surroundings.addEventListener("pointerdown", track)
            surroundings.addEventListener("pointerleave", () => this.showArrow(null))
        }
    }

    /**
     * Moves a position on the sheet so that something of the given reach around it stays on the screen and below the HUD
     */
    private onScreen(x: number, y: number, reach: number): [number, number]
    {
        const { left, top } = this.element.getBoundingClientRect()
        return [
            Math.max(reach - left, Math.min(window.innerWidth - left - reach, x)),
            Math.max(reach + this.clearTop() - top, Math.min(window.innerHeight - top - reach, y))
        ]
    }

    private pointerAt(ev: PointerEvent): void
    {
        const { content, view, arrow, element, showingAll } = this
        const on = ev.target as Element
        if (!content || !view || arrow.contains(on) || showingAll)
        {
            return
        }
        if (on.closest("button"))
        {
            this.showArrow(null)
            return
        }
        const { left, top } = element.getBoundingClientRect()
        this.showArrow(borderArrow(
            content,
            view.x + (ev.clientX - left) / view.scale,
            view.y + (ev.clientY - top) / view.scale,
            Math.min(ARROW_BAND / view.scale, PATCH_DEPTH * MAX_BAND_SHARE)
        ))
    }

    /**
     * Floats the arrow outside the border of the map, in the way of nothing but the gap, or takes it away
     */
    private showArrow(next: BorderArrow | null): void
    {
        const { shown, arrow, view } = this
        if (next && shown && next.target === shown.target && next.dq === shown.dq && next.dr === shown.dr)
        {
            return
        }
        this.shown = next
        arrow.hidden = !next || !view
        if (next && view)
        {
            this.placeArrow(arrow, next, view)
        }
    }

    private placeArrow(arrow: HTMLElement, { x: borderX, y: borderY, dq, dr, target }: BorderArrow, view: MapView): void
    {
        const angle = Math.atan2(dr, dq)
        const [bx, by] = mapProjection(this.seed, view)(borderX, borderY)
        const offset = ARROW_SIZE / 2 + ARROW_GAP
        const [x, y] = this.onScreen(bx + Math.cos(angle) * offset, by + Math.sin(angle) * offset, ARROW_SIZE / 2)

        arrow.className = "border-arrow" + (target.impression ? " " + target.impression : "")
        arrow.title = "Send an explorer"
        arrow.style.left = x + "px"
        arrow.style.top = y + "px"
        arrow.style.width = arrow.style.height = ARROW_SIZE + "px"
        arrow.style.setProperty("--angle", angle + "rad")
    }

    dispose(): void
    {
        this.observer.disconnect()
        this.client.terminate()
        this.drawn = ""
    }

    private layout(): void
    {
        const { content, renderMarker, element, surroundings, seed } = this
        if (!content || !renderMarker || !surroundings || !surroundings.clientWidth || !surroundings.clientHeight)
        {
            return
        }

        const { paddingLeft, paddingRight, paddingTop, paddingBottom } = getComputedStyle(surroundings)
        const { width, height, view } = fitSheet(
            [...content.known, ...content.rough],
            surroundings.clientWidth - parseFloat(paddingLeft) - parseFloat(paddingRight),
            surroundings.clientHeight - parseFloat(paddingTop) - parseFloat(paddingBottom)
        )
        this.view = view
        element.style.width = width + "px"
        element.style.height = height + "px"

        const drawn = [
            width,
            height,
            content.known.map(({ q, r }) => q + "/" + r),
            content.rough.map(({ q, r }) => q + "/" + r),
            view.x,
            view.y
        ].join()
        if (drawn !== this.drawn)
        {
            this.drawn = drawn
            this.load().then(([atlas, paper, castle]) => {
                // lets the popup show first
                requestAnimationFrame(() => setTimeout(() => {
                    if (drawn === this.drawn)
                    {
                        this.draw(content, view, width, height, atlas, paper, castle)
                    }
                }))
            }).catch(e => console.error("Can't draw the map", e))
        }

        const project = mapProjection(seed, view)
        const elements: HTMLElement[] = []
        for (const marker of content.markers)
        {
            const position = marker.type === "poi" ? this.poiPosition(marker) : patchCenter(marker.q, marker.r)
            if (position)
            {
                const [x, y] = this.onScreen(...project(position[0], position[1]), MARKER_REACH)
                const elem = renderMarker(marker)
                elem.style.left = x + "px"
                elem.style.top = y + "px"
                elements.push(elem)
            }
        }
        this.markers.replaceChildren(...elements)
        this.allArrows.replaceChildren(...this.showingAll ? this.renderAllArrows(content, view) : [])
    }

    /**
     * Returns an arrow for each target of an explorer, the one a pointer on the target would bring up
     */
    private renderAllArrows(content: MapContent, view: MapView): HTMLElement[]
    {
        return content.targets.flatMap(target => {
            const next = borderArrow(content, ...patchCenter(target.q, target.r), 0)
            if (!next)
            {
                return []
            }
            const arrow = document.createElement("button")
            arrow.type = "button"
            arrow.innerHTML = ARROW_SVG
            arrow.addEventListener("click", () => this.onExplore?.(target))
            this.placeArrow(arrow, next, view)
            return [arrow]
        })
    }

    private load(): Promise<[MapAtlas, HTMLCanvasElement, MapSymbol]>
    {
        this.assets ??= Promise.all([
            loadMapAtlas(),
            loadMapPaper(),
            this.client.buildPatch(0, 0, this.seed, FACE_SIZE, "CASTLE")
        ]).then(([atlas, paper, { pois }]) => {
            const [x, y] = pois[0].plan!.fountain
            return [atlas, paper, { x: x / SCALE, y: y / SCALE, type: FaceType.WALL }]
        })
        return this.assets
    }

    /**
     * Returns where the point of interest of a patch is, null as long as that isn't known.
     */
    private poiPosition({ key, q, r, kind }: Extract<MapMarker, { type: "poi" }>): [number, number] | null
    {
        if (!this.pois.has(key))
        {
            this.pois.set(key, null)
            this.client.buildPatch(q * PATCH_SIZE, r * PATCH_SIZE, this.seed, FACE_SIZE, kind).then(
                ({ patch, pois }) => {
                    this.pois.set(key, pois.length ? faceCenter(patch, pois[0].face) : patchCenter(q, r))
                    this.layout()
                },
                e => console.error("Building patch " + key + " failed", e)
            )
        }
        return this.pois.get(key)!
    }

    private draw(
        { known, rough }: MapContent,
        view: MapView,
        width: number,
        height: number,
        atlas: MapAtlas,
        paper: HTMLCanvasElement,
        castle: MapSymbol
    ): void
    {
        const { canvas, seed, terrain } = this
        const ratio = window.devicePixelRatio
        canvas.width = width * ratio
        canvas.height = height * ratio
        const ctx = canvas.getContext("2d")!
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0)

        const layer = (nodes: PatchNode[], rasterPixels: number, pois: MapSymbol[]): MapLayer => {
            const reveal = areasOf(nodes)
            const area = grow({ x: view.x, y: view.y, width: width / view.scale, height: height / view.scale }, AREA_MARGIN)
            const map = createManuscriptMap(terrain, area, rasterPixels / view.scale, pois, seed)
            return {
                map: {
                    ...map,
                    symbols: map.symbols.filter(({ x, y }) => reveal.some(cell =>
                        x >= cell.x && x <= cell.x + cell.width && y >= cell.y && y <= cell.y + cell.height
                    ))
                },
                reveal
            }
        }

        drawOldMap(
            ctx,
            [...(rough.length ? [layer(rough, ROUGH_RASTER_PIXELS, [])] : []), layer(known, RASTER_PIXELS, [castle])],
            view,
            width,
            height,
            atlas,
            paper,
            seed,
            ratio
        )
    }
}
