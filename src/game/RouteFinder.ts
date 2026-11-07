import { generatePatch } from "../map/generatePatch"
import { PATCH_SIZE } from "../map/HexagonPatch"
import PatchWorld from "../map/PatchWorld"
import { findRoute, globalFace, packPath, type Route, slotOf, stopShort, tautPath } from "../map/route"
import type { KindEdits, PassedPatch, PatchKind } from "./campaign"
import { NEIGHBORS, wantedKind } from "./patchKinds"

/**
 * How far before a point of interest someone walking a route stops, in map units
 */
const STOP_DISTANCE = 60


export interface RouteQuery
{
    /**
     * Grid position of the target patch
     */
    target: { q: number, r: number }

    /**
     * Kind edits since the last query, all patches without an edit so far have their natural kind
     */
    edits: KindEdits

    /**
     * Ring around the castle the route has to stay in
     */
    radius: number

    /**
     * Keys of the only patches the route may cross besides the castle and the target, any patch without them
     */
    known?: string[]
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
     * Way to walk from the castle to shortly before the point of interest farthest along, as x and y in map units
     */
    way: number[]

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
    /**
     * Kind the patch was built as, what it ended up as is in kind
     */
    wanted: PatchKind
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
    private readonly edits: KindEdits = {}

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
     * Keeps the given edits for the patches they are about. Generators change faces by kind, so a patch built as
     * another kind goes away, to be built again once a search gets there.
     */
    private applyEdits(edits: KindEdits): void
    {
        for (const [key, kind] of Object.entries(edits))
        {
            this.edits[key] = kind
            const entry = this.patches.get(key)
            if (entry && entry.wanted !== kind)
            {
                this.world.remove(entry.slot)
                this.patches.delete(key)
                this.bySlot.delete(entry.slot)
            }
        }
    }


    /**
     * Returns the patch at the given position and builds it if necessary
     */
    private ensure(q: number, r: number): FinderPatch
    {
        const key = patchKey(q, r)
        let entry = this.patches.get(key)
        if (!entry)
        {
            const wanted = wantedKind(this.seed, this.edits, q, r)
            const { patch, kind, pois } = generatePatch(q * PATCH_SIZE, r * PATCH_SIZE, this.seed, this.size, wanted)
            entry = { q, r, slot: this.world.add(patch), wanted, kind, pois: pois.map(({ face }) => face) }
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
    find({ target, edits, radius, known }: RouteQuery): RouteResult
    {
        this.applyEdits(edits)

        const { world, bySlot } = this
        const castle = this.ensure(0, 0)
        const goal = this.ensure(target.q, target.r)

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
                    .filter(([nq, nr]) => !known || known.includes(patchKey(nq, nr)))
                    .map(([nq, nr]) => this.ensure(nq, nr).slot)
            },
            this.size
        )

        // of several goals, the one that takes the most faces to get to stands for the farthest one
        const longest = paths.reduce((a, b) => b.length > a.length ? b : a)
        const way = stopShort(tautPath(world, longest), STOP_DISTANCE).map(Math.round)

        const crossed = new Set(paths.flat().map(slotOf))
        return {
            reachable,
            cost,
            kind: goal.kind,
            start: castle.pois[0],
            goals: goal.pois,
            paths: paths.map(path => packPath(world, path)),
            way,
            patches: [...crossed].map(slot => {
                const { q, r, kind } = bySlot.get(slot)!
                return { q, r, kind }
            })
        }
    }
}
