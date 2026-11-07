import { assert, describe, it } from "vitest"

import Exploration, { BLOCKED_REGION, OPEN_REGION, VISITED_REGION, visitedRegions } from "../../src/game/exploration"
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
