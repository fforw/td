import type { PatchKind } from "../game/campaign"
import type { RouteQuery, RouteResult } from "../game/RouteFinder"
import { DUNGEON_HEIGHT, DUNGEON_WIDTH, type DungeonLevel } from "../map/generateDungeon"
import type { GeneratedPatch } from "../map/patchGenerators"

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
     * Kind the patch is meant to be. Every request for a patch has to ask for the same kind, generators can change the
     * faces of a patch by kind.
     */
    kind: PatchKind
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

/**
 * Asks the worker for a dungeon level
 */
export interface DungeonRequest
{
    id: number
    type: "dungeon"
    /**
     * Seed of the level
     */
    seed: number
    /**
     * Hexagon size in map units
     */
    size: number
    /**
     * Number of patches in q-direction
     */
    width: number
    /**
     * Number of patches in r-direction
     */
    height: number
}

export type MapRequest = PatchRequest | RouteRequest | DungeonRequest

export type MapResponse =
    { id: number, result: GeneratedPatch | DungeonLevel | RouteResult, error?: undefined } |
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
     * Builds the patch at the given hexagon position. The same seed, position and kind always give the same patch, no
     * matter in which order patches get built.
     *
     * @param q         q-position of the patch center
     * @param r         r-position of the patch center
     * @param seed      world seed
     * @param size      hexagon size in map units
     * @param kind      kind the patch is meant to be
     *
     * @return packed patch, what it ended up as and its points of interest
     */
    buildPatch(q: number, r: number, seed: number, size: number, kind: PatchKind): Promise<GeneratedPatch>
    {
        return this.request(id => ({ id, type: "patch", q, r, seed, size, kind }))
    }


    /**
     * Builds a dungeon level
     *
     * @param seed      seed of the level
     * @param size      hexagon size in map units
     * @param width     number of patches in q-direction
     * @param height    number of patches in r-direction
     *
     * @return generated level
     */
    buildDungeon(seed: number, size: number, width = DUNGEON_WIDTH, height = DUNGEON_HEIGHT): Promise<DungeonLevel>
    {
        return this.request(id => ({ id, type: "dungeon", seed, size, width, height }))
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
