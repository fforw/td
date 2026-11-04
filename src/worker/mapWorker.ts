import { generatePatch } from "../map/generatePatch"
import PatchWorld from "../map/PatchWorld"
import { placePois } from "../map/pointsOfInterest"
import { findRoute, globalFace, packPath } from "../map/route"
import type { BuiltPatch, MapRequest, MapResponse, PatchRequest, RouteRequest, RouteResult } from "./MapWorkerClient"
import { transferables } from "../map/QuadPatch"


/**
 * Patches routes can be found on, sent back by the main thread
 */
const world = new PatchWorld()


function buildPatch({ q, r, seed, size, castle, kind }: PatchRequest): BuiltPatch
{
    const { patch, castle: plan, castleFace } = generatePatch(q, r, seed, size, castle)
    return { patch, castle: plan, ...placePois(patch, kind ?? (castle ? "CASTLE" : "EMPTY"), castleFace) }
}


function route({ start, target, goals, through }: RouteRequest): RouteResult
{
    const startSlot = world.findSlot(start.q, start.r)
    const { reachable, cost, paths } = findRoute(
        world,
        globalFace(startSlot, start.face),
        world.findSlot(target.q, target.r),
        goals,
        through.map(([q, r]) => world.findSlot(q, r))
    )
    return { reachable, cost, paths: paths.map(path => packPath(world, path)) }
}


onmessage = (ev: MessageEvent<MapRequest>) => {
    const { data } = ev
    if (data.type === "add")
    {
        world.add(data.patch)
        return
    }

    const { id } = data
    try
    {
        if (data.type === "patch")
        {
            const result = buildPatch(data)
            postMessage({ id, result } satisfies MapResponse, { transfer: transferables(result.patch) })
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
