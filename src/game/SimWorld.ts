import { PATCH_SIZE } from "../map/HexagonPatch"
import type { PatchContent } from "../map/pointsOfInterest"
import type { QuadPatch } from "../map/QuadPatch"
import { FACE_SIZE } from "../map/scale"
import MapWorkerClient from "../worker/MapWorkerClient"
import { type Campaign, overworld, type PatchKind, patchKey } from "./campaign"
import type { MissionRoute } from "./missions"
import { randomKind } from "./patchKinds"

interface SimPatch extends PatchContent
{
    patch: QuadPatch
}


/**
 * Holds the patches of the overworld that matter for the game instead of the view: the known ones and the possible
 * mission targets. They get built by a map worker of their own and go back to it as copies, since a worker hands over
 * what it builds. Routes get found there, so they never hold up the main thread.
 */
export default class SimWorld
{
    private readonly seed: number

    private readonly client = new MapWorkerClient()

    private readonly patches = new Map<string, Promise<SimPatch>>()

    constructor(seed: number)
    {
        this.seed = seed
    }


    private load(q: number, r: number, kind: PatchKind): Promise<SimPatch>
    {
        const key = patchKey(q, r)
        let patch = this.patches.get(key)
        if (!patch)
        {
            patch = this.client.buildPatch(q * PATCH_SIZE, r * PATCH_SIZE, this.seed, FACE_SIZE, kind === "CASTLE", kind).then(
                built => {
                    this.client.addPatch(built.patch)
                    return built
                }
            )
            this.patches.set(key, patch)
        }
        return patch
    }


    /**
     * Finds the route of a mission from the castle to all points of interest of an unknown patch, through the patches
     * discovered so far. Other targets don't count, nobody knows the way through them yet.
     *
     * @param campaign  campaign
     * @param target    key of the target patch
     *
     * @return route and the kind of the patch
     */
    async route(campaign: Campaign, target: string): Promise<MissionRoute>
    {
        const nodes = Object.values(overworld(campaign).patches).filter(node => node.state === "discovered")
        const [q, r] = target.split("/").map(Number)

        const [goal, ...known] = await Promise.all([
            this.load(q, r, randomKind(campaign.seed, q, r)),
            ...nodes.map(node => this.load(node.q, node.r, node.kind))
        ])

        const castle = known[nodes.findIndex(node => node.kind === "CASTLE")]
        const { reachable, cost } = await this.client.findRoute({
            start: { q: 0, r: 0, face: castle.pois[0] },
            target: { q: q * PATCH_SIZE, r: r * PATCH_SIZE },
            goals: goal.pois,
            through: nodes.map(node => [node.q * PATCH_SIZE, node.r * PATCH_SIZE])
        })
        return { reachable, cost, kind: goal.kind }
    }


    dispose(): void
    {
        this.client.terminate()
    }
}
