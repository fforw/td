import { createNoise2D } from "simplex-noise"
import Prando from "prando"
import { FaceType } from "../map/geometry"
import { type InkEdge, type ManuscriptMap, type MapArea, outerSides } from "../map/mapRegions"
import { DEFAULT_COSTS } from "../map/route"
import { deckleMask } from "./deckle"
import type { AtlasFrame, MapAtlas } from "./mapAtlas"
import { SEPIA } from "./mapPalette"

/**
 * Wavelengths and amplitudes in map units of the wobble of all points on the map. Fills and lines move together, so the
 * straight edges of the marching squares look drawn by hand without getting out of line.
 */
const WOBBLE_LARGE = 173
const WOBBLE_LARGE_AMOUNT = 11
const WOBBLE_SMALL = 47
const WOBBLE_SMALL_AMOUNT = 7

/**
 * Line width in pixels of boundaries of impassable regions
 */
const IMPASSABLE_WIDTH = 2

/**
 * Line width in pixels of other boundaries, growing with the difference in travel cost
 */
const BASE_WIDTH = 0.45
const COST_WIDTH = 0.22

/**
 * Wavelengths in map units and amounts as fractions of the width of the slow and fast changes of the line width along a
 * line, like the changing pressure on a pen
 */
const PRESSURE_SLOW = 163
const PRESSURE_SLOW_AMOUNT = 0.31
const PRESSURE_FAST = 101
const PRESSURE_FAST_AMOUNT = 0.17

/**
 * Line widths per pixel the segments get grouped by, every width being one stroke call
 */
const WIDTH_STEPS = 6

/**
 * Widths in pixels of the bands along the coast, drawn from the outside in and alternating with the water color
 */
const SHORE_WIDTHS = [26, 21, 14, 10, 5]

/**
 * Opacity of the fills and shore bands and of the lines, letting the paper show through like in the drawn symbols
 */
const REGION_ALPHA = 0.8
const INK_ALPHA = 0.6

/**
 * Pixels per noise pixel of the stains on the paper
 */
const STAIN_RESOLUTION = 2
const STAIN_SCALE = 400

/**
 * Largest random change of the size of a symbol as a fraction, and of its rotation in radians. The castle stays as it is.
 */
const SYMBOL_SIZE_JITTER = 0.1
const SYMBOL_ROTATION_JITTER = 0.06

/**
 * Line width in pixels of the outer border of what a map reveals
 */
const BORDER_WIDTH = 1.4

/**
 * Length in map units of the pieces the sides of revealed areas get cut into, so they wobble like everything else
 */
const SIDE_STEP = 20

/**
 * Pixels revealed areas reach beyond their sides, so no paper shows between the areas of two layers
 */
const REVEAL_OVERLAP = 1

/**
 * View onto the map: the map position at the top left corner of the canvas and pixels per map unit
 */
export interface MapView
{
    x: number
    y: number
    scale: number
}


/**
 * Map drawn only within some areas, later layers on top of earlier ones
 */
export interface MapLayer
{
    map: ManuscriptMap
    /**
     * Areas to draw in with their outer border, everything if left out
     */
    reveal?: MapArea[]
}


type Projection = (x: number, y: number) => number


/**
 * Creates the functions from map units to the screen, wobble included. The noise for it comes first out of the given
 * generator.
 */
function createProjection(prando: Prando, view: MapView): [Projection, Projection]
{
    const wobbleX = createNoise2D(() => prando.next())
    const wobbleY = createNoise2D(() => prando.next())

    return [
        (x, y) => (
            x +
            wobbleX(x / WOBBLE_LARGE, y / WOBBLE_LARGE) * WOBBLE_LARGE_AMOUNT +
            wobbleX(y / WOBBLE_SMALL, x / WOBBLE_SMALL) * WOBBLE_SMALL_AMOUNT -
            view.x
        ) * view.scale,
        (x, y) => (
            y +
            wobbleY(x / WOBBLE_LARGE, y / WOBBLE_LARGE) * WOBBLE_LARGE_AMOUNT +
            wobbleY(y / WOBBLE_SMALL, x / WOBBLE_SMALL) * WOBBLE_SMALL_AMOUNT -
            view.y
        ) * view.scale
    ]
}


/**
 * Returns where drawOldMap() draws map positions for the same seed and view, in pixels, so things can be put on top.
 */
export function mapProjection(seed: number, view: MapView): (x: number, y: number) => [number, number]
{
    const [screenX, screenY] = createProjection(new Prando(seed), view)
    return (x, y) => [screenX(x, y), screenY(x, y)]
}


/**
 * Returns the path around the given areas with the wobble of the map
 */
function revealPath(areas: MapArea[], grow: number, screenX: Projection, screenY: Projection): Path2D
{
    const path = new Path2D()
    for (const { x, y, width, height } of areas)
    {
        const x0 = x - grow, y0 = y - grow, x1 = x + width + grow, y1 = y + height + grow
        const corners = [x0, y0, x1, y0, x1, y1, x0, y1, x0, y0]
        path.moveTo(screenX(x0, y0), screenY(x0, y0))
        for (let c = 0; c < 8; c += 2)
        {
            const pieces = Math.ceil(Math.hypot(corners[c + 2] - corners[c], corners[c + 3] - corners[c + 1]) / SIDE_STEP)
            for (let i = 0; i < pieces; i++)
            {
                const px = corners[c] + (corners[c + 2] - corners[c]) * i / pieces
                const py = corners[c + 1] + (corners[c + 3] - corners[c + 1]) * i / pieces
                path.lineTo(screenX(px, py), screenY(px, py))
            }
        }
        path.closePath()
    }
    return path
}


function inkWidth({ type, other }: InkEdge): number
{
    const cost = DEFAULT_COSTS[type.index]
    const otherCost = DEFAULT_COSTS[other.index]
    if (cost === Infinity || otherCost === Infinity)
    {
        return IMPASSABLE_WIDTH
    }
    return BASE_WIDTH + Math.abs(cost - otherCost) * COST_WIDTH
}


/**
 * Cuts a frame out of the atlas in its size on the screen. Scaling once is better for the thin lines of the drawings
 * and faster than scaling every symbol.
 */
function symbolSprite(atlas: MapAtlas, frame: AtlasFrame, width: number, height: number): HTMLCanvasElement
{
    const sprite = document.createElement("canvas")
    sprite.width = Math.max(1, Math.round(width))
    sprite.height = Math.max(1, Math.round(height))
    const ctx = sprite.getContext("2d")!
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(atlas.image, frame.x, frame.y, frame.w, frame.h, 0, 0, sprite.width, sprite.height)
    return sprite
}


/**
 * Creates a transparent layer with the size and the transform of the given context.
 */
function createLayer(ctx: CanvasRenderingContext2D): CanvasRenderingContext2D
{
    const canvas = document.createElement("canvas")
    canvas.width = ctx.canvas.width
    canvas.height = ctx.canvas.height
    const layer = canvas.getContext("2d")!
    layer.setTransform(ctx.getTransform())
    layer.lineJoin = layer.lineCap = "round"
    return layer
}


/**
 * Draws a layer as a whole, so that overlapping shapes on it don't get darker where they overlap.
 */
function drawLayer(ctx: CanvasRenderingContext2D, layer: CanvasRenderingContext2D, alpha: number): void
{
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = alpha
    ctx.drawImage(layer.canvas, 0, 0)
    ctx.restore()
}


/**
 * Cuts the canvas into the shape of a sheet of handmade paper.
 */
function cutDeckledEdges(ctx: CanvasRenderingContext2D, pixelRatio: number, seed: number): void
{
    const { width, height } = ctx.canvas
    const mask = document.createElement("canvas")
    mask.width = width
    mask.height = height
    mask.getContext("2d")!.putImageData(new ImageData(deckleMask(width, height, pixelRatio, seed), width, height), 0, 0)

    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = "destination-in"
    ctx.drawImage(mask, 0, 0)
    ctx.restore()
}


/**
 * Stains the paper with noise.
 */
function drawStains(ctx: CanvasRenderingContext2D, width: number, height: number, stain: string, seed: number): void
{
    const prando = new Prando(seed)
    const noise = createNoise2D(() => prando.next())

    const canvas = document.createElement("canvas")
    canvas.width = Math.ceil(width / STAIN_RESOLUTION)
    canvas.height = Math.ceil(height / STAIN_RESOLUTION)
    const stains = canvas.getContext("2d")!
    const image = stains.createImageData(canvas.width, canvas.height)
    const { data } = image

    const r = parseInt(stain.slice(1, 3), 16)
    const g = parseInt(stain.slice(3, 5), 16)
    const b = parseInt(stain.slice(5, 7), 16)
    for (let y = 0, i = 0; y < canvas.height; y++)
    {
        for (let x = 0; x < canvas.width; x++, i += 4)
        {
            const stainNoise = noise(x * STAIN_RESOLUTION / STAIN_SCALE, y * STAIN_RESOLUTION / STAIN_SCALE)
            data[i] = r
            data[i + 1] = g
            data[i + 2] = b
            data[i + 3] = Math.max(0, 22 + stainNoise * 22)
        }
    }
    stains.putImageData(image, 0, 0)

    ctx.save()
    ctx.globalCompositeOperation = "multiply"
    ctx.drawImage(canvas, 0, 0, width, height)

    const cx = width / 2
    const cy = height / 2
    const vignette = ctx.createRadialGradient(cx, cy, Math.min(cx, cy) * 0.75, cx, cy, Math.hypot(cx, cy))
    vignette.addColorStop(0, stain + "00")
    vignette.addColorStop(1, stain + "b0")
    ctx.fillStyle = vignette
    ctx.fillRect(0, 0, width, height)
    ctx.restore()
}


/**
 * Draws the map onto a canvas of the given size in pixels.
 *
 * @param ctx               context of the canvas
 * @param layers            maps to draw, from the bottom up
 * @param view              part of the map to show
 * @param width             width in pixels
 * @param height            height in pixels
 * @param atlas             atlas with the symbols
 * @param paper             gray texture of the paper, see loadMapPaper()
 * @param seed              seed for the wobble, the stains, the variants of the symbols and the edges
 * @param pixelRatio        canvas pixels per pixel, for the resolution of the symbols
 */
export default function drawOldMap(
    ctx: CanvasRenderingContext2D,
    layers: MapLayer[],
    view: MapView,
    width: number,
    height: number,
    atlas: MapAtlas,
    paper: HTMLCanvasElement,
    seed: number,
    pixelRatio = 1
): void
{
    const prando = new Prando(seed)
    const [screenX, screenY] = createProjection(prando, view)
    const pressure = createNoise2D(() => prando.next())

    const addLine = (lines: Map<number, Path2D>, x0: number, y0: number, x1: number, y1: number, width: number) => {
        const mx = (x0 + x1) / 2
        const my = (y0 + y1) / 2
        const pressed = width * (
            1 +
            pressure(mx / PRESSURE_SLOW, my / PRESSURE_SLOW) * PRESSURE_SLOW_AMOUNT +
            pressure(my / PRESSURE_FAST, mx / PRESSURE_FAST) * PRESSURE_FAST_AMOUNT
        )
        const lineWidth = Math.round(pressed * WIDTH_STEPS) / WIDTH_STEPS
        let path = lines.get(lineWidth)
        if (!path)
        {
            path = new Path2D()
            lines.set(lineWidth, path)
        }
        path.moveTo(screenX(x0, y0), screenY(x0, y0))
        path.lineTo(screenX(x1, y1), screenY(x1, y1))
    }

    ctx.fillStyle = SEPIA.paper
    ctx.fillRect(0, 0, width, height)

    const fills = createLayer(ctx)
    const ink = createLayer(ctx)
    ink.strokeStyle = SEPIA.ink
    const strokeLines = (lines: Map<number, Path2D>) => lines.forEach((path, lineWidth) => {
        ink.lineWidth = lineWidth
        ink.stroke(path)
    })

    for (const { map, reveal } of layers)
    {
        const clip = reveal && revealPath(reveal, REVEAL_OVERLAP / view.scale, screenX, screenY)
        fills.save()
        ink.save()
        if (clip)
        {
            fills.clip(clip)
            ink.clip(clip)
        }

        const regions = new Map<FaceType, Path2D>()
        map.outlines.forEach((loops, type) => {
            const path = new Path2D()
            for (const loop of loops)
            {
                for (let i = 0; i < loop.length; i += 2)
                {
                    const x = screenX(loop[i], loop[i + 1])
                    const y = screenY(loop[i], loop[i + 1])
                    if (i === 0)
                    {
                        path.moveTo(x, y)
                    }
                    else
                    {
                        path.lineTo(x, y)
                    }
                }
                path.closePath()
            }
            regions.set(type, path)

            // the hairline gaps between the regions end up below the ink
            fills.fillStyle = SEPIA.regions.get(type) ?? SEPIA.paper
            fills.fill(path)
        })

        const coast = new Path2D()
        const lines = new Map<number, Path2D>()
        for (const edge of map.ink)
        {
            const { x0, y0, x1, y1, type, other } = edge
            addLine(lines, x0, y0, x1, y1, inkWidth(edge))

            if (type === FaceType.WATER || other === FaceType.WATER)
            {
                coast.moveTo(screenX(x0, y0), screenY(x0, y0))
                coast.lineTo(screenX(x1, y1), screenY(x1, y1))
            }
        }

        const water = regions.get(FaceType.WATER)
        if (water)
        {
            fills.save()
            fills.clip(water)
            SHORE_WIDTHS.forEach((lineWidth, i) => {
                fills.lineWidth = lineWidth
                fills.strokeStyle = i % 2 === 0 ? SEPIA.shore : SEPIA.regions.get(FaceType.WATER)!
                fills.stroke(coast)
            })
            fills.restore()
        }
        strokeLines(lines)

        fills.restore()
        ink.restore()
    }
    drawLayer(ctx, fills, REGION_ALPHA)

    ctx.save()
    ctx.globalCompositeOperation = "multiply"
    ctx.fillStyle = ctx.createPattern(paper, "repeat")!
    ctx.fillRect(0, 0, width, height)
    ctx.restore()

    drawStains(ctx, width, height, SEPIA.stain, seed)

    const border = new Map<number, Path2D>()
    for (const [x0, y0, x1, y1] of outerSides(layers.flatMap(({ reveal }) => reveal ?? [])))
    {
        const pieces = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / SIDE_STEP)
        for (let i = 0; i < pieces; i++)
        {
            addLine(
                border,
                x0 + (x1 - x0) * i / pieces,
                y0 + (y1 - y0) * i / pieces,
                x0 + (x1 - x0) * (i + 1) / pieces,
                y0 + (y1 - y0) * (i + 1) / pieces,
                BORDER_WIDTH
            )
        }
    }
    strokeLines(border)
    drawLayer(ctx, ink, INK_ALPHA)

    const sprites = new Map<AtlasFrame, HTMLCanvasElement>()
    for (const { x, y, type } of layers.flatMap(({ map }) => map.symbols))
    {
        const style = SEPIA.symbols.get(type)
        if (style)
        {
            const variants = atlas.sprites.get(style.sprite)
            if (!variants)
            {
                throw new Error("No sprite " + style.sprite + " in the map atlas")
            }

            const frame = variants[prando.nextInt(0, variants.length - 1)]
            const largest = Math.max(...variants.map(({ w, h }) => Math.max(w, h)))
            const scale = style.size * view.scale / largest

            let sprite = sprites.get(frame)
            if (!sprite)
            {
                // in the largest size it can have, so that no symbol gets scaled up
                const largestScale = scale * (1 + SYMBOL_SIZE_JITTER) * pixelRatio
                sprite = symbolSprite(atlas, frame, frame.w * largestScale, frame.h * largestScale)
                sprites.set(frame, sprite)
            }

            const jitter = type !== FaceType.WALL
            const size = jitter ? 1 + prando.next(-SYMBOL_SIZE_JITTER, SYMBOL_SIZE_JITTER) : 1
            const width = frame.w * scale * size
            const height = frame.h * scale * size

            ctx.save()
            ctx.translate(screenX(x, y), screenY(x, y))
            if (jitter)
            {
                ctx.rotate(prando.next(-SYMBOL_ROTATION_JITTER, SYMBOL_ROTATION_JITTER))
            }
            ctx.drawImage(sprite, -width * frame.pivotX, -height * frame.pivotY, width, height)
            ctx.restore()
        }
    }

    cutDeckledEdges(ctx, pixelRatio, seed)
}
