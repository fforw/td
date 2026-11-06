import Prando from "prando"
import { assert, describe, it } from "vitest"

import { SEGMENT_SIZE } from "../../src/map/dungeonLights"
import { clearestSpot, fixtureSegments, type FixtureSpot, outerSpot, setAgainstWall } from "../../src/map/fixtures"

const SPOT: FixtureSpot = { face: 0, x: 0, z: 0, facing: 0 }
const HALF_DEPTH = 0.2


describe("outerSpot", () => {

    const inRow = (face: number): number[] => [face, 0]

    it("stays away from the openings, as long as it can", () => {

        assert.isNull(outerSpot([1, 2], [[1.5, 0]], inRow, new Prando(1)))
        assert.equal(outerSpot([1, 2, 5], [[1.5, 0]], inRow, new Prando(1))!.face, 5)
    })

    it("goes for the outer part of the room", () => {

        for (let seed = 0; seed < 20; seed++)
        {
            assert.notEqual(outerSpot([1, 2, 3, 4, 5], [], inRow, new Prando(seed))!.face, 3)
        }
    })
})


describe("clearestSpot", () => {

    it("goes as far from the openings as the room allows", () => {

        assert.equal(clearestSpot([1, 2], [[0, 0]], face => [face, 0]).face, 2)
    })
})


describe("setAgainstWall", () => {

    it("backs up against the closest wall, looking away from it", () => {

        const spot = { ...SPOT, x: 0.1, z: 0.5, facing: 2 }
        const far = [-5, 5, 5, 5, 0, 0]
        const near = [-5, 0, 5, 0, 0, 0]
        setAgainstWall(spot, Float64Array.of(...far, ...near), HALF_DEPTH)
        assert.closeTo(spot.x, 0.1, 1e-9)
        assert.closeTo(spot.z, HALF_DEPTH, 1e-9)
        assert.closeTo(spot.facing, 0, 1e-9)
    })

    it("stays where it is with no wall around", () => {

        const spot = { ...SPOT, x: 0, z: 50, facing: 2 }
        setAgainstWall(spot, Float64Array.of(-5, 0, 5, 0, 0, 0), HALF_DEPTH)
        assert.deepEqual(spot, { ...SPOT, x: 0, z: 50, facing: 2 })
    })
})


describe("fixtureSegments", () => {

    it("goes all around a fixture", () => {

        const segments = fixtureSegments([{ ...SPOT, x: 1, facing: Math.PI / 4 }], 0.3, 0.2)
        assert.equal(segments.length, 4 * SEGMENT_SIZE)
        for (let side = 0; side < 4; side++)
        {
            const end = side * SEGMENT_SIZE + 2
            const next = (side + 1) % 4 * SEGMENT_SIZE
            assert.closeTo(segments[end], segments[next], 1e-9)
            assert.closeTo(segments[end + 1], segments[next + 1], 1e-9)
        }
    })
})
