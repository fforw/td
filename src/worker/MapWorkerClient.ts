import type { CastlePlan } from "../castle/castlePlan"
import type { PatchKind } from "../game/campaign"
import type { PatchContent } from "../map/pointsOfInterest"
import type { QuadPatch } from "../map/QuadPatch"
import type { Route } from "../map/route"

/**
 * Asks the worker to build the patch at the given hexagon position
 */
export interface PatchRequest
{
    id: number
    type: "patch"
    q: number
    r: number
    /**
     * World seed, the worker derives the patch seed from it and the position
     */
    seed: number
    /**
     * Hexagon size in map units
     */
    size: number
    /**
     * Build a castle around the face closest to the world origin
     */
    castle: boolean
    /**
     * Kind the patch is meant to be
     */
    kind?: PatchKind
}

/**
 * Gives the worker a copy of a patch to find routes on. Requests are handled in order, so a route request sent later
 * sees the patch.
 */
export interface AddPatchRequest
{
    type: "add"
    patch: QuadPatch
}

/**
 * Asks the worker for the route from a face to the given goals. Patches are addressed by hexagon position, since the
 * slots in the worker are its own.
 */
export interface RouteRequest
{
    id: number
    type: "route"
    start: { q: number, r: number, face: number }
    target: { q: number, r: number }
    /**
     * Local faces in the target patch to reach
     */
    goals: number[]
    /**
     * Hexagon positions of the patches the route may use
     */
    through: [number, number][]
}

export type MapRequest = PatchRequest | AddPatchRequest | RouteRequest

/**
 * Packed patch together with the plan of the castle built on it, if any, and its kind and points of interest
 */
export interface BuiltPatch extends PatchContent
{
    patch: QuadPatch
    castle: CastlePlan | null
}

/**
 * Route with its paths packed by packPath()
 */
export interface RouteResult extends Route
{
    paths: Int32Array<ArrayBuffer>[]
}

export type MapResponse =
    { id: number, result: BuiltPatch | RouteResult, error?: undefined } |
    { id: number, error: string }


interface Pending
{
    resolve: (result: any) => void
    reject: (error: Error) => void
}


/**
 * Main thread side of the map worker. Generation runs on the object based half edge structure inside the worker, only
 * the finished, packed patches come back.
 */
export default class MapWorkerClient
{
    private worker = new Worker(new URL("./mapWorker.ts", import.meta.url), { type: "module" })

    private pending = new Map<number, Pending>()

    private nextId = 1

    constructor()
    {
        this.worker.onmessage = (ev: MessageEvent<MapResponse>) => {
            const { data } = ev
            const pending = this.pending.get(data.id)
            if (!pending)
            {
                return
            }
            this.pending.delete(data.id)

            if (data.error !== undefined)
            {
                pending.reject(new Error(data.error))
            }
            else
            {
                pending.resolve(data.result)
            }
        }

        this.worker.onerror = ev => {
            const error = new Error("Map worker failed: " + ev.message)
            this.pending.forEach(p => p.reject(error))
            this.pending.clear()
        }
    }


    private request<T>(send: (id: number) => MapRequest): Promise<T>
    {
        const id = this.nextId++
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject })
            this.worker.postMessage(send(id))
        })
    }


    /**
     * Builds the patch at the given hexagon position. The same seed and position always give the same patch, no matter
     * in which order patches get built.
     *
     * @param q         q-position of the patch center
     * @param r         r-position of the patch center
     * @param seed      world seed
     * @param size      hexagon size in map units
     * @param castle    build a castle around the face closest to the world origin
     * @param kind      kind the patch is meant to be, the result says what it ended up as
     *
     * @return packed patch, castle plan, kind and points of interest
     */
    buildPatch(q: number, r: number, seed: number, size: number, castle = false, kind?: PatchKind): Promise<BuiltPatch>
    {
        return this.request(id => ({ id, type: "patch", q, r, seed, size, castle, kind }))
    }


    /**
     * Sends a copy of the patch to the worker for finding routes on, the given one stays valid.
     */
    addPatch(patch: QuadPatch): void
    {
        this.worker.postMessage({ type: "add", patch } satisfies MapRequest)
    }


    /**
     * Finds a route on the patches added before.
     */
    findRoute(request: Omit<RouteRequest, "id" | "type">): Promise<RouteResult>
    {
        return this.request(id => ({ id, type: "route", ...request }))
    }


    terminate(): void
    {
        this.worker.terminate()
        const error = new Error("Map worker terminated")
        this.pending.forEach(p => p.reject(error))
        this.pending.clear()
    }
}
