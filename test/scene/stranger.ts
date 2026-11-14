import { assert, describe, it } from "vitest"

import { placeStranger } from "../../src/scene/stranger"

/**
 * Faces numbered by their place on a grid of 10 columns
 */
const center = (face: number): [number, number] => [face % 10, Math.floor(face / 10)]

const square = (left: number, top: number, size: number): number[] =>
    Array.from({ length: size * size }, (_, i) => (top + Math.floor(i / size)) * 10 + left + i % size)


describe("placeStranger", () => {

    it("stands in the middle of a big room that isn't the entrance", () => {
        const rooms = [square(0, 0, 3), square(5, 0, 3), [70, 71]]
        for (let seed = 0; seed < 20; seed++)
        {
            const spot = placeStranger(rooms, 0, center, seed)
            assert.deepEqual(spot, { room: 1, face: 16 })
        }
    })

    it("takes a small room without a big one, and no room without another", () => {
        assert.deepEqual(placeStranger([square(0, 0, 3), [70, 71]], 0, center, 1), { room: 1, face: 70 })
        assert.isNull(placeStranger([square(0, 0, 3)], 0, center, 1))
    })
})
