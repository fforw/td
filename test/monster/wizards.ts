import { assert, describe, it } from "vitest"

import type { Prey } from "../../src/monster/monsters"
import { SIGIL_RADIUS } from "../../src/monster/sigils"
import WizardPack, { BEAM_TURN, BEAM_TURN_RATE, BLUE_WIZARD, GUARD_MAX, PURPLE_WIZARD, reactionTime, RED_WIZARD, STAFF_STOMP, THREAT_RANGE, WIZARD, WIZARD_TREE, type Wizard, type WizardFloor, type WizardKind } from "../../src/monster/wizards"
import { SIGIL_DRAW } from "../../src/render/sigilShape"
import { BEAM_CAST_END, BEAM_FADE_TIME, BEAM_FIRE, BEAM_FIRE_TIME } from "../../src/render/beamTiming"
import { FIRE_WARN } from "../../src/render/fireTiming"

const FRAME = 1 / 60


function openFloor(): WizardFloor
{
    return {
        move(monster, dx, dz)
        {
            monster.x += dx
            monster.z += dz
        },
        sees: () => true,
        wallDistance: () => Infinity,
        wallAhead: (_x, _z, _dirX, _dirZ, most) => most
    }
}

function prey(x = 0, z = 0): Prey
{
    return { x, z, facing: 0, blocking: false, dodging: false, hurtWait: 0, vx: 0, vz: 0, shoveX: 0, shoveZ: 0 }
}


describe("WizardPack", () => {
    it("walks up to a hero it sees, but stays some way off", () => {
        const pack = new WizardPack(openFloor())
        const wizard = pack.add(BLUE_WIZARD, 0, 0, 0)
        wizard.castWait = Infinity
        // within sight, see NOTICE_DISTANCE
        const hero = prey(WIZARD.keepAway * 1.8, 0)
        for (let i = 0; i < 60 * 20; i++)
        {
            pack.update(FRAME, [hero])
        }
        assert.closeTo(Math.hypot(hero.x - wizard.x, hero.z - wizard.z), WIZARD.keepAway, 1e-6)
        assert.closeTo(wizard.walked, WIZARD.keepAway * 0.8, 1e-6)
        assert.isFalse(wizard.moving)
    })

    /** a wizard, by default a blue one, that just started casting at the hero */
    function casting(kind: WizardKind = BLUE_WIZARD): { pack: WizardPack, wizard: Wizard, hero: Prey }
    {
        const pack = new WizardPack(openFloor())
        const wizard = pack.add(kind, 0, 0, 0)
        const hero = prey(WIZARD.keepAway, 0)
        for (let i = 0; i < 120 && !wizard.casting; i++)
        {
            pack.update(FRAME, [hero])
        }
        assert.isNotNull(wizard.casting)
        return { pack, wizard, hero }
    }

    it("warns before its sigil hurts who is still in it, and only for a while", () => {
        const { pack, wizard, hero } = casting()
        assert.strictEqual(pack.touch(hero, true), 0)
        for (let t = 0; t < SIGIL_DRAW + 0.1; t += FRAME)
        {
            pack.update(FRAME, [hero])
        }
        assert.isNull(wizard.casting)
        assert.strictEqual(pack.touch(hero, true), WIZARD.damage)
        assert.strictEqual(pack.touch(hero, false), 0)
        assert.strictEqual(pack.touch(prey(hero.x + SIGIL_RADIUS * 1.01, hero.z), true), 0)
        // the wizard waits longer than that for the next one
        for (let t = 0; t < 1.5; t += FRAME)
        {
            pack.update(FRAME, [hero])
        }
        assert.isEmpty(pack.sigils)
    })

    it("leaves the sigil where it was cast", () => {
        const { pack, hero } = casting()
        const { x, z } = pack.sigils[0]
        hero.x += 0.3
        pack.update(FRAME, [hero])
        assert.deepEqual([pack.sigils[0].x, pack.sigils[0].z], [x, z])
    })

    for (const [blow, damage] of [["a hit", 1], ["its death", 100]] as const)
    {
        it("breaks the sigil with " + blow, () => {
            const { pack, hero } = casting()
            pack.strike(0, 0, 0, 1, Math.PI, damage)
            for (let t = 0; t < SIGIL_DRAW + 0.1; t += FRAME)
            {
                assert.strictEqual(pack.touch(hero, true), 0)
                pack.update(FRAME, [hero])
            }
            assert.isEmpty(pack.sigils)
        })
    }

    it("shows where fire strikes after stomping the staff, and hurts who stays", () => {
        const { pack, hero } = casting(RED_WIZARD)
        let stomped = 0, hurtAt = 0
        for (let t = 0; t < STAFF_STOMP + FIRE_WARN + 2.5 && !hurtAt; t += FRAME)
        {
            pack.update(FRAME, [hero])
            stomped ||= pack.fire.drops.length > 0 ? t : 0
            assert.strictEqual(pack.touch(hero, false), 0)
            const damage = pack.touch(hero, true)
            if (damage > 0)
            {
                assert.strictEqual(damage, WIZARD.fireDamage)
                hurtAt = t
            }
        }
        assert.closeTo(stomped, STAFF_STOMP, 2 * FRAME)
        assert.isAtLeast(hurtAt - stomped, FIRE_WARN - 2 * FRAME)
        assert.isEmpty(pack.sigils)
    })

    it("has no fire come if a blow lands before the stomp, but not after", () => {
        for (const [wait, comes] of [[STAFF_STOMP / 2, false], [STAFF_STOMP + 0.1, true]] as const)
        {
            const { pack, wizard, hero } = casting(RED_WIZARD)
            for (let t = 0; t < wait; t += FRAME)
            {
                pack.update(FRAME, [hero])
            }
            pack.strike(0, 0, 0, 1, Math.PI, 1)
            assert.isNull(wizard.casting)
            pack.update(FRAME, [hero])
            for (let t = 0; t < 0.5; t += FRAME)
            {
                pack.update(FRAME, [hero])
            }
            assert.strictEqual(pack.fire.drops.length > 0, comes)
        }
    })

    it("turns around once with its beam while it stands", () => {
        const { pack, wizard, hero } = casting(PURPLE_WIZARD)
        const { x, z, yaw } = wizard
        const { spin } = pack.beams[0]
        let seconds = 0, turned = yaw
        while (wizard.casting && seconds < 60)
        {
            turned = wizard.yaw
            pack.update(FRAME, [hero])
            seconds += FRAME
        }
        assert.deepEqual([wizard.x, wizard.z], [x, z])
        // it turns while the staff charges, too
        assert.closeTo(turned - yaw, spin * (BEAM_TURN + BEAM_FIRE * BEAM_TURN_RATE), 0.05)
        assert.closeTo(seconds, BEAM_FIRE + BEAM_TURN / BEAM_TURN_RATE + BEAM_CAST_END, 0.1)
        assert.isEmpty(pack.beams)
    })

    /** has the beam of a wizard point at the hero, at full strength */
    function pointAt(pack: WizardPack, wizard: Wizard, heroes: Prey[]): void
    {
        for (let t = 0; t < BEAM_FIRE + BEAM_FIRE_TIME + FRAME; t += FRAME)
        {
            pack.update(FRAME, heroes)
        }
        const { beams: [beam] } = pack
        // the beam starts beside the wizard, so the hero goes where it points instead
        heroes.forEach((hero, i) => {
            hero.x = beam.x + Math.sin(wizard.yaw) * (i + 1)
            hero.z = beam.z + Math.cos(wizard.yaw) * (i + 1)
        })
        pack.update(FRAME, heroes)
    }

    it("hurts the first hero its beam hits, unless a shield is in the way or they dodge", () => {
        const { pack, wizard, hero } = casting(PURPLE_WIZARD)
        const behind = prey(9, 9)
        pointAt(pack, wizard, [hero, behind])
        assert.isBelow(pack.beams[0].reach, 1)
        assert.strictEqual(pack.touch(hero, true), WIZARD.beamDamage)
        assert.strictEqual(pack.touch(hero, false), 0)
        assert.strictEqual(pack.touch(behind, true), 0)

        hero.blocking = true
        hero.facing = wizard.yaw + Math.PI
        assert.strictEqual(pack.touch(hero, true), 0)
        hero.facing = wizard.yaw
        assert.strictEqual(pack.touch(hero, true), WIZARD.beamDamage)

        hero.dodging = true
        pack.update(FRAME, [hero, behind])
        assert.strictEqual(pack.beams[0].hit, behind)
    })

    it("has no beam go through walls", () => {
        const floor = openFloor()
        floor.wallAhead = () => 0.5
        const pack = new WizardPack(floor)
        const wizard = pack.add(PURPLE_WIZARD, 0, 0, 0)
        const hero = prey(WIZARD.keepAway, 0)
        for (let i = 0; i < 120 && !wizard.casting; i++)
        {
            pack.update(FRAME, [hero])
        }
        pointAt(pack, wizard, [hero])
        assert.strictEqual(pack.beams[0].reach, 0.5)
        assert.strictEqual(pack.touch(hero, true), 0)
    })

    for (const [blow, damage] of [["a hit", 1], ["its death", 100]] as const)
    {
        it("ends the beam with " + blow, () => {
            const { pack, wizard, hero } = casting(PURPLE_WIZARD)
            pointAt(pack, wizard, [hero])
            pack.strike(wizard.x, wizard.z, 0, 1, Math.PI, damage)
            assert.isNull(wizard.casting)
            assert.strictEqual(pack.touch(hero, true), 0)
            for (let t = 0; t < BEAM_FADE_TIME + FRAME; t += FRAME)
            {
                pack.update(FRAME, [])
            }
            assert.isEmpty(pack.beams)
        })
    }

    /** a wizard of the given skill at the origin facing a hero that comes at it from the east, close enough to strike */
    function threatened(skill: number): { pack: WizardPack, wizard: Wizard, hero: Prey }
    {
        const pack = new WizardPack(openFloor())
        const wizard = pack.add(BLUE_WIZARD, 0, 0, 0, skill)
        wizard.castWait = Infinity
        wizard.yaw = Math.PI / 2
        const hero = { ...prey(THREAT_RANGE * 0.8, 0), facing: -Math.PI / 2 }
        return { pack, wizard, hero }
    }

    function run(pack: WizardPack, hero: Prey, seconds: number): void
    {
        for (let t = 0; t < seconds; t += FRAME)
        {
            pack.update(FRAME, [hero])
        }
    }

    it("blocks a hero that comes at it once skilled enough, sooner the more skilled", () => {
        const { pack, wizard, hero } = threatened(1)
        run(pack, hero, reactionTime(wizard) + 0.6)
        assert.strictEqual(wizard.staff, 1)
        assert.deepEqual(WIZARD_TREE.path(wizard), ["wizard", "guard", "block"])

        const novice = threatened(0)
        run(novice.pack, novice.hero, 2)
        assert.strictEqual(novice.wizard.staff, 0)

        assert.isAbove(reactionTime({ ...wizard, skill: 0.3 }), reactionTime(wizard))
    })

    it("stops blows from the front with the staff up, but not from behind", () => {
        const { pack, wizard, hero } = threatened(1)
        run(pack, hero, reactionTime(wizard) + 0.6)
        assert.strictEqual(pack.strike(hero.x, hero.z, hero.facing, THREAT_RANGE, 2, 1), 1)
        assert.strictEqual(wizard.hp, WIZARD.hp)

        pack.strike(-hero.x, hero.z, -hero.facing, THREAT_RANGE, 2, 1)
        assert.strictEqual(wizard.hp, WIZARD.hp - 1)
        assert.isFalse(wizard.guarding)
    })

    it("lowers the staff after a while, and has to see the next blow coming anew", () => {
        const { pack, wizard, hero } = threatened(0.5)
        let lowered = false, raisedAgain = false
        for (let t = 0; t < GUARD_MAX + 3; t += FRAME)
        {
            pack.update(FRAME, [hero])
            lowered ||= wizard.staff === 0 && t > GUARD_MAX
            raisedAgain ||= lowered && wizard.staff > 0
        }
        assert.isTrue(raisedAgain)
    })

    it("backs off from a hero too close once skilled enough, facing them", () => {
        for (const [skill, backs] of [[0.6, true], [0, false]] as const)
        {
            const pack = new WizardPack(openFloor())
            const wizard = pack.add(BLUE_WIZARD, 0, 0, 0, skill)
            wizard.castWait = Infinity
            // facing away, so it doesn't block
            const hero = { ...prey(WIZARD.keepAway * 0.4, 0), facing: Math.PI / 2 }
            run(pack, hero, 4)
            const distance = Math.hypot(hero.x - wizard.x, hero.z - wizard.z)
            if (backs)
            {
                assert.closeTo(distance, WIZARD.keepAway, 1e-6)
                assert.isBelow(wizard.walked, 0)
                assert.closeTo(wizard.yaw % (Math.PI * 2), Math.PI / 2, 0.01)
            }
            else
            {
                assert.closeTo(distance, WIZARD.keepAway * 0.4, 1e-9)
            }
        }
    })
})
