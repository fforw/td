import { assert, describe, it } from "vitest"

import type { KindEdits } from "../../src/game/campaign"
import { naturalKind } from "../../src/game/patchKinds"
import RouteFinder, { type RouteResult } from "../../src/game/RouteFinder"
import { generatePatch } from "../../src/map/generatePatch"
import { PATCH_SIZE } from "../../src/map/HexagonPatch"
import PatchWorld from "../../src/map/PatchWorld"
import { findRoute, globalFace } from "../../src/map/route"
import { FACE_SIZE } from "../../src/map/scale"


const SEEDS = [4711, 99]

const TARGETS: [number, number][] = [[2, 0], [-2, 1], [0, -3], [3, 3], [-3, -2]]


function find(finder: RouteFinder, q: number, r: number, edits: KindEdits = {}): RouteResult
{
    return finder.find({ target: { q, r }, edits, radius: Math.max(Math.abs(q), Math.abs(r)) + 1 })
}


describe("RouteFinder", () => {

    it("finds the same as a search with all patches built up front", () => {

        for (const seed of SEEDS)
        {
            const world = new PatchWorld()
            const slots = new Map<string, number>()
            const pois = new Map<string, number[]>()
            for (let r = -4; r <= 4; r++)
            {
                for (let q = -4; q <= 4; q++)
                {
                    const kind = naturalKind(seed, q, r)
                    const { patch, pois: generated } = generatePatch(q * PATCH_SIZE, r * PATCH_SIZE, seed, FACE_SIZE, kind)
                    const key = q + "/" + r
                    slots.set(key, world.add(patch))
                    pois.set(key, generated.map(({ face }) => face))
                }
            }
            const castle = globalFace(slots.get("0/0")!, pois.get("0/0")![0])

            for (const [q, r] of TARGETS)
            {
                const radius = Math.max(Math.abs(q), Math.abs(r)) + 1
                const through: number[] = []
                slots.forEach((slot, key) => {
                    const [pq, pr] = key.split("/").map(Number)
                    if (Math.max(Math.abs(pq), Math.abs(pr)) <= radius)
                    {
                        through.push(slot)
                    }
                })
                const key = q + "/" + r
                const eager = findRoute(world, castle, slots.get(key)!, pois.get(key)!, through)
                const lazy = new RouteFinder(seed, FACE_SIZE).find({ target: { q, r }, edits: {}, radius })

                assert(lazy.reachable === eager.reachable, seed + " " + key)
                assert(lazy.cost === eager.cost, seed + " " + key)
            }
        }
    }, 60000)

    it("builds fewer patches than the whole area for a near target", () => {

        let lazy = 0
        let area = 0
        for (const seed of SEEDS)
        {
            for (const [q, r] of TARGETS)
            {
                const finder = new RouteFinder(seed, FACE_SIZE)
                find(finder, q, r)
                lazy += finder.built
                area += (Math.max(Math.abs(q), Math.abs(r)) * 2 + 3) ** 2
            }
        }
        assert(lazy < area)
    }, 60000)

    it("stays inside the given ring", () => {

        const finder = new RouteFinder(4711, FACE_SIZE)
        const { patches } = finder.find({ target: { q: 2, r: 0 }, edits: {}, radius: 2 })
        assert(patches.every(({ q, r }) => Math.max(Math.abs(q), Math.abs(r)) <= 2))
        assert(finder.built <= 25)
    })

    it("starts at the castle and ends at the goals of the target", () => {

        for (const seed of SEEDS)
        {
            const route = find(new RouteFinder(seed, FACE_SIZE), 2, 0, { "2/0": "TEMPLE" })
            assert(route.kind === "TEMPLE" || route.kind === "EMPTY")
            assert(route.goals.length === (route.kind === "TEMPLE" ? 1 : 0))
            assert(route.start >= 0)
            assert(route.patches.some(({ q, r }) => q === 0 && r === 0))

            const [path] = route.paths
            assert(path[0] === 0 && path[1] === 0)
            if (route.reachable)
            {
                assert(route.patches.some(({ q, r }) => q === 2 && r === 0))
                assert(path[path.length - 1] === route.goals[0] || route.goals.length === 0)
            }
        }
    })

    it("uses the edits it is given and natural kinds for the others", () => {

        const finder = new RouteFinder(4711, FACE_SIZE)
        const { patches } = find(finder, 1, 0, { "1/0": "DUNGEON" })
        assert(patches.find(({ q, r }) => q === 1 && r === 0)!.kind === "DUNGEON")
        assert(patches.find(({ q, r }) => q === 0 && r === 0)!.kind === "CASTLE")
    })

    it("keeps edits for later queries", () => {

        const finder = new RouteFinder(4711, FACE_SIZE)
        find(finder, 1, 0, { "2/0": "TEMPLE" })
        assert(find(finder, 2, 0).kind === "TEMPLE")
    })

    it("builds a patch again when an edit changes its kind", () => {

        const finder = new RouteFinder(4711, FACE_SIZE)
        const temple = find(finder, 2, 0, { "2/0": "TEMPLE" })
        assert(temple.goals.length === 1)
        const built = finder.built

        const empty = find(finder, 2, 0, { "2/0": "EMPTY" })
        assert(empty.kind === "EMPTY")
        assert.deepEqual(empty.goals, [])
        assert(finder.built === built)

        const again = find(finder, 2, 0, { "2/0": "TEMPLE" })
        assert(again.kind === "TEMPLE")
        assert(again.cost === temple.cost)
        assert.deepEqual(again.goals, temple.goals)
    })

    it("uses hexagon positions in the packed paths only", () => {

        const { paths } = find(new RouteFinder(4711, FACE_SIZE), 1, 0)
        const last = paths[0]
        // the first run is the castle at 0/0, a later one has to be a multiple of the patch size
        for (let i = 0; i < last.length; i += 3 + last[i + 2])
        {
            assert(last[i] % PATCH_SIZE === 0 && last[i + 1] % PATCH_SIZE === 0)
        }
    })
})
