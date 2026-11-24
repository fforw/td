import { assert, describe, it } from "vitest"

import { SIGIL_ACTIVE, SIGIL_DRAW, SIGIL_FADE, SIGIL_STROKES, sigilPhase, strokeProgress } from "../../src/render/sigilShape"


describe("sigil", () => {
    it("draws its strokes one after the other, in two groups at once", () => {
        const groups = [SIGIL_STROKES.slice(0, 6), SIGIL_STROKES.slice(6)]
        for (const strokes of groups)
        {
            assert.equal(strokes[0].start, 0)
            assert.closeTo(strokes[strokes.length - 1].end, 1, 1e-9)
            for (let i = 1; i < strokes.length; i++)
            {
                assert.equal(strokes[i].start, strokes[i - 1].end)
            }
        }
    })

    it("starts with nothing and ends with all strokes", () => {
        for (const stroke of SIGIL_STROKES)
        {
            assert.equal(strokeProgress(stroke, 0), 0)
            assert.closeTo(strokeProgress(stroke, 1), 1, 1e-9)
        }
    })

    it("draws a closed star, each line from where the last one ended", () => {
        const lines = SIGIL_STROKES.filter(stroke => stroke.type === "line")
        assert.equal(lines.length, 5)
        lines.forEach((line, i) => {
            const next = lines[(i + 1) % lines.length]
            assert.closeTo(line.x1, next.x0, 1e-9)
            assert.closeTo(line.y1, next.y0, 1e-9)
        })
    })

    it("hurts only once drawn and not while it fades", () => {
        assert.isFalse(sigilPhase(SIGIL_DRAW - 0.01).hurts)
        assert.equal(sigilPhase(SIGIL_DRAW - 0.01).power, 0)
        assert.isTrue(sigilPhase(SIGIL_DRAW).hurts)
        assert.equal(sigilPhase(SIGIL_DRAW).power, 1)
        assert.equal(sigilPhase(SIGIL_DRAW).flash, 1)
        assert.isTrue(sigilPhase(SIGIL_DRAW + SIGIL_ACTIVE - 0.01).hurts)
        assert.equal(sigilPhase(SIGIL_DRAW + SIGIL_ACTIVE - 0.01).power, 1)
        assert.isFalse(sigilPhase(SIGIL_DRAW + SIGIL_ACTIVE + 0.01).hurts)
    })

    it("dissolves without hurting when broken off", () => {
        assert.isAbove(sigilPhase(0.5, SIGIL_FADE / 2).opacity, 0)
        assert.equal(sigilPhase(0.5, SIGIL_FADE).opacity, 0)
        assert.isFalse(sigilPhase(SIGIL_DRAW, 0).hurts)
    })

    it("is gone before and after its time", () => {
        assert.equal(sigilPhase(-0.1).opacity, 0)
        assert.equal(sigilPhase(SIGIL_DRAW + SIGIL_ACTIVE + SIGIL_FADE + 0.01).opacity, 0)
    })
})
