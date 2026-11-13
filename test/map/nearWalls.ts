import { assert, describe, it } from "vitest"
import { faceCenter } from "../../src/map/dungeonLights"
import { wallGround } from "../../src/map/dungeonWalls"
import { generateDungeon } from "../../src/map/generateDungeon"
import { EdgeType } from "../../src/map/geometry"
import {
    createNearWalls,
    findSpaces,
    THICK_WALL_CUT_DEPTH,
    thickWallSpaces,
    thinWallEndSpaces,
    thinWallSpace,
    VIEW_AWAY
} from "../../src/map/nearWalls"
import PatchWorld, { SLOT_SHIFT } from "../../src/map/PatchWorld"
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
        const { spaceOf, spaceAt } = createNearWalls(world, slots, dungeon)
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
        const near = createNearWalls(world, slots, dungeon)
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
        const near = createNearWalls(world, slots, dungeon)
        const back = createNearWalls(world, slots, dungeon, [-VIEW_AWAY[0], -VIEW_AWAY[1]])
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
        const near = createNearWalls(world, slots, dungeon)
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
        const near = createNearWalls(world, slots, dungeon)
        const { triangles, outline } = wallGround(world, slots[0])
        const spaces = thickWallSpaces(triangles, outline, near)

        assert.isAbove(spaces.size, 50)
        assert.isBelow(spaces.size, triangles.length / 2)

        const reach = THICK_WALL_CUT_DEPTH + 0.75 + 0.01
        for (const [key, [first]] of spaces)
        {
            const [x, z] = key.split(",").map(Number)
            assert.isAbove(first, 0)

            // floor of that space is behind the corner as the view has it
            let behind = false
            for (const [face, space] of near.spaceOf)
            {
                const [fx, fz] = faceCenter(world, face)
                behind ||= space === first && fz < z * SCALE + 0.5 && Math.hypot(fx - x * SCALE, fz - z * SCALE) < reach + 0.75
            }
            assert.isTrue(behind, key)
        }
    })

    it("cuts nothing without floor", () => {

        const { world, slots } = level()
        const near = createNearWalls(world, slots, { rooms: [], corridors: [] })
        const { triangles, outline } = wallGround(world, slots[0])
        assert.equal(thickWallSpaces(triangles, outline, near).size, 0)
    })
})
