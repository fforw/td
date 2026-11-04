import type { CastlePlan } from "../castle/castlePlan"
import type { RouteQuery, RouteResult } from "../game/RouteFinder"
import type { QuadPatch } from "../map/QuadPatch"

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
}

/**
 * Asks the worker for the route of a mission. The worker builds the patches it needs for that itself, in grid positions
 * with the castle at 0/0.
 */
export interface RouteRequest extends RouteQuery
{
    id: number
    type: "route"
    /**
     * World seed
     */
    seed: number
    /**
     * Hexagon size in map units
     */
    size: number
}

export type MapRequest = PatchRequest | RouteRequest

/**
 * Packed patch together with the plan of the castle built on it, if any
 */
export interface BuiltPatch
{
    patch: QuadPatch
    castle: CastlePlan | null
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
     *
     * @return packed patch and castle plan
     */
    buildPatch(q: number, r: number, seed: number, size: number, castle = false): Promise<BuiltPatch>
    {
        return this.request(id => ({ id, type: "patch", q, r, seed, size, castle }))
    }


    /**
     * Finds the route of a mission. Requests are answered in order, so far targets hold up what comes after them.
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
