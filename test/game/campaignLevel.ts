import { assert, describe, it } from "vitest"

import { createCampaign, overworld, type PatchKind, SAVE_VERSION } from "../../src/game/campaign"
import { campaignLevel, DEED_XP, gainXp, levelXp, monsterSkill } from "../../src/game/campaignLevel"
import { enterJob, enterLevel, hasArrived, leaveLevel, returnHome, startJob } from "../../src/game/heroes"
import { advanceDay, missionDays, startMission } from "../../src/game/missions"
import { parseSave } from "../../src/game/storage"


describe("Campaign level", () => {

    it("starts at 1 and takes more experience for each level", () => {
        assert.strictEqual(levelXp(1), 0)
        assert.strictEqual(campaignLevel(0), 1)
        for (let level = 2; level < 60; level++)
        {
            assert.strictEqual(campaignLevel(levelXp(level)), level)
            assert.strictEqual(campaignLevel(levelXp(level) - 1), level - 1)
            assert.isAbove(levelXp(level + 1) - levelXp(level), levelXp(level) - levelXp(level - 1))
        }
    })

    it("has monsters get better ever slower, without getting perfect", () => {
        assert.strictEqual(monsterSkill(1), 0)
        for (let level = 2; level < 100; level++)
        {
            const gain = monsterSkill(level) - monsterSkill(level - 1)
            assert.isAbove(gain, 0)
            assert.isBelow(gain, monsterSkill(level - 1) - monsterSkill(Math.max(1, level - 2)) || Infinity)
            assert.isBelow(monsterSkill(level), 1)
        }
    })

    it("tells how many levels a deed went up by", () => {
        const campaign = createCampaign(3)
        campaign.xp = levelXp(2) - 1
        assert.strictEqual(gainXp(campaign, "room"), 1)
        assert.strictEqual(gainXp(campaign, "room"), 0)
        assert.strictEqual(campaign.xp, levelXp(2) - 1 + 2 * DEED_XP.room)
    })

    it("gains experience for discovering a patch with something in it", () => {
        for (const kind of ["DUNGEON", "EMPTY"] as const)
        {
            const campaign = createCampaign(7)
            const explorer = campaign.tavern[0]
            startMission(campaign, explorer.id, "2/0", { reachable: true, cost: 100, kind, passed: [] })
            for (let day = 0; day < missionDays(explorer, 100); day++)
            {
                advanceDay(campaign)
            }
            assert.strictEqual(overworld(campaign).patches["2/0"].state, "discovered")
            assert.strictEqual(campaign.xp, kind === "EMPTY" ? 0 : DEED_XP.tile)
        }
    })

    /** sends the first hero to a known patch of the given kind and has them get there */
    function arrive(kind: PatchKind)
    {
        const campaign = createCampaign(9)
        overworld(campaign).patches["1/0"] = { q: 1, r: 0, kind, state: "discovered", parent: "0/0" }
        const hero = campaign.heroes[0]
        startJob(campaign, hero.id, "1/0")
        while (!hasArrived(campaign, campaign.jobs[0]))
        {
            advanceDay(campaign)
        }
        return { campaign, hero }
    }

    it("gains experience the first time a hero goes into a dungeon only", () => {
        const { campaign, hero } = arrive("DUNGEON")
        enterLevel(campaign, hero.id)
        leaveLevel(campaign, hero.id)
        enterLevel(campaign, hero.id)
        assert.strictEqual(campaign.xp, DEED_XP.dungeon)

        // nor on another job there
        leaveLevel(campaign, hero.id)
        returnHome(campaign, hero.id)
        while (campaign.jobs.length)
        {
            advanceDay(campaign)
        }
        startJob(campaign, hero.id, "1/0")
        while (!hasArrived(campaign, campaign.jobs[0]))
        {
            advanceDay(campaign)
        }
        enterLevel(campaign, hero.id)
        assert.strictEqual(campaign.xp, DEED_XP.dungeon)
    })

    it("gains experience for getting to a temple or a treasure, but not to an empty patch", () => {
        for (const [kind, xp] of [["TEMPLE", DEED_XP.temple], ["TREASURE", DEED_XP.treasure], ["EMPTY", 0]] as const)
        {
            const { campaign, hero } = arrive(kind)
            enterJob(campaign, hero.id)
            assert.strictEqual(campaign.xp, xp, kind)
        }
    })

    it("starts older saves without experience", () => {
        const campaign: Partial<ReturnType<typeof createCampaign>> = { ...createCampaign(5), saveVersion: 7 }
        delete campaign.xp
        const loaded = parseSave(JSON.stringify(campaign))
        assert.strictEqual(loaded.saveVersion, SAVE_VERSION)
        assert.strictEqual(loaded.xp, 0)
    })
})
