/**
 * Atlas of the map symbols, created from atlas-src by scripts/buildAtlas.ts
 */

const ATLAS_DIR = import.meta.env.BASE_URL + "media/map/"

export interface AtlasFrame
{
    x: number
    y: number
    w: number
    h: number
    /**
     * Point of the image that goes onto the map position, as fractions of its size
     */
    pivotX: number
    pivotY: number
}

export interface MapAtlas
{
    image: HTMLImageElement
    /**
     * Frames per sprite name
     */
    sprites: Map<string, AtlasFrame[]>
}


/**
 * Groups frames by their sprite name, which is the frame name without a number at the end: tree-1 and tree-2 are
 * variants of "tree".
 */
export function spritesOf(frames: Record<string, AtlasFrame>): Map<string, AtlasFrame[]>
{
    const sprites = new Map<string, AtlasFrame[]>()
    for (const [name, frame] of Object.entries(frames))
    {
        const sprite = name.replace(/-\d+$/, "")
        const variants = sprites.get(sprite)
        if (variants)
        {
            variants.push(frame)
        }
        else
        {
            sprites.set(sprite, [frame])
        }
    }
    return sprites
}


export async function loadMapAtlas(): Promise<MapAtlas>
{
    const response = await fetch(ATLAS_DIR + "atlas.json")
    if (!response.ok)
    {
        throw new Error("Loading the map atlas failed: " + response.status)
    }
    const { image: file, frames } = await response.json()

    const image = new Image()
    image.src = ATLAS_DIR + file
    await image.decode()

    return { image, sprites: spritesOf(frames) }
}
