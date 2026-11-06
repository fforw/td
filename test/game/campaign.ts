import { assert, describe, it } from "vitest"

import { createCampaign, overworld, type PassedPatch, START_GOLD, START_HEROES } from "../../src/game/campaign"
import { enterJob, hasArrived, isAway, jobDays, returnHome, startJob } from "../../src/game/heroes"
import { advanceDay, frontier, missionDays, type MissionRoute, startMission } from "../../src/game/missions"
import { naturalKind, NEIGHBORS, startEdits, startPatches, unsentEdits, wantedKind } from "../../src/game/patchKinds"
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


describe("Kind edits", () => {

    it("start with the first dungeon as the only one", () => {

        for (const seed of [1, 2, 3, 4, 5])
        {
            const { kindEdits, patches } = overworld(createCampaign(seed))
            const [[key, kind], ...others] = Object.entries(kindEdits)
            assert(kind === "DUNGEON")
            assert(others.length === 0)
            assert(patches[key].kind === "DUNGEON")
        }
    })

    it("win over the natural kind", () => {

        const natural = naturalKind(7, 3, 2)
        assert(wantedKind(7, {}, 3, 2) === natural)
        assert(wantedKind(7, { "3/2": "TEMPLE" }, 3, 2) === "TEMPLE")
        assert(wantedKind(7, { "2/2": "TEMPLE" }, 3, 2) === natural)
    })

    it("has a castle as the natural kind at the origin only", () => {

        assert(naturalKind(7, 0, 0) === "CASTLE")
        for (const [q, r] of NEIGHBORS)
        {
            assert(naturalKind(7, q, r) !== "CASTLE")
        }
    })

    it("move the first dungeon on if its patch has no room", () => {

        const [key] = Object.keys(startEdits(7))
        const edits = startEdits(7, (_, q, r, kind) => q + "/" + r === key ? "EMPTY" : kind)
        const [other, ...rest] = Object.keys(edits)
        assert(other !== key)
        assert(rest.length === 0)
        assert(edits[other] === "DUNGEON")
    })

    it("don't exist for a first dungeon no patch has room for", () => {

        assert.deepEqual(startEdits(7, () => "EMPTY"), {})
    })

    it("know what start patches ended up as", () => {

        const nodes = startPatches(7, { "1/0": "TEMPLE" }, (_, q, r, kind) => kind === "TEMPLE" ? "EMPTY" : kind)
        assert(nodes.find(({ q, r }) => q === 1 && r === 0)!.kind === "EMPTY")
        assert(nodes.find(({ q, r }) => q === 0 && r === 0)!.kind === "CASTLE")
    })

    it("only get sent when new or changed", () => {

        const sent = { "1/0": "DUNGEON" } as const
        assert.deepEqual(unsentEdits({}, {}), {})
        assert.deepEqual(unsentEdits(sent, sent), {})
        assert.deepEqual(unsentEdits(sent, {}), sent)
        assert.deepEqual(
            unsentEdits({ "1/0": "TEMPLE", "2/0": "EMPTY" }, sent),
            { "1/0": "TEMPLE", "2/0": "EMPTY" }
        )
    })
})


describe("Missions", () => {

    it("keeps the way of a mission", () => {

        const campaign = createCampaign(7)
        startMission(campaign, campaign.tavern[0].id, "2/0", { ...ROUTE, way: [0, 0, 5, 5] })
        assert.deepEqual(campaign.missions[0].way, [0, 0, 5, 5])
    })

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

    it("only gets explorers of high dexterity", () => {

        const campaign = createCampaign(11)
        for (let i = 0; i < 20; i++)
        {
            assert(campaign.tavern.every(e => e.dex >= 7 && e.dex <= 10))
            advanceDay(campaign)
        }
    })

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

    it("sends a hero to a known patch, who waits there for the order to enter", () => {

        const campaign = createCampaign(21)
        const hero = campaign.heroes[0]
        const days = jobDays("1/0")
        startJob(campaign, hero.id, "1/0")
        const [job] = campaign.jobs
        assert(isAway(campaign, hero))

        for (let i = 1; i < days; i++)
        {
            advanceDay(campaign)
            assert(!hasArrived(campaign, job))
        }
        advanceDay(campaign)
        assert(hasArrived(campaign, job))

        // no matter how long it takes
        advanceDay(campaign)
        assert(isAway(campaign, hero))
        assert.equal(hero.experience, 0)

        enterJob(campaign, hero.id)
        assert(!isAway(campaign, hero))
        assert(hero.experience === 1)
    })

    it("can't enter before getting there", () => {

        const campaign = createCampaign(21)
        const hero = campaign.heroes[0]
        startJob(campaign, hero.id, "1/0")
        let error: Error | null = null
        try
        {
            enterJob(campaign, hero.id)
        }
        catch (e)
        {
            error = e as Error
        }
        assert(error !== null)
        assert(isAway(campaign, hero))
    })

    it("has a hero walk back home without entering, learning nothing", () => {

        const campaign = createCampaign(21)
        const hero = campaign.heroes[0]
        const days = jobDays("1/0")
        startJob(campaign, hero.id, "1/0", { reachable: true, way: [0, 0, 5, 5, 9, 5] })
        const [job] = campaign.jobs
        for (let i = 0; i < days; i++)
        {
            advanceDay(campaign)
        }

        const back = campaign.day + days
        returnHome(campaign, hero.id)
        assert(job.returning)
        assert(job.startDay === campaign.day)
        assert(job.endDay === back)
        assert.deepEqual(job.way, [9, 5, 5, 5, 0, 0])

        for (let i = 1; i < days; i++)
        {
            advanceDay(campaign)
            assert(isAway(campaign, hero))
            assert(!hasArrived(campaign, job))
        }
        advanceDay(campaign)
        assert(!isAway(campaign, hero))
        assert.equal(hero.experience, 0)
    })

    it("can't return before getting there", () => {

        const campaign = createCampaign(21)
        const hero = campaign.heroes[0]
        startJob(campaign, hero.id, "1/0")
        let error: Error | null = null
        try
        {
            returnHome(campaign, hero.id)
        }
        catch (e)
        {
            error = e as Error
        }
        assert(error !== null)
        assert(!campaign.jobs[0].returning)
    })

    it("keeps the way of a job", () => {

        const campaign = createCampaign(21)
        startJob(campaign, campaign.heroes[0].id, "1/0", { reachable: true, way: [0, 0, 5, 5] })
        assert.deepEqual(campaign.jobs[0].way, [0, 0, 5, 5])
    })

    it("needs a known way to the target", () => {

        const campaign = createCampaign(21)
        const hero = campaign.heroes[0]
        let error: Error | null = null
        try
        {
            startJob(campaign, hero.id, "1/0", { reachable: false, way: [0, 0, 5, 5] })
        }
        catch (e)
        {
            error = e as Error
        }
        assert(error !== null)
        assert(!isAway(campaign, hero))
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
