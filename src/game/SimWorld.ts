import { FACE_SIZE } from "../map/scale"
import MapWorkerClient from "../worker/MapWorkerClient"
import { type Campaign, overworld, patchKey } from "./campaign"
import type { MissionRoute } from "./missions"


/**
 * The side of the game that needs the map instead of just looking at it. The map worker it has for itself keeps the
 * patches and finds the routes, so they never hold up the main thread.
 */
export default class SimWorld
{
    private readonly seed: number

    private readonly client = new MapWorkerClient()

    constructor(seed: number)
    {
        this.seed = seed
    }


    /**
     * Finds the route of a mission from the castle to all points of interest of an unknown patch. It may cross any
     * patch around, explorers get through unknown land unnoticed, but what they cross that way stays unknown. The way
     * may lead up to one ring beyond the target and what's known.
     *
     * @param campaign  campaign
     * @param target    key of the target patch
     *
     * @return route and the kind of the patch
     */
    async route(campaign: Campaign, target: string): Promise<MissionRoute>
    {
        const { patches } = overworld(campaign)
        const [q, r] = target.split("/").map(Number)

        const nodes = Object.values(patches)
        const radius = Math.max(...[...nodes.filter(node => node.state === "discovered"), { q, r }]
            .map(node => Math.max(Math.abs(node.q), Math.abs(node.r)))) + 1

        const { reachable, cost, kind, patches: crossed } = await this.client.findRoute({
            seed: this.seed,
            size: FACE_SIZE,
            target: { q, r },
            kinds: Object.fromEntries(nodes.map(node => [patchKey(node.q, node.r), node.kind])),
            radius
        })

        const passed = crossed.filter(patch => {
            const key = patchKey(patch.q, patch.r)
            return key !== target && patches[key]?.state !== "discovered"
        })
        return { reachable, cost, kind, passed }
    }


    dispose(): void
    {
        this.client.terminate()
    }
}
