import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { assert, describe, it } from "vitest"

import { type Campaign, createCampaign, SAVE_VERSION, START_HEROES } from "../../src/game/campaign"
import { advanceDay, startMission } from "../../src/game/missions"
import { parseSave, serializeSave } from "../../src/game/storage"


describe("Saves", () => {

    it("round-trips a campaign", () => {

        const campaign = createCampaign(9)
        startMission(campaign, campaign.tavern[0].id, "-2/0", { reachable: true, cost: 100, kind: "EMPTY" })
        advanceDay(campaign)
        assert.deepEqual(parseSave(serializeSave(campaign)), campaign)
    })

    it("refuses saves of another generator", () => {

        const campaign = createCampaign(9)
        campaign.generatorVersion = -1
        let error: Error | null = null
        try
        {
            parseSave(serializeSave(campaign))
        }
        catch (e)
        {
            error = e as Error
        }
        assert(error !== null)
    })
})


describe("Save fixtures", () => {

    const dir = join(import.meta.dirname, "../fixtures/saves")

    for (const file of readdirSync(dir).filter(name => name.endsWith(".json")))
    {
        it("loads " + file + " and plays on", () => {

            const campaign = parseSave(readFileSync(join(dir, file), "utf8"))
            const day = campaign.day
            advanceDay(campaign)
            assert(campaign.day === day + 1)
        })
    }
})


describe("Save migration", () => {

    it("gives version 1 saves local heroes", () => {

        const campaign = createCampaign(9) as Partial<Campaign>
        delete campaign.heroes
        delete campaign.jobs
        campaign.saveVersion = 1

        const migrated = parseSave(JSON.stringify(campaign))
        assert(migrated.saveVersion === SAVE_VERSION)
        assert(migrated.heroes.length === START_HEROES)
        assert.deepEqual(migrated.jobs, [])
    })
})
