import Prando from "prando"
import { assert, describe, it } from "vitest"

import CuboidPack, { BIG_CUBOID, SMALL_CUBOID } from "../../src/monster/cuboids"
import EyePack, {
    BLOCK_ANGLE,
    BOLT_SPEED,
    type Eye,
    FIRE_WAIT_MAX,
    FIRE_WAIT_MIN,
    FLYING_EYE,
    MIN_PERCH,
    placeEyes,
    WARN_TIME
} from "../../src/monster/eyes"
import Monsters, { HERO_RADIUS, HURT_WAIT, type MonsterFloor, type Prey } from "../../src/monster/monsters"

const FRAME = 1 / 60


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
    return { x, z, facing: 0, blocking: false, dodging: false, hurtWait: 0, ...changes }
}

/**
 * Runs frames, with the heroes getting hurt, and returns the hit points they lost
 */
function run(monsters: Monsters, seconds: number, heroes: Prey[]): number
{
    let lost = 0
    for (let t = 0; t < seconds; t += FRAME)
    {
        monsters.update(FRAME, heroes)
        for (const hero of heroes)
        {
            lost += monsters.hurt(hero, FRAME)
        }
    }
    return lost
}

/**
 * Runs frames until the given is true, for 10 seconds at most
 */
function runUntil(monsters: Monsters, heroes: Prey[], done: () => boolean): void
{
    for (let t = 0; t < 10 && !done(); t += FRAME)
    {
        monsters.update(FRAME, heroes)
    }
    assert(done())
}

function setup(sees?: (x0: number, z0: number, x1: number, z1: number) => boolean): [EyePack, Monsters]
{
    const floor = openFloor(sees)
    const eyes = new EyePack(floor)
    return [eyes, new Monsters([eyes], floor)]
}

/**
 * Returns an eye at the given spot that holds still and fires right away
 */
function sniper(eyes: EyePack, x: number, z: number): Eye
{
    const eye = eyes.add(FLYING_EYE, 0, x, z)
    eye.fireWait = 0
    eye.lookWait = 0
    eye.kind = { ...FLYING_EYE, speed: 0 }
    return eye
}


describe("Flying eyes", () => {

    describe("keeping away", () => {

        it("fly off from a hero close by", () => {

            const [eyes, monsters] = setup()
            const eye = eyes.add(FLYING_EYE, 0, 0.3, 0)
            run(monsters, 4, [prey(0, 0, { dodging: true })])
            assert.isAtLeast(Math.hypot(eye.x, eye.z), MIN_PERCH - 0.05)
        })

        it("come closer to a hero far off, but not too close", () => {

            const [eyes, monsters] = setup()
            const eye = eyes.add(FLYING_EYE, 0, 2.9, 0)
            run(monsters, 4, [prey(0, 0, { dodging: true })])
            assert(eye.chase > 0)
            assert.isAtLeast(Math.hypot(eye.x, eye.z), MIN_PERCH - 0.05)
            assert.isBelow(Math.hypot(eye.x, eye.z), 2.9)
        })

        it("only pick spots that see the hero", () => {

            // a wall along x = 0.5, nothing beyond it sees anything before it
            const sees = (x0: number, _z0: number, x1: number) => (x0 < 0.5) === (x1 < 0.5)
            const [eyes, monsters] = setup(sees)
            const eye = eyes.add(FLYING_EYE, 0, 0, 0.3)
            run(monsters, 4, [prey(0, 0, { dodging: true })])
            assert.isBelow(eye.x, 0.5)
        })

        it("are pushed aside by heroes and big monsters, but not by small ones", () => {

            const floor = openFloor()
            const eyes = new EyePack(floor)
            const cuboids = new CuboidPack(floor)
            const monsters = new Monsters([eyes, cuboids], floor)
            const overSmall = eyes.add(FLYING_EYE, 0, 5, 0)
            const small = cuboids.add(SMALL_CUBOID, 0, 5, 0.01)
            const overBig = eyes.add(FLYING_EYE, 0, -5, 0)
            const big = cuboids.add(BIG_CUBOID, 0, -5, 0.01)
            const overHero = eyes.add(FLYING_EYE, 0, 0, 0.01)
            const hero = prey(0, 0, { dodging: true })
            monsters.update(FRAME, [hero])
            assert.isBelow(Math.hypot(overSmall.x - small.x, overSmall.z - small.z), 0.02)
            assert.isAtLeast(Math.hypot(overBig.x - big.x, overBig.z - big.z), FLYING_EYE.radius + BIG_CUBOID.radius - 1e-6)
            assert.isAtLeast(Math.hypot(overHero.x, overHero.z), FLYING_EYE.radius + HERO_RADIUS - 1e-6)
            assert(hero.x === 0 && hero.z === 0)
        })
    })

    describe("firing", () => {

        it("shows it is coming before a bolt flies", () => {

            const [eyes, monsters] = setup()
            const eye = sniper(eyes, 0, 2)
            runUntil(monsters, [prey()], () => eye.warning > 0)
            assert(eyes.bolts.length === 0)
            runUntil(monsters, [prey()], () => eyes.bolts.length > 0)
            assert(eye.warning === 0)
        })

        it("goes at irregular intervals", () => {

            const [eyes, monsters] = setup()
            const eye = sniper(eyes, 0, 2)
            // dodging lets the bolts through, which go out at the end of their range
            const hero = prey(0, 0, { dodging: true })
            const shots: number[] = []
            let time = 0
            for (let count = 0; time < 60; time += FRAME)
            {
                monsters.update(FRAME, [hero])
                if (eyes.bolts.length > count)
                {
                    shots.push(time)
                }
                count = eyes.bolts.length
            }
            const gaps = shots.slice(1).map((shot, i) => shot - shots[i])
            assert.isAbove(gaps.length, 10)
            assert(gaps.every(gap => gap >= FIRE_WAIT_MIN + WARN_TIME - 0.1 && gap <= FIRE_WAIT_MAX + WARN_TIME + 0.3))
            assert.isAbove(Math.max(...gaps) - Math.min(...gaps), 0.5)
            assert(eye.hp === FLYING_EYE.hp)
        })

        it("doesn't happen without seeing anyone", () => {

            const [eyes, monsters] = setup(() => false)
            sniper(eyes, 0, 2)
            run(monsters, 5, [prey()])
            assert(eyes.bolts.length === 0)
        })

        it("is fast", () => {

            // a hero running at the walking speed of a multiplier of 1, see LevelScene
            assert.isAbove(BOLT_SPEED, 0.45 * 2.5 * 3)
        })
    })

    describe("bolts", () => {

        it("hurt who they hit, once", () => {

            const [eyes, monsters] = setup()
            sniper(eyes, 0, 2)
            const hero = prey()
            runUntil(monsters, [hero], () => eyes.bolts.length > 0)
            assert(run(monsters, 1, [hero]) === FLYING_EYE.damage)
            assert(hero.hurtWait > 0 && hero.hurtWait <= HURT_WAIT)
        })

        it("go past those dodging", () => {

            const [eyes, monsters] = setup()
            sniper(eyes, 0, 2)
            const hero = prey(0, 0, { dodging: true })
            runUntil(monsters, [hero], () => eyes.bolts.length > 0)
            run(monsters, 0.5, [hero])
            assert(eyes.bolts.length === 1)
            assert.isBelow(eyes.bolts[0].z, 0)
        })

        it("are stopped by a shield held their way, give or take quite a bit", () => {

            for (const facing of [0, BLOCK_ANGLE - 0.05, -BLOCK_ANGLE + 0.05])
            {
                const [eyes, monsters] = setup()
                sniper(eyes, 0, 2)
                const hero = prey(0, 0, { blocking: true, facing })
                runUntil(monsters, [hero], () => eyes.bolts.length > 0)
                assert(run(monsters, 1, [hero]) === 0)
                assert(eyes.bolts.length === 0)
            }
            assert.isAbove(BLOCK_ANGLE, Math.PI / 3)
        })

        it("aren't stopped by a shield held the wrong way", () => {

            const [eyes, monsters] = setup()
            sniper(eyes, 0, 2)
            const hero = prey(0, 0, { blocking: true, facing: Math.PI })
            runUntil(monsters, [hero], () => eyes.bolts.length > 0)
            assert(run(monsters, 1, [hero]) === FLYING_EYE.damage)
        })

        it("go out at walls", () => {

            let seen = true
            const [eyes, monsters] = setup(() => seen)
            sniper(eyes, 0, 2)
            runUntil(monsters, [prey()], () => eyes.bolts.length > 0)
            seen = false
            assert(run(monsters, FRAME, [prey()]) === 0)
            assert(eyes.bolts.length === 0)
            assert(eyes.sparks.length === 1)
        })
    })

    describe("striking", () => {

        it("knocks one back and puts it off its shot", () => {

            const [eyes, monsters] = setup()
            const eye = eyes.add(FLYING_EYE, 0, 0, 0.4)
            eye.warning = WARN_TIME
            assert(monsters.strike(0, 0, 0, 0.55, 2.2, 1) === 1)
            assert(eye.warning === 0)
            assert(eye.flash > 0)
            assert.isAbove(eye.vz, 0)
        })

        it("kills one with enough blows", () => {

            const [eyes, monsters] = setup()
            eyes.add(FLYING_EYE, 0, 0, 0.4)
            monsters.strike(0, 0, 0, 0.55, 2.2, FLYING_EYE.hp)
            assert(eyes.members.length === 0)
            assert(!monsters.sees(prey()))
        })
    })

    describe("placing", () => {

        const rooms = Array.from({ length: 50 }, (_, i) => [i * 3 + 1, i * 3 + 2, i * 3 + 3])

        it("leaves the room the heroes come in by alone", () => {

            for (let seed = 0; seed < 20; seed++)
            {
                const placed = placeEyes(rooms, new Prando(seed))
                assert(placed.every(({ face }) => face > 3))
            }
        })

        it("is the same for the same seed", () => {

            assert.deepEqual(placeEyes(rooms, new Prando(7)), placeEyes(rooms, new Prando(7)))
        })
    })
})
