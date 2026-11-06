import { assert, describe, it } from "vitest"

import { dayMarks, Walk } from "../../src/game/journey"


const WAY = [0, 0, 100, 0, 100, 100]

function positionOf(walk: Walk): number[]
{
    const out: number[] = []
    walk.position(out)
    return out
}


describe("Day marks", () => {

    it("share the way out equally between the days", () => {

        const journey = { startDay: 3, endDay: 8 }
        assert.deepEqual(dayMarks(journey, 3), [0, 0.2])
        assert.deepEqual(dayMarks(journey, 4), [0.2, 0.4])
        assert.deepEqual(dayMarks(journey, 7), [0.8, 1])
    })

    it("end at the end of the way, however late it is", () => {

        const journey = { startDay: 3, endDay: 8 }
        assert.deepEqual(dayMarks(journey, 8), [1, 1])
        assert.deepEqual(dayMarks(journey, 20), [1, 1])
    })

    it("go all the way in one day for a journey of one day", () => {

        assert.deepEqual(dayMarks({ startDay: 1, endDay: 2 }, 1), [0, 1])
    })
})


describe("Walk", () => {

    it("measures its way", () => {

        assert(new Walk(WAY, 0).length === 200)
        assert(new Walk([5, 5], 0).length === 0)
    })

    it("starts at the given share of the way", () => {

        assert.deepEqual(positionOf(new Walk(WAY, 0.25)), [50, 0, 100, 0])
        assert.deepEqual(positionOf(new Walk(WAY, 0.75)), [100, 50, 0, 100])
    })

    it("follows its way around corners", () => {

        const walk = new Walk(WAY, 0)
        walk.advance(50, 1)
        assert.deepEqual(positionOf(walk), [50, 0, 100, 0])
        walk.advance(100, 1)
        assert.deepEqual(positionOf(walk), [100, 50, 0, 100])
    })

    it("stops at the mark of the next day", () => {

        const walk = new Walk(WAY, 0)
        assert(walk.advance(30, 0.2))
        assert(!walk.isAt(0.2))
        assert(walk.advance(30, 0.2))
        assert(walk.isAt(0.2))
        assert.deepEqual(positionOf(walk).slice(0, 2), [40, 0])
        assert(!walk.advance(30, 0.2))
    })

    it("stays at the end of its way", () => {

        const walk = new Walk(WAY, 1)
        assert(!walk.advance(30, 1))
        assert(walk.isAt(1))
        assert.deepEqual(positionOf(walk).slice(0, 2), [100, 100])
    })

    it("never goes back when the marks are behind it", () => {

        const walk = new Walk(WAY, 0.5)
        assert(!walk.advance(10, 0.2))
        assert.deepEqual(positionOf(walk).slice(0, 2), [100, 0])
    })

    it("can be put anywhere on its way, also further back", () => {

        const walk = new Walk(WAY, 0.75)
        walk.jumpTo(0.25)
        assert(walk.share === 0.25)
        assert.deepEqual(positionOf(walk), [50, 0, 100, 0])
        walk.jumpTo(0.75)
        assert.deepEqual(positionOf(walk), [100, 50, 0, 100])
    })

    it("has nowhere to go on a way of a single point", () => {

        const walk = new Walk([5, 7], 0)
        assert(!walk.advance(10, 1))
        assert(walk.isAt(1))
        assert.deepEqual(positionOf(walk), [5, 7, 0, 0])
    })
})
