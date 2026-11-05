import { assert, describe, it } from "vitest"

import { DUNGEON_HEIGHT, DUNGEON_WIDTH, generateDungeon, levelSeed } from "../../src/map/generateDungeon"
import { FaceType } from "../../src/map/geometry"
import { PATCH_SIZE } from "../../src/map/HexagonPatch"
import { marchingSquaresPatch } from "../../src/map/marchingSquares"
import PatchWorld, { SLOT_SHIFT } from "../../src/map/PatchWorld"
import { faceCount, faceOf } from "../../src/map/QuadPatch"
import { DEFAULT_COSTS, globalFace } from "../../src/map/route"
import { FACE_SIZE } from "../../src/map/scale"


function connect(width: number, height: number)
{
    const patches = generateDungeon(4711, FACE_SIZE, width, height)
    const world = new PatchWorld()
    const slots = patches.map(patch => world.add(patch))
    return { patches, world, slots }
}


/**
 * Counts the faces reachable across half edges from the first face of the first slot
 */
function reachableFaces(world: PatchWorld, slot: number): number
{
    const start = globalFace(slot, 0)
    const seen = new Set([start])
    const open = [start]
    while (open.length)
    {
        const face = open.pop()!
        for (let i = 0; i < 4; i++)
        {
            const twin = world.twin(face * 4 + i)
            const other = faceOf(twin)
            if (twin >= 0 && !seen.has(other))
            {
                seen.add(other)
                open.push(other)
            }
        }
    }
    return seen.size
}


function groundTriangles(world: PatchWorld, slot: number): FaceType[]
{
    const types: FaceType[] = []
    marchingSquaresPatch(world, slot, type => types.push(type))
    return types
}


describe("generateDungeon", () => {

    it("starts out with two by two patches", () => {
        assert(DUNGEON_WIDTH === 2)
        assert(DUNGEON_HEIGHT === 2)
    })

    it("builds width times height patches row by row", () => {
        const positions = generateDungeon(4711, FACE_SIZE, 3, 2).map(({ q, r }) => [q / PATCH_SIZE, r / PATCH_SIZE])
        assert.deepEqual(positions, [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]])
    })

    it("connects all patches", () => {
        for (const [width, height] of [[1, 1], [2, 2], [3, 1], [1, 3], [3, 2], [4, 4]])
        {
            const { patches, world, slots } = connect(width, height)
            const total = patches.reduce((sum, patch) => sum + faceCount(patch), 0)
            assert(reachableFaces(world, slots[0]) === total)
        }
    })

    it("sets all faces to NONE", () => {
        for (const patch of generateDungeon(4711, FACE_SIZE, 2, 2))
        {
            assert(patch.faceType.every(type => type === FaceType.NONE.index))
        }
    })

    it("always gives the same patches for the same seed", () => {
        const a = generateDungeon(4711, FACE_SIZE, 2, 2)
        const b = generateDungeon(4711, FACE_SIZE, 2, 2)
        a.forEach((patch, i) => assert.deepEqual(patch.positions, b[i].positions))
    })

    it("gives other patches for another seed", () => {
        const [a] = generateDungeon(4711, FACE_SIZE, 1, 1)
        const [b] = generateDungeon(4712, FACE_SIZE, 1, 1)
        assert.notDeepEqual(a.positions, b.positions)
    })
})


describe("levelSeed", () => {

    it("always gives the same seed for the same entrance", () => {
        assert(levelSeed(4711, -1, 0) === levelSeed(4711, -1, 0))
    })

    it("gives every entrance a level of its own", () => {
        const seeds = [
            levelSeed(4711, -1, 0),
            levelSeed(4711, 1, 0),
            levelSeed(4711, -1, 1),
            levelSeed(4711, -1, 0, 1),
            levelSeed(4712, -1, 0),
            levelSeed(levelSeed(4711, -1, 0), -1, 0)
        ]
        assert(new Set(seeds).size === seeds.length)
    })
})


describe("FaceType.NONE", () => {

    it("can't be entered", () => {
        assert(DEFAULT_COSTS[FaceType.NONE.index] === Infinity)
    })

    it("has no ground", () => {
        const { world, slots } = connect(2, 2)
        slots.forEach(slot => assert(groundTriangles(world, slot).length === 0))
    })

    it("only leaves the ground of faces that are set", () => {
        const { patches, world, slots } = connect(2, 2)
        patches[0].faceType[0] = FaceType.PAVED.index

        const types = groundTriangles(world, slots[0])
        assert(types.length > 0)
        assert(types.every(type => type === FaceType.PAVED))
        assert(groundTriangles(world, slots[3]).length === 0)
    })

    it("draws a face that is set on a seam in both patches", () => {
        const { patches, world, slots } = connect(2, 1)
        const [a] = patches

        // find a border half edge of the first patch that faces the second one
        let seam = -1
        for (let h = 0; h < a.twin.length && seam < 0; h++)
        {
            const twin = world.twin((slots[0] << SLOT_SHIFT) | h)
            if (a.twin[h] < 0 && twin >= 0)
            {
                seam = h
            }
        }
        assert(seam >= 0)

        a.faceType[faceOf(seam)] = FaceType.PAVED.index
        const before = groundTriangles(world, slots[0]).length

        const twin = world.twin((slots[0] << SLOT_SHIFT) | seam)
        patches[1].faceType[faceOf(twin & ((1 << SLOT_SHIFT) - 1))] = FaceType.PAVED.index

        assert(before > 0)
        assert(groundTriangles(world, slots[1]).length > 0)
    })
})
