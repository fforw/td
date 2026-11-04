import { createNoise2D } from "simplex-noise"
import Prando from "prando"

/*
 * Deckled edges of handmade paper, imitating the ones of the paper exports of Rebelle. The numbers come from measuring
 * such an export of 2048 x 2048: the edge wanders about 16 pixels in long bumps with fine fibres on top and fades out
 * over a few pixels, without changing its color.
 */

/**
 * Wavelengths and amplitudes in pixels of the noise moving the edge
 */
const EDGE_OCTAVES: readonly [number, number][] = [
    [200, 2.5],
    [100, 3],
    [50, 2.2],
    [25, 1.4],
    [12, 0.9],
    [6, 0.6],
    [3, 0.9]
]

/**
 * Average distance of the edge from the border of the canvas in pixels. The sum of all amplitudes is smaller, so it
 * doesn't get cut off.
 */
const EDGE_MARGIN = 14

/**
 * Width of the fade in pixels, which gets wider in the wispy places given by the noise of the given wavelength
 */
const FADE = 3
const WISP_FADE = 8
const WISP_WAVELENGTH = 45

const BAND = EDGE_MARGIN + EDGE_OCTAVES.reduce((sum, [, amount]) => sum + amount, 0) + FADE + WISP_FADE


/**
 * Creates the alpha mask of a sheet of paper as RGBA data, with the color being irrelevant.
 *
 * @param width         width in canvas pixels
 * @param height        height in canvas pixels
 * @param pixelRatio    canvas pixels per pixel, so the edge looks the same at all resolutions
 * @param seed          seed of the noise
 */
export function deckleMask(width: number, height: number, pixelRatio: number, seed: number): Uint8ClampedArray<ArrayBuffer>
{
    const prando = new Prando(seed)
    const edgeNoise = createNoise2D(() => prando.next())
    const wispNoise = createNoise2D(() => prando.next())

    const data = new Uint8ClampedArray(width * height * 4)
    for (let py = 0, i = 3; py < height; py++)
    {
        const y = py / pixelRatio
        const edgeY = Math.min(y, height / pixelRatio - y)
        for (let px = 0; px < width; px++, i += 4)
        {
            const x = px / pixelRatio
            const distance = Math.min(edgeY, x, width / pixelRatio - x)
            if (distance >= BAND)
            {
                data[i] = 255
                continue
            }

            let edge = EDGE_MARGIN
            for (const [wavelength, amount] of EDGE_OCTAVES)
            {
                edge += edgeNoise(x / wavelength, y / wavelength) * amount
            }
            const fade = FADE + Math.max(0, wispNoise(x / WISP_WAVELENGTH, y / WISP_WAVELENGTH)) * WISP_FADE

            const t = Math.min(1, Math.max(0, (distance - edge) / fade + 0.5))
            data[i] = t * t * (3 - 2 * t) * 255
        }
    }
    return data
}
