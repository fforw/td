import { assert, describe, it } from "vitest"

import ScenePlayer, { checkScript, type SceneWorld, type Script, type Ware } from "../../src/scene/script"
import { PRICES, traderScript } from "../../src/scene/trader"


class TestWorld implements SceneWorld
{
    used: Ware[] = []
    facts = new Set<string>()
    learned = new Set<string>()

    constructor(public carried: number)
    {
    }

    gold(): number
    {
        return this.carried
    }

    pay(gold: number): void
    {
        this.carried -= gold
    }

    use(ware: Ware): void
    {
        this.used.push(ware)
    }

    fact(name: string): boolean
    {
        return this.facts.has(name)
    }

    setFact(name: string): void
    {
        this.facts.add(name)
    }

    knows(concept: string): boolean
    {
        return this.learned.has(concept)
    }

    learn(concept: string): void
    {
        this.learned.add(concept)
    }
}

/**
 * Plays a scene through, answering each choice with the given option
 *
 * @return the kinds of beats it waited on
 */
function playThrough(player: ScenePlayer, answers: number[]): string[]
{
    const waited: string[] = []
    while (!player.ended)
    {
        const beat = player.beat!
        waited.push(beat.kind)
        if (beat.kind === "choice")
        {
            player.choose(answers.shift()!)
        }
        else
        {
            player.done()
        }
    }
    return waited
}


describe("ScenePlayer", () => {

    it("waits on beats that take time and runs the others at once", () => {
        const script: Script<"look" | "know" | "mark" | "hi"> = {
            left: "a",
            start: "look",
            beats: {
                look: { kind: "shot", shot: "two", next: "know" },
                know: { kind: "check", condition: { fact: "met" }, then: "hi", else: "mark" },
                mark: { kind: "set", fact: "met", next: "hi" },
                hi: { kind: "say", actor: "b", words: ["greeting"] }
            }
        }
        const world = new TestWorld(0)
        const player = new ScenePlayer(script, world)
        assert.equal(player.beat?.kind, "shot")
        player.done()
        assert.equal(player.beat?.kind, "say")
        assert.isTrue(world.fact("met"))
        player.done()
        assert.isTrue(player.ended)
        assert.isNull(player.beat)
    })

    it("refuses to finish a choice or choose without one", () => {
        const player = new ScenePlayer({
            left: "a",
            start: "pick",
            beats: { pick: { kind: "choice", options: [{ label: "Yes?", next: "end" }] }, end: { kind: "shot", shot: "two" } }
        }, new TestWorld(0))
        assert.throws(() => player.done())
        assert.throws(() => player.choose(1))
        player.choose(0)
        assert.throws(() => player.choose(0))
    })

    it("stops a script that loops without waiting", () => {
        const script: Script = {
            left: "a",
            start: "x",
            beats: { x: { kind: "set", fact: "f", next: "y" }, y: { kind: "check", condition: { fact: "f" }, then: "x", else: "x" } }
        }
        assert.throws(() => new ScenePlayer(script, new TestWorld(0)), /loops/)
    })
})


describe("traderScript", () => {

    it("links every beat", () => {
        assert.deepEqual(checkScript(traderScript(["healing", "speed", "strength", "map"])), { unreachable: [], missing: [] })
        assert.deepEqual(checkScript(traderScript([])), { unreachable: [], missing: [] })
    })

    it("ends at once when the hero doesn't want to trade", () => {
        const world = new TestWorld(100)
        const waited = playThrough(new ScenePlayer(traderScript(["healing"]), world), [1])
        assert.deepEqual(waited, ["shot", "choice"])
        assert.equal(world.carried, 100)
    })

    it("sells what the hero can pay for until they leave, and teaches what it is", () => {
        const world = new TestWorld(PRICES.healing + PRICES.map)
        const player = new ScenePlayer(traderScript(["healing", "strength", "map"]), world)
        player.done()
        player.choose(0)
        player.done()
        assert.equal(player.beat?.kind, "trade")

        assert.isTrue(player.buy(2))
        assert.isTrue(player.sold(2))
        assert.isFalse(player.buy(2), "a map is sold once")
        assert.isFalse(player.affords(1))
        assert.isFalse(player.buy(1))
        assert.isTrue(player.buy(0))
        assert.deepEqual(world.used, ["map", "healing"])
        assert.deepEqual([...world.learned], ["map", "healing"])
        assert.isTrue(player.knows("healing"))
        assert.isFalse(player.knows("strength"))
        assert.equal(world.carried, 0)

        player.done()
        assert.isTrue(player.ended)
    })
})
