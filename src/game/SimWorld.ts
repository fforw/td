import { PATCH_SIZE } from "../map/HexagonPatch"
import type { PatchContent } from "../map/pointsOfInterest"
import type { QuadPatch } from "../map/QuadPatch"
import { pathPatches } from "../map/route"
import { FACE_SIZE } from "../map/scale"
import MapWorkerClient from "../worker/MapWorkerClient"
import { type Campaign, overworld, type PassedPatch, type PatchKind, patchKey } from "./campaign"
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
     * Finds the route of a mission from the castle to all points of interest of an unknown patch. It may cross any
     * patch around, explorers get through unknown land unnoticed, but what they cross that way stays unknown.
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

        const known = Object.values(patches).filter(node => node.state === "discovered")
        const radius = Math.max(...[...known, { q, r }].map(node => Math.max(Math.abs(node.q), Math.abs(node.r)))) + 1

        const area: [number, number][] = []
        for (let pr = -radius; pr <= radius; pr++)
        {
            for (let pq = -radius; pq <= radius; pq++)
            {
                area.push([pq, pr])
            }
        }
        const kindAt = (pq: number, pr: number) => patches[patchKey(pq, pr)]?.kind ?? randomKind(campaign.seed, pq, pr)
        const built = await Promise.all(area.map(([pq, pr]) => this.load(pq, pr, kindAt(pq, pr))))
        const goal = built[area.findIndex(([pq, pr]) => pq === q && pr === r)]
        const castle = built[area.findIndex(([pq, pr]) => pq === 0 && pr === 0)]

        const { reachable, cost, paths } = await this.client.findRoute({
            start: { q: 0, r: 0, face: castle.pois[0] },
            target: { q: q * PATCH_SIZE, r: r * PATCH_SIZE },
            goals: goal.pois,
            through: area.map(([pq, pr]) => [pq * PATCH_SIZE, pr * PATCH_SIZE])
        })

        const passed = new Map<string, PassedPatch>()
        for (const [hq, hr] of paths.flatMap(pathPatches))
        {
            const pq = hq / PATCH_SIZE
            const pr = hr / PATCH_SIZE
            const key = patchKey(pq, pr)
            if (key !== target && patches[key]?.state !== "discovered")
            {
                passed.set(key, { q: pq, r: pr, kind: built[area.findIndex(([aq, ar]) => aq === pq && ar === pr)].kind })
            }
        }
        return { reachable, cost, kind: goal.kind, passed: [...passed.values()] }
    }


    dispose(): void
    {
        this.client.terminate()
    }
}
