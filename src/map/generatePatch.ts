import type { PatchKind } from "../game/campaign"
import { patchSeed, resetRandom, rng } from "../math/random"
import HexagonPatch from "./HexagonPatch"
import { applyGenerator, type GeneratedPatch } from "./patchGenerators"
import Terrain from "./terrain"


/**
 * Terrain of the current world seed
 */
let terrain: Terrain | null = null
let terrainSeed = NaN


/**
 * Generates the patch at the given hexagon position. The same seed, position and kind always give the same patch, no
 * matter in which order patches get generated.
 *
 * @param q         q-position of the patch center
 * @param r         r-position of the patch center
 * @param seed      world seed
 * @param size      hexagon size in map units
 * @param kind      kind the patch is meant to be
 *
 * @return packed patch, what it ended up as and its points of interest
 */
export function generatePatch(q: number, r: number, seed: number, size: number, kind: PatchKind): GeneratedPatch
{
    resetRandom(patchSeed(seed, q, r))
    const patch = new HexagonPatch(q, r, size)
    const faces = patch.build()

    if (seed !== terrainSeed)
    {
        terrain = new Terrain(seed)
        terrainSeed = seed
    }
    const random = () => rng.next()
    for (const face of faces)
    {
        const [x, y] = face.centroid
        face.type = terrain!.faceType(x, y, random)
    }

    return applyGenerator(kind, patch, faces)
}
