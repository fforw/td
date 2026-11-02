import Castle from "../castle/Castle"
import { planCastle } from "../castle/castlePlan"
import HexagonPatch from "./HexagonPatch"
import type { MapRequest, MapResponse } from "./MapWorkerClient"
import { packPatch, transferables } from "./QuadPatch"
import Terrain from "./terrain"
import { patchSeed, resetRandom, rng } from "../core/util"


/**
 * Terrain of the current world seed
 */
let terrain: Terrain | null = null
let terrainSeed = NaN


function respond(response: MapResponse): void
{
    postMessage(response, { transfer: response.error === undefined ? transferables(response.result.patch) : [] })
}


onmessage = (ev: MessageEvent<MapRequest>) => {
    const { id, q, r, seed, size, castle } = ev.data
    try
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
        const plan = castle ? planCastle(faces, new Castle(faces)) : null
        respond({ id, result: { patch: packPatch(patch, faces), castle: plan } })
    }
    catch (e)
    {
        respond({ id, error: String(e instanceof Error ? e.stack ?? e.message : e) })
    }
}
