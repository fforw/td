import { assert, describe, it } from "vitest"

import { BRUTE } from "../../src/monster/brutes"
import Monsters, { HERO_RADIUS, type MonsterFloor, type Prey } from "../../src/monster/monsters"
import { blockTime } from "../../src/monster/SoldierCrowd"
import SoldierPack, {
    CUT_TIME,
    GUARD_MAX,
    GUARD_MIN,
    LOWER_TIME,
    RAISE_TIME,
    SHIELD_UP,
    SOLDIER,
    type Soldier,
    SWING_TIME
} from "../../src/monster/soldiers"

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
    return { x, z, facing: 0, blocking: false, dodging: false, hurtWait: 0, vx: 0, vz: 0, shoveX: 0, shoveZ: 0, ...changes }
}

/**
 * Runs frames and returns the hit points the heroes lost in them
 */
function run(soldiers: SoldierPack, seconds: number, heroes: Prey[], each = () => {}): number
{
    const monsters = new Monsters([soldiers], openFloor())
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
 * Returns a soldier facing a hero at the origin from within its reach
 */
function facingHero(soldiers: SoldierPack): Soldier
{
    const soldier = soldiers.add(SOLDIER, 0, 0, SOLDIER.reach * 0.8)
    soldier.yaw = Math.PI
    return soldier
}

/**
 * Runs frames until a soldier has its shield all the way up after a swing
 */
function guarding(soldiers: SoldierPack, soldier: Soldier, hero: Prey): void
{
    run(soldiers, SWING_TIME + RAISE_TIME + 0.05, [hero])
    assert(soldier.guarding && soldier.shield === 1)
}


describe("Soldiers", () => {

    it("are faster and weaker than brutes", () => {

        assert(SOLDIER.speed > BRUTE.speed)
        assert(SOLDIER.hp < BRUTE.hp)
        assert(SOLDIER.damage < BRUTE.damage)
        assert(SOLDIER.big && !SOLDIER.flying)
    })

    it("walk to a hero they see and swing within reach", () => {

        const soldiers = new SoldierPack(openFloor())
        const soldier = soldiers.add(SOLDIER, 0, 1, 0)
        run(soldiers, 1 / SOLDIER.speed * 1.2, [prey()])
        assert(soldier.attack !== null)
        assert.closeTo(soldier.walked, 1 - Math.hypot(soldier.x, soldier.z), 1e-9, "counts the ground covered")
        assert(Math.hypot(soldier.x, soldier.z) <= SOLDIER.reach)
        assert(Math.hypot(soldier.x, soldier.z) > SOLDIER.radius + HERO_RADIUS)
    })

    it("hurt only when the sword comes down, once per swing", () => {

        const soldiers = new SoldierPack(openFloor())
        facingHero(soldiers)
        const hero = prey()
        assert(run(soldiers, CUT_TIME - 0.05, [hero]) === 0)
        assert(run(soldiers, 0.1, [hero]) === SOLDIER.damage)
        assert(run(soldiers, SWING_TIME - CUT_TIME - 0.1, [hero]) === 0)
    })

    it("are stopped by a shield in front, not behind", () => {

        const front = new SoldierPack(openFloor())
        facingHero(front)
        // the soldier is at +z, where the hero looks
        assert(run(front, CUT_TIME + 0.05, [prey(0, 0, { blocking: true })]) === 0)

        const back = new SoldierPack(openFloor())
        facingHero(back)
        assert(run(back, CUT_TIME + 0.05, [prey(0, 0, { blocking: true, facing: Math.PI })]) === SOLDIER.damage)
    })

    it("guard after a swing for a while, then lower the shield and swing again", () => {

        const soldiers = new SoldierPack(openFloor())
        const soldier = facingHero(soldiers)
        const hero = prey()
        run(soldiers, SWING_TIME + 3 * FRAME, [hero])
        assert(soldier.attack === null && soldier.guarding)
        assert.isAtLeast(soldier.guardLeft, GUARD_MIN - 2 * FRAME)

        // frame by frame, as how long it guards is random, and a short guard leaves time for the whole next swing
        let guarded = 0
        while (soldier.guarding)
        {
            run(soldiers, FRAME, [hero])
            guarded += FRAME
            assert.isAtMost(guarded, GUARD_MAX)
        }
        let lowered = 0
        while (soldier.attack === null)
        {
            run(soldiers, FRAME, [hero])
            lowered += FRAME
            assert.isAtMost(lowered, LOWER_TIME + 0.05)
        }
        assert(soldier.shield === 0, "doesn't swing with the shield up")
    })

    it("stop blows from the front with the shield up", () => {

        const soldiers = new SoldierPack(openFloor())
        const soldier = facingHero(soldiers)
        const hero = prey()
        guarding(soldiers, soldier, hero)

        assert(soldiers.strike(0, 0, 0, REACH, WIDTH, SWORD_DAMAGE) === 1)
        assert(soldier.hp === SOLDIER.hp && soldier.flash === 0)
    })

    it("take blows from behind with the shield up", () => {

        const soldiers = new SoldierPack(openFloor())
        const soldier = facingHero(soldiers)
        guarding(soldiers, soldier, prey())

        // from beyond the soldier, looking back at it
        soldiers.strike(0, SOLDIER.reach * 1.6, Math.PI, REACH, WIDTH, SWORD_DAMAGE)
        assert(soldier.hp === SOLDIER.hp - SWORD_DAMAGE)
    })

    it("take blows while swinging and keep swinging", () => {

        const soldiers = new SoldierPack(openFloor())
        const soldier = facingHero(soldiers)
        run(soldiers, 0.2, [prey()])
        soldiers.strike(0, 0, 0, REACH, WIDTH, SWORD_DAMAGE)
        assert(soldier.hp === SOLDIER.hp - SWORD_DAMAGE)
        assert(soldier.attack !== null && !soldier.guarding)
    })

    it("raise the shield when struck, which stops blows only once far enough up", () => {

        const soldiers = new SoldierPack(openFloor())
        const soldier = soldiers.add(SOLDIER, 0, 0, SOLDIER.reach * 0.8)
        soldier.yaw = Math.PI
        soldiers.strike(0, 0, 0, REACH, WIDTH, SWORD_DAMAGE)
        assert(soldier.guarding && soldier.hp === SOLDIER.hp - SWORD_DAMAGE)

        const halfway = new SoldierPack(openFloor())
        const early = halfway.add(SOLDIER, 0, 0, SOLDIER.reach * 0.8)
        early.yaw = Math.PI
        early.guarding = true
        early.guardLeft = GUARD_MAX
        run(halfway, RAISE_TIME * SHIELD_UP * 0.8, [])
        halfway.strike(0, 0, 0, REACH, WIDTH, SWORD_DAMAGE)
        assert(early.hp === SOLDIER.hp - SWORD_DAMAGE)
        run(halfway, RAISE_TIME * SHIELD_UP * 0.4, [])
        halfway.strike(0, 0, 0, REACH, WIDTH, SWORD_DAMAGE)
        assert(early.hp === SOLDIER.hp - SWORD_DAMAGE)
    })

    it("pose the shield from the first half of the block clip going up and the second going down", () => {

        const soldier = new SoldierPack(openFloor()).add(SOLDIER, 0, 0, 0)
        const duration = 1
        assert(blockTime({ ...soldier, guarding: true, shield: 0 }, duration) === 0)
        assert(blockTime({ ...soldier, guarding: true, shield: 1 }, duration) === RAISE_TIME)
        assert(blockTime({ ...soldier, guarding: false, shield: 1 }, duration) === RAISE_TIME)
        assert(blockTime({ ...soldier, guarding: false, shield: 0 }, duration) === duration)
        // dropped halfway up, it lowers from halfway down
        assert.closeTo(blockTime({ ...soldier, guarding: false, shield: 0.5 }, duration), 0.75, 1e-9)
    })
})
