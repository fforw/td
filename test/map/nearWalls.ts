import { assert, describe, it } from "vitest"
import { faceCenter } from "../../src/map/dungeonLights"
import { wallGround } from "../../src/map/dungeonWalls"
import { generateDungeon } from "../../src/map/generateDungeon"
import { EdgeType } from "../../src/map/geometry"
import {
    createNearWalls,
    createWallFinder,
    findSpaces,
    THICK_WALL_CUT_DEPTH,
    thickWallCuts,
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


describe("thickWallCuts", () => {

    it("cuts walls with floor right behind them, about a face deep", () => {

        const { dungeon, world, slots } = level()
        const near = createNearWalls(world, dungeon)
        const { triangles } = wallGround(world, slots[0])
        const cuts = thickWallCuts(triangles, near)
        const cut = cuts.filter(([first]) => first)

        assert.equal(cuts.length, triangles.length / 6)
        assert.isAbove(cut.length, 50)
        assert.isBelow(cut.length, cuts.length / 2)

        cuts.forEach(([first], i) => {
            if (!first)
            {
                return
            }
            // the first floor straight behind the middle as the view has it, so no other space lies in between
            const x = (triangles[i * 6] + triangles[i * 6 + 2] + triangles[i * 6 + 4]) / 3 * SCALE
            const z = (triangles[i * 6 + 1] + triangles[i * 6 + 3] + triangles[i * 6 + 5]) / 3 * SCALE
            let found = 0
            for (let reach = 0.1; reach <= THICK_WALL_CUT_DEPTH + 0.01 && !found; reach += 0.1)
            {
                found = near.spaceAt(x, z - reach)
            }
            assert.equal(found, first, String(i))
        })
    })

    it("doesn't spread sideways, or through a space to one further behind than the cut is deep", () => {

        // two rooms side by side and one far behind the right one, walls in front of them
        const spaceAt = (x: number, z: number) => z >= 0 ? 0 : x < 0 ? 1 : z > -2 ? 2 : 3
        const near = { spaceOf: new Map<number, number>(), spaceAt, away: VIEW_AWAY }
        const triangles = [
            -0.4, 0.3, -0.1, 0.3, -0.1, 0.6,
            0.1, 0.3, 0.4, 0.3, 0.4, 0.6,
            0.1, 1.4, 0.4, 1.4, 0.4, 1.7
        ].map(v => v / SCALE)

        assert.deepEqual(thickWallCuts(triangles, near), [[1, 0], [2, 0], [0, 0]])
    })

    it("cuts for the space behind a narrow strip of another one", () => {

        // a strip of a room in front of another room, the wall in front hides both
        const spaceAt = (x: number, z: number) => z >= 0 ? 0 : z > -0.3 ? 1 : 2
        const near = { spaceOf: new Map<number, number>(), spaceAt, away: VIEW_AWAY }
        const triangles = [-0.2, 0.3, 0.2, 0.3, 0.2, 0.6].map(v => v / SCALE)

        assert.deepEqual(thickWallCuts(triangles, near), [[1, 2]])
    })

    it("keeps the sides of walls that run along the view", () => {

        // floor to the right, the first wall sticks out a bit over its edge there, the second one well over it
        const near = { spaceOf: new Map<number, number>(), spaceAt: (x: number, z: number) => x > 0 && z < 0 ? 1 : 0, away: VIEW_AWAY }
        const triangles = [-0.1, 0.2, 0.2, 0.2, 0.05, 0.4, 0.2, 0.2, 0.5, 0.2, 0.35, 0.4].map(v => v / SCALE)

        assert.deepEqual(thickWallCuts(triangles, near), [[0, 0], [1, 0]])
    })

    it("cuts nothing without floor", () => {

        const { world, slots } = level()
        const near = createNearWalls(world, { rooms: [], corridors: [] })
        const { triangles } = wallGround(world, slots[0])
        assert.isTrue(thickWallCuts(triangles, near).every(([first, second]) => !first && !second))
    })
})
