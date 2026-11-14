import { assert, describe, it } from "vitest"

import { SHOTS } from "../../src/scene/sceneCamera"
import ScenePlayer, { type SceneWorld, type Script } from "../../src/scene/script"
import SceneStage, { ACT_TIME, BLEND_TIME } from "../../src/scene/stage"

const WORLD: SceneWorld = {
    gold: () => 0,
    pay: () => {},
    use: () => {},
    fact: () => false,
    setFact: () => {},
    knows: () => false,
    learn: () => {}
}

const SCRIPT: Script = {
    left: "a",
    start: "open",
    beats: {
        open: { kind: "shot", shot: "two", next: "hi" },
        hi: { kind: "say", actor: "b", words: ["greeting"], next: "over" },
        over: { kind: "shot", shot: "overA", next: "shake" },
        shake: { kind: "act", actor: "b", clip: "shakeHead", next: "pick" },
        pick: { kind: "choice", options: [{ label: "Yes?", next: "end" }, { label: "No, I guess?", next: "end" }] },
        end: { kind: "say", actor: "a", words: ["farewell"] }
    }
}


describe("SceneStage", () => {

    it("cuts to the first shot and blends to the next", () => {
        let beats = 0
        const stage = new SceneStage(new ScenePlayer(SCRIPT, WORLD), () => beats++)
        assert.deepEqual(stage.shot, SHOTS.two)
        assert.equal(stage.beat?.kind, "say")
        assert.isTrue(stage.next())
        assert.equal(beats, 1)
        assert.equal(stage.beat?.kind, "shot")

        stage.update(BLEND_TIME / 2)
        assert.isAbove(stage.shot.angle, SHOTS.overA.angle)
        assert.isBelow(stage.shot.angle, SHOTS.two.angle)
        stage.update(BLEND_TIME / 2 + 0.01)
        for (const [key, value] of Object.entries(SHOTS.overA))
        {
            assert.closeTo(stage.shot[key as keyof typeof SHOTS.overA], value, 1e-9, key)
        }
        assert.equal(stage.beat?.kind, "act")
    })

    it("waits on acts by time and on the player for the rest", () => {
        const stage = new SceneStage(new ScenePlayer(SCRIPT, WORLD), () => {})
        stage.update(10)
        assert.equal(stage.beat?.kind, "say", "says until the player goes on")
        stage.next()
        stage.update(BLEND_TIME + 0.01)
        assert.isFalse(stage.next(), "an act can't be skipped")
        stage.update(ACT_TIME * 0.9)
        assert.equal(stage.beat?.kind, "act")
        stage.update(ACT_TIME * 0.2)
        assert.equal(stage.beat?.kind, "choice")
        assert.isFalse(stage.next())
        stage.choose(1)
        stage.next()
        assert.isTrue(stage.ended)
        assert.isNull(stage.beat)
    })
})
