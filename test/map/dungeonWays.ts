import Prando from "prando"
import { assert, describe, it } from "vitest"

import { faceCenter, findWallSegments, SEGMENT_SIZE } from "../../src/map/dungeonLights"
import { createFloorWalls, entranceFace, findFaces, type FloorSpot, type FloorWalls, moveOnFloor, seesAcross } from "../../src/map/dungeonWays"
import { generateDungeon } from "../../src/map/generateDungeon"
import { EdgeType, FaceType } from "../../src/map/geometry"
import PatchWorld, { SLOT_SHIFT } from "../../src/map/PatchWorld"
import { faceOf, next } from "../../src/map/QuadPatch"
import { FACE_SIZE, SCALE } from "../../src/map/scale"


const RADIUS = 0.09

const FLOOD_STEP = 0.1
const FLOOD_STEPS = [[FLOOD_STEP, 0], [-FLOOD_STEP, 0], [0, FLOOD_STEP], [0, -FLOOD_STEP]]

/**
 * Most faces apart on the way a step of FLOOD_STEP can get someone, as it goes over at most a few faces
 */
const MAX_HOPS_ON_STEP = 8


function level(seed: number)
{
    const generated = generateDungeon(seed, FACE_SIZE, 2, 2)
    const world = new PatchWorld()
    const slots = generated.patches.map(patch => world.add(patch))
    const segments = findWallSegments(world, slots)
    return { ...generated, world, slots, segments, walls: createFloorWalls(segments, RADIUS) }
}


describe("Ways through dungeon levels", () => {

    it("sees across the floor up to the first wall", () => {

        for (const seed of [1, 2, 3])
        {
            const { world, rooms, corridors, segments, walls } = level(seed)
            const floor = [...rooms.flat(), ...corridors.flatMap(({ faces }) => faces)].map(face => faceCenter(world, face))
            let seen = 0, hidden = 0
            for (let i = 0; i < floor.length; i += 7)
            {
                for (let j = 3; j < floor.length; j += 53)
                {
                    const [x0, z0] = floor[i], [x1, z1] = floor[j]
                    if (Math.hypot(x1 - x0, z1 - z0) < 4)
                    {
                        const free = !crossesAny(segments, x0, z0, x1, z1)
                        assert(seesAcross(walls, x0, z0, x1, z1) === free, "seed " + seed + " from " + [x0, z0] + " to " + [x1, z1])
                        assert(seesAcross(walls, x1, z1, x0, z0) === free, "seed " + seed + " from " + [x1, z1] + " to " + [x0, z0])
                        seen += free ? 1 : 0
                        hidden += free ? 0 : 1
                    }
                }
            }
            assert(seen > 0 && hidden > 0)
        }
    })

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

        for (const seed of [1, 2, 3])
        {
            const { world, rooms, walls } = level(seed)
            const face = entranceFace(world, { rooms })
            const [x, z] = faceCenter(world, face)
            const spot: FloorSpot = { face, x, z }
            const random = new Prando(seed)
            const seen = new Set<number>()
            for (let i = 0; i < 2000; i++)
            {
                // keeps going one way for a while, to get into corners and through doors
                const angle = Math.floor(i / 25) * 2.4 + random.next() * 0.4
                moveOnFloor(world, walls, spot, Math.cos(angle) * 0.3, Math.sin(angle) * 0.3)
                seen.add(spot.face)
                assert(world.faceType(spot.face) === FaceType.PAVED.index)
                assert(clearance(walls, spot.x, spot.z) > RADIUS * 0.9)
                assert(!insideWall(walls, spot.x, spot.z))
            }
            assert(seen.size > 5, "gets around, only saw " + seen.size)
        }
    })

    it("slides along a wall instead of stopping at it", () => {

        const { world, rooms, walls } = level(1)
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
                moveOnFloor(world, walls, spot, mx * 0.3 + ex * 0.1, mz * 0.3 + ez * 0.1)
                assert(spot.x * ex + spot.z * ez > along, "got along the wall")
                assert(clearance(walls, spot.x, spot.z) > RADIUS * 0.9)
                return
            }
        }
        assert.fail("no wall around the largest room")
    })

    it("walks over the part of a wall face no wall got built on", () => {

        const { world, slots, walls } = level(1)
        let walked = 0
        for (const slot of slots)
        {
            const { faceType } = world.getPatch(slot)
            for (let local = 0; local < faceType.length; local++)
            {
                const face = (slot << (SLOT_SHIFT - 2)) | local
                if (faceType[local] !== FaceType.PAVED.index)
                {
                    continue
                }
                for (let h = face * 4; h < face * 4 + 4; h++)
                {
                    const twin = world.twin(h)
                    if (twin < 0 || world.faceType(faceOf(twin)) !== FaceType.WALL.index)
                    {
                        continue
                    }
                    const a = [0, 0, 0], b = [0, 0, 0]
                    world.position(h, a)
                    world.position(next(h), b)
                    const [cx, cz] = faceCenter(world, face)
                    const mx = (a[0] + b[0]) / 2 * SCALE, mz = (a[1] + b[1]) / 2 * SCALE
                    // far enough from the walls to stand on the edge, which the face walls used to block
                    if (clearance(walls, mx, mz) > RADIUS * 1.5 && clearance(walls, cx, cz) > RADIUS)
                    {
                        const spot: FloorSpot = { face, x: cx, z: cz }
                        moveOnFloor(world, walls, spot, mx - cx, mz - cz)
                        assert.closeTo(spot.x, mx, 1e-9)
                        assert.closeTo(spot.z, mz, 1e-9)
                        assert(world.faceType(spot.face) === FaceType.PAVED.index)
                        walked++
                    }
                }
            }
        }
        assert(walked > 10, "only found " + walked)
    })

    it("gets to all of the floor, without any way out of the level or around the walls", { timeout: 30000 }, () => {

        for (const seed of [1, 2])
        {
            const { world, rooms, corridors, segments, walls } = level(seed)
            const entrance = entranceFace(world, { rooms })

            const hops = new Map([[entrance, 0]])
            for (const face of hops.keys())
            {
                for (let h = face * 4; h < face * 4 + 4; h++)
                {
                    const twin = world.twin(h)
                    if (twin >= 0 && world.edgeType(h) !== EdgeType.WALL.index && world.faceType(faceOf(twin)) === FaceType.PAVED.index)
                    {
                        hops.set(faceOf(twin), hops.get(faceOf(twin)) ?? hops.get(face)! + 1)
                    }
                }
            }

            let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
            for (let s = 0; s < segments.length; s += SEGMENT_SIZE)
            {
                minX = Math.min(minX, segments[s], segments[s + 2])
                maxX = Math.max(maxX, segments[s], segments[s + 2])
                minZ = Math.min(minZ, segments[s + 1], segments[s + 3])
                maxZ = Math.max(maxZ, segments[s + 1], segments[s + 3])
            }

            // walks everywhere in small steps
            const [x, z] = faceCenter(world, entrance)
            const todo: FloorSpot[] = [{ face: entrance, x, z }]
            const visited = new Set<string>()
            const seen = new Set([entrance])
            while (todo.length)
            {
                const from = todo.pop()!
                for (const [dx, dz] of FLOOD_STEPS)
                {
                    const spot = { ...from }
                    moveOnFloor(world, walls, spot, dx, dz)
                    const key = Math.round(spot.x / FLOOD_STEP) + "," + Math.round(spot.z / FLOOD_STEP)
                    if (visited.has(key))
                    {
                        continue
                    }
                    visited.add(key)
                    seen.add(spot.face)
                    todo.push(spot)
                    assert(spot.x > minX && spot.x < maxX && spot.z > minZ && spot.z < maxZ, "left the level at " + key)
                    assert.isAtMost(Math.abs(hops.get(spot.face)! - hops.get(from.face)!), MAX_HOPS_ON_STEP, "around a wall at " + key)
                }
            }

            const floor = new Set([...rooms.flat(), ...corridors.flatMap(({ faces }) => faces)])
            assert.equal([...floor].filter(face => !seen.has(face)).length, 0, "floor out of reach on seed " + seed)
        }
    })
})


/**
 * Returns whether a point is inside of a thick wall, where nothing else tells as it is far from the sides
 */
function insideWall({ segments }: FloorWalls, x: number, z: number): boolean
{
    let inside = false
    for (let s = 0; s < segments.length; s += SEGMENT_SIZE)
    {
        const x0 = segments[s], z0 = segments[s + 1], x1 = segments[s + 2], z1 = segments[s + 3]
        // thin walls have no inside, and don't have a side given
        if ((segments[s + 4] || segments[s + 5]) && (z0 > z) !== (z1 > z) && x < x0 + (z - z0) / (z1 - z0) * (x1 - x0))
        {
            inside = !inside
        }
    }
    return inside
}


/**
 * Returns how far a point is from the closest wall around it
 */
function clearance({ segments }: FloorWalls, x: number, z: number): number
{
    let closest = Infinity
    for (let s = 0; s < segments.length; s += SEGMENT_SIZE)
    {
        const x0 = segments[s], z0 = segments[s + 1]
        const ex = segments[s + 2] - x0, ez = segments[s + 3] - z0
        const t = Math.max(0, Math.min(1, ((x - x0) * ex + (z - z0) * ez) / (ex * ex + ez * ez)))
        closest = Math.min(closest, Math.hypot(x - (x0 + t * ex), z - (z0 + t * ez)))
    }
    return closest
}


/**
 * Returns whether a line crosses any wall, from whichever side
 */
function crossesAny(segments: Float64Array, x0: number, z0: number, x1: number, z1: number): boolean
{
    const dx = x1 - x0, dz = z1 - z0
    for (let s = 0; s < segments.length; s += SEGMENT_SIZE)
    {
        const ax = segments[s], az = segments[s + 1], ex = segments[s + 2] - ax, ez = segments[s + 3] - az
        const across = dx * ez - dz * ex
        const t = ((ax - x0) * ez - (az - z0) * ex) / across
        const u = ((ax - x0) * dz - (az - z0) * dx) / across
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1)
        {
            return true
        }
    }
    return false
}
