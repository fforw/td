import { afterEach, assert, beforeEach, describe, it, vi } from "vitest"

import type { FireDrop } from "../../src/monster/fireRain"

const played: { name: string, rate: number, volume: number, at: number }[] = []

/**
 * Milliseconds performance.now() returns
 */
let clock = 0

vi.mock("../../src/sound/effects", () => ({
    loadEffect: () => Promise.resolve(null),
    playEffect: (name: string, rate: number, volume: number) => {
        played.push({ name, rate, volume, at: clock / 1000 })
    }
}))

const { default: FireSounds } = await import("../../src/sound/fireSounds")

const FRAME = 1 / 60

/**
 * Seconds from one strike of a fire room line to the next, and from one line to the next
 */
const STRIKE_DELAY = 0.035
const LINE_DELAY = 0.4

function drop(age: number): FireDrop
{
    return { x: 0, z: 0, radius: 0.1, damage: 1, age, random: 0 }
}

/**
 * Runs frames over the drops, aging them, and returns how many strikes played
 */
function run(sounds: InstanceType<typeof FireSounds>, drops: FireDrop[], seconds: number): number
{
    played.length = 0
    for (let t = 0; t < seconds; t += FRAME)
    {
        clock += FRAME * 1000
        for (const fire of drops)
        {
            fire.age += FRAME
        }
        sounds.update(drops)
    }
    return played.length
}

describe("FireSounds", () => {

    beforeEach(() => {
        vi.spyOn(performance, "now").mockImplementation(() => clock)
        played.length = 0
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("sounds all along the lines of a fire room, not just at the start of some", () => {

        const sounds = new FireSounds()
        const start = clock / 1000
        // three lines of 12, one after the other, as a fire room has them
        const lines = [0, 1, 2].map(line => Array.from({ length: 12 }, (_, i) => drop(-1 - line * LINE_DELAY - i * STRIKE_DELAY)))
        run(sounds, lines.flat(), 3)
        // from the first strike to the last, the sounds keep coming
        const times = played.map(({ at }) => at)
        const gaps = times.slice(1).map((at, i) => at - times[i])
        assert.isAtLeast(times[0], start + 1 - 0.3)
        assert.isAtLeast(times[times.length - 1], start + 1 + 2 * LINE_DELAY + 11 * STRIKE_DELAY - 0.3)
        assert.isBelow(Math.max(...gaps), 0.2)
        assert.isAtLeast(played.length, 9)
        assert.isBelow(played.length, 36)
    })

    it("plays a ring striking at once as one louder strike", () => {

        const sounds = new FireSounds()
        const ring = Array.from({ length: 14 }, () => drop(-0.5))
        // all of them get the same moment to strike, whatever recording and rate they picked
        sounds.update(ring)
        for (const fire of ring)
        {
            fire.age = 0
        }
        played.length = 0
        sounds.update(ring)
        assert.lengthOf(played, 1)

        const single = new FireSounds()
        const alone = [drop(-0.5)]
        single.update(alone)
        alone[0].age = 0
        const loudest = played[0].volume
        played.length = 0
        single.update(alone)
        assert.isAbove(loudest, played[0].volume)
    })

    it("varies the volume of the strikes", () => {

        const sounds = new FireSounds()
        const strikes = Array.from({ length: 30 }, (_, i) => drop(-1 - i * 0.2))
        run(sounds, strikes, 8)
        assert.isAbove(new Set(played.map(({ volume }) => volume.toFixed(3))).size, 10)
    })
})
