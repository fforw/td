import Prando from "prando"
import { assert, describe, it } from "vitest"
import { BRUTE } from "../../src/monster/brutes"
import { depthSkill, LIMITED_GROUPS, planSpawns, ROOMS_TAKEN, SPAWN_GROUPS, type SpawnGroup } from "../../src/monster/spawns"

const rooms = Array.from({ length: 50 }, (_, i) => [i * 3 + 1, i * 3 + 2, i * 3 + 3])


describe("spawn planner", () => {

    it("leaves closed rooms alone", () => {

        const closed = new Set([3, 7, 20])
        for (let seed = 0; seed < 20; seed++)
        {
            const plan = planSpawns({ rooms, closed }, new Prando(seed))
            assert(plan.length > 0)
            assert(plan.every(({ room }) => !closed.has(room)))
        }
    })

    it("puts a single monster at most into limited rooms", () => {

        const limited = new Set(rooms.keys())
        for (let seed = 0; seed < 20; seed++)
        {
            for (const { group, spawns } of planSpawns({ rooms, closed: new Set(), limited }, new Prando(seed)))
            {
                assert(LIMITED_GROUPS.includes(group))
                assert.equal(spawns.length, 1)
            }
        }
    })

    it("gives each room one group at most, with its monsters in that room", () => {

        for (let seed = 0; seed < 20; seed++)
        {
            const plan = planSpawns({ rooms, closed: new Set() }, new Prando(seed))
            assert(new Set(plan.map(({ room }) => room)).size === plan.length)
            for (const { room, group, spawns } of plan)
            {
                assert(SPAWN_GROUPS.includes(group))
                assert(spawns.length > 0)
                assert(spawns.every(spawn => spawn.room === room && rooms[room].includes(spawn.face)))
            }
        }
    })

    it("takes about the share of rooms it should", () => {

        let taken = 0
        for (let seed = 0; seed < 100; seed++)
        {
            taken += planSpawns({ rooms, closed: new Set() }, new Prando(seed)).length
        }
        assert(Math.abs(taken / (100 * rooms.length) - ROOMS_TAKEN) < 0.03)
    })

    it("puts as many of a member in as it allows", () => {

        const groups: SpawnGroup[] = [{ name: "brutes", weight: 1, members: [{ species: "brute", kind: BRUTE, min: 2, max: 4 }] }]
        for (let seed = 0; seed < 20; seed++)
        {
            for (const { spawns } of planSpawns({ rooms, closed: new Set() }, new Prando(seed), groups))
            {
                assert(spawns.length >= 2 && spawns.length <= 4)
                assert(spawns.every(({ species, kind }) => species === "brute" && kind === BRUTE))
            }
        }
    })

    it("is the same for the same seed", () => {

        const level = { rooms, closed: new Set([3]) }
        assert.deepEqual(planSpawns(level, new Prando(7)), planSpawns(level, new Prando(7)))
    })
})

describe("depthSkill", () => {
    it("grows from the first room to the deepest, and leaves out rooms nobody gets to", () => {
        const depths = [0, 5, Infinity, 20]
        assert.deepEqual(depths.map((_, room) => depthSkill(depths, room)), [0, 0.25, 0, 1])
        assert.strictEqual(depthSkill([0], 0), 0)
    })
})
