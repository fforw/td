import Prando from "prando"
import { assert, describe, it } from "vitest"

import { createCampaign } from "../../src/game/campaign"
import { gainXp, levelXp } from "../../src/game/campaignLevel"
import { addGear, baseGear, baseGearUpTo, foundGear, type Gear, gearName, spendGear } from "../../src/game/gear"


describe("gear", () => {
    it("puts pieces of the same kind and element together", () => {
        const gear: Gear[] = []
        addGear(gear, { kind: "dagger", count: 2 })
        addGear(gear, { kind: "wand", element: "fire", count: 1 })
        addGear(gear, { kind: "dagger", count: 3 })
        addGear(gear, { kind: "wand", element: "fire", count: 1 })
        addGear(gear, { kind: "wand", element: "frost", count: 1 })
        assert.deepEqual(gear, [
            { kind: "dagger", count: 5 },
            { kind: "wand", element: "fire", count: 1 },
            { kind: "wand", element: "frost", count: 1 }
        ])
    })

    it("takes out what is used up, and keeps to the current piece", () => {
        const gear: Gear[] = [{ kind: "scroll", element: "venom", count: 1 }, { kind: "wand", element: "fire", count: 1 }, { kind: "dagger", count: 1 }]
        assert.strictEqual(spendGear(gear, 1, 1), 1)
        assert.lengthOf(gear, 3)
        assert.strictEqual(spendGear(gear, 0, 2), 1)
        assert.deepEqual(gear.map(({ kind }) => kind), ["wand", "dagger"])
        assert.strictEqual(spendGear(gear, 1, 1), 0)
        assert.deepEqual(gear.map(({ kind }) => kind), ["wand"])
    })

    it("gives the base gear of all levels up to one", () => {
        assert.deepEqual(baseGearUpTo(1), baseGear(1))
        const kinds = baseGearUpTo(4).map(({ kind }) => kind)
        assert.sameMembers(kinds, ["dagger", "wand", "axe", "scroll"])
    })

    it("has every hero get the base gear of a level the campaign reaches", () => {
        const campaign = createCampaign(3)
        for (const hero of campaign.heroes)
        {
            assert.deepEqual(hero.gear, baseGearUpTo(1))
        }
        campaign.xp = levelXp(2) - 1
        gainXp(campaign, "room")
        for (const hero of campaign.heroes)
        {
            assert.deepEqual(hero.gear, baseGearUpTo(2))
        }
    })

    it("finds every kind in chests, with what makes it up", () => {
        const random = new Prando(5)
        const found = Array.from({ length: 200 }, () => foundGear(random))
        assert.sameMembers([...new Set(found.map(({ kind }) => kind))], ["dagger", "axe", "wand", "scroll"])
        for (const piece of found)
        {
            assert.strictEqual(piece.element !== undefined, piece.kind === "wand" || piece.kind === "scroll")
            assert.isAbove(piece.count, 0)
        }
    })

    it("names pieces with their count", () => {
        assert.strictEqual(gearName({ kind: "dagger", count: 1 }), "1 dagger")
        assert.strictEqual(gearName({ kind: "axe", count: 2 }), "2 throwing axes")
        assert.strictEqual(gearName({ kind: "scroll", element: "frost", count: 2 }), "Frost scroll, 2 uses")
        assert.strictEqual(gearName({ kind: "wand", element: "fire", count: 1 }), "Fire wand")
    })
})
