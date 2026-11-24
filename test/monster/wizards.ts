import { assert, describe, it } from "vitest"

import type { Prey } from "../../src/monster/monsters"
import { ROBE_COLORS } from "../../src/monster/WizardCrowd"
import { SIGIL_RADIUS } from "../../src/monster/sigils"
import WizardPack, { FIRE_ROBE, ROBE_COUNT, SIGIL_ROBE, STAFF_STOMP, WIZARD, type Wizard, type WizardFloor } from "../../src/monster/wizards"
import { SIGIL_DRAW } from "../../src/render/sigilShape"
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
        wallDistance: () => Infinity
    }
}

function prey(x = 0, z = 0): Prey
{
    return { x, z, facing: 0, blocking: false, dodging: false, hurtWait: 0, vx: 0, vz: 0, shoveX: 0, shoveZ: 0 }
}


describe("WizardPack", () => {
    it("has a robe color for every robe", () => {
        assert.lengthOf(ROBE_COLORS, ROBE_COUNT)
        const pack = new WizardPack(openFloor())
        for (let i = 0; i < 50; i++)
        {
            const { robe } = pack.add(WIZARD, 0, 0, 0)
            assert.isTrue(Number.isInteger(robe) && robe >= 0 && robe < ROBE_COUNT)
        }
    })

    it("walks up to a hero it sees, but stays some way off", () => {
        const pack = new WizardPack(openFloor())
        const wizard = pack.add(WIZARD, 0, 0, 0)
        wizard.robe = SIGIL_ROBE + 1
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
    function casting(robe = SIGIL_ROBE): { pack: WizardPack, wizard: Wizard, hero: Prey }
    {
        const pack = new WizardPack(openFloor())
        const wizard = pack.add(WIZARD, 0, 0, 0)
        wizard.robe = robe
        const hero = prey(WIZARD.keepAway, 0)
        for (let i = 0; i < 120 && !wizard.casting; i++)
        {
            pack.update(FRAME, [hero])
        }
        assert.isNotNull(wizard.casting)
        return { pack, wizard, hero }
    }

    it("only casts in blue and red", () => {
        const pack = new WizardPack(openFloor())
        for (let robe = 0; robe < ROBE_COUNT; robe++)
        {
            pack.add(WIZARD, 0, 0, 0).robe = robe
        }
        for (let i = 0; i < 70; i++)
        {
            pack.update(FRAME, [prey(WIZARD.keepAway, 0)])
        }
        assert.deepEqual(pack.members.filter(({ casting }) => casting).map(({ robe }) => robe), [SIGIL_ROBE, FIRE_ROBE])
    })

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
        const { pack, hero } = casting(FIRE_ROBE)
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
            const { pack, wizard, hero } = casting(FIRE_ROBE)
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
})
