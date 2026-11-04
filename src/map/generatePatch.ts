import Castle from "../castle/Castle"
import { type CastlePlan, planCastle } from "../castle/castlePlan"
import { patchSeed, resetRandom, rng } from "../math/random"
import HexagonPatch from "./HexagonPatch"
import { packPatch, type QuadPatch } from "./QuadPatch"
import Terrain from "./terrain"


/**
 * Terrain of the current world seed
 */
let terrain: Terrain | null = null
let terrainSeed = NaN


export interface GeneratedPatch
{
    patch: QuadPatch
    castle: CastlePlan | null
    /**
     * Local face of the center of the castle, -1 without a castle
     */
    castleFace: number
}


/**
 * Generates the patch at the given hexagon position. The same seed and position always give the same patch, no matter
 * in which order patches get generated.
 *
 * @param q         q-position of the patch center
 * @param r         r-position of the patch center
 * @param seed      world seed
 * @param size      hexagon size in map units
 * @param castle    build a castle around the face closest to the world origin
 *
 * @return packed patch and castle
 */
export function generatePatch(q: number, r: number, seed: number, size: number, castle: boolean): GeneratedPatch
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

    // the castle changes the face types, so it has to be built before packing
    const built = castle ? new Castle(faces) : null
    const plan = built && planCastle(faces, built)
    return { patch: packPatch(patch, faces), castle: plan, castleFace: built ? faces.indexOf(built.centerFace) : -1 }
}
