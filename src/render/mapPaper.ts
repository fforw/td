const PAPER_IMAGE = import.meta.env.BASE_URL + "media/empty-handmade-paper.jpg"

/**
 * Strength of the texture of the paper on the map, 1 being the contrast of the image
 */
const PAPER_CONTRAST = 1.5

/**
 * Fraction of the pixels of the paper image that may be brighter than white in the texture, so a few bright ones don't
 * darken everything
 */
const BRIGHT_PIXELS = 0.01


/**
 * Loads the paper as a gray texture for multiplying it with the colors of the map, so its structure ends up in sepia
 * no matter which color the image has. The image repeats with a faint seam, so the tile holds it mirrored.
 */
export async function loadMapPaper(): Promise<HTMLCanvasElement>
{
    const image = new Image()
    image.src = PAPER_IMAGE
    await image.decode()

    const { naturalWidth: width, naturalHeight: height } = image

    const texture = document.createElement("canvas")
    texture.width = width
    texture.height = height
    const ctx = texture.getContext("2d")!
    ctx.drawImage(image, 0, 0)
    const pixels = ctx.getImageData(0, 0, width, height)
    const { data } = pixels

    const histogram = new Int32Array(256)
    for (let i = 0; i < data.length; i += 4)
    {
        histogram[Math.round((data[i] + data[i + 1] + data[i + 2]) / 3)]++
    }
    let white = 255
    for (let bright = histogram[white]; bright < width * height * BRIGHT_PIXELS; bright += histogram[white])
    {
        white--
    }

    for (let i = 0; i < data.length; i += 4)
    {
        const value = 255 - (white - (data[i] + data[i + 1] + data[i + 2]) / 3) * PAPER_CONTRAST
        data[i] = data[i + 1] = data[i + 2] = value
    }
    ctx.putImageData(pixels, 0, 0)

    const tile = document.createElement("canvas")
    tile.width = width * 2
    tile.height = height * 2
    const tileCtx = tile.getContext("2d")!
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]])
    {
        tileCtx.setTransform(sx, 0, 0, sy, width, height)
        tileCtx.drawImage(texture, 0, 0)
    }
    return tile
}
