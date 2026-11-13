import { assert, describe, it } from "vitest"
import { MeshStandardMaterial } from "three"
import { applyWallCut, createWallCut, CUT_FADE, updateWallCut } from "../../src/render/wallCut"


describe("updateWallCut", () => {

    it("cuts the walls of a space over the fade time", () => {

        const cut = createWallCut()
        updateWallCut(cut, [7], CUT_FADE / 2)
        assert.equal(cut.uniforms.openSpaces.value.x, 7)
        assert.closeTo(cut.uniforms.openAmounts.value.x, 0.5, 1e-9)

        updateWallCut(cut, [7], CUT_FADE)
        assert.equal(cut.uniforms.openAmounts.value.x, 1)
    })

    it("turns them solid again while the next ones get cut", () => {

        const cut = createWallCut()
        updateWallCut(cut, [7], CUT_FADE)
        updateWallCut(cut, [8], CUT_FADE / 4)
        assert.deepEqual(cut.uniforms.openSpaces.value.toArray(), [7, 8, -1, -1])
        assert.deepEqual(cut.uniforms.openAmounts.value.toArray(), [0.75, 0.25, 0, 0])

        updateWallCut(cut, [8], CUT_FADE)
        assert.deepEqual(cut.uniforms.openSpaces.value.toArray(), [-1, 8, -1, -1])
        assert.deepEqual(cut.uniforms.openAmounts.value.toArray(), [0, 1, 0, 0])
    })

    it("goes on from where it is for a space that comes back", () => {

        const cut = createWallCut()
        updateWallCut(cut, [7], CUT_FADE)
        updateWallCut(cut, [], CUT_FADE / 2)
        updateWallCut(cut, [7], CUT_FADE / 4)
        assert.deepEqual(cut.uniforms.openSpaces.value.toArray(), [7, -1, -1, -1])
        assert.closeTo(cut.uniforms.openAmounts.value.x, 0.75, 1e-9)
    })

    it("gives up the space that is cut the least when there are too many", () => {

        const cut = createWallCut()
        updateWallCut(cut, [1, 2, 3, 4], CUT_FADE)
        assert.deepEqual(cut.uniforms.openSpaces.value.toArray(), [1, 2, 3, 4])

        updateWallCut(cut, [2, 3, 4], CUT_FADE / 2)
        updateWallCut(cut, [2, 3, 4, 5], CUT_FADE / 4)
        assert.deepEqual(cut.uniforms.openSpaces.value.toArray(), [5, 2, 3, 4])
        assert.deepEqual(cut.uniforms.openAmounts.value.toArray(), [0.25, 1, 1, 1])
    })
})


describe("applyWallCut", () => {

    it("makes only the glass side see-through, and keeps the two apart", () => {

        const cut = createWallCut()
        const solid = new MeshStandardMaterial()
        const glass = new MeshStandardMaterial()
        applyWallCut(solid, cut, false)
        applyWallCut(glass, cut, true)

        assert.isFalse(solid.transparent)
        assert.isTrue(solid.depthWrite)
        assert.isTrue(glass.transparent)
        assert.isFalse(glass.depthWrite)
        assert.notEqual(solid.customProgramCacheKey(), glass.customProgramCacheKey())
    })
})
