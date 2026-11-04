import RouteFinder from "../game/RouteFinder"
import { generatePatch } from "../map/generatePatch"
import type { MapRequest, MapResponse, RouteRequest } from "./MapWorkerClient"
import { transferables } from "../map/QuadPatch"


/**
 * Finds the routes of the current world seed
 */
let finder: RouteFinder | null = null
let finderSeed = NaN


function route({ seed, size, target, kinds, radius }: RouteRequest)
{
    if (seed !== finderSeed)
    {
        finder = new RouteFinder(seed, size)
        finderSeed = seed
    }
    return finder!.find({ target, kinds, radius })
}


onmessage = (ev: MessageEvent<MapRequest>) => {
    const { data } = ev
    const { id } = data
    try
    {
        if (data.type === "patch")
        {
            const { patch, castle } = generatePatch(data.q, data.r, data.seed, data.size, data.castle)
            postMessage({ id, result: { patch, castle } } satisfies MapResponse, { transfer: transferables(patch) })
        }
        else
        {
            postMessage({ id, result: route(data) } satisfies MapResponse)
        }
    }
    catch (e)
    {
        postMessage({ id, error: String(e instanceof Error ? e.stack ?? e.message : e) } satisfies MapResponse)
    }
}
