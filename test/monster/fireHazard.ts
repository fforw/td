import { assert, describe, it } from "vitest"

import type { FireRoom } from "../../src/map/fireRoom"
import FireHazard, { HAZARD_PERIOD } from "../../src/monster/fireHazard"
import FireRain from "../../src/monster/fireRain"

const ROOM: FireRoom = {
    room: 0,
    doors: [[0, 0], [0, 4]],
    lines: [
        { x: 0, z: 1, strikes: [{ x: 0, z: 1 }] },
        { x: 0, z: 2, strikes: [{ x: 0, z: 2 }] }
    ],
    lever: { face: 1, x: 1, z: 4, facing: 0 }
}

const INSIDE = [{ face: 1, x: 0, z: 1 }]

function build()
{
    const rain = new FireRain({ sees: () => true, wallDistance: () => Infinity })
    return { rain, hazard: new FireHazard(ROOM, new Set([1]), rain) }
}

/** returns when it hurt at the given point, as the times it started to */
function hurtTimes({ rain, hazard }: ReturnType<typeof build>, x: number, z: number, seconds: number): number[]
{
    const times: number[] = []
    let hurting = false
    for (let t = 0; t < seconds; t += 0.05)
    {
        hazard.update(0.05, INSIDE)
        const hurts = rain.damageAt(x, z) > 0
        if (hurts && !hurting)
        {
            times.push(t)
        }
        hurting = hurts
    }
    return times
}

describe("FireHazard", () => {

    it("strikes each line once per period, one after the other", () => {

        const first = hurtTimes(build(), 0, 1, HAZARD_PERIOD * 4)
        const second = hurtTimes(build(), 0, 2, HAZARD_PERIOD * 4)
        assert.isAtLeast(first.length, 3)
        assert.closeTo(first[1] - first[0], HAZARD_PERIOD, 0.06)
        assert.isAbove(second[0], first[0])
    })

    it("only goes on with someone near", () => {

        const { rain, hazard } = build()
        for (let t = 0; t < 10; t += 0.1)
        {
            hazard.update(0.1, [{ face: 7, x: 50, z: 0 }])
        }
        assert.equal(rain.drops.length, 0)
        hazard.update(0.1, [{ face: 7, x: 0, z: -2 }])
        assert.isAbove(rain.drops.length, 0)
    })

    it("stops with the switch, along with fire that isn't falling yet", () => {

        const built = build()
        hurtTimes(built, 0, 1, 0.5)
        built.hazard.switchOff()
        assert.equal(built.rain.drops.length, 0)
        assert.deepEqual(hurtTimes(built, 0, 1, HAZARD_PERIOD * 3), [])
    })
})
