import { assert, describe, it } from "vitest"

import { findRegions, growRooms, pickRooms } from "../../src/map/dungeonRooms"
import { generateDungeon } from "../../src/map/generateDungeon"
import PatchWorld from "../../src/map/PatchWorld"
import { faceCount, faceOf, prev } from "../../src/map/QuadPatch"
import { globalFace, slotOf } from "../../src/map/route"
import { FACE_SIZE } from "../../src/map/scale"
import { patchSeed, withSeed } from "../../src/math/random"


const SEEDS = [1, 2, 3, 4711, 12345]


function level(seed: number, width = 2, height = 2)
{
    const { patches, regions, rooms } = generateDungeon(seed, FACE_SIZE, width, height)
    const world = new PatchWorld()
    const slots = patches.map(patch => world.add(patch))
    return { world, slots, regions, rooms }
}


/**
 * Returns the half edges starting at the same vertex as the given one, without those behind an outer edge
 */
function aroundVertex(world: PatchWorld, h: number): number[]
{
    const around = [h]
    for (let curr = world.twin(prev(h)); curr >= 0 && curr !== h; curr = world.twin(prev(curr)))
    {
        around.push(curr)
    }
    return around
}


describe("findRegions", () => {

    it("leaves faces out that touch an irregular vertex", () => {

        for (const seed of SEEDS)
        {
            const { world, regions } = level(seed)
            for (const face of regions.flat())
            {
                for (let i = 0; i < 4; i++)
                {
                    assert(aroundVertex(world, face * 4 + i).length < 5)
                }
            }
        }
    })

    it("takes every face that touches no irregular vertex", () => {

        const { world, slots, regions } = level(4711)
        const inRegions = new Set(regions.flat())
        for (const slot of slots)
        {
            for (let local = 0; local < faceCount(world.getPatch(slot)); local++)
            {
                const face = globalFace(slot, local)
                const fits = [0, 1, 2, 3].every(i => {
                    const h = face * 4 + i
                    const around = aroundVertex(world, h)
                    return around.length < 5 && around.every(other => world.twin(prev(other)) >= 0)
                })
                assert(fits === inRegions.has(face))
            }
        }
    })

    it("leaves out the outer edge of the level", () => {

        const { world, regions } = level(4711)
        for (const face of regions.flat())
        {
            for (let i = 0; i < 4; i++)
            {
                assert(world.twin(face * 4 + i) >= 0)
            }
        }
    })

    it("has regions that don't share an edge", () => {

        const { world, regions } = level(4711)
        const regionOf = new Map(regions.flatMap((faces, index) => faces.map(face => [face, index] as const)))
        for (const [face, index] of regionOf)
        {
            for (let i = 0; i < 4; i++)
            {
                const other = regionOf.get(faceOf(world.twin(face * 4 + i)))
                assert(other === undefined || other === index)
            }
        }
    })

    it("connects regions across seams", () => {

        const crossing = SEEDS.flatMap(seed => level(seed).regions).filter(
            faces => new Set(faces.map(slotOf)).size > 1
        )
        assert(crossing.length > 0)
    })

    it("has as many regions as measured for two by two patches", () => {

        for (const seed of SEEDS)
        {
            const { regions } = level(seed)
            assert(regions.length >= 180 && regions.length <= 260, seed + ": " + regions.length)
        }
    })
})


describe("pickRooms", () => {

    it("only picks regions large enough", () => {

        const { regions } = level(4711)
        assert(pickRooms(regions, Infinity).every(room => regions[room].length >= 8))
    })

    it("picks the largest regions first", () => {

        const { regions } = level(4711)
        const sizes = pickRooms(regions, Infinity).map(room => regions[room].length)
        assert.deepEqual(sizes, [...sizes].sort((a, b) => b - a))
        assert(sizes[0] === Math.max(...regions.map(faces => faces.length)))
    })

    it("stops when there are no regions left", () => {

        const { regions } = level(4711)
        assert(pickRooms(regions, Infinity).length === regions.filter(faces => faces.length >= 8).length)
    })

    it("finds nothing without regions", () => {

        assert.deepEqual(pickRooms([], 1000), [])
    })

    it("stops at the floor it was asked for", () => {

        const { regions } = level(4711)
        assert.deepEqual(pickRooms(regions, 0), [])
        assert(pickRooms(regions, 1).length === 1)
    })
})


describe("growRooms", () => {

    function grow(seed: number, floorFaces: number)
    {
        const { world, regions } = level(4711)
        const rooms = pickRooms(regions, Infinity).map(room => regions[room])
        return { world, rooms, grown: withSeed(patchSeed(seed, 0, 0), () => growRooms(world, rooms, floorFaces)) }
    }

    it("stops at the floor it was asked for", () => {

        const { rooms, grown } = grow(1, 2500)
        assert(rooms.flat().length < 2500)
        assert(grown.flat().length === 2500)
    })

    it("does nothing if the rooms are large enough already", () => {

        const { rooms, grown } = grow(1, 0)
        assert.deepEqual(grown, rooms)
    })

    it("keeps the faces rooms had and doesn't change the given rooms", () => {

        const { rooms, grown } = grow(1, 2500)
        rooms.forEach((faces, room) => {
            assert.deepEqual(grown[room].slice(0, faces.length), faces)
            assert(grown[room].length >= faces.length)
        })
        assert(rooms.flat().length < grown.flat().length)
    })

    it("gives every face to one room only", () => {

        const faces = grow(1, 2500).grown.flat()
        assert(new Set(faces).size === faces.length)
    })

    it("keeps rooms connected", () => {

        const { world, grown } = grow(1, 2500)
        for (const faces of grown)
        {
            const inRoom = new Set(faces)
            const seen = new Set([faces[0]])
            for (const face of seen)
            {
                for (let i = 0; i < 4; i++)
                {
                    const other = faceOf(world.twin(face * 4 + i))
                    if (inRoom.has(other))
                    {
                        seen.add(other)
                    }
                }
            }
            assert(seen.size === faces.length)
        }
    })

    it("stays off the outer edge of the level", () => {

        const { world, grown } = grow(1, 2500)
        for (const face of grown.flat())
        {
            for (let i = 0; i < 4; i++)
            {
                assert(world.twin(face * 4 + i) >= 0)
            }
        }
    })

    it("stops when there is nothing left to grow into", () => {

        const { world, grown } = grow(1, Infinity)
        const taken = new Set(grown.flat())
        for (const face of taken)
        {
            for (let i = 0; i < 4; i++)
            {
                const other = faceOf(world.twin(face * 4 + i))
                const inner = [0, 1, 2, 3].every(k => world.twin(other * 4 + k) >= 0)
                assert(taken.has(other) || !inner)
            }
        }
    })

    it("doesn't grow into blocked faces", () => {

        const { world, regions } = level(4711)
        const rooms = pickRooms(regions, Infinity).map(room => regions[room])
        const free = withSeed(patchSeed(1, 0, 0), () => growRooms(world, rooms, 2500))
        const taken = free.flatMap((faces, room) => faces.slice(rooms[room].length))
        const blocked = new Set(taken.slice(0, 100))

        const grown = withSeed(patchSeed(1, 0, 0), () => growRooms(world, rooms, 2500, blocked))
        assert(!grown.flat().some(face => blocked.has(face)))
        assert(grown.flat().length === 2500)
    })

    it("depends on the seed", () => {

        assert.notDeepEqual(grow(1, 2500).grown, grow(2, 2500).grown)
    })
})
