import { assert, describe, it } from "vitest"

import { brain, condition, leaf, selector, sequence, skilled, type Status, type Thinker, Tree } from "../../src/monster/behavior"

interface Bot extends Thinker
{
    log: string[]
    near: boolean
    /** frames the move takes */
    moveLeft: number
}

function bot(skill = 0): Bot
{
    return { brain: brain(), skill, log: [], near: false, moveLeft: 0 }
}

/** a leaf that logs its start, frames and stop, and runs while `keeps` says so */
function logging(name: string, keeps: (bot: Bot) => Status = () => "running", commits = false)
{
    return leaf<Bot, null>(name, {
        commits,
        start: bot =>
        {
            bot.log.push(`start ${name}`)
            return true
        },
        tick: bot =>
        {
            bot.log.push(name)
            return keeps(bot)
        },
        stop: bot =>
        {
            bot.log.push(`stop ${name}`)
        }
    })
}

describe("Tree", () => {
    it("runs the first branch that doesn't fail, and stops the one it leaves", () => {
        const tree = new Tree<Bot, null>(selector("root",
            sequence("fight", condition("near", bot => bot.near), logging("attack")),
            logging("wander")
        ))
        const it = bot()
        tree.tick(it, null)
        it.near = true
        tree.tick(it, null)
        tree.tick(it, null)
        assert.deepEqual(it.log, ["start wander", "wander", "start attack", "attack", "stop wander", "attack"])
        assert.deepEqual(tree.path(it), ["root", "fight", "attack"])
    })

    it("lets a committed leaf run to its end without going through the tree", () => {
        const swing = logging("swing", bot => --bot.moveLeft > 0 ? "running" : "success", true)
        const tree = new Tree<Bot, null>(selector("root",
            sequence("fight", condition("near", bot => bot.near), swing),
            logging("wander")
        ))
        const it = bot()
        it.near = true
        it.moveLeft = 3
        tree.tick(it, null)
        it.near = false
        tree.tick(it, null)
        tree.tick(it, null)
        assert.deepEqual(tree.path(it), [])
        tree.tick(it, null)
        assert.deepEqual(it.log, ["start swing", "swing", "swing", "swing", "start wander", "wander"])
    })

    it("stops what runs when interrupted", () => {
        const tree = new Tree<Bot, null>(logging("swing", () => "running", true))
        const it = bot()
        tree.tick(it, null)
        tree.interrupt(it)
        tree.tick(it, null)
        assert.deepEqual(it.log, ["start swing", "swing", "stop swing", "start swing", "swing"])
    })

    it("keeps branches for the skilled", () => {
        const tree = new Tree<Bot, null>(selector("root",
            sequence("trick", skilled(0.5), logging("feint")),
            logging("attack")
        ))
        const novice = bot(0.2), master = bot(0.8)
        tree.tick(novice, null)
        tree.tick(master, null)
        assert.deepEqual(tree.path(novice), ["root", "attack"])
        assert.deepEqual(tree.path(master), ["root", "trick", "feint"])
    })

    it("doesn't take a node twice", () => {
        const twice = logging("twice")
        assert.throws(() => new Tree<Bot, null>(selector("root", twice, twice)))
    })
})
