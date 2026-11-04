import { assert, describe, it } from "vitest"

import HexagonPatch, { PATCH_SIZE } from "../../src/map/HexagonPatch"
import { FaceType } from "../../src/map/geometry"
import PatchWorld, { SLOT_SHIFT } from "../../src/map/PatchWorld"
import { faceCount, packPatch, type QuadPatch } from "../../src/map/QuadPatch"
import { DEFAULT_COSTS, findRoute, globalFace, packPath, unpackPath } from "../../src/map/route"
import { FACE_SIZE } from "../../src/map/scale"
import { patchSeed, resetRandom } from "../../src/math/random"


const { GRASS, WATER, SWAMP, TREE, TREE2, FOREST_FLOOR, SAND, SNOW, WALL, HOUSE, ROCK, GATE } = FaceType


/**
 * Builds a patch of nothing but the given face type
 */
function plainPatch(q: number, r: number, type: FaceType): QuadPatch
{
    resetRandom(patchSeed(4711, q, r))
    const patch = new HexagonPatch(q * PATCH_SIZE, r * PATCH_SIZE, FACE_SIZE)
    const faces = patch.build()
    faces.forEach(face => face.type = type)
    return packPatch(patch, faces)
}


/**
 * Returns the faces next to the given local face inside its patch
 */
function neighbors(patch: QuadPatch, face: number): number[]
{
    const out: number[] = []
    for (let i = 0; i < 4; i++)
    {
        const twin = patch.twin[face * 4 + i]
        if (twin >= 0)
        {
            out.push(twin >> 2)
        }
    }
    return out
}


/**
 * Returns a face without any border half edge
 */
function innerFace(patch: QuadPatch): number
{
    const count = faceCount(patch)
    for (let face = 0; face < count; face++)
    {
        if (neighbors(patch, face).length === 4)
        {
            return face
        }
    }
    throw new Error("No inner face")
}


describe("Costs", () => {

    it("has a constant cost per face type", () => {

        assert(DEFAULT_COSTS[GRASS.index] === 1)
        assert(DEFAULT_COSTS[GATE.index] === 1)
        assert(DEFAULT_COSTS[SAND.index] === 1.5)
        assert(DEFAULT_COSTS[SNOW.index] === 2)
        assert(DEFAULT_COSTS[TREE.index] === 3)
        assert(DEFAULT_COSTS[TREE2.index] === 3)
        assert(DEFAULT_COSTS[FOREST_FLOOR.index] === 3)
        assert(DEFAULT_COSTS[SWAMP.index] === 4)
    })

    it("can't enter water, rock or buildings", () => {

        for (const type of [WATER, ROCK, WALL, HOUSE])
        {
            assert(DEFAULT_COSTS[type.index] === Infinity)
        }
    })
})


describe("Route", () => {

    it("sums up the costs of all faces entered, but not the start", () => {

        const patch = plainPatch(0, 0, WATER)
        const start = innerFace(patch)
        const [swamp] = neighbors(patch, start)
        const sand = neighbors(patch, swamp).find(face => face !== start)!
        patch.faceType[start] = SNOW.index
        patch.faceType[swamp] = SWAMP.index
        patch.faceType[sand] = SAND.index

        const world = new PatchWorld()
        const slot = world.add(patch)
        const route = findRoute(world, globalFace(slot, start), slot, [sand], [slot])
        assert(route.reachable)
        assert(route.cost === 5.5)
        assert.deepEqual(route.paths, [[start, swamp, sand].map(face => globalFace(slot, face))])
    })

    it("needs all goals and costs as much as the farthest one", () => {

        const patch = plainPatch(0, 0, WATER)
        const start = innerFace(patch)
        const [near] = neighbors(patch, start)
        const far = neighbors(patch, near).find(face => face !== start)!
        patch.faceType[start] = GRASS.index
        patch.faceType[near] = GRASS.index
        patch.faceType[far] = GRASS.index

        const world = new PatchWorld()
        const slot = world.add(patch)
        const from = globalFace(slot, start)
        const route = findRoute(world, from, slot, [far, near], [slot])
        assert(route.reachable)
        assert(route.cost === 2)
        assert(route.paths.length === 2)

        patch.faceType[far] = WATER.index
        assert(!findRoute(world, from, slot, [far, near], [slot]).reachable)
    })

    it("crosses seams, but only through the patches it may use", () => {

        const world = new PatchWorld()
        const a = world.add(plainPatch(0, 0, GRASS))
        const b = world.add(plainPatch(1, 0, GRASS))
        const c = world.add(plainPatch(2, 0, GRASS))
        const start = globalFace(a, innerFace(world.getPatch(a)))

        const route = findRoute(world, start, c, [], [a, b])
        assert(route.reachable)
        assert(route.cost > 0)
        assert(!findRoute(world, start, c, [], [a]).reachable)
    })

    it("reaches a patch without goals by entering any face", () => {

        const world = new PatchWorld()
        const a = world.add(plainPatch(0, 0, GRASS))
        const b = world.add(plainPatch(1, 0, GRASS))
        const start = globalFace(a, innerFace(world.getPatch(a)))

        const direct = findRoute(world, start, b, [], [a])
        const middle = findRoute(world, start, b, [innerFace(world.getPatch(b))], [a])
        assert(direct.reachable && middle.reachable)
        assert(direct.cost <= middle.cost)
    })

    it("costs what it takes to get as close as possible if there is no way", () => {

        const world = new PatchWorld()
        const a = world.add(plainPatch(0, 0, GRASS))
        const b = world.add(plainPatch(1, 0, WATER))
        const start = globalFace(a, innerFace(world.getPatch(a)))

        const route = findRoute(world, start, b, [], [a])
        assert(!route.reachable)
        assert(route.cost > 0)
        assert(route.cost < Infinity)
    })
})


describe("Paths", () => {

    it("run from the start across the seam and survive the way to another thread", () => {

        const world = new PatchWorld()
        const a = world.add(plainPatch(0, 0, GRASS))
        const b = world.add(plainPatch(1, 0, GRASS))
        const start = globalFace(a, innerFace(world.getPatch(a)))

        const { paths } = findRoute(world, start, b, [innerFace(world.getPatch(b))], [a])
        assert(paths[0][0] === start)
        assert(paths[0].some(face => face >> (SLOT_SHIFT - 2) === b))

        // the other side may have the same patches in other slots
        const other = new PatchWorld()
        const otherB = other.add(world.getPatch(b))
        const otherA = other.add(world.getPatch(a))
        const moved = unpackPath(other, packPath(world, paths[0]))
        assert(moved[0] === globalFace(otherA, innerFace(world.getPatch(a))))
        assert(moved[moved.length - 1] === globalFace(otherB, innerFace(world.getPatch(b))))
        assert(moved.length === paths[0].length)
    })

    it("lead to the closest face if there is no way", () => {

        const world = new PatchWorld()
        const a = world.add(plainPatch(0, 0, GRASS))
        const b = world.add(plainPatch(1, 0, WATER))
        const start = globalFace(a, innerFace(world.getPatch(a)))

        const { reachable, paths, cost } = findRoute(world, start, b, [], [a])
        assert(!reachable)
        assert(paths.length === 1)
        assert(paths[0].length === cost + 1)
    })
})
