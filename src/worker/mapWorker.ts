import RouteFinder from "../game/RouteFinder"
import { generateDungeon } from "../map/generateDungeon"
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
            const result = generatePatch(data.q, data.r, data.seed, data.size, data.kind)
            postMessage({ id, result } satisfies MapResponse, { transfer: transferables(result.patch) })
        }
        else if (data.type === "dungeon")
        {
            const patches = generateDungeon(data.seed, data.size, data.width, data.height)
            postMessage({ id, result: patches } satisfies MapResponse, { transfer: patches.flatMap(transferables) })
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
