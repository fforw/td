import { assert, describe, it } from "vitest"

import { type AtlasFrame, spritesOf } from "../../src/render/mapAtlas"


function frame(x: number): AtlasFrame
{
    return { x, y: 0, w: 1, h: 1, pivotX: 0.5, pivotY: 1 }
}


describe("mapAtlas", function () {

    it("groups variants by sprite name", function () {
        const a = frame(0), b = frame(1), c = frame(2), d = frame(3)
        const sprites = spritesOf({ "tree-1": a, "tree-2": b, "old-tree-1": c, castle: d })
        assert.deepEqual([...sprites.keys()], ["tree", "old-tree", "castle"])
        assert.deepEqual(sprites.get("tree"), [a, b])
        assert.deepEqual(sprites.get("old-tree"), [c])
        assert.deepEqual(sprites.get("castle"), [d])
    })
})
