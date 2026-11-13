import { assert, describe, it } from "vitest"

import { DUNGEON_HEIGHT, DUNGEON_WIDTH, generateDungeon } from "../../src/map/generateDungeon"
import { FACE_SIZE } from "../../src/map/scale"
import SoundSpaces, { hopCutoff, hopGain, SILENT_HOPS } from "../../src/sound/soundSpaces"

const center = (face: number): [number, number] => [face, 0]

/**
 *      room 0 - corridor 4 - room 1 = room 2       (= is a door without a corridor)
 *                   |
 *              corridor 5 - room 3
 */
const ROOMS = [[0, 1], [10, 11], [20, 21], [30, 31]]
const CORRIDORS = [
    { faces: [100, 101, 102], fromFace: 1, toFace: 10 },
    { faces: [], fromFace: 11, toFace: 20 },
    { faces: [200, 201], fromFace: 101, toFace: 30 }
]


describe("SoundSpaces", () => {

    const spaces = new SoundSpaces(ROOMS, CORRIDORS, center)

    it("has rooms first, then corridors with faces", () => {

        assert.equal(spaces.count, 6)
        assert.equal(spaces.space(11), 1)
        assert.equal(spaces.space(102), 4)
        assert.equal(spaces.space(200), 5)
        assert.equal(spaces.space(999), null)
    })

    it("puts doorways between the faces on either side", () => {

        assert.equal(spaces.doorways.length, 5)
        assert.deepEqual(spaces.doorways[0], { a: 0, b: 4, x: 50.5, z: 0 })
        assert.deepEqual(spaces.doorways.find(({ a, b }) => a === 1 && b === 2), { a: 1, b: 2, x: 15.5, z: 0 })
    })

    it("counts doorways from the listener's space", () => {

        const heard = spaces.hear(0)
        assert.deepEqual(heard.map(({ hops }) => hops), [0, 2, 3, 3, 1, 2])
    })

    it("has sound enter through the listener's doorway", () => {

        const heard = spaces.hear(0)
        assert.equal(heard[0].entry, null)
        for (const space of [1, 2, 3, 4, 5])
        {
            assert.deepEqual(heard[space].entry, spaces.doorways[0])
        }

        // from the corridor, room 3 comes through the branch and room 2 through room 1
        const fromCorridor = spaces.hear(4)
        assert.equal(fromCorridor[3].entry!.x, 150.5)
        assert.equal(fromCorridor[2].entry!.x, 56)
    })

    it("can't hear a space without a way to it", () => {

        const apart = new SoundSpaces([[0], [10]], [], center)
        assert.deepEqual(apart.hear(0), [{ hops: 0, entry: null }, { hops: Infinity, entry: null }])
    })
})


describe("SoundSpaces of generated levels", () => {

    it("can hear every room and corridor from every other one", () => {

        for (const seed of [1, 2, 3, 4711])
        {
            const { rooms, corridors } = generateDungeon(seed, FACE_SIZE, DUNGEON_WIDTH, DUNGEON_HEIGHT)
            const spaces = new SoundSpaces(rooms, corridors, center)
            assert.equal(spaces.count, rooms.length + corridors.filter(({ faces }) => faces.length).length)
            assert(spaces.hear(0).every(({ hops }) => hops < Infinity), "seed " + seed)
        }
    })
})


describe("hopGain and hopCutoff", () => {

    it("get quieter and more muffled with every hop", () => {

        assert.equal(hopGain(0), 1)
        for (let hops = 1; hops < SILENT_HOPS; hops++)
        {
            assert(hopGain(hops) < hopGain(hops - 1) && hopGain(hops) > 0)
            assert(hopCutoff(hops) < hopCutoff(hops - 1))
        }
        assert.equal(hopGain(SILENT_HOPS), 0)
        assert.equal(hopGain(Infinity), 0)
        assert(hopCutoff(Infinity) > 0)
    })
})
