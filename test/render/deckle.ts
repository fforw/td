import { assert, describe, it } from "vitest"

import { deckleMask } from "../../src/render/deckle"


const WIDTH = 400
const HEIGHT = 300


function alpha(data: Uint8ClampedArray, x: number, y: number): number
{
    return data[(y * WIDTH + x) * 4 + 3]
}


/**
 * Returns the distance from the top border to the first mostly opaque pixel per column
 */
function topEdge(data: Uint8ClampedArray): number[]
{
    const edge: number[] = []
    for (let x = 0; x < WIDTH; x++)
    {
        let y = 0
        while (y < HEIGHT && alpha(data, x, y) < 128)
        {
            y++
        }
        edge.push(y)
    }
    return edge
}


describe("deckleMask", function () {

    const mask = deckleMask(WIDTH, HEIGHT, 1, 4711)

    it("is opaque inside and transparent on all borders", function () {
        assert.equal(alpha(mask, WIDTH >> 1, HEIGHT >> 1), 255)
        for (let x = 0; x < WIDTH; x++)
        {
            assert.equal(alpha(mask, x, 0), 0)
            assert.equal(alpha(mask, x, HEIGHT - 1), 0)
        }
        for (let y = 0; y < HEIGHT; y++)
        {
            assert.equal(alpha(mask, 0, y), 0)
            assert.equal(alpha(mask, WIDTH - 1, y), 0)
        }
    })

    it("has an uneven edge within the margin and a soft fade", function () {
        const edge = topEdge(mask).slice(40, -40)
        const min = Math.min(...edge)
        const max = Math.max(...edge)
        assert.ok(min >= 2, "min " + min)
        assert.ok(max <= 30, "max " + max)
        assert.ok(max - min >= 8, "range " + (max - min))

        let soft = 0
        for (let y = 0; y < 40; y++)
        {
            const a = alpha(mask, WIDTH >> 1, y)
            soft += a > 0 && a < 255 ? 1 : 0
        }
        assert.ok(soft >= 2, "soft " + soft)
    })

    it("depends on the seed only", function () {
        assert.deepEqual(deckleMask(WIDTH, HEIGHT, 1, 4711), mask)
        assert.notDeepEqual(deckleMask(WIDTH, HEIGHT, 1, 4712), mask)
    })

    it("keeps the edge in place at higher pixel ratios", function () {
        const double = deckleMask(WIDTH * 2, HEIGHT * 2, 2, 4711)
        const a = alpha(mask, 200, 14)
        const b = double[(28 * WIDTH * 2 + 400) * 4 + 3]
        assert.closeTo(a, b, 8)
    })
})
