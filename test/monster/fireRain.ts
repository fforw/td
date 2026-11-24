import { assert, describe, it } from "vitest"

import { FIRE_PATTERN_NAMES, FIRE_PATTERNS, FIRE_RADIUS, type FireAim } from "../../src/monster/firePatterns"
import FireRain, { type FireFloor } from "../../src/monster/fireRain"
import { FIRE_ACTIVE, FIRE_FADE, FIRE_WARN } from "../../src/render/fireTiming"

const OPEN: FireFloor = { sees: () => true, wallDistance: () => Infinity }

const AIM: FireAim = { x: 2, z: 1, fromX: 1, fromZ: 1 }


describe("FIRE_PATTERNS", () => {
    for (const name of FIRE_PATTERN_NAMES)
    {
        it("has the fire of " + name + " strike the target at some time", () => {
            const spots = FIRE_PATTERNS[name](AIM)
            assert.isTrue(spots.some(({ x, z }) => Math.hypot(x - AIM.x, z - AIM.z) < FIRE_RADIUS))
            assert.isTrue(spots.every(({ delay }) => delay >= 0))
        })
    }

    it("has the line come from far away and go on through the target", () => {
        const spots = [...FIRE_PATTERNS.line(AIM)].sort((a, b) => a.delay - b.delay)
        for (let i = 1; i < spots.length; i++)
        {
            assert.isAbove(spots[i].x, spots[i - 1].x)
            assert.closeTo(spots[i].z, AIM.z, 1e-9)
        }
        assert.isAbove(spots[0].x, AIM.fromX)
        assert.isBelow(spots[0].x, AIM.x - FIRE_RADIUS)
        assert.isAbove(spots[spots.length - 1].x, AIM.x + FIRE_RADIUS)
    })

    it("copes with a line from right on the target", () => {
        const spots = FIRE_PATTERNS.line({ x: 1, z: 1, fromX: 1, fromZ: 1 })
        assert.isTrue(spots.every(({ x, z }) => Number.isFinite(x) && Number.isFinite(z)))
    })

    it("has three rings strike from the outermost to the innermost", () => {
        const radii = new Map<number, number>()
        for (const { x, z, delay } of FIRE_PATTERNS.rings(AIM))
        {
            const radius = Math.hypot(x - AIM.x, z - AIM.z)
            assert.closeTo(radii.get(delay) ?? radius, radius, 1e-9)
            radii.set(delay, radius)
        }
        const ordered = [...radii].sort(([a], [b]) => a - b).map(([, radius]) => radius)
        assert.lengthOf(ordered, 3)
        assert.isTrue(ordered[0] > ordered[1] && ordered[1] > ordered[2])
    })
})

describe("FireRain", () => {
    it("hurts only where and while it strikes", () => {
        const rain = new FireRain(OPEN)
        rain.cast([{ x: 0, z: 0, delay: 0.5 }], 0, 0, 2)
        rain.update(FIRE_WARN + 0.45)
        assert.strictEqual(rain.damageAt(0, 0), 0)
        rain.update(0.1)
        assert.strictEqual(rain.damageAt(0, 0), 2)
        assert.strictEqual(rain.damageAt(FIRE_RADIUS * 1.01, 0), 0)
        rain.update(FIRE_ACTIVE)
        assert.strictEqual(rain.damageAt(0, 0), 0)
        rain.update(FIRE_FADE)
        assert.isEmpty(rain.drops)
    })

    it("leaves out spots in and behind walls", () => {
        // a wall at x = 1
        const rain = new FireRain({
            sees: (x0, _z0, x1) => (x0 < 1) === (x1 < 1),
            wallDistance: x => Math.abs(x - 1)
        })
        rain.cast([0, 1, 2].map(x => ({ x, z: 0, delay: 0 })), 0, 0, 1)
        assert.deepEqual(rain.drops.map(({ x }) => x), [0])
    })
})
