import { patchSeed, resetRandom } from "../math/random"
import { FaceType } from "./geometry"
import HexagonPatch, { PATCH_SIZE } from "./HexagonPatch"
import { packPatch, type QuadPatch } from "./QuadPatch"


/**
 * Default size of a dungeon in patches
 */
export const DUNGEON_WIDTH = 2
export const DUNGEON_HEIGHT = 2


/**
 * Generates the patches of a dungeon level. They only give the dungeon room to grow in: all their faces start out as
 * NONE, so only what the dungeon sets later gets drawn. The same seed and size always give the same patches.
 *
 * @param seed      seed of the level
 * @param size      hexagon size in map units
 * @param width     number of patches in q-direction
 * @param height    number of patches in r-direction
 *
 * @return packed patches, row by row. Any two patches next to each other in a row or column share a seam.
 */
export function generateDungeon(seed: number, size: number, width: number, height: number): QuadPatch[]
{
    const patches: QuadPatch[] = []
    for (let r = 0; r < height; r++)
    {
        for (let q = 0; q < width; q++)
        {
            resetRandom(patchSeed(seed, q * PATCH_SIZE, r * PATCH_SIZE))
            const patch = new HexagonPatch(q * PATCH_SIZE, r * PATCH_SIZE, size)
            const faces = patch.build()
            faces.forEach(face => face.type = FaceType.NONE)
            patches.push(packPatch(patch, faces))
        }
    }
    return patches
}
