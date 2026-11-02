import {
    BufferGeometry,
    DataTexture,
    Float32BufferAttribute,
    NearestFilter,
    RGBAFormat,
    SRGBColorSpace
} from "three"

/**
 * RGBA pixels, rows from the top. ImageData fits this.
 */
export interface SpriteImage
{
    readonly width: number
    readonly height: number
    readonly data: Uint8ClampedArray
}


/**
 * Lowest alpha counted as part of a sprite. The soft edge of the downscaled items is about 2 pixels wide and thin
 * parts like a bow string never become fully opaque, so everything visible is solid. Lower values are only specks.
 */
export const SOLID_ALPHA = 16

const NEIGHBORS = [[-1, 0], [1, 0], [0, -1], [0, 1]]


/**
 * Returns a copy of the image with a hard edge: pixels with at least the given alpha become fully opaque, all others
 * fully transparent. The soft edge keeps its unpremultiplied color.
 *
 * @param image     sprite
 * @param threshold lowest alpha that is solid
 * @param grow      number of pixels to grow the solid area by, sideways and up and down. Grown pixels take the color
 *                  of a solid neighbor.
 */
export function solidifySprite(image: SpriteImage, threshold = SOLID_ALPHA, grow = 0): SpriteImage
{
    const { width, height } = image
    const data = new Uint8ClampedArray(image.data)
    for (let i = 3; i < data.length; i += 4)
    {
        data[i] = data[i] >= threshold ? 255 : 0
    }

    growSolid(data, width, height, grow, null)
    return { width, height, data }
}


/**
 * Returns a copy of a solidified sprite with a pixel outline around it, sideways and up and down. The image grows by
 * the outline width on every side, so an outline at the border is not cut off.
 *
 * @param image sprite from solidifySprite()
 * @param width outline width in pixels
 * @param color outline color as RGB
 */
export function outlineSprite(image: SpriteImage, width = 1, color: readonly number[] = OUTLINE_COLOR): SpriteImage
{
    const w = image.width + width * 2
    const h = image.height + width * 2
    const data = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < image.height; y++)
    {
        const row = image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4)
        data.set(row, ((y + width) * w + width) * 4)
    }
    growSolid(data, w, h, width, [...color, 255])
    return { width: w, height: h, data }
}


/**
 * Default outline color, black like the 2D outlines
 */
export const OUTLINE_COLOR = [0, 0, 0]


/**
 * Grows the solid area of the pixels in place, sideways and up and down.
 *
 * @param data   RGBA pixels with an alpha of 0 or 255
 * @param width  width in pixels
 * @param height height in pixels
 * @param steps  pixels to grow by
 * @param color  RGBA color of the new pixels, or null to take the color of a solid neighbor
 */
function growSolid(data: Uint8ClampedArray, width: number, height: number, steps: number, color: number[] | null): void
{
    for (let step = 0; step < steps; step++)
    {
        // read from the previous step only, so every step grows by exactly one pixel
        const prev = new Uint8ClampedArray(data)
        for (let y = 0; y < height; y++)
        {
            for (let x = 0; x < width; x++)
            {
                const off = (y * width + x) * 4
                if (prev[off + 3])
                {
                    continue
                }
                for (const [dx, dy] of NEIGHBORS)
                {
                    const nx = x + dx, ny = y + dy
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height)
                    {
                        continue
                    }
                    const nOff = (ny * width + nx) * 4
                    if (prev[nOff + 3])
                    {
                        data.set(color ?? prev.subarray(nOff, nOff + 4), off)
                        break
                    }
                }
            }
        }
    }
}


/**
 * Turns a solidified sprite into a closed object of the given thickness, like a cookie cut from a plank. Front and
 * back are a single quad each, cut out by the material's alphaTest. Every pixel edge between a solid and a
 * transparent pixel gets a side quad colored like its solid pixel.
 *
 * The longer side of the sprite is 1 unit long, the object is centered on the origin and the sprite faces +z with
 * its top at +y. The UVs fit createSpriteTexture(), whose first row is at v = 0.
 *
 * @param image     sprite from solidifySprite()
 * @param thickness thickness in units
 */
export function extrudeSprite(image: SpriteImage, thickness: number): BufferGeometry
{
    const { width: w, height: h, data } = image
    const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] >= 128

    const s = 1 / Math.max(w, h)
    const X = (x: number) => (x - w / 2) * s
    const Y = (y: number) => (h / 2 - y) * s
    const t = thickness / 2

    const positions: number[] = []
    const uvs: number[] = []
    const indices: number[] = []

    // corners counter-clockwise as seen from outside
    function quad(corners: number[][], quadUvs: number[][])
    {
        const base = positions.length / 3
        for (let i = 0; i < 4; i++)
        {
            positions.push(...corners[i])
            uvs.push(...quadUvs[i])
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }

    const left = X(0), right = X(w), bottom = Y(h), top = Y(0)
    quad([[left, bottom, t], [right, bottom, t], [right, top, t], [left, top, t]], [[0, 1], [1, 1], [1, 0], [0, 0]])
    quad([[right, bottom, -t], [left, bottom, -t], [left, top, -t], [right, top, -t]], [[1, 1], [0, 1], [0, 0], [1, 0]])

    for (let y = 0; y < h; y++)
    {
        for (let x = 0; x < w; x++)
        {
            if (!solid(x, y))
            {
                continue
            }

            // the side quads sample the center of their pixel
            const uv = [(x + 0.5) / w, (y + 0.5) / h]
            const uv4 = [uv, uv, uv, uv]
            const l = X(x), r = X(x + 1), u = Y(y), d = Y(y + 1)

            if (!solid(x - 1, y)) quad([[l, d, -t], [l, d, t], [l, u, t], [l, u, -t]], uv4)
            if (!solid(x + 1, y)) quad([[r, d, t], [r, d, -t], [r, u, -t], [r, u, t]], uv4)
            if (!solid(x, y - 1)) quad([[l, u, t], [r, u, t], [r, u, -t], [l, u, -t]], uv4)
            if (!solid(x, y + 1)) quad([[l, d, -t], [r, d, -t], [r, d, t], [l, d, t]], uv4)
        }
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3))
    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    return geometry
}


/**
 * Texture for a solidified sprite. Nearest filtering without mipmaps keeps the cut out faces flush with the side
 * quads. Use it with alphaTest 0.5.
 */
export function createSpriteTexture(image: SpriteImage): DataTexture
{
    const tex = new DataTexture(new Uint8Array(image.data), image.width, image.height, RGBAFormat)
    tex.colorSpace = SRGBColorSpace
    tex.minFilter = tex.magFilter = NearestFilter
    tex.generateMipmaps = false
    tex.needsUpdate = true
    return tex
}


export interface ItemSprite
{
    geometry: BufferGeometry
    texture: DataTexture
}


export interface ItemSpriteOptions
{
    /**
     * Pixels to grow the solid area by before the outline is added
     */
    grow?: number
    /**
     * Outline width in pixels, 0 for none
     */
    outline?: number
    /**
     * Outline color as RGB
     */
    outlineColor?: readonly number[]
}


/**
 * Loads a sprite and turns it into a solid item.
 *
 * @param url       sprite image
 * @param thickness thickness in units, with the longer side of the sprite including its outline 1 unit long
 * @param options   grow and outline options
 */
export async function loadItemSprite(url: string, thickness: number, options: ItemSpriteOptions = {}): Promise<ItemSprite>
{
    const { grow = 0, outline = 1, outlineColor = OUTLINE_COLOR } = options

    const response = await fetch(url)
    // the canvas stores premultiplied colors, so the faintest edge pixels come back a few levels off. Not worth
    // decoding the PNG ourselves.
    const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: "none" })

    const canvas = document.createElement("canvas")
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext("2d")!
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()

    let image = solidifySprite(ctx.getImageData(0, 0, canvas.width, canvas.height), SOLID_ALPHA, grow)
    if (outline > 0)
    {
        image = outlineSprite(image, outline, outlineColor)
    }
    return {
        geometry: extrudeSprite(image, thickness),
        texture: createSpriteTexture(image)
    }
}

