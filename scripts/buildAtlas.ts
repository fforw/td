/**
 * Packs the PNG images in atlas-src into one image with a JSON file of their frames, ported from fforw/rd.
 *
 *     pnpm build-atlas
 *
 * The name of a frame is the file name without ".png". Frames named like tree-1 and tree-2 are variants of the sprite
 * "tree". Images are placed on the map at their pivot, which is the center unless the optional atlas-src/atlas.json says
 * otherwise. Pivots above 1 are in pixels, the others fractions of the image size.
 *
 *     { "frames": { "tree-1": { "pivot": { "x": 0.5, "y": 1 } } } }
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import pack from "bin-pack"
import { Jimp } from "jimp"

const ROOT = join(import.meta.dirname, "..")
const SOURCE_DIR = join(ROOT, "atlas-src")
const OUTPUT_DIR = join(ROOT, "public/media/map")
const IMAGE_NAME = "atlas.png"

/**
 * Empty pixels around every image, so scaling doesn't pick up pixels of its neighbors
 */
const PADDING = 1

const DEFAULT_PIVOT = { x: 0.5, y: 0.5 }


function fraction(pivot: number, size: number): number
{
    return Math.abs(pivot) > 1 ? pivot / size : pivot
}


const template = existsSync(join(SOURCE_DIR, "atlas.json"))
    ? JSON.parse(readFileSync(join(SOURCE_DIR, "atlas.json"), "utf-8"))
    : { frames: {} }

const files = readdirSync(SOURCE_DIR).filter(file => file.endsWith(".png")).sort()
if (files.length === 0)
{
    throw new Error("No images in " + SOURCE_DIR)
}

const bins = await Promise.all(files.map(async file => {
    const img = await Jimp.read(join(SOURCE_DIR, file))
    return {
        name: file.slice(0, -".png".length),
        width: img.width + PADDING * 2,
        height: img.height + PADDING * 2,
        img,
        x: 0,
        y: 0
    }
}))

for (const name of Object.keys(template.frames))
{
    if (!bins.some(bin => bin.name === name))
    {
        throw new Error("atlas.json has a frame without an image: " + name)
    }
}

const { width, height } = pack(bins, { inPlace: true })
const atlas = new Jimp({ width, height, color: 0x00000000 })

const frames: Record<string, object> = {}
for (const { name, x, y, img } of [...bins].sort((a, b) => a.name < b.name ? -1 : 1))
{
    const w = img.width
    const h = img.height
    const pivot = template.frames[name]?.pivot ?? DEFAULT_PIVOT
    frames[name] = {
        x: x + PADDING,
        y: y + PADDING,
        w,
        h,
        pivotX: fraction(pivot.x, w),
        pivotY: fraction(pivot.y, h)
    }
    atlas.blit({ src: img, x: x + PADDING, y: y + PADDING })
}

mkdirSync(OUTPUT_DIR, { recursive: true })
await atlas.write(join(OUTPUT_DIR, IMAGE_NAME) as `${string}.png`)
writeFileSync(
    join(OUTPUT_DIR, "atlas.json"),
    JSON.stringify({ image: IMAGE_NAME, width, height, frames }, null, 4) + "\n"
)

console.log("Packed " + bins.length + " images into " + width + " x " + height)
