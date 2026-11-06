import { assert, describe, it } from "vitest"

import { parseOptions } from "../../src/game/options"


describe("Options", () => {

    it("start from the defaults", () => {

        assert.deepEqual(parseOptions(null), { waddle: false })
    })

    it("keep what was set", () => {

        assert.deepEqual(parseOptions('{"waddle":true}'), { waddle: true })
    })

    it("fill in what older ones don't have", () => {

        assert.deepEqual(parseOptions("{}"), { waddle: false })
    })

    it("ignore what can't be read", () => {

        assert.deepEqual(parseOptions("{nope"), { waddle: false })
    })
})
