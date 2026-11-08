import Prando from "prando"
import { assert, describe, it } from "vitest"

import { entranceRoom, findRoomRoles, placeExits, SIDE_EXIT_CHANCE } from "../../src/map/dungeonRoles"

const inRow = (face: number): number[] => [face, 0]

/**
 * Rooms with 2 faces each, with their faces apart from each other
 */
const roomsOf = (count: number): number[][] => Array.from({ length: count }, (_, room) => [room * 10, room * 10 + 1])

const corridor = (from: number, to: number, length: number) => ({ from, to, faces: Array.from({ length }, (_, i) => 1000 + from * 100 + i) })

/**
 *      0 (main exit) - 1 - 2 - 3 (end of the main path, entrance)
 *          |
 *          4 - 5
 */
const BRANCHED = [corridor(0, 1, 5), corridor(1, 2, 5), corridor(2, 3, 5), corridor(1, 4, 2), corridor(4, 5, 2)]


describe("findRoomRoles", () => {

    it("goes by how far the way is", () => {

        const { depths, mainPath, farBranch } = findRoomRoles(roomsOf(6), BRANCHED)
        assert.equal(depths[0], 0)
        assert(depths[1] < depths[2] && depths[2] < depths[3])
        assert.deepEqual(mainPath, [0, 1, 2, 3])
        assert.equal(farBranch, 5)
    })

    it("works in both directions of a corridor", () => {

        const { mainPath } = findRoomRoles(roomsOf(3), [corridor(2, 1, 3), corridor(1, 0, 3)])
        assert.deepEqual(mainPath, [0, 1, 2])
    })

    it("knows when there are no branches", () => {

        assert.isNull(findRoomRoles(roomsOf(3), [corridor(0, 1, 3), corridor(1, 2, 3)]).farBranch)
    })

    it("gets by with a single room and with rooms that can't be reached", () => {

        assert.deepEqual(findRoomRoles(roomsOf(1), []).mainPath, [0])
        const { depths, mainPath, farBranch } = findRoomRoles(roomsOf(3), [corridor(0, 1, 3)])
        assert.equal(depths[2], Infinity)
        assert.deepEqual(mainPath, [0, 1])
        assert.isNull(farBranch)
    })
})


describe("entranceRoom", () => {

    it("is at the end of the main path, as far from the main exit as it gets", () => {

        assert.equal(entranceRoom(roomsOf(6), BRANCHED), 3)
        assert.equal(entranceRoom(roomsOf(1), []), 0)
    })
})


describe("placeExits", () => {

    const exitsOf = (seed: number) => placeExits(roomsOf(6), BRANCHED, [], inRow, new Prando(seed))

    it("always has an exit in the first room, at the start of the main path", () => {

        for (let seed = 0; seed < 100; seed++)
        {
            assert.equal(exitsOf(seed)[0].room, 0)
        }
    })

    it("sometimes has a side exit, on the far branch", () => {

        let sides = 0
        const runs = 2000
        for (let seed = 0; seed < runs; seed++)
        {
            const exits = exitsOf(seed)
            if (exits.length > 1)
            {
                sides++
                assert.equal(exits[1].room, 5)
            }
        }
        assert.closeTo(sides / runs, SIDE_EXIT_CHANCE, 0.05)
    })

    it("is the same for the same seed", () => {

        assert.deepEqual(exitsOf(7), exitsOf(7))
    })

    it("still has an exit if all of the room is close to an opening, as far from it as it gets", () => {

        const [exit] = placeExits([[0, 1], [10, 11]], [{ from: 0, to: 1, faces: [] }], [inRow(1)], inRow, new Prando(1))
        assert.equal(exit.room, 0)
        assert.equal(exit.face, 0)
    })
})
