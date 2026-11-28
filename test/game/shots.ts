import { assert, describe, it } from "vitest"

import { GEAR_USES } from "../../src/game/gear"
import Shots, { FALL_AFTER, FALL_TIME, RECALL_TIME, type ShotFloor, type ShotTargets } from "../../src/game/shots"
import type { Monster, Shot } from "../../src/monster/monsters"
import { resetRandom } from "../../src/math/random"

const FRAME = 1 / 60

/**
 * Wall along x = WALL, the room is everything left of ROOM_END, which counts as face 0, a corridor after it as face 1
 */
const WALL = 10
const ROOM_END = 4

const floor: ShotFloor = {
    sees: (x0, _z0, x1) => (x0 < WALL) === (x1 < WALL),
    move: (spot, dx, dz) => {
        spot.x += dx
        spot.z += dz
        spot.face = spot.x < ROOM_END ? 0 : 1
    },
    spaceOf: face => face
}

const DAGGER = { kind: "dagger", count: 1 } as const
const WAND = { kind: "wand", element: "frost", count: 1 } as const


function monsterAt(x: number, hp = 10): Monster
{
    return { x, z: 0, hp, kind: { radius: 0.2 } } as Monster
}


/**
 * Monsters on the line z = 0 that take what hits them
 */
function targets(monsters: Monster[], stopped = false): ShotTargets
{
    return {
        shoot(x0, _z0, x1, _z1, radius, _fromX, _fromZ, damage): Shot | null
        {
            const monster = monsters.find(({ x, kind }) => Math.min(x0, x1) - radius - kind.radius <= x && x <= Math.max(x0, x1) + radius + kind.radius)
            if (!monster)
            {
                return null
            }
            if (!stopped)
            {
                monster.hp -= damage
            }
            const killed = monster.hp <= 0
            if (killed)
            {
                monsters.splice(monsters.indexOf(monster), 1)
            }
            return { monster, x: monster.x, z: 0, material: "flesh", stopped, killed }
        },
        has: monster => monsters.includes(monster)
    }
}


function run(shots: Shots, seconds: number, monsters: ShotTargets): void
{
    for (let t = 0; t < seconds; t += FRAME)
    {
        shots.update(FRAME, monsters)
    }
}


describe("Shots", () => {
    it("drops a weapon at a wall", () => {
        const shots = new Shots(floor)
        shots.launch(1, DAGGER, { face: 1, x: 8, z: 0 }, 1, 0)
        run(shots, 1, targets([]))
        assert.lengthOf(shots.flying, 0)
        assert.lengthOf(shots.lying, 1)
        assert.isBelow(shots.lying[0].x, WALL)
        assert.isAbove(shots.lying[0].x, WALL - 0.2)
    })

    it("drops a weapon a little after it left the room it was thrown in", () => {
        const shots = new Shots(floor)
        shots.launch(1, DAGGER, { face: 0, x: 0, z: 0 }, 1, 0)
        run(shots, 2, targets([]))
        const [{ x }] = shots.lying
        assert.isAtLeast(x, ROOM_END + FALL_AFTER)
        assert.isBelow(x, ROOM_END + FALL_AFTER + GEAR_USES.dagger.speed * FRAME * 2)
    })

    it("drops a weapon at the end of its range without a room", () => {
        const shots = new Shots({ ...floor, spaceOf: () => -1, sees: () => true })
        shots.launch(1, DAGGER, { face: 0, x: 0, z: 0 }, 0, 1)
        run(shots, 2, targets([]))
        assert.closeTo(shots.lying[0].z, GEAR_USES.dagger.range, 1e-9)
    })

    it("has weapons that hit stick in the monster half of the time, until it dies", () => {
        resetRandom(7)
        let stuck = 0
        for (let tries = 0; tries < 100; tries++)
        {
            const shots = new Shots(floor)
            const monsters = [monsterAt(2)]
            shots.launch(1, DAGGER, { face: 0, x: 0, z: 0 }, 1, 0)
            run(shots, 0.5, targets(monsters))
            assert.strictEqual(shots.outOf(1, "dagger"), 1)
            if (shots.stuck.length > 0)
            {
                stuck++
                monsters.length = 0
                run(shots, 0.1, targets(monsters))
                assert.lengthOf(shots.stuck, 0)
                assert.strictEqual(shots.lying[0].x, 2)
            }
        }
        assert.isAbove(stuck, 30)
        assert.isBelow(stuck, 70)
    })

    it("never has a weapon stick in a shield or a monster it killed", () => {
        for (const [hp, stopped] of [[1, false], [10, true]] as const)
        {
            for (let tries = 0; tries < 20; tries++)
            {
                const shots = new Shots(floor)
                shots.launch(1, DAGGER, { face: 0, x: 0, z: 0 }, 1, 0)
                run(shots, 0.5, targets([monsterAt(2, hp)], stopped))
                assert.lengthOf(shots.stuck, 0)
                assert.lengthOf(shots.lying, 1)
            }
        }
    })

    it("only lets the one who threw it pick it up, once it landed", () => {
        const shots = new Shots(floor)
        shots.launch(1, DAGGER, { face: 1, x: 9.9, z: 0 }, 1, 0)
        shots.update(FRAME, targets([]))
        const [{ x }] = shots.lying
        assert.deepEqual(shots.pickUp(1, x, 0), [])
        run(shots, FALL_TIME, targets([]))
        assert.deepEqual(shots.pickUp(2, x, 0), [])
        assert.deepEqual(shots.pickUp(1, x, 0), ["dagger"])
        assert.strictEqual(shots.outOf(1, "dagger"), 0)
    })

    it("gives a hero back what of theirs lay on the floor a while, but not what is in a monster", () => {
        const shots = new Shots(floor)
        shots.launch(1, DAGGER, { face: 1, x: 9.9, z: 0 }, 1, 0)
        shots.launch(2, DAGGER, { face: 1, x: 9.9, z: 0 }, 1, 0)
        shots.update(FRAME, targets([]))
        run(shots, RECALL_TIME - 2 * FRAME, targets([]))
        assert.deepEqual(shots.recall(1), [])
        run(shots, 2 * FRAME, targets([]))
        assert.deepEqual(shots.recall(1), ["dagger"])
        assert.strictEqual(shots.outOf(1, "dagger"), 0)
        assert.strictEqual(shots.outOf(2, "dagger"), 1)

        shots.stuck.push({ kind: "axe", owner: 1, monster: monsterAt(2), side: 0 })
        assert.deepEqual(shots.recall(1), [])
        assert.strictEqual(shots.outOf(1, "axe"), 1)
    })

    it("bursts balls on what they hit, without anything left", () => {
        const shots = new Shots(floor)
        const monster = monsterAt(2)
        shots.launch(1, WAND, { face: 0, x: 0, z: 0 }, 1, 0)
        run(shots, 0.5, targets([monster]))
        assert.strictEqual(monster.hp, 10 - GEAR_USES.wand.damage)
        assert.lengthOf(shots.flying, 0)
        assert.lengthOf(shots.lying, 0)
        assert.lengthOf(shots.stuck, 0)
    })

    it("loses what a hero leaves behind", () => {
        const shots = new Shots(floor)
        shots.launch(1, DAGGER, { face: 0, x: 0, z: 0 }, 1, 0)
        shots.launch(1, { kind: "axe", count: 1 }, { face: 0, x: 0, z: 0 }, -1, 0)
        shots.launch(2, DAGGER, { face: 0, x: 0, z: 0 }, 1, 0)
        run(shots, 0.1, targets([]))
        assert.deepEqual([...shots.lose(1)].sort(), [["axe", 1], ["dagger", 1]])
        assert.strictEqual(shots.outOf(2, "dagger"), 1)
    })
})
