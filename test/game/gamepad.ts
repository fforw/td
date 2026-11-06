import { assert, describe, it } from "vitest"

import { glyphUrl, nextInDirection, PadTracker, type PadState, readPad, schemeOf } from "../../src/game/gamepad"


function pad(pressed: number[] = [], axes: number[] = [0, 0, 0, 0], id = "Xbox 360 Controller (XInput STANDARD GAMEPAD)"): PadState
{
    return {
        id,
        axes,
        buttons: Array.from({ length: 17 }, (_, i) => ({
            pressed: pressed.includes(i),
            touched: pressed.includes(i),
            value: pressed.includes(i) ? 1 : 0
        }))
    }
}


describe("Controller schemes", () => {

    it("go by the vendor in Chrome ids", () => {

        assert.equal(schemeOf("Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)"), "playstation")
        assert.equal(schemeOf("Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)"), "switch")
        assert.equal(schemeOf("Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)"), "xbox")
    })

    it("go by the vendor in Firefox ids, padded or not", () => {

        assert.equal(schemeOf("54c-ce6-Wireless Controller"), "playstation")
        assert.equal(schemeOf("054c-09cc-Wireless Controller"), "playstation")
        assert.equal(schemeOf("57e-2009-Pro Controller"), "switch")
        assert.equal(schemeOf("45e-b13-Xbox Wireless Controller"), "xbox")
    })

    it("tell the Steam Deck from other Valve hardware", () => {

        assert.equal(schemeOf("Steam Deck (STANDARD GAMEPAD Vendor: 28de Product: 1205)"), "steamdeck")
        assert.equal(schemeOf("28de-1205-Steam Deck"), "steamdeck")
        assert.equal(schemeOf("Steam Virtual Gamepad (STANDARD GAMEPAD Vendor: 28de Product: 11ff)"), "xbox")
    })

    it("go by the name without hardware ids", () => {

        assert.equal(schemeOf("DualSense Wireless Controller Extended Gamepad"), "playstation")
        assert.equal(schemeOf("Nintendo Switch Pro Controller"), "switch")
        assert.equal(schemeOf("Joy-Con (L)"), "switch")
    })

    it("fall back to Xbox", () => {

        assert.equal(schemeOf("8BitDo Pro 2 (STANDARD GAMEPAD Vendor: 2dc8 Product: 6006)"), "xbox")
        assert.equal(schemeOf("HORIPAD"), "xbox")
        assert.equal(schemeOf(""), "xbox")
    })

    it("have icons for all that the game shows", () => {

        assert.equal(glyphUrl("playstation", "confirm"), "media/input/playstation/playstation_button_cross.svg")
        assert.equal(glyphUrl("switch", "back"), "media/input/switch/switch_button_b.svg")
    })
})


describe("Reading a controller", () => {

    it("takes actions from the standard positions", () => {

        assert.deepEqual(readPad(pad([0])).actions, ["confirm"])
        assert.deepEqual(readPad(pad([1])).actions, ["back"])
        assert.deepEqual(readPad(pad([3])).actions, ["map"])
        assert.deepEqual(readPad(pad([2])).actions, ["endDay"])
        assert.deepEqual(readPad(pad([9])).actions, ["menu"])
    })

    it("confirms on the east for Nintendo", () => {

        const id = "Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)"
        assert.deepEqual(readPad(pad([1], undefined, id)).actions, ["confirm"])
        assert.deepEqual(readPad(pad([0], undefined, id)).actions, ["back"])
    })

    it("finds the direction on the d-pad and the left stick", () => {

        assert.equal(readPad(pad([12])).direction, "up")
        assert.equal(readPad(pad([15])).direction, "right")
        assert.equal(readPad(pad([], [-0.9, 0.2, 0, 0])).direction, "left")
        assert.equal(readPad(pad([], [0.2, 0.9, 0, 0])).direction, "down")
    })

    it("ignores sticks that rest off center", () => {

        const input = readPad(pad([], [0.1, -0.15, 0.1, -0.1]))
        assert.isNull(input.direction)
        assert.equal(input.lookX, 0)
        assert.equal(input.lookY, 0)
        assert.isFalse(input.active)
    })

    it("counts the right stick and the triggers as being used", () => {

        const look = readPad(pad([], [0, 0, 0.6, -0.4]))
        assert.equal(look.lookX, 0.6)
        assert.equal(look.lookY, -0.4)
        assert.isTrue(look.active)

        assert.equal(readPad(pad([7])).zoom, 1)
        assert.equal(readPad(pad([6])).zoom, -1)
        assert.isTrue(readPad(pad([6])).active)
    })
})


describe("Tracking a controller", () => {

    it("counts a held button once", () => {

        const tracker = new PadTracker()
        assert.deepEqual(tracker.update(readPad(pad([0])), 0).pressed, ["confirm"])
        assert.deepEqual(tracker.update(readPad(pad([0])), 16).pressed, [])
        assert.deepEqual(tracker.update(readPad(pad()), 32).pressed, [])
        assert.deepEqual(tracker.update(readPad(pad([0])), 48).pressed, ["confirm"])
    })

    it("repeats a held direction after a delay", () => {

        const tracker = new PadTracker()
        const held = readPad(pad([13]))
        assert.equal(tracker.update(held, 0).move, "down")
        assert.isNull(tracker.update(held, 349).move)
        assert.equal(tracker.update(held, 350).move, "down")
        assert.isNull(tracker.update(held, 499).move)
        assert.equal(tracker.update(held, 500).move, "down")
    })

    it("moves right away on another direction", () => {

        const tracker = new PadTracker()
        assert.equal(tracker.update(readPad(pad([13])), 0).move, "down")
        assert.equal(tracker.update(readPad(pad([15])), 16).move, "right")
        assert.isNull(tracker.update(readPad(pad()), 32).move)
    })
})


describe("Next in a direction", () => {

    const hud = { x: 100, y: 10 }
    const map = { x: 200, y: 10 }
    const low = { x: 110, y: 200 }
    const far = { x: 900, y: 20 }
    const all = [hud, map, low, far]

    it("takes the closest one that way", () => {

        assert.equal(nextInDirection(100, 10, "right", all), map)
        assert.equal(nextInDirection(100, 10, "down", all), low)
        assert.equal(nextInDirection(200, 10, "left", all), hud)
        assert.equal(nextInDirection(110, 200, "up", all), hud)
    })

    it("prefers staying in line over being close", () => {

        const beside = { x: 150, y: 100 }
        const ahead = { x: 300, y: 12 }
        assert.equal(nextInDirection(100, 10, "right", [beside, ahead]), ahead)
    })

    it("has nothing past the last one", () => {

        assert.isNull(nextInDirection(900, 20, "right", all))
        assert.isNull(nextInDirection(100, 10, "up", all))
    })

    it("doesn't go to where it is", () => {

        assert.isNull(nextInDirection(100, 10, "right", [hud]))
    })
})
