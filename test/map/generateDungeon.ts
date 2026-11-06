import { assert, describe, it } from "vitest"

import { DEFAULT_DUNGEON_STYLE, DUNGEON_HEIGHT, DUNGEON_WIDTH, generateDungeon, levelSeed } from "../../src/map/generateDungeon"
import { FaceType } from "../../src/map/geometry"
import { PATCH_SIZE } from "../../src/map/HexagonPatch"
import { LEVEL_PRIORITY, marchingSquaresPatch } from "../../src/map/marchingSquares"
import PatchWorld, { LOCAL_MASK, SLOT_SHIFT } from "../../src/map/PatchWorld"
import { faceCount, faceOf } from "../../src/map/QuadPatch"
import { DEFAULT_COSTS, globalFace } from "../../src/map/route"
import { FACE_SIZE } from "../../src/map/scale"


/**
 * Connects the patches of a level, with all of their faces back to NONE
 */
function connect(width: number, height: number)
{
    const { patches } = generateDungeon(4711, FACE_SIZE, width, height)
    patches.forEach(patch => patch.faceType.fill(FaceType.NONE.index))
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
        const positions = generateDungeon(4711, FACE_SIZE, 3, 2).patches.map(({ q, r }) => [q / PATCH_SIZE, r / PATCH_SIZE])
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

    it("only sets the faces of its rooms and corridors and the walls touching them, even at just a corner", () => {
        for (const [seed, width, height] of [[4711, 2, 2], [700959734, DUNGEON_WIDTH, DUNGEON_HEIGHT]])
        {
            const { patches, rooms, corridors } = generateDungeon(seed, FACE_SIZE, width, height)
            const floor = new Set([...rooms.flat(), ...corridors.flatMap(({ faces }) => faces)])
            const world = new PatchWorld()
            patches.forEach(patch => world.add(patch))

            // seams have vertices on both sides, so this goes by the positions
            const corners = (face: number): string[] => {
                const { positions, vertex } = world.getPatch(face >> (SLOT_SHIFT - 2))
                const local = face & (LOCAL_MASK >> 2)
                return [0, 1, 2, 3].map(i => {
                    const v = vertex[local * 4 + i]
                    return positions[v * 3].toFixed(3) + "/" + positions[v * 3 + 1].toFixed(3)
                })
            }
            const floorCorners = new Set([...floor].flatMap(corners))

            patches.forEach((patch, slot) => patch.faceType.forEach((type, face) => {
                const id = globalFace(slot, face)
                const expected = floor.has(id) ? FaceType.PAVED : corners(id).some(corner => floorCorners.has(corner)) ? FaceType.WALL : FaceType.NONE
                assert(type === expected.index, "seed " + seed + ", face " + id)
            }))
        }
    })

    it("leaves the floor all of its faces and the walls less than theirs", () => {
        const { patches, rooms, corridors } = generateDungeon(4711, FACE_SIZE, 2, 2)
        const world = new PatchWorld()
        const slots = patches.map(patch => world.add(patch))

        const area = (points: number[][]) => points.reduce((sum, [x, y], i) => {
            const [nx, ny] = points[(i + 1) % points.length]
            return sum + x * ny - nx * y
        }, 0) / 2
        const faceArea = (face: number) => {
            const { positions, vertex } = patches[face >> (SLOT_SHIFT - 2)]
            const local = face & ((1 << (SLOT_SHIFT - 2)) - 1)
            return Math.abs(area([0, 1, 2, 3].map(i => {
                const v = vertex[local * 4 + i] * 3
                return [positions[v], positions[v + 1]]
            })))
        }

        const areas = new Map<FaceType, number>()
        slots.forEach(slot => marchingSquaresPatch(world, slot, (type, x0, y0, x1, y1, x2, y2) => {
            const triangle = Math.abs(area([[x0, y0], [x1, y1], [x2, y2]]))
            areas.set(type, (areas.get(type) ?? 0) + triangle)
        }, LEVEL_PRIORITY))

        const sum = (faces: number[]) => faces.reduce((total, face) => total + faceArea(face), 0)
        const floor = sum([...rooms.flat(), ...corridors.flatMap(({ faces }) => faces)])
        const walls = sum(slots.flatMap(slot => [...patches[slot].faceType.entries()]
            .filter(([, type]) => type === FaceType.WALL.index)
            .map(([face]) => globalFace(slot, face))))

        // floor can also reach into wall faces at corners where it is the most common type
        assert(areas.get(FaceType.PAVED)! > floor * 0.999)
        assert(areas.get(FaceType.WALL)! < walls)
    })

    it("always gives the same level for the same seed", () => {
        const a = generateDungeon(4711, FACE_SIZE, 2, 2)
        const b = generateDungeon(4711, FACE_SIZE, 2, 2)
        a.patches.forEach((patch, i) => {
            assert.deepEqual(patch.positions, b.patches[i].positions)
            assert.deepEqual(patch.faceType, b.patches[i].faceType)
        })
        assert.deepEqual(a.regions, b.regions)
        assert.deepEqual(a.rooms, b.rooms)
        assert.deepEqual(a.corridors, b.corridors)
    })

    it("grows rooms to the floor share it is asked for", () => {
        for (const floorShare of [0.45, 0.6, 0.7])
        {
            const { patches, rooms } = generateDungeon(4711, FACE_SIZE, 2, 2, { floorShare })
            const total = patches.reduce((sum, patch) => sum + faceCount(patch), 0)
            assert(rooms.flat().length === Math.ceil(total * floorShare))
        }
    })

    it("keeps the default for what a style leaves out", () => {
        const { rooms } = generateDungeon(4711, FACE_SIZE, 2, 2)
        assert.deepEqual(generateDungeon(4711, FACE_SIZE, 2, 2, { labyrinth: 2.5 }).rooms, rooms)
        assert.deepEqual(generateDungeon(4711, FACE_SIZE, 2, 2, DEFAULT_DUNGEON_STYLE).rooms, rooms)
    })

    it("gives other patches for another seed", () => {
        const { patches: [a] } = generateDungeon(4711, FACE_SIZE, 1, 1)
        const { patches: [b] } = generateDungeon(4712, FACE_SIZE, 1, 1)
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
