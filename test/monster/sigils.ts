import { assert, describe, it } from "vitest"

import { placeSigil, SIGIL_CLEARANCE, SIGIL_REACH, type SigilFloor } from "../../src/monster/sigils"

const R = 0.33
/** as close to a wall as a hero gets */
const CLOSE = 0.066


/**
 * Floor with the given distances to walls, which are negative beyond them
 */
function floorOf(distance: (x: number, z: number) => number): SigilFloor
{
    return {
        wallDistance: (x, z) => Math.abs(distance(x, z)),
        sees: (x0, z0, x1, z1) => distance(x0, z0) * distance(x1, z1) > 0
    }
}


describe("placing sigils", () => {
    it("puts it right under a hero in the open", () => {
        assert.deepEqual(placeSigil(floorOf(() => 1), 3, 4, R), [3, 4])
    })

    it("keeps off a wall the hero stands at, no further than needed", () => {
        const [x, z] = placeSigil(floorOf(x => x), CLOSE, 0, R)
        assert.isAtLeast(x, SIGIL_CLEARANCE * R)
        assert.isAtMost(x, SIGIL_CLEARANCE * R + SIGIL_REACH * R / 8 + 1e-9)
        assert.closeTo(z, 0, 1e-9)
    })

    it("keeps off both walls of a corner", () => {
        const [x, z] = placeSigil(floorOf((x, z) => Math.min(x, z)), CLOSE, CLOSE, R)
        assert.isAtLeast(Math.min(x, z), SIGIL_CLEARANCE * R)
    })

    it("goes to about the middle of a narrow corridor", () => {
        const half = R / 2
        const [x, z] = placeSigil(floorOf(x => half - Math.abs(x)), half - CLOSE, 0, R)
        assert.closeTo(x, 0, 0.03)
        assert.closeTo(z, 0, 1e-9)
    })

    it("always has the hero in it, on the same side of the wall", () => {
        for (let d = 0.01; d < 0.5; d += 0.01)
        {
            const [x, z] = placeSigil(floorOf(x => x), d, 0, R)
            assert.isAbove(x, 0)
            assert.isAtMost(Math.hypot(x - d, z), SIGIL_REACH * R + 1e-9)
        }
    })
})
