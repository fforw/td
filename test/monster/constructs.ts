import { assert, describe, it } from "vitest"

import ConstructPack, { type Construct, CONSTRUCT, MAX_ZIP_SPEED, MIN_BEHIND, ZIP_TIME, zipDuration, zipEase } from "../../src/monster/constructs"
import EyePack, { FLYING_EYE } from "../../src/monster/eyes"
import Monsters, { type MonsterFloor, NOTICE_DISTANCE, type Prey } from "../../src/monster/monsters"

const FRAME = 1 / 60

const SWORD_DAMAGE = 2

/**
 * Seconds of a zip from 1.5 in front of a hero
 */
const LONG = zipDuration(3)


function openFloor(sees = (_x0: number, _z0: number, _x1: number, _z1: number) => true): MonsterFloor
{
    return {
        move(monster, dx, dz)
        {
            monster.x += dx
            monster.z += dz
        },
        sees
    }
}

function prey(x = 0, z = 0, changes: Partial<Prey> = {}): Prey
{
    return { x, z, facing: 0, blocking: false, dodging: false, hurtWait: 0, vx: 0, vz: 0, shoveX: 0, shoveZ: 0, ...changes }
}

/**
 * Runs frames, with the heroes getting hurt, and returns the hit points they lost
 */
function run(monsters: Monsters, seconds: number, heroes: Prey[], each?: () => void): number
{
    let lost = 0
    for (let t = 0; t < seconds; t += FRAME)
    {
        monsters.update(FRAME, heroes)
        for (const hero of heroes)
        {
            lost += monsters.hurt(hero, FRAME)
        }
        each?.()
    }
    return lost
}

function setup(sees?: (x0: number, z0: number, x1: number, z1: number) => boolean): [ConstructPack, Monsters]
{
    const floor = openFloor(sees)
    const constructs = new ConstructPack(floor)
    return [constructs, new Monsters([constructs], floor)]
}

/**
 * Returns a construct at the given spot that looks around right away
 */
function ready(constructs: ConstructPack, x: number, z: number): Construct
{
    const construct = constructs.add(CONSTRUCT, 0, x, z)
    construct.wait = 0
    construct.lookWait = 0
    return construct
}


describe("Constructs", () => {

    it("go down in two sword blows", () => {

        const [constructs, monsters] = setup()
        ready(constructs, 0, 0.2)
        monsters.strike(0, 0, 0, 0.55, 2.2, SWORD_DAMAGE)
        assert.equal(constructs.members.length, 1)
        monsters.strike(0, 0, 0, 0.55, 2.2, SWORD_DAMAGE)
        assert.equal(constructs.members.length, 0)
    })

    it("fly straight from point to point while nobody is around", () => {

        const [constructs, monsters] = setup()
        const construct = ready(constructs, 0, 0)
        let moved = 0
        run(monsters, 10, [], () => {
            if (construct.going)
            {
                // on the line to where it goes
                const dx = construct.destX - construct.x, dz = construct.destZ - construct.z
                moved = Math.max(moved, Math.hypot(construct.x, construct.z))
                assert(Math.hypot(dx, dz) < 2)
            }
        })
        assert.isAbove(moved, 0.1)
        assert(!construct.zipping)
    })

    it("zip through a hero they see to as far behind them", () => {

        const [constructs, monsters] = setup()
        const construct = ready(constructs, 0, 1.5)
        const hero = prey()
        monsters.update(FRAME, [hero])
        assert(construct.zipping)
        assert.closeTo(construct.toX, 0, 1e-9)
        assert.closeTo(construct.toZ, -1.5, 1e-9)
    })

    it("know when they pass through the hero", () => {

        const [constructs, monsters] = setup()
        const construct = ready(constructs, 0, 1.5)
        const hero = prey()
        monsters.update(FRAME, [hero])
        assert.isAbove(construct.passTime, construct.zipDuration * 0.8)
        run(monsters, construct.passTime - construct.zipTime, [prey(5, 5)])
        assert(construct.zipping)
        assert.closeTo(construct.z, 0, 0.1)
    })

    it("creep at first and pass the hero late in the zip", () => {

        assert.isBelow(zipEase(0.5), 0.05)
        assert.closeTo(zipEase(Math.pow(0.5, 1 / 5)), 0.5, 1e-9)
        // time enough to step out of the way
        assert.isAbove(Math.pow(0.5, 1 / 5) * ZIP_TIME, 0.8)
    })

    it("take longer for long zips, so they don't get too fast", () => {

        assert.equal(zipDuration(0.5), ZIP_TIME)
        for (const length of [1, 3, 2 * NOTICE_DISTANCE])
        {
            // fastest at the end
            const duration = zipDuration(length)
            const end = (1 - zipEase(1 - FRAME / duration)) * length / FRAME
            assert.isAtMost(end, MAX_ZIP_SPEED)
        }
        assert.isAbove(zipDuration(2 * NOTICE_DISTANCE), ZIP_TIME)
    })

    it("go at least a bit behind a hero close by", () => {

        const [constructs, monsters] = setup()
        const construct = ready(constructs, 0, 0.2)
        monsters.update(FRAME, [prey()])
        assert(construct.zipping)
        assert.closeTo(construct.toZ, -MIN_BEHIND, 1e-9)
    })

    it("stop short of a wall behind the hero", () => {

        // a wall at z = -1
        const [constructs, monsters] = setup((_x0, z0, _x1, z1) => Math.min(z0, z1) > -1)
        const construct = ready(constructs, 0, 2)
        monsters.update(FRAME, [prey()])
        assert(construct.zipping)
        assert.isAbove(construct.toZ, -1)
        assert.isAtMost(construct.toZ, -MIN_BEHIND)
    })

    it("don't zip without room behind the hero", () => {

        const [constructs, monsters] = setup((_x0, z0, _x1, z1) => Math.min(z0, z1) > -0.1)
        const construct = ready(constructs, 0, 2)
        monsters.update(FRAME, [prey()])
        assert(!construct.zipping)
    })

    it("hurt the one they zip through, and pass them", () => {

        const [constructs, monsters] = setup()
        const construct = ready(constructs, 0, 1.5)
        const hero = prey()
        assert.equal(run(monsters, LONG + 0.1, [hero]), CONSTRUCT.damage)
        assert.isBelow(construct.z, -1.4)
        // not carried along
        assert.closeTo(hero.z, 0, 1e-9)
    })

    it("don't hurt anyone touching them while not zipping", () => {

        const [constructs, monsters] = setup()
        const construct = ready(constructs, 0, 0.1)
        // holding still, as after a zip
        construct.wait = 10
        assert.equal(run(monsters, 2, [prey(0, 0.05)]), 0)
    })

    it("miss a hero who stepped aside", () => {

        const [constructs, monsters] = setup()
        ready(constructs, 0, 1.5)
        const hero = prey()
        monsters.update(FRAME, [hero])
        hero.x = 0.5
        assert.equal(run(monsters, LONG, [hero]), 0)
    })

    it("pass those dodging", () => {

        const [constructs, monsters] = setup()
        const construct = ready(constructs, 0, 1.5)
        const hero = prey(0, 0, { dodging: true })
        assert.equal(run(monsters, LONG + 0.1, [hero]), 0)
        assert.isBelow(construct.z, -1.4)
    })

    it("are thrown back by a shield held their way", () => {

        const [constructs, monsters] = setup()
        const construct = ready(constructs, 0, 1.5)
        const hero = prey(0, 0, { blocking: true })
        assert.equal(run(monsters, LONG + 0.1, [hero]), 0)
        assert(!construct.zipping)
        assert.isAbove(construct.z, 0)
    })

    it("aren't stopped by a shield held the wrong way", () => {

        const [constructs, monsters] = setup()
        ready(constructs, 0, 1.5)
        const hero = prey(0, 0, { blocking: true, facing: Math.PI })
        assert.equal(run(monsters, LONG + 0.1, [hero]), CONSTRUCT.damage)
    })

    it("go through other monsters while zipping", () => {

        const floor = openFloor()
        const constructs = new ConstructPack(floor)
        const eyes = new EyePack(floor)
        const monsters = new Monsters([constructs, eyes], floor)
        const construct = ready(constructs, 0, 1.5)
        const eye = eyes.add({ ...FLYING_EYE, speed: 0 }, 0, 0, 0.75)
        const hero = prey(0, 0, { dodging: true })
        run(monsters, LONG + 0.1, [hero])
        assert.isBelow(construct.z, -1.4)
        assert.closeTo(eye.z, 0.75, 1e-9)
    })

    it("stop zipping when struck", () => {

        const [constructs, monsters] = setup()
        const construct = ready(constructs, 0, 0.3)
        monsters.update(FRAME, [prey(0, 0, { dodging: true })])
        assert(construct.zipping)
        monsters.strike(0, 0, 0, 0.55, 2.2, SWORD_DAMAGE)
        assert(!construct.zipping)
        assert(!construct.passing)
    })

    it("notice heroes as far as other monsters", () => {

        const [constructs, monsters] = setup()
        const construct = ready(constructs, 0, NOTICE_DISTANCE + 0.1)
        monsters.update(FRAME, [prey()])
        assert(!construct.zipping)
    })
})
