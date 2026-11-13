import { assert, describe, it } from "vitest"

import HeroControl, { BLOCK_SPEED, DASH_COOLDOWN, DASH_SPEED, DASH_TIME, DODGE_TIME, type HeroOrders, NO_ORDERS, RUN_SPEED } from "../../src/game/heroControl"

const FRAME = 1 / 60
const ATTACK_TIME = 0.5


function orders(changes: Partial<HeroOrders>): HeroOrders
{
    return { ...NO_ORDERS, ...changes }
}


/**
 * Runs frames for the given time and returns how many attacks they started
 */
function run(control: HeroControl, seconds: number, given: Partial<HeroOrders> = {}): number
{
    let attacks = 0
    for (let t = 0; t < seconds; t += FRAME)
    {
        attacks += control.update(orders(given), FRAME, 0) ? 1 : 0
    }
    return attacks
}


describe("HeroControl", () => {

    it("moves as far as the stick goes", () => {

        const control = new HeroControl(ATTACK_TIME, true)
        control.update(orders({ moveX: 0.5 }), FRAME, 0)
        assert.closeTo(control.velocityX, 0.5 * RUN_SPEED, 1e-9)
        assert.equal(control.velocityZ, 0)
        control.update(NO_ORDERS, FRAME, 0)
        assert(!control.moving)
    })

    it("looks where it aims, else where it goes, else stays as it is", () => {

        const control = new HeroControl(ATTACK_TIME, true)
        control.update(orders({ moveX: 1, aimZ: -1 }), FRAME, 0)
        assert.closeTo(control.turnTo!, Math.PI, 1e-9)
        control.update(orders({ moveX: 1 }), FRAME, 0)
        assert.closeTo(control.turnTo!, Math.PI / 2, 1e-9)
        control.update(NO_ORDERS, FRAME, 0)
        assert.isNull(control.turnTo)
    })

    it("dashes where it goes for a moment at full speed however far the stick is", () => {

        const control = new HeroControl(ATTACK_TIME, true)
        control.update(orders({ moveX: 0.3, dash: true }), FRAME, 0)
        assert(control.dashing)
        assert.closeTo(control.velocityX, RUN_SPEED * DASH_SPEED, 1e-9)
        run(control, DASH_TIME + FRAME, { moveX: 0.3, dash: true })
        assert(!control.dashing)
        assert.closeTo(control.velocityX, 0.3 * RUN_SPEED, 1e-9)
    })

    it("dashes where it looks when standing", () => {

        const control = new HeroControl(ATTACK_TIME, true)
        control.update(orders({ dash: true }), FRAME, Math.PI / 2)
        assert.closeTo(control.velocityX, RUN_SPEED * DASH_SPEED, 1e-9)
        assert.closeTo(control.velocityZ, 0, 1e-9)
    })

    it("can't be hurt from the start of a dash until a while after it", () => {

        const control = new HeroControl(ATTACK_TIME, true)
        assert(!control.dodging)
        control.update(orders({ dash: true }), FRAME, 0)
        assert(control.dodging)
        run(control, DASH_TIME + FRAME)
        assert(!control.dashing)
        assert(control.dodging, "still after the dash")
        run(control, DODGE_TIME - DASH_TIME)
        assert(!control.dodging)
    })

    it("needs a new press and the cooldown for the next dash", () => {

        const control = new HeroControl(ATTACK_TIME, true)
        run(control, DASH_COOLDOWN * 2, { dash: true })
        assert(!control.dashing, "holding doesn't dash again")

        run(control, FRAME)
        control.update(orders({ dash: true }), FRAME, 0)
        assert(control.dashing)
        run(control, DASH_COOLDOWN / 2)
        control.update(orders({ dash: true }), FRAME, 0)
        assert(!control.dashing, "too soon")
        run(control, DASH_COOLDOWN / 2 + FRAME)
        control.update(orders({ dash: true }), FRAME, 0)
        assert(control.dashing)
    })

    it("repeats attacks while held, each after the one before", () => {

        const control = new HeroControl(ATTACK_TIME, true)
        assert.equal(run(control, ATTACK_TIME * 2.5, { attack: true }), 3)
    })

    it("attacks once for a tap, even in the middle of something else", () => {

        const control = new HeroControl(ATTACK_TIME, true)
        assert.equal(run(control, FRAME, { attack: true }), 1)
        assert.equal(run(control, FRAME), 0)
        assert.equal(run(control, FRAME, { attack: true }), 0, "still busy")
        assert.equal(run(control, ATTACK_TIME * 2), 1, "comes after it")
        assert.equal(run(control, ATTACK_TIME * 2), 0)

        control.update(orders({ dash: true }), FRAME, 0)
        assert.equal(run(control, FRAME, { attack: true, dash: true }), 0, "dashing")
        assert.equal(run(control, DASH_TIME), 1, "comes after the dash")
    })

    it("slows down and doesn't attack behind the shield", () => {

        const control = new HeroControl(ATTACK_TIME, true)
        assert.equal(run(control, FRAME, { block: true, moveX: 1, attack: true }), 0)
        assert(control.blocking)
        assert.closeTo(control.velocityX, RUN_SPEED * BLOCK_SPEED, 1e-9)

        assert.equal(run(control, FRAME, { block: true }), 0)
        assert.equal(run(control, ATTACK_TIME), 0, "the tap behind the shield is forgotten")
    })

    it("dashes out from behind the shield", () => {

        const control = new HeroControl(ATTACK_TIME, true)
        run(control, FRAME, { block: true })
        control.update(orders({ block: true, dash: true }), FRAME, 0)
        assert(control.dashing && !control.blocking)
    })

    it("can't attack or block with bare hands", () => {

        const control = new HeroControl(null, false)
        assert.equal(run(control, 1, { attack: true, block: true }), 0)
        assert(!control.blocking)
    })
})

