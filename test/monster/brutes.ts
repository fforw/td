import Prando from "prando"
import { assert, describe, it } from "vitest"

import BrutePack, { AIM_TIME, ATTACK_TIME, BRUTE, type Brute, IMPACT_TIME, placeBrutes } from "../../src/monster/brutes"
import { BIG_CUBOID } from "../../src/monster/cuboids"
import { FLYING_EYE } from "../../src/monster/eyes"
import Monsters, { HERO_RADIUS, type MonsterFloor, type Prey } from "../../src/monster/monsters"

const FRAME = 1 / 60
const REACH = 0.55
const WIDTH = 2.2
const SWORD_DAMAGE = 2


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
 * Runs frames and returns the hit points the heroes lost in them
 */
function run(brutes: BrutePack, seconds: number, heroes: Prey[], each = () => {}): number
{
    const monsters = new Monsters([brutes], openFloor())
    let lost = 0
    for (let t = 0; t < seconds - FRAME / 2; t += FRAME)
    {
        each()
        monsters.update(FRAME, heroes)
        lost += heroes.reduce((sum, hero) => sum + monsters.hurt(hero, FRAME), 0)
    }
    return lost
}

/**
 * Returns a brute facing a hero at the origin from within its reach
 */
function facingHero(brutes: BrutePack): Brute
{
    const brute = brutes.add(BRUTE, 0, 0, BRUTE.reach * 0.8)
    brute.yaw = Math.PI
    return brute
}


describe("Brutes", () => {

    it("are slow, durable and hit hard", () => {

        // a hero running at the walking speed of a multiplier of 1, see LevelScene
        assert(BRUTE.speed < 0.45 * 2.5 / 2)
        assert(BRUTE.speed < FLYING_EYE.speed)
        assert(BRUTE.speed < BIG_CUBOID.hopLength / BIG_CUBOID.hopTime)
        assert(BRUTE.hp > BIG_CUBOID.hp)
        assert(BRUTE.damage > BIG_CUBOID.damage)
        assert(BRUTE.big && !BRUTE.flying)
        assert(BRUTE.radius <= BIG_CUBOID.radius, "fits where big monsters do")
    })

    it("walk to a hero they see at their speed", () => {

        const brutes = new BrutePack(openFloor())
        const brute = brutes.add(BRUTE, 0, 2, 0)
        run(brutes, 1, [prey()])
        assert.closeTo(brute.x, 2 - BRUTE.speed, 0.01)
        assert(brute.moving)
        assert.closeTo(brute.walked, BRUTE.speed, 0.01)
    })

    it("stop within reach and swing", () => {

        const brutes = new BrutePack(openFloor())
        const brute = brutes.add(BRUTE, 0, 1, 0)
        run(brutes, 1 / BRUTE.speed * 1.2, [prey()])
        assert(brute.attack !== null)
        assert(Math.hypot(brute.x, brute.z) <= BRUTE.reach)
        assert(Math.hypot(brute.x, brute.z) > BRUTE.radius + HERO_RADIUS)
    })

    it("hurt only when the club comes down, once per swing", () => {

        const brutes = new BrutePack(openFloor())
        facingHero(brutes)
        const hero = prey()
        assert(run(brutes, IMPACT_TIME - 0.05, [hero]) === 0)
        assert(run(brutes, 0.1, [hero]) === BRUTE.damage)
        assert(run(brutes, ATTACK_TIME - IMPACT_TIME - 0.1, [hero]) === 0)
    })

    it("aren't stopped by a shield", () => {

        const brutes = new BrutePack(openFloor())
        facingHero(brutes)
        assert(run(brutes, IMPACT_TIME + 0.05, [prey(0, 0, { blocking: true })]) === BRUTE.damage)
    })

    it("miss a dodging hero", () => {

        const brutes = new BrutePack(openFloor())
        facingHero(brutes)
        assert(run(brutes, IMPACT_TIME + 0.05, [prey(0, 0, { dodging: true })]) === 0)
    })

    it("miss those who step back in time", () => {

        const brutes = new BrutePack(openFloor())
        facingHero(brutes)
        const hero = prey()
        let t = 0
        const lost = run(brutes, IMPACT_TIME + 0.05, [hero], () => {
            t += FRAME
            if (t > AIM_TIME)
            {
                hero.z = -0.3
            }
        })
        assert(lost === 0)
    })

    it("miss those beside them once they stop aiming", () => {

        const brutes = new BrutePack(openFloor())
        facingHero(brutes)
        const hero = prey()
        let t = 0
        const lost = run(brutes, IMPACT_TIME + 0.05, [hero], () => {
            t += FRAME
            if (t > AIM_TIME)
            {
                hero.x = BRUTE.reach * 0.8
                hero.z = BRUTE.reach * 0.8
            }
        })
        assert(lost === 0)
    })

    it("turn after a hero while raising the club", () => {

        const brutes = new BrutePack(openFloor())
        const brute = brutes.add(BRUTE, 0, 0, BRUTE.reach * 0.8)
        brute.yaw = Math.PI * 0.6
        assert(run(brutes, IMPACT_TIME + 0.05, [prey()]) === BRUTE.damage)
        assert.closeTo(brute.yaw, Math.PI, 0.01)
    })

    it("take many blows and go on swinging", () => {

        const brutes = new BrutePack(openFloor())
        const brute = facingHero(brutes)
        run(brutes, 0.5, [prey()])
        const blows = BRUTE.hp / SWORD_DAMAGE
        for (let i = 1; i < blows; i++)
        {
            assert(brutes.strike(0, 0, 0, REACH, WIDTH, SWORD_DAMAGE) === 1)
        }
        assert.lengthOf(brutes.members, 1)
        assert(brute.attack !== null)
        assert.closeTo(brute.z, BRUTE.reach * 0.8, 1e-9, "doesn't get knocked back")
        brutes.strike(0, 0, 0, REACH, WIDTH, SWORD_DAMAGE)
        assert.isEmpty(brutes.members)
    })

    it("stay put with nobody seen", () => {

        const brutes = new BrutePack(openFloor(() => false))
        const brute = brutes.add(BRUTE, 0, 1, 0)
        run(brutes, 1, [prey()])
        assert(brute.chase === 0 && brute.attack === null)
    })

    describe("placing", () => {

        const rooms = Array.from({ length: 50 }, (_, i) => [i * 3 + 1, i * 3 + 2, i * 3 + 3])

        it("puts one in a few rooms, not the one the heroes come in by", () => {

            for (let seed = 0; seed < 20; seed++)
            {
                const placed = placeBrutes(rooms, 3, new Prando(seed))
                assert(placed.length < rooms.length / 4)
                assert(new Set(placed.map(({ face }) => Math.ceil(face / 3))).size === placed.length)
                assert(placed.every(({ face }) => face < 10 || face > 12))
            }
        })

        it("is the same for the same seed", () => {

            assert.deepEqual(placeBrutes(rooms, 3, new Prando(7)), placeBrutes(rooms, 3, new Prando(7)))
        })
    })
})
