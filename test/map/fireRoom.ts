import { assert, describe, it } from "vitest"

import { faceCenter, findWallSegments } from "../../src/map/dungeonLights"
import { findRoomRoles } from "../../src/map/dungeonRoles"
import { createFloorWalls, entranceFace, findFaces, seesAcross } from "../../src/map/dungeonWays"
import { findFireRoom, type FireRoom, SWITCH_REACH } from "../../src/map/fireRoom"
import { DUNGEON_HEIGHT, DUNGEON_WIDTH, generateDungeon, levelSeed } from "../../src/map/generateDungeon"
import PatchWorld from "../../src/map/PatchWorld"
import { FACE_SIZE } from "../../src/map/scale"
import { HERO_RADIUS } from "../../src/monster/monsters"

const SEEDS = Array.from({ length: 12 }, (_, i) => levelSeed(i * 7919 + 13, i % 5 - 2, i % 3 - 1))

const levels = SEEDS.map(seed => {
    const level = generateDungeon(seed, FACE_SIZE, DUNGEON_WIDTH, DUNGEON_HEIGHT)
    const world = new PatchWorld()
    const slots = level.patches.map(patch => world.add(patch))
    const segments = findWallSegments(world, slots)
    return { seed, level, world, slots, segments, fire: findFireRoom(level, world, segments, seed) }
})
const found = levels.filter(({ fire }) => fire) as (typeof levels[number] & { fire: FireRoom })[]

describe("findFireRoom", () => {

    it("finds one in most levels, the same for the same seed", () => {

        assert.isAtLeast(found.length, SEEDS.length * 0.8)
        for (const { level, world, segments, seed, fire } of found.slice(0, 3))
        {
            assert.deepEqual(findFireRoom(level, world, segments, seed), fire)
        }
    })

    it("picks a room that the way through the level goes through", () => {

        for (const { level, world, slots, fire } of found)
        {
            const exitRoom = level.rooms[findRoomRoles(level.rooms, level.corridors).mainPath[0]]
            const way = findFaces(world, slots, entranceFace(world, level), exitRoom[0])!
            const inside = way.filter(face => level.rooms[fire.room].includes(face))
            assert.isAbove(inside.length, 0)
            // the doors come in the order of the way
            const distance = (face: number, [x, z]: [number, number]) => {
                const [fx, fz] = faceCenter(world, face)
                return Math.hypot(fx - x, fz - z)
            }
            assert.isBelow(distance(inside[0], fire.doors[0]), 1)
            assert.isBelow(distance(inside[inside.length - 1], fire.doors[1]), 1)
        }
    })

    it("leaves out taken rooms", () => {

        const { level, world, segments, seed, fire } = found[0]
        assert.notEqual(findFireRoom(level, world, segments, seed, new Set([fire.room]))?.room, fire.room)
        assert.isNull(findFireRoom(level, world, segments, seed, new Set(level.rooms.keys())))
    })

    it("keeps the fire off the doors and the switch", () => {

        for (const { fire: { doors, lever, lines } } of found)
        {
            for (const { x, z } of lines.flatMap(({ strikes }) => strikes))
            {
                for (const [sx, sz] of [...doors, [lever.x, lever.z]])
                {
                    assert.isAbove(Math.hypot(sx - x, sz - z), 0.6)
                }
            }
        }
    })

    it("puts the switch on the wall next to the far door, in reach from the floor", () => {

        for (const { segments, fire: { doors, lever } } of found)
        {
            const [x, z] = doors[1]
            assert.isBelow(Math.hypot(lever.x - x, lever.z - z), 2)
            const fx = lever.x + Math.sin(lever.facing) * (HERO_RADIUS + 0.05)
            const fz = lever.z + Math.cos(lever.facing) * (HERO_RADIUS + 0.05)
            assert.isBelow(Math.hypot(fx - lever.x, fz - lever.z), SWITCH_REACH)
            assert(seesAcross(createFloorWalls(segments, 0.2), fx, fz, lever.x + Math.sin(lever.facing) * 0.01, lever.z + Math.cos(lever.facing) * 0.01))
        }
    })
})
