import { assert, describe, it } from "vitest"

import { createCampaign, overworld, START_GOLD } from "../../src/game/campaign"
import { advanceDay, frontier, missionDays, startMission } from "../../src/game/missions"
import { MAX_LOITERING, price } from "../../src/game/tavern"


describe("Campaign", () => {

    it("derives everything from the seed", () => {

        const a = createCampaign(42)
        const b = createCampaign(42)
        assert.deepEqual(a, b)
        assert(a.subtitle.length > 0)
        assert(a.subtitle.indexOf(a.castleName) >= 0 || a.subtitle.indexOf(a.characterName) >= 0)
        assert(a.tavern.length === 3)
        assert(a.gold === START_GOLD)
        assert(a.day === 1)
    })

    it("starts with the castle and its eight neighbors known, one of them a dungeon", () => {

        for (const seed of [1, 2, 3, 4, 5])
        {
            const campaign = createCampaign(seed)
            const nodes = Object.values(overworld(campaign).patches)
            assert(nodes.length === 9)
            assert(nodes.every(node => node.state === "discovered"))
            assert(nodes.filter(node => node.kind === "CASTLE").length === 1)
            assert(nodes.some(node => node.kind === "DUNGEON"))
            assert(frontier(campaign).length === 16)
        }
    })
})


describe("Missions", () => {

    it("pays the explorer and discovers the target when the days are up", () => {

        const campaign = createCampaign(7)
        const explorer = campaign.tavern[0]
        const days = missionDays(explorer, "2/0")
        const cost = price(explorer)

        startMission(campaign, explorer.id, "2/0")

        const node = overworld(campaign).patches["2/0"]
        assert(node.state === "targeted")
        assert(node.parent !== null && node.parent.startsWith("1/"))
        assert(campaign.gold === START_GOLD - cost)
        assert(campaign.tavern.indexOf(explorer) < 0)

        for (let i = 1; i < days; i++)
        {
            advanceDay(campaign)
            assert(node.state === "targeted")
        }
        advanceDay(campaign)
        assert(overworld(campaign).patches["2/0"].state === "discovered")
        assert(campaign.missions.length === 0)

        const back = campaign.tavern.find(e => e.id === explorer.id)!
        assert(back.experience === 1)
        assert(back.speed > 0)
    })

    it("only targets unknown patches next to discovered ones", () => {

        const campaign = createCampaign(3)
        const id = campaign.tavern[0].id
        let error: Error | null = null
        try
        {
            startMission(campaign, id, "3/0")
        }
        catch (e)
        {
            error = e as Error
        }
        assert(error !== null)
    })

    it("lets the gold go negative", () => {

        const campaign = createCampaign(5)
        campaign.gold = 10
        startMission(campaign, campaign.tavern[0].id, "2/2")
        assert(campaign.gold < 0)
    })
})


describe("Tavern", () => {

    it("changes its crowd over the days", () => {

        const campaign = createCampaign(11)
        const firstIds = campaign.tavern.map(e => e.id)
        for (let i = 0; i < 10; i++)
        {
            advanceDay(campaign)
            assert(campaign.tavern.length <= MAX_LOITERING)
            assert(campaign.tavern.every(e => e.leavesOn > campaign.day))
        }
        assert(campaign.tavern.every(e => firstIds.indexOf(e.id) < 0))
    })
})
