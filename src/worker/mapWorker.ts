import RouteFinder from "../game/RouteFinder"
import { lightDungeon } from "../map/dungeonLights"
import { generateDungeon } from "../map/generateDungeon"
import { generatePatch } from "../map/generatePatch"
import type { MapRequest, MapResponse, RouteRequest } from "./MapWorkerClient"
import { transferables } from "../map/QuadPatch"


/**
 * Finds the routes of the current world seed
 */
let finder: RouteFinder | null = null
let finderSeed = NaN


function route({ seed, size, target, edits, radius }: RouteRequest)
{
    if (seed !== finderSeed)
    {
        finder = new RouteFinder(seed, size)
        finderSeed = seed
    }
    return finder!.find({ target, edits, radius })
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
            const level = generateDungeon(data.seed, data.size, data.width, data.height, data.style)
            const transfer: Transferable[] = level.patches.flatMap(transferables)
            if (data.lit)
            {
                level.lighting = lightDungeon(data.seed, level)
                transfer.push(level.lighting.visibility.buffer, level.lighting.lightIds.buffer, level.lighting.walls.buffer)
            }
            postMessage({ id, result: level } satisfies MapResponse, { transfer })
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
