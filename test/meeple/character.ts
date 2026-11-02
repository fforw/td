import { assert, describe, it } from "vitest"

import { canEquip, canHaveClass, type Character, checkClasses, type ClassName, type Stats } from "../../src/meeple/character"


const STRONG: Stats = { hp: 20, mp: 20, str: 10, dex: 10 }

function character(...classes: ClassName[]): Character
{
    return { stats: STRONG, classes }
}


describe("canEquip", function () {

    it("allows empty hands", function () {
        assert(canEquip(character()) === null)
    })

    it("allows the item types of the character's classes", function () {
        assert(canEquip(character("fighter"), "sword_silver", "apple") === null)
        assert(canEquip(character("peasant"), "shovel_silver") === null)
        assert(canEquip(character("peasant"), undefined, "hoe_silver") === null)
    })

    it("refuses item types no class allows", function () {
        assert(canEquip(character("peasant"), "sword_silver") !== null)
        assert(canEquip(character("fighter"), undefined, "pick_silver") !== null)
        assert(canEquip(character(), "apple") !== null)
    })

    it("combines the rules of all classes", function () {
        assert(canEquip(character("peasant", "fighter"), "sword_silver", "hammer_silver") === null)
    })

    it("keeps the other hand free for two-handed items", function () {
        assert(canEquip(character("fighter"), "bow") === null)
        assert(canEquip(character("fighter"), undefined, "bow") === null)
        assert(canEquip(character("fighter"), "bow", "apple") !== null)
        assert(canEquip(character("fighter"), "apple", "bow") !== null)
    })

    it("refuses sprites that are no items", function () {
        assert(canEquip(character("fighter"), "bowArrow") !== null)
    })
})


describe("classes", function () {

    it("need their minimum stats", function () {
        const weak: Stats = { hp: 5, mp: 2, str: 2, dex: 3 }
        assert(canHaveClass(weak, "peasant"))
        assert(!canHaveClass(weak, "fighter"))
        assert(!canHaveClass(weak, "wizard"))
        assert(canHaveClass({ ...weak, mp: 8 }, "wizard"))
        assert(checkClasses({ stats: weak, classes: ["peasant"] }) === null)
        assert(checkClasses({ stats: weak, classes: ["peasant", "wizard"] }) !== null)
    })
})
