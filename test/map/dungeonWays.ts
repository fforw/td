import Prando from "prando"
import { assert, describe, it } from "vitest"

import { faceCenter } from "../../src/map/dungeonLights"
import { entranceFace, findFaces, type FloorSpot, moveOnFloor } from "../../src/map/dungeonWays"
import { generateDungeon } from "../../src/map/generateDungeon"
import { EdgeType, FaceType } from "../../src/map/geometry"
import PatchWorld from "../../src/map/PatchWorld"
import { faceOf, next } from "../../src/map/QuadPatch"
import { FACE_SIZE, SCALE } from "../../src/map/scale"


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

    it("keeps someone on the floor and out of the walls whatever they do", () => {

        const RADIUS = 0.1
        for (const seed of [1, 2, 3])
        {
            const { world, rooms } = level(seed)
            const face = entranceFace(world, { rooms })
            const [x, z] = faceCenter(world, face)
            const spot: FloorSpot = { face, x, z }
            const random = new Prando(seed)
            const seen = new Set<number>()
            for (let i = 0; i < 2000; i++)
            {
                // keeps going one way for a while, to get into corners and through doors
                const angle = Math.floor(i / 25) * 2.4 + random.next() * 0.4
                moveOnFloor(world, spot, Math.cos(angle) * 0.3, Math.sin(angle) * 0.3, RADIUS)
                seen.add(spot.face)
                assert(world.faceType(spot.face) === FaceType.PAVED.index)
                for (const wall of wallPoints(world, spot.face))
                {
                    assert(Math.hypot(wall[0] - spot.x, wall[1] - spot.z) > RADIUS * 0.9)
                }
            }
            assert(seen.size > 5, "gets around, only saw " + seen.size)
        }
    })

    it("slides along a wall instead of stopping at it", () => {

        const { world, rooms } = level(1)
        for (const face of rooms[0])
        {
            for (let h = face * 4; h < face * 4 + 4; h++)
            {
                if (world.edgeType(h) !== EdgeType.WALL.index)
                {
                    continue
                }
                const [x, z] = faceCenter(world, face)
                const a = [0, 0, 0], b = [0, 0, 0]
                world.position(h, a)
                world.position(next(h), b)
                const ex = (b[0] - a[0]) * SCALE, ez = (b[1] - a[1]) * SCALE
                const mx = (a[0] + b[0]) / 2 * SCALE - x, mz = (a[1] + b[1]) / 2 * SCALE - z
                // start next to the wall and head into it at an angle
                const spot: FloorSpot = { face, x: x + mx * 0.5, z: z + mz * 0.5 }
                const along = spot.x * ex + spot.z * ez
                moveOnFloor(world, spot, mx * 0.3 + ex * 0.1, mz * 0.3 + ez * 0.1, 0.1)
                assert(spot.x * ex + spot.z * ez > along, "got along the wall")
                assert(wallPoints(world, spot.face).every(([wx, wz]) => Math.hypot(wx - spot.x, wz - spot.z) > 0.09))
                return
            }
        }
        assert.fail("no wall around the largest room")
    })
})


/**
 * Returns points along the walls on all sides of a face
 */
function wallPoints(world: PatchWorld, face: number): [number, number][]
{
    const points: [number, number][] = []
    const a = [0, 0, 0], b = [0, 0, 0]
    for (let h = face * 4; h < face * 4 + 4; h++)
    {
        const twin = world.twin(h)
        if (twin >= 0 && world.edgeType(h) !== EdgeType.WALL.index && world.faceType(faceOf(twin)) === FaceType.PAVED.index)
        {
            continue
        }
        world.position(h, a)
        world.position(next(h), b)
        for (let t = 0; t <= 1; t += 0.1)
        {
            points.push([(a[0] + (b[0] - a[0]) * t) * SCALE, (a[1] + (b[1] - a[1]) * t) * SCALE])
        }
    }
    return points
}
