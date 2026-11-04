import { assert, describe, it } from "vitest"

import { createCampaign, overworld, type PassedPatch, START_GOLD, START_HEROES } from "../../src/game/campaign"
import { isAway, jobDays, startJob } from "../../src/game/heroes"
import { advanceDay, frontier, missionDays, type MissionRoute, startMission } from "../../src/game/missions"
import { MAX_LOITERING, price } from "../../src/game/tavern"


const ROUTE: MissionRoute = { reachable: true, cost: 100, kind: "EMPTY", passed: [] }


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
        const days = missionDays(explorer, ROUTE.cost)
        const cost = price(explorer)

        startMission(campaign, explorer.id, "2/0", ROUTE)

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

    it("leaves the target unknown if there is no route", () => {

        const campaign = createCampaign(7)
        const explorer = campaign.tavern[0]
        const days = missionDays(explorer, 300)

        startMission(campaign, explorer.id, "2/0", { reachable: false, cost: 300, kind: "DUNGEON", passed: [] })
        assert(frontier(campaign).indexOf("2/0") < 0)

        for (let i = 0; i < days; i++)
        {
            advanceDay(campaign)
        }
        assert(overworld(campaign).patches["2/0"] === undefined)
        assert(frontier(campaign).indexOf("2/0") >= 0)

        const back = campaign.tavern.find(e => e.id === explorer.id)!
        assert(back.experience === 1)
    })

    it("only notes patches passed on the way, without discovering them", () => {

        const campaign = createCampaign(7)
        const explorer = campaign.tavern[0]
        const { patches } = overworld(campaign)
        const passed: PassedPatch[] = [{ q: 2, r: 0, kind: "DUNGEON" }, { q: 3, r: 0, kind: "TEMPLE" }]

        startMission(campaign, explorer.id, "2/1", { ...ROUTE, passed })
        assert(!("2/0" in patches))

        advanceDay(campaign)
        assert(patches["2/0"].state === "passed")
        assert(patches["2/0"].impression === "dangerous")
        assert(patches["3/0"].impression === "safe")
        assert(patches["2/1"].state === "discovered")

        // still a target, and only a real visit discovers it
        assert(frontier(campaign).indexOf("2/0") >= 0)
        assert(campaign.tavern.length > 0)
        startMission(campaign, campaign.tavern[0].id, "2/0", { ...ROUTE, kind: "DUNGEON" })
        assert(overworld(campaign).patches["2/0"].state === "targeted")
    })

    it("remembers the impression of a target that can't be reached", () => {

        const campaign = createCampaign(7)
        const { patches } = overworld(campaign)
        patches["2/0"] = { q: 2, r: 0, kind: "DUNGEON", state: "passed", parent: null, impression: "dangerous" }

        startMission(campaign, campaign.tavern[0].id, "2/0", { reachable: false, cost: 0, kind: "DUNGEON", passed: [] })
        advanceDay(campaign)
        assert(patches["2/0"].state === "passed")
        assert(patches["2/0"].impression === "dangerous")
    })

    it("takes a coarse number of days, which good explorers bump down", () => {

        const explorer = (speed: number) => ({ id: 1, name: "", speed, wisdom: 1, experience: 0, leavesOn: 9 })

        const slow = explorer(1)
        const costs = [0, 50, 100, 150, 180, 181, 255, 256, 330, 331, 800]
        for (const cost of costs)
        {
            assert(missionDays(slow, cost) % 2 === 1)
        }
        assert(missionDays(slow, 0) === 1)
        assert(missionDays(slow, 180) === 1)
        assert(missionDays(slow, 181) === 3)
        assert(missionDays(slow, 256) === 5)

        assert(missionDays(explorer(1.5), 256) === 3)
        assert(missionDays(explorer(2), 256) === 1)
        assert(missionDays(explorer(2.5), 0) === 1)
    })

    it("only targets unknown patches next to discovered ones", () => {

        const campaign = createCampaign(3)
        const id = campaign.tavern[0].id
        let error: Error | null = null
        try
        {
            startMission(campaign, id, "3/0", ROUTE)
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
        startMission(campaign, campaign.tavern[0].id, "2/2", ROUTE)
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


describe("Heroes", () => {

    it("starts with local heroes beyond peasants", () => {

        const campaign = createCampaign(21)
        assert(campaign.heroes.length === START_HEROES)
        assert(campaign.heroes.every(hero => hero.character.classes.some(name => name !== "peasant")))
        assert(campaign.heroes.every(hero => campaign.tavern.every(e => e.id !== hero.id)))
    })

    it("sends a hero to a known patch and back", () => {

        const campaign = createCampaign(21)
        const hero = campaign.heroes[0]
        const days = jobDays("1/0")
        startJob(campaign, hero.id, "1/0")
        assert(isAway(campaign, hero))

        for (let i = 0; i < days; i++)
        {
            advanceDay(campaign)
        }
        assert(!isAway(campaign, hero))
        assert(hero.experience === 1)
    })

    it("only takes jobs at known patches other than the castle", () => {

        const campaign = createCampaign(21)
        const id = campaign.heroes[0].id
        for (const target of ["0/0", "2/0"])
        {
            let error: Error | null = null
            try
            {
                startJob(campaign, id, target)
            }
            catch (e)
            {
                error = e as Error
            }
            assert(error !== null)
        }
    })
})
