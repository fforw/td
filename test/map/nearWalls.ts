import { assert, describe, it } from "vitest"
import { faceCenter } from "../../src/map/dungeonLights"
import { wallGround } from "../../src/map/dungeonWalls"
import { generateDungeon } from "../../src/map/generateDungeon"
import { EdgeType } from "../../src/map/geometry"
import {
    createCutFinder,
    createNearWalls,
    createSpaceGrid,
    findSpaces,
    isExposed,
    SPACE_CELL,
    THICK_WALL_CUT_DEPTH,
    thickWallSpaces,
    thinWallEndSpaces,
    thinWallSpace,
    VIEW_AWAY
} from "../../src/map/nearWalls"
import PatchWorld, { SLOT_SHIFT } from "../../src/map/PatchWorld"
import { next } from "../../src/map/QuadPatch"
import { FACE_SIZE, SCALE } from "../../src/map/scale"


function level()
{
    const dungeon = generateDungeon(4711, FACE_SIZE, 2, 2)
    const world = new PatchWorld()
    const slots = dungeon.patches.map(patch => world.add(patch))
    return { dungeon, world, slots }
}


/** global half edges of the thin walls, one per wall */
function thinWalls(world: PatchWorld, slots: readonly number[]): number[]
{
    const walls: number[] = []
    for (const slot of slots)
    {
        const { edgeType } = world.getPatch(slot)
        const base = slot << SLOT_SHIFT
        for (let h = 0; h < edgeType.length; h++)
        {
            if (edgeType[h] === EdgeType.WALL.index && (base | h) < world.twin(base | h))
            {
                walls.push(base | h)
            }
        }
    }
    return walls
}


describe("findSpaces", () => {

    it("numbers the rooms from 1 and the corridors after them", () => {

        const spaces = findSpaces({ rooms: [[1, 2], [3]], corridors: [{ faces: [2, 4, 3] }, { faces: [5] }] })
        assert.deepEqual([...spaces], [[1, 1], [2, 1], [3, 2], [4, 3], [5, 4]])
    })
})


describe("createNearWalls", () => {

    it("finds the space at the middle of each floor face, and none in the walls", () => {

        const { dungeon, world, slots } = level()
        const { spaceOf, spaceAt } = createNearWalls(world, dungeon)
        for (const [face, space] of spaceOf)
        {
            assert.equal(spaceAt(...faceCenter(world, face)), space)
        }
        assert.equal(spaceAt(-1000, -1000), 0)
    })
})


describe("thinWallSpace", () => {

    it("gives the space behind a wall that faces the view", () => {

        const { dungeon, world, slots } = level()
        const near = createNearWalls(world, dungeon)
        let found = 0, sideways = 0
        for (const h of thinWalls(world, slots))
        {
            const space = thinWallSpace(world, h, near)
            const [, az] = faceCenter(world, h >> 2)
            const [, bz] = faceCenter(world, world.twin(h) >> 2)
            // the view looks to where z gets less
            const behind = az < bz ? h : world.twin(h)
            if (space)
            {
                found++
                assert.equal(space, near.spaceOf.get(behind >> 2))
            }
            else if (near.spaceOf.has(behind >> 2))
            {
                sideways++
            }
        }
        assert.isAbove(found, 50)
        assert.isAbove(sideways, 10)
    })

    it("gives the other side for a view from the other side", () => {

        const { dungeon, world, slots } = level()
        const near = createNearWalls(world, dungeon)
        const back = createNearWalls(world, dungeon, [-VIEW_AWAY[0], -VIEW_AWAY[1]])
        let differ = 0
        for (const h of thinWalls(world, slots))
        {
            // a wall faces both views or none
            assert.equal(thinWallSpace(world, h, near) === 0, thinWallSpace(world, h, back) === 0)
            differ += Number(thinWallSpace(world, h, near) !== thinWallSpace(world, h, back))
        }
        assert.isAbove(differ, 20)
    })
})


describe("thinWallEndSpaces", () => {

    it("has the ends of the near walls only", () => {

        const { dungeon, world, slots } = level()
        const near = createNearWalls(world, dungeon)
        const walls = thinWalls(world, slots).filter(h => thinWallSpace(world, h, near))
        const ends = thinWallEndSpaces(world, slots, near)
        assert.isAtLeast(ends.size, walls.length / 2)
        assert.isAtMost(ends.size, walls.length * 2)
        for (const [first] of ends.values())
        {
            assert.isAbove(first, 0)
        }
    })
})


describe("thickWallSpaces", () => {

    it("cuts walls with floor right behind them, about a face deep", () => {

        const { dungeon, world, slots } = level()
        const near = createNearWalls(world, dungeon)
        const { triangles } = wallGround(world, slots[0])
        const spaces = thickWallSpaces(triangles, near)

        assert.isAbove(spaces.size, 50)
        assert.isBelow(spaces.size, triangles.length / 2)

        for (const [key, [first]] of spaces)
        {
            // the first floor straight behind the corner as the view has it, so no other space lies in between
            const [x, z] = key.split(",").map(Number)
            let found = 0
            for (let reach = 0.1; reach <= THICK_WALL_CUT_DEPTH + 0.01 && !found; reach += 0.1)
            {
                found = near.spaceAt(x * SCALE, z * SCALE - reach)
            }
            assert.equal(found, first, key)
        }
    })

    it("doesn't spread sideways, or through a space to one further behind than the cut is deep", () => {

        // two rooms side by side and one far behind the right one, walls in front of them
        const spaceAt = (x: number, z: number) => z >= 0 ? 0 : x < 0 ? 1 : z > -2 ? 2 : 3
        const near = { spaceOf: new Map<number, number>(), spaceAt, away: VIEW_AWAY }
        const triangles = [-0.2, 0.3, 0.2, 0.3, 0.2, 2].map(v => v / SCALE)
        const spaces = thickWallSpaces(triangles, near)

        assert.deepEqual([...spaces.values()], [[1, 0], [2, 0]])
    })

    it("cuts for the space behind a narrow strip of another one", () => {

        // a strip of a room in front of another room, the wall in front hides both
        const spaceAt = (x: number, z: number) => z >= 0 ? 0 : z > -0.3 ? 1 : 2
        const near = { spaceOf: new Map<number, number>(), spaceAt, away: VIEW_AWAY }
        const triangles = [-0.2, 0.3, 0.2, 0.3, 0.2, 2].map(v => v / SCALE)
        const spaces = thickWallSpaces(triangles, near)

        assert.deepEqual([...spaces.values()], [[1, 2], [1, 2]])
    })

    it("keeps the sides of walls that run along the view", () => {

        // floor to the right, the wall sticks out a bit over its edge there
        const near = { spaceOf: new Map<number, number>(), spaceAt: (x: number, z: number) => x > 0 && z < 0 ? 1 : 0, away: VIEW_AWAY }
        const triangles = [0.05, 0.2, 0.5, 0.2, 0.5, 0.4].map(v => v / SCALE)
        const spaces = thickWallSpaces(triangles, near)

        assert.isFalse(spaces.has(triangles[0] + "," + triangles[1]))
        assert.equal(spaces.size, 2)
    })

    it("cuts nothing without floor", () => {

        const { world, slots } = level()
        const near = createNearWalls(world, { rooms: [], corridors: [] })
        const { triangles } = wallGround(world, slots[0])
        assert.equal(thickWallSpaces(triangles, near).size, 0)
    })
})


describe("isExposed", () => {

    // wall from z = 0 to 2 toward the camera, only cut for space 7, at the corner of the triangle at x = 2
    const triangles = [-2, 0, -2, 2, 2, 0].map(v => v / SCALE)
    const spaces = new Map([[triangles[4] + "," + triangles[5], [7, 0] as [number, number]]])
    const cutAt = createCutFinder([{ triangles, spaces }])
    const near = (spaceAt: (x: number, z: number) => number) =>
        ({ spaceOf: new Map<number, number>(), spaceAt, away: VIEW_AWAY })

    it("finds the spaces the wall gets cut for", () => {

        assert.deepEqual([...cutAt(0, 0.5)], [7])
        assert.deepEqual([...cutAt(1, 1.5)], [])
    })

    it("takes floor of another space behind a cut", () => {

        assert.isTrue(isExposed(-1, 0, 0.6, cutAt, near(() => 1)))
        assert.isTrue(isExposed(-1, 0, 0.6, cutAt, near((_, z) => z > -0.5 ? 7 : 1)))
    })

    it("leaves out what has only the space behind it that the wall is cut for, no floor, or no cut in front", () => {

        assert.isFalse(isExposed(-1, 0, 0.6, cutAt, near(() => 7)))
        assert.isFalse(isExposed(-1, 0, 0.6, cutAt, near(() => 0)))
        assert.isFalse(isExposed(9, 0, 0.6, cutAt, near(() => 1)))
    })
})


describe("createSpaceGrid", () => {

    it("has the spaces at the middle of its cells", () => {

        const { dungeon, world } = level()
        const near = createNearWalls(world, dungeon)
        const { minX, minZ, width, height, cells } = createSpaceGrid(world, near)
        assert.equal(cells.length, width * height * 2)
        for (const [face, space] of near.spaceOf)
        {
            // close enough to the middle of the face to be on it
            const [x, z] = faceCenter(world, face)
            const column = Math.floor((x - minX) / SPACE_CELL), row = Math.floor((z - minZ) / SPACE_CELL)
            assert.equal(cells[(row * width + column) * 2], space)
        }
    })

    it("marks the cells along thin walls with the space they are near for", () => {

        const { dungeon, world, slots } = level()
        const near = createNearWalls(world, dungeon)
        const { minX, minZ, width, cells } = createSpaceGrid(world, near)
        const values = new Set<number>()
        for (const h of thinWalls(world, slots))
        {
            if (near.spaceOf.has(h >> 2))
            {
                const { positions, vertex } = world.getPatch(h >> SLOT_SHIFT)
                const local = h & ((1 << SLOT_SHIFT) - 1)
                const v0 = vertex[local] * 3, v1 = vertex[next(local)] * 3
                const column = Math.floor(((positions[v0] + positions[v1]) / 2 * SCALE - minX) / SPACE_CELL)
                const row = Math.floor(((positions[v0 + 1] + positions[v1 + 1]) / 2 * SCALE - minZ) / SPACE_CELL)
                // the middle can be right between cells
                const around = [0, 1, -1].flatMap(dy => [0, 1, -1].map(dx => cells[((row + dy) * width + column + dx) * 2 + 1]))
                const value = Math.max(...around.filter(v => v !== undefined))
                assert.isAbove(value, 0)
                values.add(value)
            }
        }
        assert.isAbove(values.size, 5)
    })
})
