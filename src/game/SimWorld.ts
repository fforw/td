import { FACE_SIZE } from "../map/scale"
import MapWorkerClient from "../worker/MapWorkerClient"
import { type Campaign, type KindEdits, overworld, patchKey } from "./campaign"
import type { MissionRoute } from "./missions"
import { unsentEdits } from "./patchKinds"


/**
 * The side of the game that needs the map instead of just looking at it. The map worker it has for itself keeps the
 * patches and finds the routes, so they never hold up the main thread.
 */
export default class SimWorld
{
    private readonly seed: number

    private readonly client = new MapWorkerClient()

    /**
     * Kind edits the worker knows. Requests are handled in order, so a search sees all edits made before it.
     */
    private readonly sentEdits: KindEdits = {}

    constructor(seed: number)
    {
        this.seed = seed
    }


    /**
     * Finds the route of a mission from the castle to all points of interest of a patch. It may cross any patch around,
     * explorers get through unknown land unnoticed, but what they cross that way stays unknown. The way may lead up to
     * one ring beyond the target and what's known.
     *
     * @param campaign  campaign
     * @param target    key of the target patch
     *
     * @return route and the kind of the patch
     */
    route(campaign: Campaign, target: string): Promise<MissionRoute>
    {
        return this.find(campaign, target)
    }


    /**
     * Finds the route of a hero from the castle to all points of interest of a patch. Unlike explorers, heroes get
     * noticed, so it only crosses discovered patches.
     *
     * @param campaign  campaign
     * @param target    key of the target patch
     *
     * @return route, which isn't reachable as long as there is no way over known land
     */
    heroRoute(campaign: Campaign, target: string): Promise<MissionRoute>
    {
        const known = Object.entries(overworld(campaign).patches)
            .filter(([, node]) => node.state === "discovered")
            .map(([key]) => key)
        return this.find(campaign, target, known)
    }


    private async find(campaign: Campaign, target: string, known?: string[]): Promise<MissionRoute>
    {
        const { patches, kindEdits } = overworld(campaign)
        const [q, r] = target.split("/").map(Number)

        const nodes = Object.values(patches)
        const radius = Math.max(...[...nodes.filter(node => node.state === "discovered"), { q, r }]
            .map(node => Math.max(Math.abs(node.q), Math.abs(node.r)))) + 1

        const edits = unsentEdits(kindEdits, this.sentEdits)
        Object.assign(this.sentEdits, edits)

        const { reachable, cost, kind, way, patches: crossed } = await this.client.findRoute({
            seed: this.seed,
            size: FACE_SIZE,
            target: { q, r },
            edits,
            radius,
            ...(known ? { known } : {})
        })

        const passed = crossed.filter(patch => {
            const key = patchKey(patch.q, patch.r)
            return key !== target && patches[key]?.state !== "discovered"
        })
        return { reachable, cost, kind, passed, way }
    }


    dispose(): void
    {
        this.client.terminate()
    }
}
