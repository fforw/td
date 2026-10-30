import HexagonPatch from "./HexagonPatch"
import type { MapRequest, MapResponse } from "./MapWorkerClient"
import { packPatch, transferables } from "./QuadPatch"
import { patchSeed, resetRandom } from "./util"


function respond(response: MapResponse): void
{
    postMessage(response, { transfer: response.error === undefined ? transferables(response.patch) : [] })
}


onmessage = (ev: MessageEvent<MapRequest>) => {
    const { id, q, r, seed, size } = ev.data
    try
    {
        resetRandom(patchSeed(seed, q, r))
        const patch = new HexagonPatch(q, r, size)
        respond({ id, patch: packPatch(patch, patch.build()) })
    }
    catch (e)
    {
        respond({ id, error: String(e instanceof Error ? e.stack ?? e.message : e) })
    }
}
