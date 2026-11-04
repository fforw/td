import { generatePatch } from "../map/generatePatch"
import { PATCH_SIZE } from "../map/HexagonPatch"
import PatchWorld from "../map/PatchWorld"
import { placePois } from "../map/pointsOfInterest"
import { findRoute, globalFace, packPath, type Route, slotOf } from "../map/route"
import type { PassedPatch, PatchKind } from "./campaign"
import { NEIGHBORS, randomKind } from "./patchKinds"


export interface RouteQuery
{
    /**
     * Grid position of the target patch
     */
    target: { q: number, r: number }

    /**
     * Kinds of the patches that are known already by patch key, the others get rolled
     */
    kinds: Record<string, PatchKind>

    /**
     * Ring around the castle the route has to stay in
     */
    radius: number
}


export interface RouteResult extends Route
{
    /**
     * Kind of the target patch
     */
    kind: PatchKind

    /**
     * Local face in the castle patch the route starts on
     */
    start: number

    /**
     * Local faces to reach in the target patch
     */
    goals: number[]

    /**
     * Paths packed by packPath()
     */
    paths: Int32Array<ArrayBuffer>[]

    /**
     * The patches the paths go through in grid positions
     */
    patches: PassedPatch[]
}


interface FinderPatch
{
    q: number
    r: number
    slot: number
    kind: PatchKind
    pois: number[]
}


function patchKey(q: number, r: number): string
{
    return q + "/" + r
}


/**
 * Finds the routes of missions in a world. It builds its patches itself once a search gets there, since most patches
 * around don't matter for a route. All positions are grid positions, the castle is at 0/0.
 */
export default class RouteFinder
{
    private readonly seed: number
    private readonly size: number

    private readonly world = new PatchWorld()
    private readonly patches = new Map<string, FinderPatch>()
    private readonly bySlot = new Map<number, FinderPatch>()

    constructor(seed: number, size: number)
    {
        this.seed = seed
        this.size = size
    }


    /**
     * Number of patches built so far
     */
    get built(): number
    {
        return this.patches.size
    }


    /**
     * Returns the patch at the given position and builds it if necessary
     */
    private ensure(q: number, r: number, kinds: Record<string, PatchKind>): FinderPatch
    {
        const key = patchKey(q, r)
        let entry = this.patches.get(key)
        if (!entry)
        {
            const isCastle = q === 0 && r === 0
            const { patch, castleFace } = generatePatch(q * PATCH_SIZE, r * PATCH_SIZE, this.seed, this.size, isCastle)
            const kind = isCastle ? "CASTLE" : kinds[key] ?? randomKind(this.seed, q, r)
            const content = placePois(patch, kind, castleFace)
            entry = { q, r, slot: this.world.add(patch), ...content }
            this.patches.set(key, entry)
            this.bySlot.set(entry.slot, entry)
        }
        return entry
    }


    /**
     * Finds the route from the castle to all points of interest of a patch
     *
     * @param query     target and limits of the route
     *
     * @return route
     */
    find({ target, kinds, radius }: RouteQuery): RouteResult
    {
        const { world, bySlot } = this
        const castle = this.ensure(0, 0, kinds)
        const goal = this.ensure(target.q, target.r, kinds)

        const { reachable, cost, paths } = findRoute(
            world,
            globalFace(castle.slot, castle.pois[0]),
            goal.slot,
            goal.pois,
            [castle.slot],
            undefined,
            // a patch in reach needs its neighbors, to connect to them before the search looks across the seams
            slot => {
                const { q, r } = bySlot.get(slot)!
                return NEIGHBORS
                    .map(([dq, dr]) => [q + dq, r + dr])
                    .filter(([nq, nr]) => Math.max(Math.abs(nq), Math.abs(nr)) <= radius)
                    .map(([nq, nr]) => this.ensure(nq, nr, kinds).slot)
            }
        )

        const crossed = new Set(paths.flat().map(slotOf))
        return {
            reachable,
            cost,
            kind: goal.kind,
            start: castle.pois[0],
            goals: goal.pois,
            paths: paths.map(path => packPath(world, path)),
            patches: [...crossed].map(slot => {
                const { q, r, kind } = bySlot.get(slot)!
                return { q, r, kind }
            })
        }
    }
}
