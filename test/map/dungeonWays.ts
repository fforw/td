import { assert, describe, it } from "vitest"

import { faceCenter } from "../../src/map/dungeonLights"
import { entranceFace, findFaces, nextFace } from "../../src/map/dungeonWays"
import { generateDungeon } from "../../src/map/generateDungeon"
import { EdgeType, FaceType } from "../../src/map/geometry"
import PatchWorld from "../../src/map/PatchWorld"
import { faceOf } from "../../src/map/QuadPatch"
import { FACE_SIZE } from "../../src/map/scale"


function level(seed: number)
{
    const generated = generateDungeon(seed, FACE_SIZE, 2, 2)
    const world = new PatchWorld()
    const slots = generated.patches.map(patch => world.add(patch))
    return { ...generated, world, slots }
}


describe("Ways through dungeon levels", () => {

    it("gets to all of the floor from the entrance", () => {

        for (const seed of [1, 2, 3])
        {
            const { world, slots, rooms, corridors } = level(seed)
            const entrance = entranceFace(world, { rooms })
            assert(world.faceType(entrance) === FaceType.PAVED.index)

            const floor = [...rooms.flat(), ...corridors.flatMap(({ faces }) => faces)]
            // spread over the level, each search goes all the way there
            for (let i = 0; i < floor.length; i += 97)
            {
                const faces = findFaces(world, slots, entrance, floor[i])
                assert(faces !== null, "seed " + seed + ", face " + floor[i])
                assert(faces[0] === entrance && faces[faces.length - 1] === floor[i])
            }
        }
    })

    it("never goes through a wall", () => {

        const { world, slots, rooms } = level(1)
        const faces = findFaces(world, slots, entranceFace(world, { rooms }), rooms[rooms.length - 1][0])!
        for (let i = 1; i < faces.length; i++)
        {
            let crossed = false
            for (let h = faces[i - 1] * 4; h < faces[i - 1] * 4 + 4; h++)
            {
                if (faceOf(world.twin(h)) === faces[i])
                {
                    crossed = world.edgeType(h) !== EdgeType.WALL.index
                }
            }
            assert(crossed, "between " + faces[i - 1] + " and " + faces[i])
        }
    })

    it("steps to the next face in a direction", () => {

        const { world, rooms } = level(1)
        const entrance = entranceFace(world, { rooms })
        const [x, z] = faceCenter(world, entrance)
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
        {
            const next = nextFace(world, entrance, dx, dz)
            if (next !== null)
            {
                const [nx, nz] = faceCenter(world, next)
                assert((nx - x) * dx + (nz - z) * dz > 0)
                assert(world.faceType(next) === FaceType.PAVED.index)
            }
        }
    })

    it("doesn't step through walls", () => {

        const { world, rooms } = level(1)
        for (const face of rooms[0])
        {
            for (let h = face * 4; h < face * 4 + 4; h++)
            {
                const [x, z] = faceCenter(world, face)
                const other = faceOf(world.twin(h))
                const [ox, oz] = faceCenter(world, other)
                if (nextFace(world, face, ox - x, oz - z) === other)
                {
                    assert(world.edgeType(h) !== EdgeType.WALL.index)
                }
            }
        }
    })
})
