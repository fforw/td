import { CanvasTexture, EquirectangularReflectionMapping, SRGBColorSpace, type Texture } from "three"

/*
 * The surroundings that metal reflects in the dungeons: a spooky glow at the height of the walls, cut by the dark shapes
 * of wall segments in front of it. It is drawn rather than loaded, as nothing in it needs to be exact.
 */

/**
 * Size of the equirectangular map. Reflections of it are blurred by the roughness of the metal, so it can stay small.
 */
const WIDTH = 512
const HEIGHT = 256

/**
 * Color of the glow at its brightest, a little above the horizon
 */
const GLOW = "#5fd0a8"

/**
 * Color of the glow where it fades into the dark above
 */
const GLOW_HIGH = "#2a3a6a"

/**
 * Color of the darkness above and below the glow
 */
const DARK = "#040406"

/**
 * Color of the wall segments cutting through the glow
 */
const WALL = "#08080b"

/**
 * Color of the edges of the wall segments the glow catches
 */
const WALL_EDGE = "rgba(150, 230, 200, 0.35)"

/**
 * Share of wall segments that are fat ones
 */
const FAT_SHARE = 0.35

/**
 * Widths of thin and fat wall segments, as shares of the full circle
 */
const THIN_WIDTH: [number, number] = [0.012, 0.035]
const FAT_WIDTH: [number, number] = [0.06, 0.13]

/**
 * Widest gap between wall segments, as a share of the full circle, where they are sparsest
 */
const MAX_GAP = 0.28

/**
 * Where the wall segments are densest, as a share of the full circle
 */
const CROWD = 0.3

/**
 * Seed of the generator placing the wall segments, so that the map is the same each time
 */
const SEED = 0x7d3a91

let environment: Texture | null = null

/**
 * Returns the environment map for metal in the dungeons, made on the first call
 */
export function dungeonEnvironment(): Texture
{
    if (!environment)
    {
        const texture = new CanvasTexture(drawEnvironment())
        texture.mapping = EquirectangularReflectionMapping
        texture.colorSpace = SRGBColorSpace
        environment = texture
    }
    return environment
}

function drawEnvironment(): HTMLCanvasElement
{
    const canvas = document.createElement("canvas")
    canvas.width = WIDTH
    canvas.height = HEIGHT
    const ctx = canvas.getContext("2d")!

    // the top row is straight up, the middle one the horizon
    const horizon = HEIGHT / 2
    const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT)
    sky.addColorStop(0, DARK)
    sky.addColorStop(0.22, DARK)
    sky.addColorStop(0.34, GLOW_HIGH)
    sky.addColorStop(0.46, GLOW)
    sky.addColorStop(0.54, "#1c3a34")
    sky.addColorStop(0.62, DARK)
    sky.addColorStop(1, DARK)
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, WIDTH, HEIGHT)

    // the glow swells and ebbs around the horizon
    const random = generator(SEED)
    for (let i = 0; i < 5; i++)
    {
        const x = random() * WIDTH
        const radius = WIDTH * (0.08 + random() * 0.1)
        for (const offset of [-WIDTH, 0, WIDTH])
        {
            const swell = ctx.createRadialGradient(x + offset, horizon - 6, 0, x + offset, horizon - 6, radius)
            swell.addColorStop(0, "rgba(120, 255, 200, 0.35)")
            swell.addColorStop(1, "rgba(120, 255, 200, 0)")
            ctx.fillStyle = swell
            ctx.fillRect(x + offset - radius, horizon - 6 - radius, radius * 2, radius * 2)
        }
    }

    // wall segments rise from the floor through the glow, some of them above the top of it. They crowd together on one
    // side and leave wide gaps on the other.
    let x = random() * WIDTH * MAX_GAP
    while (x < WIDTH)
    {
        const fat = random() < FAT_SHARE
        const [narrowest, widest] = fat ? FAT_WIDTH : THIN_WIDTH
        const width = Math.round(WIDTH * (narrowest + random() * (widest - narrowest)))
        const top = Math.round(horizon - HEIGHT * (0.03 + random() * random() * 0.3))
        // fat ones may step down on one side
        const step = fat && random() < 0.5 ? Math.round(width * (0.3 + random() * 0.4)) : 0
        const stepTop = top + Math.round(HEIGHT * (0.03 + random() * 0.06))
        // the glow catches the top and one side
        const left = random() < 0.5
        for (const offset of [-WIDTH, 0, WIDTH])
        {
            const start = x + offset
            drawSegment(ctx, start, top, width, left, horizon)
            if (step)
            {
                drawSegment(ctx, left ? start - step + 1 : start + width - 1, stepTop, step, left, horizon)
            }
        }

        const crowding = density(x / WIDTH)
        const gap = WIDTH * MAX_GAP * (1 - crowding) * random()
        x += (width + step) * (0.3 + random() * 0.7) + gap
    }
    return canvas
}

function drawSegment(ctx: CanvasRenderingContext2D, x: number, top: number, width: number, left: boolean, horizon: number): void
{
    ctx.fillStyle = WALL
    ctx.fillRect(x, top, width, HEIGHT - top)
    ctx.fillStyle = WALL_EDGE
    ctx.fillRect(x, top, width, 1)
    ctx.fillRect(left ? x : x + width - 1, top, 1, horizon + HEIGHT * 0.06 - top)
}

/**
 * Returns how crowded the wall segments are at the given share of the full circle, from 0 to 1
 */
function density(at: number): number
{
    const closeness = 0.5 + 0.5 * Math.cos(2 * Math.PI * (at - CROWD))
    return closeness * closeness
}

/**
 * Returns a generator of numbers from 0 to 1, the same ones for the same seed
 */
function generator(seed: number): () => number
{
    let state = seed >>> 0
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        return state / 0x100000000
    }
}
