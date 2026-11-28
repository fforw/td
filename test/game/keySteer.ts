import { assert, describe, it } from "vitest"

import KeySteer, { keyAction, keyPick } from "../../src/game/keySteer"


describe("KeySteer", () => {

    it("goes where the keys say", () => {

        const keys = new KeySteer()
        assert.deepInclude(keys.input(), { moveX: 0, moveY: 0 })

        assert(keys.keyDown("KeyW"))
        assert.deepInclude(keys.input(), { moveX: 0, moveY: -1 })

        keys.keyUp("KeyW")
        keys.keyDown("KeyD")
        assert.deepInclude(keys.input(), { moveX: 1, moveY: 0 })
    })

    it("is as fast diagonally as straight, like a stick pushed all the way", () => {

        const keys = new KeySteer()
        keys.keyDown("KeyS")
        keys.keyDown("KeyA")
        const { moveX, moveY } = keys.input()
        assert.closeTo(Math.hypot(moveX, moveY), 1, 1e-9)
        assert.closeTo(moveX, -Math.SQRT1_2, 1e-9)
        assert.closeTo(moveY, Math.SQRT1_2, 1e-9)
    })

    it("stands still with opposite keys", () => {

        const keys = new KeySteer()
        keys.keyDown("KeyA")
        keys.keyDown("KeyD")
        assert.deepInclude(keys.input(), { moveX: 0, moveY: 0 })

        keys.keyDown("KeyW")
        assert.deepInclude(keys.input(), { moveX: 0, moveY: -1 })
    })

    it("leaves other keys alone", () => {

        const keys = new KeySteer()
        assert(!keys.keyDown("KeyP"))
        assert(!keys.keyDown("Escape"))
        assert.deepInclude(keys.input(), { moveX: 0, moveY: 0, dash: false })
    })

    it("uses gear while Q is held, and picks it with Z and C", () => {

        const keys = new KeySteer()
        assert(keys.keyDown("KeyQ"))
        assert(keys.input().use)
        keys.keyUp("KeyQ")
        assert(!keys.input().use)
        assert.strictEqual(keyPick("KeyZ"), -1)
        assert.strictEqual(keyPick("KeyC"), 1)
        assert.strictEqual(keyPick("KeyQ"), 0)
    })

    it("dashes on space or shift", () => {

        const keys = new KeySteer()
        assert(keys.keyDown("Space"))
        assert(keys.input().dash)
        keys.keyUp("Space")
        assert(!keys.input().dash)
        keys.keyDown("ShiftLeft")
        assert(keys.input().dash)
    })

    it("attacks and blocks with the mouse buttons", () => {

        const keys = new KeySteer()
        keys.button(0, true)
        assert.deepInclude(keys.input(), { attack: true, block: false })
        keys.button(2, true)
        keys.button(0, false)
        assert.deepInclude(keys.input(), { attack: false, block: true })
        // the wheel button does nothing
        keys.button(2, false)
        keys.button(1, true)
        assert.deepInclude(keys.input(), { attack: false, block: false })
    })

    it("knows where the pointer is once it was told", () => {

        const keys = new KeySteer()
        assert.deepInclude(keys.input(), { pointerX: null, pointerY: null })
        keys.point(120, 80)
        assert.deepInclude(keys.input(), { pointerX: 120, pointerY: 80 })
    })

    it("lets go of everything but the pointer", () => {

        const keys = new KeySteer()
        keys.keyDown("KeyW")
        keys.keyDown("Space")
        keys.button(0, true)
        keys.point(5, 6)
        keys.release()
        assert.deepEqual(keys.input(), {
            moveX: 0,
            moveY: 0,
            dash: false,
            attack: false,
            block: false,
            use: false,
            pointerX: 5,
            pointerY: 6
        })
    })

    it("has keys for what the buttons of a controller do", () => {

        assert.equal(keyAction("KeyE"), "confirm")
        assert.equal(keyAction("KeyF"), "endDay")
        assert.equal(keyAction("KeyM"), "map")
        assert.isNull(keyAction("KeyW"))
    })
})
