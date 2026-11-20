import { assert, describe, it } from "vitest"

import type { MonsterFloor, Prey } from "../../src/monster/monsters"
import { ROBE_COLORS } from "../../src/monster/WizardCrowd"
import WizardPack, { ROBE_COUNT, WIZARD } from "../../src/monster/wizards"

const FRAME = 1 / 60


function openFloor(): MonsterFloor
{
    return {
        move(monster, dx, dz)
        {
            monster.x += dx
            monster.z += dz
        },
        sees: () => true
    }
}

function prey(x = 0, z = 0): Prey
{
    return { x, z, facing: 0, blocking: false, dodging: false, hurtWait: 0 }
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

    it("does no harm yet", () => {
        const pack = new WizardPack(openFloor())
        pack.add(WIZARD, 0, 0, 0)
        assert.strictEqual(pack.touch(prey(), true), 0)
    })
})
