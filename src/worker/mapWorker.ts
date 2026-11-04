import Castle from "../castle/Castle"
import { planCastle } from "../castle/castlePlan"
import HexagonPatch from "../map/HexagonPatch"
import PatchWorld from "../map/PatchWorld"
import { placePois } from "../map/pointsOfInterest"
import { findRoute, globalFace, packPath } from "../map/route"
import type { BuiltPatch, MapRequest, MapResponse, PatchRequest, RouteRequest, RouteResult } from "./MapWorkerClient"
import { packPatch, transferables } from "../map/QuadPatch"
import Terrain from "../map/terrain"
import { patchSeed, resetRandom, rng } from "../math/random"


/**
 * Terrain of the current world seed
 */
let terrain: Terrain | null = null
let terrainSeed = NaN

/**
 * Patches routes can be found on, sent back by the main thread
 */
const world = new PatchWorld()


function buildPatch({ q, r, seed, size, castle, kind }: PatchRequest): BuiltPatch
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
    const builtCastle = castle ? new Castle(faces) : null
    const plan = builtCastle && planCastle(faces, builtCastle)
    const packed = packPatch(patch, faces)
    const content = placePois(packed, kind ?? (castle ? "CASTLE" : "EMPTY"), builtCastle ? faces.indexOf(builtCastle.centerFace) : -1)
    return { patch: packed, castle: plan, ...content }
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
