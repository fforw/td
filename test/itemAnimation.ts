import { assert, describe, it } from "vitest"

import {
    actionDuration,
    actItem,
    advanceItem,
    blendPose,
    EASINGS,
    type ItemAnimation,
    type ItemPhase,
    itemPose,
    type ItemPose,
    type ItemState,
    MAX_HEIGHT,
    MIN_HEIGHT,
    newItemState,
    resolveAnimation,
    stopActing
} from "../src/itemAnimation"


function newPose(): ItemPose
{
    return { pivot: [0, 0], height: 0, angle: 0, lift: 0, roll: 0, swing: 0 }
}


// not narrowed, the phase changes between the checks
const phase = (state: ItemState): ItemPhase => state.phase

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9

/**
 * 0.5s to ready, an action of 1s + 0.5s hold + 1s back and a repeat after 2s
 */
const ANIMATION: ItemAnimation = resolveAnimation({
    idle: { roll: 0 },
    ready: { roll: 1, transition: { duration: 0.5, easing: "linear" } },
    action: {
        steps: [{ roll: 3, transition: { duration: 1, easing: "linear" }, hold: 0.5 }],
        out: { duration: 1, easing: "linear" },
        repeat: 2
    }
})

const ONCE: ItemAnimation = { ...ANIMATION, action: { ...ANIMATION.action, repeat: undefined } }


function run(animation: ItemAnimation, state: ItemState, ready: boolean, time: number): number
{
    advanceItem(animation, state, ready, time)
    return itemPose(animation, state, time, newPose()).roll
}


describe("EASINGS", function () {
    it("go from 0 to 1", function () {
        for (const easing of Object.values(EASINGS))
        {
            assert(near(easing(0), 0))
            assert(near(easing(1), 1))
        }
    })
})


describe("resolveAnimation", function () {

    it("fills in the defaults and writes the steps as differences to READY", function () {
        const animation = resolveAnimation({
            ready: { height: 0.7 },
            action: { steps: [{ roll: 2, transition: { duration: 0.1, easing: "linear" } }] }
        })
        const { ready, action } = animation
        assert(ready.height === 0.7)
        assert(ready.transition.duration > 0)
        assert(action.steps.length === 1)
        assert(action.steps[0].height === 0.7)
        assert(action.steps[0].roll === 2)
        assert(action.steps[0].hold === 0)
        assert(action.repeat === undefined)
    })

    it("keeps the default steps relative to the item's READY pose", function () {
        const { ready, action } = resolveAnimation({ ready: { angle: 1.1 } })
        assert(action.steps.length > 0)
        for (const step of action.steps)
        {
            assert(step.angle === ready.angle)
        }
    })

    it("clamps the height", function () {
        const { idle, ready } = resolveAnimation({ idle: { height: 0 }, ready: { height: 2 } })
        assert(idle.height === MIN_HEIGHT)
        assert(ready.height === MAX_HEIGHT)
    })
})


describe("blendPose", function () {

    it("turns the angle the short way around", function () {
        const a = { ...newPose(), angle: 3 }
        const b = { ...newPose(), angle: -3 }
        const half = blendPose(a, b, 0.5, newPose())
        assert(near(Math.cos(half.angle), -1))
        assert(near(blendPose(a, b, 1, newPose()).angle, 3 + Math.PI * 2 - 6))
    })

    it("keeps the roll as it is, so items can spin", function () {
        const a = { ...newPose(), roll: 0 }
        const b = { ...newPose(), roll: 5 }
        assert(near(blendPose(a, b, 0.5, newPose()).roll, 2.5))
    })

    it("clamps overshooting heights", function () {
        const a = { ...newPose(), height: 0.5 }
        const b = { ...newPose(), height: MAX_HEIGHT }
        assert(blendPose(a, b, 1.2, newPose()).height === MAX_HEIGHT)
    })
})


describe("advanceItem and itemPose", function () {

    it("readies the item and goes back to idle", function () {
        const state = newItemState()
        assert(run(ANIMATION, state, false, 1) === 0)
        assert(run(ANIMATION, state, true, 2) === 0)
        assert(near(run(ANIMATION, state, true, 2.25), 0.5))
        assert(run(ANIMATION, state, true, 3) === 1)
        assert(phase(state) === "ready")
        run(ANIMATION, state, false, 3)
        assert(near(run(ANIMATION, state, false, 3.25), 0.5))
        assert(run(ANIMATION, state, false, 4) === 0)
        assert(phase(state) === "idle")
    })

    it("readies the item before acting and plays the action once", function () {
        const state = newItemState()
        actItem(ONCE, state)
        run(ONCE, state, false, 0)
        assert(phase(state) === "readying")
        assert(run(ONCE, state, false, 0.5) === 1)
        assert(phase(state) === "action")
        assert(near(run(ONCE, state, false, 1), 2))
        // hold
        assert(run(ONCE, state, false, 1.75) === 3)
        assert(near(run(ONCE, state, false, 2.5), 2))
        // back at READY, then IDLE without the ready flag
        run(ONCE, state, false, 3)
        assert(phase(state) === "unreadying")
        assert(run(ONCE, state, false, 3.5) === 0)
        assert(phase(state) === "idle")
    })

    it("repeats the action after the delay while acting", function () {
        const state = newItemState()
        actItem(ANIMATION, state)
        run(ANIMATION, state, true, 0)
        // ready at 0.5, action until 3, waits until 5
        run(ANIMATION, state, true, 4)
        assert(phase(state) === "ready")
        // a long frame still keeps the rhythm: the second run started at 5
        assert(near(run(ANIMATION, state, true, 5.5), 2))
        assert(phase(state) === "action" && state.since === 5)
    })

    it("lets a running action finish when acting stops", function () {
        const state = newItemState()
        actItem(ANIMATION, state)
        run(ANIMATION, state, false, 0)
        run(ANIMATION, state, false, 1)
        stopActing(state)
        assert(run(ANIMATION, state, false, 1.5) === 3)
        assert(phase(state) === "action")
        run(ANIMATION, state, false, 0.5 + actionDuration(ANIMATION.action))
        assert(phase(state) === "unreadying")
    })

    it("plays the action again when acting again", function () {
        const state = newItemState()
        actItem(ONCE, state)
        run(ONCE, state, true, 0)
        run(ONCE, state, true, 10)
        assert(phase(state) === "ready")
        actItem(ONCE, state)
        run(ONCE, state, true, 11)
        assert(phase(state) === "action")
    })
})
