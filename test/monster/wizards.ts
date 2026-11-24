import { assert, describe, it } from "vitest"

import type { Prey } from "../../src/monster/monsters"
import { ROBE_COLORS } from "../../src/monster/WizardCrowd"
import { SIGIL_RADIUS } from "../../src/monster/sigils"
import WizardPack, { ROBE_COUNT, SIGIL_ROBE, WIZARD, type Wizard, type WizardFloor } from "../../src/monster/wizards"
import { SIGIL_DRAW } from "../../src/render/sigilShape"

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

    /** a blue wizard that just started a sigil under the hero */
    function casting(): { pack: WizardPack, wizard: Wizard, hero: Prey }
    {
        const pack = new WizardPack(openFloor())
        const wizard = pack.add(WIZARD, 0, 0, 0)
        wizard.robe = SIGIL_ROBE
        const hero = prey(WIZARD.keepAway, 0)
        for (let i = 0; i < 120 && !wizard.casting; i++)
        {
            pack.update(FRAME, [hero])
        }
        assert.isNotNull(wizard.casting)
        return { pack, wizard, hero }
    }

    it("only casts sigils in blue", () => {
        const pack = new WizardPack(openFloor())
        for (let robe = 0; robe < ROBE_COUNT; robe++)
        {
            pack.add(WIZARD, 0, 0, 0).robe = robe
        }
        for (let i = 0; i < 70; i++)
        {
            pack.update(FRAME, [prey(WIZARD.keepAway, 0)])
        }
        assert.deepEqual(pack.members.filter(({ casting }) => casting).map(({ robe }) => robe), [SIGIL_ROBE])
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
})
