import { assert, describe, it } from "vitest"

import HeroControl, { BLOCK_SPEED, DASH_COOLDOWN, DASH_SPEED, DASH_TIME, DODGE_TIME, type HeroOrders, NO_ORDERS, RUN_SPEED, VIEW_TURN_BOOST, VIEW_TURN_LAG, VIEW_TURN_RATE, ViewTurn } from "../../src/game/heroControl"

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


/**
 * Turns for the given time with the stick held and returns the yaw it adds up to
 */
function turn(view: ViewTurn, seconds: number, aimX: number, aimY: number): number
{
    let yaw = 0
    for (let t = 0; t < seconds - 1e-9; t += FRAME)
    {
        yaw += view.update(aimX, aimY, FRAME)
    }
    return yaw
}


describe("ViewTurn", () => {

    it("leaves the view alone without any aim, or aiming ahead", () => {

        const view = new ViewTurn()
        assert.equal(turn(view, 1, 0, 0), 0)
        assert.equal(turn(view, 1, 0.1, -1), 0)
    })

    it("gets up to speed with some inertia", () => {

        const view = new ViewTurn()
        view.update(1, 0, FRAME)
        assert.isBelow(view.rate, VIEW_TURN_RATE * 0.2, "doesn't jump to full speed")
        turn(view, VIEW_TURN_LAG * 4, 1, 0)
        assert.closeTo(view.rate, VIEW_TURN_RATE, VIEW_TURN_RATE * 0.1)
    })

    it("turns to the right with a negative yaw, and the other way to the left", () => {

        assert.isBelow(turn(new ViewTurn(), 0.5, 1, 0), 0)
        assert.isAbove(turn(new ViewTurn(), 0.5, -1, 0), 0)
    })

    it("turns faster the further the stick is pushed and the more it points to the side", () => {

        const full = -turn(new ViewTurn(), 0.5, 1, 0)
        assert.isBelow(-turn(new ViewTurn(), 0.5, 0.5, 0), full * 0.6)
        assert.isBelow(-turn(new ViewTurn(), 0.5, Math.SQRT1_2, -Math.SQRT1_2), full * 0.8)
    })

    it("goes on turning as long as the stick is held, and speeds up", () => {

        const view = new ViewTurn()
        const first = -turn(view, 1, 1, 0)
        assert.isAbove(first, Math.PI / 2, "goes past a quarter turn")
        turn(view, 2, 1, 0)
        assert.closeTo(view.rate, VIEW_TURN_RATE * VIEW_TURN_BOOST, 1e-3)
    })

    it("keeps turning the way it does when the stick points back", () => {

        const view = new ViewTurn()
        turn(view, 0.5, -1, 0)
        turn(view, 0.5, 0.05, 1)
        assert.isBelow(view.rate, 0, "still to the left, though slightly right of back")
    })

    it("comes to rest when let go of, after coasting a little", () => {

        const view = new ViewTurn()
        turn(view, 1, 1, 0)
        const coast = -turn(view, 1, 0, 0)
        assert.isAbove(coast, 0)
        assert.isBelow(coast, VIEW_TURN_RATE * VIEW_TURN_BOOST * VIEW_TURN_LAG * 1.1)
        assert.equal(view.rate, 0)
    })
})
