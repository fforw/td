import { readFileSync } from "node:fs"
import { assert, describe, it } from "vitest"

import { type AtlasFrame, spritesOf } from "../../src/render/mapAtlas"
import { SEPIA } from "../../src/render/mapPalette"


const { width, height, frames } = JSON.parse(readFileSync("public/media/map/atlas.json", "utf-8")) as {
    width: number
    height: number
    frames: Record<string, AtlasFrame>
}


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

    it("has all sprites of the palette", function () {
        const sprites = spritesOf(frames)
        SEPIA.symbols.forEach(({ sprite }) => assert.ok(sprites.has(sprite), sprite))
    })

    it("keeps frames apart and inside of the image", function () {
        const all = Object.values(frames)
        for (let i = 0; i < all.length; i++)
        {
            const a = all[i]
            assert.ok(a.x >= 1 && a.y >= 1 && a.x + a.w < width && a.y + a.h < height)
            for (let j = i + 1; j < all.length; j++)
            {
                const b = all[j]
                assert.ok(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y)
            }
        }
    })
})
