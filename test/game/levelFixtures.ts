import { assert, describe, it } from "vitest"

import { placeFixtures } from "../../src/game/levelFixtures"
import { faceCenter, findWallSegments } from "../../src/map/dungeonLights"
import { EXIT_HALF_SIZE, EXIT_REACH } from "../../src/map/dungeonRoles"
import { createFloorWalls, entranceFace, findFaces, type FloorSpot, moveOnFloor } from "../../src/map/dungeonWays"
import { fixtureSegments } from "../../src/map/fixtures"
import { EdgeType } from "../../src/map/geometry"
import { DUNGEON_HEIGHT, DUNGEON_WIDTH, generateDungeon, levelSeed } from "../../src/map/generateDungeon"
import PatchWorld from "../../src/map/PatchWorld"
import { faceOf } from "../../src/map/QuadPatch"
import { FACE_SIZE } from "../../src/map/scale"
import { HERO_RADIUS } from "../../src/monster/monsters"
import { CHEST_HALF_DEPTH, CHEST_HALF_WIDTH, CHEST_REACH } from "../../src/treasure/chests"

/**
 * Seeds the way the game makes them, with a few campaigns and patches
 */
const SEEDS = Array.from({ length: 12 }, (_, i) => levelSeed(i * 7919 + 13, i % 5 - 2, i % 3 - 1))

/**
 * How far a hero goes in one step of walking around a room, in world units, which is less than they need around them twice
 */
const STEP = 0.15

/**
 * How close in world units to the middle of a face of a room a hero has to get for it to count as not cut off. That has to be
 * more than half the width of a fixture, which can stand right on it.
 */
const FACE_REACH = 0.55

const DIRECTIONS = Array.from({ length: 8 }, (_, i) => [Math.cos(i * Math.PI / 4), Math.sin(i * Math.PI / 4)])

function build(seed: number)
{
    const level = generateDungeon(seed, FACE_SIZE, DUNGEON_WIDTH, DUNGEON_HEIGHT)
    const world = new PatchWorld()
    const slots = level.patches.map(patch => world.add(patch))
    const segments = findWallSegments(world, slots)
    return { level, world, slots, segments, ...placeFixtures(level, world, segments, seed) }
}


/**
 * Returns all a hero can get to by walking, starting from a face, without going further from there than the given distance
 */
function walkAround(world: PatchWorld, solid: Float64Array, face: number, within: number): [number, number][]
{
    const walls = createFloorWalls(solid, HERO_RADIUS)
    const [startX, startZ] = faceCenter(world, face)
    const seen = new Set<string>()
    const found: [number, number][] = []
    const open: FloorSpot[] = [{ face, x: startX, z: startZ }]
    const spot: FloorSpot = { face, x: 0, z: 0 }
    while (open.length > 0)
    {
        const from = open.pop()!
        for (const [dx, dz] of DIRECTIONS)
        {
            Object.assign(spot, from)
            moveOnFloor(world, walls, spot, dx * STEP, dz * STEP)
            const key = Math.round(spot.x / STEP * 2) + "/" + Math.round(spot.z / STEP * 2)
            if (!seen.has(key) && Math.hypot(spot.x - startX, spot.z - startZ) <= within)
            {
                seen.add(key)
                found.push([spot.x, spot.z])
                open.push({ ...spot })
            }
        }
    }
    return found
}


/**
 * Returns the faces on the other side of the doors of a room
 */
function facesBehindDoors(world: PatchWorld, room: readonly number[]): number[]
{
    const inside = new Set(room)
    const outside = new Set<number>()
    for (const face of room)
    {
        for (let h = face * 4; h < face * 4 + 4; h++)
        {
            if (world.edgeType(h) === EdgeType.DOOR.index && !inside.has(faceOf(world.twin(h))))
            {
                outside.add(faceOf(world.twin(h)))
            }
        }
    }
    return [...outside]
}


describe("placeFixtures", () => {

    it("puts everything where the way from the entrance leads", () => {

        for (const seed of SEEDS)
        {
            const { level, world, slots, exits, chests } = build(seed)
            const entrance = entranceFace(world, level)
            assert(exits.length >= 1, "seed " + seed)
            assert(chests.length >= 1, "seed " + seed)
            for (const { face } of [...exits, ...chests])
            {
                assert(findFaces(world, slots, entrance, face), "seed " + seed + ", face " + face)
            }
        }
    })

    it("puts the entrance at the end of the main path, far from the main exit", () => {

        for (const seed of SEEDS)
        {
            const { level, world, slots, exits: [exit] } = build(seed)
            const way = findFaces(world, slots, exit.face, entranceFace(world, level))!
            const others = level.rooms.map(room => findFaces(world, slots, exit.face, room[0])?.length ?? 0)
            const longer = others.filter(length => length > way.length).length
            assert(longer < others.length / 4, "seed " + seed + ": " + longer + " of " + others.length + " rooms are further")
        }
    })

    it("always leaves room to walk past and to get close, doors included", () => {

        for (const seed of SEEDS.slice(0, 3))
        {
            const { level, world, segments, exits, chests } = build(seed)
            const solid = Float64Array.of(
                ...segments,
                ...fixtureSegments(chests, CHEST_HALF_WIDTH, CHEST_HALF_DEPTH),
                ...fixtureSegments(exits, EXIT_HALF_SIZE, EXIT_HALF_SIZE)
            )
            const fixtures = [...exits.map(spot => ({ spot, reach: EXIT_REACH })), ...chests.map(spot => ({ spot, reach: CHEST_REACH }))]
            for (const { spot, reach } of fixtures)
            {
                const room = level.rooms.find(faces => faces.includes(spot.face))!
                const outside = facesBehindDoors(world, room)
                assert(outside.length > 0, "seed " + seed + ", a room without a door")

                const [startX, startZ] = faceCenter(world, outside[0])
                const within = Math.max(...room.map(face => {
                    const [x, z] = faceCenter(world, face)
                    return Math.hypot(x - startX, z - startZ)
                })) + 1
                const walked = walkAround(world, solid, outside[0], within)

                const gets = (x: number, z: number, distance: number) => walked.some(([wx, wz]) => Math.hypot(wx - x, wz - z) <= distance)
                assert(gets(spot.x, spot.z, reach), "seed " + seed + ": can't get to the fixture on face " + spot.face)
                for (const face of room)
                {
                    const [x, z] = faceCenter(world, face)
                    assert(gets(x, z, FACE_REACH), "seed " + seed + ": the fixture on face " + spot.face + " cuts off face " + face)
                }
                for (const face of outside)
                {
                    const [x, z] = faceCenter(world, face)
                    assert(gets(x, z, STEP * 2), "seed " + seed + ": the fixture on face " + spot.face + " blocks the way to face " + face)
                }
            }
        }
    }, 120000)
})
