import { assert, describe, it } from "vitest"

import Exploration, { BLOCKED_REGION, inUnexplored, jumpTargets, OPEN_REGION, VISITED_REGION, visitedRegions } from "../../src/game/exploration"
import { faceCenter } from "../../src/map/dungeonLights"
import { DUNGEON_HEIGHT, DUNGEON_WIDTH, generateDungeon, levelSeed } from "../../src/map/generateDungeon"
import PatchWorld, { SLOT_SHIFT } from "../../src/map/PatchWorld"
import { faceCount } from "../../src/map/QuadPatch"
import { FACE_SIZE } from "../../src/map/scale"


function build()
{
    const level = generateDungeon(levelSeed(13, 1, -1), FACE_SIZE, DUNGEON_WIDTH, DUNGEON_HEIGHT)
    const world = new PatchWorld()
    const slots = level.patches.map(patch => world.add(patch))
    return { level, world, slots }
}


describe("Exploration", () => {

    it("keeps visited faces through its record", () => {

        const { world, slots } = build()
        const exploration = new Exploration(world, slots)
        const last = slots[slots.length - 1]
        const faces = [0, 5, (1 << (SLOT_SHIFT - 2)) | 3, (last << (SLOT_SHIFT - 2)) | (faceCount(world.getPatch(last)) - 1)]
        for (const face of faces)
        {
            assert(exploration.visit(face))
        }
        assert(!exploration.visit(5))

        const loaded = new Exploration(world, slots, exploration.encode())
        for (const face of faces)
        {
            assert(loaded.has(face), "face " + face)
        }
        assert(!loaded.has(1))
        assert(!loaded.has((1 << (SLOT_SHIFT - 2)) | 2))
        assert(loaded.encode() === exploration.encode())
    })

    it("knows when all of some faces are visited", () => {

        const { level, world, slots } = build()
        const exploration = new Exploration(world, slots)
        const [room] = level.rooms
        assert(exploration.hasAll([]))
        assert(!exploration.hasAll(room))
        for (const face of room.slice(1))
        {
            exploration.visit(face)
        }
        assert(!exploration.hasAll(room))
        exploration.visit(room[0])
        assert(exploration.hasAll(room))
        assert(!exploration.hasAll(level.rooms.flat()))
    })

    it("leaves monsters only where nobody has been", () => {

        const { level, world, slots } = build()
        const exploration = new Exploration(world, slots)
        const [first, second] = level.rooms
        const placed = [{ face: first[0], name: "a" }, { face: first[1], name: "b" }, { face: second[0], name: "c" }]
        assert.deepEqual(inUnexplored(placed, exploration), placed)

        exploration.visit(first[0])
        exploration.visit(second[0])
        assert.deepEqual(inUnexplored(placed, exploration).map(({ name }) => name), ["b"])

        // and stay gone after a reload
        const loaded = new Exploration(world, slots, exploration.encode())
        assert.deepEqual(inUnexplored(placed, loaded).map(({ name }) => name), ["b"])
    })

    it("records nothing for nothing visited", () => {

        const { world, slots } = build()
        assert(new Exploration(world, slots).encode() === "")
        assert(!new Exploration(world, slots, "").has(0))
    })

    it("draws visited faces as far as the faces around them", () => {

        // a row of a wall, a visited floor face and one nobody has been to
        const regions = visitedRegions([0, 0, FACE_SIZE, 0, FACE_SIZE * 2, 0], [false, true, false], [false, true, true])
        assert(regions.faceType(FACE_SIZE, 0) === VISITED_REGION)
        assert(regions.faceType(FACE_SIZE * 0.6, 0) === VISITED_REGION)
        assert(regions.faceType(FACE_SIZE * 0.4, 0) === BLOCKED_REGION)
        assert(regions.faceType(FACE_SIZE * 1.6, 0) === OPEN_REGION)
        // nothing beyond the faces
        assert(regions.faceType(FACE_SIZE, FACE_SIZE * 1.2) === BLOCKED_REGION)
    })
})


describe("jumpTargets", () => {

    it("goes to the visited face closest to the middle of each other room with visited floor", () => {

        const { level, world, slots } = build()
        const { rooms } = level
        const exploration = new Exploration(world, slots)
        const [here, whole, part] = rooms
        for (const face of [...here, ...whole, part[0], part[part.length - 1]])
        {
            exploration.visit(face)
        }

        const targets = jumpTargets(world, rooms, exploration, here[0])
        assert.equal(targets.length, 2)

        const [toWhole, toPart] = targets
        assert(whole.includes(toWhole.face))
        assert.deepEqual([toWhole.x, toWhole.z], faceCenter(world, toWhole.face))
        assert.include([part[0], part[part.length - 1]], toPart.face)

        // the middle of the whole room, as the closest of all its faces
        const centers = whole.map(face => faceCenter(world, face))
        const midX = centers.reduce((sum, [x]) => sum + x, 0) / centers.length
        const midZ = centers.reduce((sum, [, z]) => sum + z, 0) / centers.length
        for (const [x, z] of centers)
        {
            assert(Math.hypot(toWhole.x - midX, toWhole.z - midZ) <= Math.hypot(x - midX, z - midZ))
        }

        // seen from another room, the first one is a target and the room the hero is in isn't
        const fromWhole = jumpTargets(world, rooms, exploration, whole[0]).map(({ face }) => face)
        assert.equal(fromWhole.length, 2)
        assert(fromWhole.some(face => here.includes(face)))
        assert(!fromWhole.some(face => whole.includes(face)))
    })
})
