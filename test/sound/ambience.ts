import { assert, describe, it } from "vitest"

import { dripLoop } from "../../src/sound/ambience"

const RATE = 8000


describe("dripLoop", () => {

    it("is the same for the same seed", () => {

        assert.deepEqual(dripLoop(7, RATE, 3), dripLoop(7, RATE, 3))
        assert.notDeepEqual(dripLoop(7, RATE, 3), dripLoop(8, RATE, 3))
    })

    it("has the asked length and stays in range", () => {

        const loop = dripLoop(1, RATE, 3)
        assert.equal(loop.length, 3 * RATE)
        assert(loop.every(sample => Math.abs(sample) < 1))
    })

    it("has no jump where it starts over", () => {

        const loop = dripLoop(2, RATE, 3)
        let largest = 0
        for (let i = 1; i < loop.length; i++)
        {
            largest = Math.max(largest, Math.abs(loop[i] - loop[i - 1]))
        }
        assert(Math.abs(loop[0] - loop[loop.length - 1]) <= largest)
    })
})
