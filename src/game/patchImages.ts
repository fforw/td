import { FaceType } from "../map/geometry"
import { PATCH_SIZE } from "../map/HexagonPatch"
import type { QuadPatch } from "../map/QuadPatch"
import { FACE_SIZE } from "../map/scale"
import MapWorkerClient from "../worker/MapWorkerClient"

/**
 * Size of a patch in 2D map units, see createHexagon(). Patches sit on a grid of this size; their hexagon rows make
 * the edges jagged, so neighboring patches interlock.
 */
export const PATCH_WIDTH = Math.sqrt(3) * FACE_SIZE * PATCH_SIZE
export const PATCH_DEPTH = 1.5 * FACE_SIZE * PATCH_SIZE

/**
 * Pixels per patch width of the rendered images, before the device pixel ratio
 */
const IMAGE_WIDTH = 200

/**
 * Image of the faces of a patch with its position in 2D map units
 */
export interface PatchImage
{
    href: string
    x: number
    y: number
    width: number
    height: number
}


/**
 * Draws the faces of the patch in their 2D colors at the given scale.
 */
function drawPatch(patch: QuadPatch, scale: number): PatchImage
{
    const { positions, vertex, faceType } = patch

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let i = 0; i < positions.length; i += 3)
    {
        minX = Math.min(minX, positions[i])
        maxX = Math.max(maxX, positions[i])
        minY = Math.min(minY, positions[i + 1])
        maxY = Math.max(maxY, positions[i + 1])
    }

    const canvas = document.createElement("canvas")
    canvas.width = Math.ceil((maxX - minX) * scale)
    canvas.height = Math.ceil((maxY - minY) * scale)
    const ctx = canvas.getContext("2d")!
    // a stroke in the fill color closes the hairline gaps between the faces
    ctx.lineWidth = 1
    ctx.lineJoin = "round"

    for (let f = 0; f < faceType.length; f++)
    {
        const { color } = FaceType.byIndex(faceType[f])
        ctx.fillStyle = ctx.strokeStyle = color
        ctx.beginPath()
        for (let h = f * 4; h < f * 4 + 4; h++)
        {
            const v = vertex[h] * 3
            const x = (positions[v] - minX) * scale
            const y = (positions[v + 1] - minY) * scale
            if (h === f * 4)
            {
                ctx.moveTo(x, y)
            }
            else
            {
                ctx.lineTo(x, y)
            }
        }
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
    }

    return { href: canvas.toDataURL(), x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}


/**
 * Builds overworld patches of a campaign and draws them as images for the patch map. The patches come from their own
 * map worker, the same way the 3D view gets them.
 */
export default class PatchImages
{
    private readonly client = new MapWorkerClient()
    private readonly images = new Map<string, PatchImage | null>()

    /**
     * Offset of the patch centers from their grid positions, known once a patch has been built
     */
    private origin: [number, number] | null = null

    /**
     * @param seed      campaign seed
     * @param onReady   called whenever another image is ready
     */
    constructor(private readonly seed: number, private readonly onReady: () => void)
    {
    }

    /**
     * Returns the image of the patch, null while it is being built.
     */
    get(q: number, r: number): PatchImage | null
    {
        const key = q + "/" + r
        if (!this.images.has(key))
        {
            this.images.set(key, null)
            const scale = IMAGE_WIDTH * window.devicePixelRatio / PATCH_WIDTH
            this.client.buildPatch(q * PATCH_SIZE, r * PATCH_SIZE, this.seed, FACE_SIZE, q === 0 && r === 0).then(
                ({ patch }) => {
                    const image = drawPatch(patch, scale)
                    this.origin ??= [
                        image.x + image.width / 2 - q * PATCH_WIDTH,
                        image.y + image.height / 2 - r * PATCH_DEPTH
                    ]
                    this.images.set(key, image)
                    this.onReady()
                },
                err => console.error("Building patch " + key + " failed", err)
            )
        }
        return this.images.get(key)!
    }

    /**
     * Returns the center of the patch at the given grid position in 2D map units.
     */
    center(q: number, r: number): [number, number]
    {
        const [ox, oy] = this.origin ?? [0, 0]
        return [q * PATCH_WIDTH + ox, r * PATCH_DEPTH + oy]
    }

    dispose(): void
    {
        this.client.terminate()
    }
}
