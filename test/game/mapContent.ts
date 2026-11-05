import { assert, describe, it, vi } from "vitest"

import { type Campaign, createCampaign, overworld } from "../../src/game/campaign"
import { returnHome, startJob } from "../../src/game/heroes"
import { borderArrow, fitSheet, mapContent, type MapMarker, PATCH_DEPTH, PATCH_WIDTH, patchArea, patchCenter } from "../../src/game/mapContent"
import { advanceDay, type MissionRoute, startMission } from "../../src/game/missions"
import { generatePatch } from "../../src/map/generatePatch"
import { PATCH_SIZE } from "../../src/map/HexagonPatch"
import { FACE_SIZE } from "../../src/map/scale"


const SEED = 1234

const ROUTE: MissionRoute = { reachable: true, cost: 100, kind: "DUNGEON", passed: [] }


function marker(campaign: Campaign, key: string): MapMarker | undefined
{
    return mapContent(campaign).markers.find(m => m.key === key)
}


function hire(campaign: Campaign, target: string, route: MissionRoute = ROUTE): void
{
    startMission(campaign, campaign.tavern[0].id, target, route)
}


describe("Map sheet", () => {

    const CELLS = [{ q: -1, r: -1 }, { q: 1, r: 1 }, { q: 0, r: 0 }]

    it("leaves nothing over on the sides if the room is wide", () => {

        const { width, height, view } = fitSheet(CELLS, 2000, 500)
        assert(height === 500)
        assert(width === Math.round(3 * PATCH_WIDTH * view.scale))
        assert(width < 2000)
    })

    it("leaves nothing over at the top and bottom if the room is high", () => {

        const { width, height, view } = fitSheet(CELLS, 500, 2000)
        assert(width === 500)
        assert(height === Math.round(3 * PATCH_DEPTH * view.scale))
        assert(height < 2000)
    })

    it("starts its view at the corner of the first patch", () => {

        const { view } = fitSheet(CELLS, 800, 800)
        const { x, y } = patchArea(-1, -1)
        assert(view.x === x)
        assert(view.y === y)
    })

    it("fits a single patch", () => {

        const { width, height } = fitSheet([{ q: 2, r: 3 }], 800, 800)
        assert(width === 800)
        assert.closeTo(height, 800 * PATCH_DEPTH / PATCH_WIDTH, 1)
    })
})


describe("Map content", () => {

    it("starts with the start patches known, nothing rough and the ring around them as targets", () => {
        const campaign = createCampaign(SEED)
        const { known, rough, targets } = mapContent(campaign)

        assert(known.length === 9)
        assert(rough.length === 0)
        assert(targets.length === 16)
    })

    it("has points of interest on known patches other than the castle and empty ones", () => {
        const campaign = createCampaign(SEED)
        const pois = mapContent(campaign).markers.filter(m => m.type === "poi")

        const expected = Object.values(overworld(campaign).patches)
            .filter(({ kind }) => kind !== "CASTLE" && kind !== "EMPTY")
        assert(pois.length === expected.length)
        assert(pois.some(m => m.type === "poi" && m.kind === "DUNGEON"))
    })

    it("shows the days of a hero at a point of interest", () => {
        const campaign = createCampaign(SEED)
        const poi = mapContent(campaign).markers.find(m => m.type === "poi")!
        startJob(campaign, campaign.heroes[0].id, poi.key)

        const away = marker(campaign, poi.key)
        assert(away?.type === "poi" && away.days === campaign.jobs[0].endDay - campaign.day)
    })

    it("frees a point of interest for another hero once the hero there returns", () => {
        const campaign = createCampaign(SEED)
        const poi = mapContent(campaign).markers.find(m => m.type === "poi")!
        startJob(campaign, campaign.heroes[0].id, poi.key)
        campaign.day = campaign.jobs[0].endDay
        returnHome(campaign, campaign.heroes[0].id)

        const free = marker(campaign, poi.key)
        assert(free?.type === "poi" && free.days === undefined)
    })

    it("shows the days of an explorer on the way instead of a target", () => {
        const campaign = createCampaign(SEED)
        hire(campaign, "2/0")

        const targeted = marker(campaign, "2/0")
        assert(targeted?.type === "targeted" && targeted.days === campaign.missions[0].endDay - campaign.day)
        assert(!mapContent(campaign).targets.some(({ key }) => key === "2/0"))
        assert(mapContent(campaign).rough.length === 0)
    })

    it("draws passed patches rough and keeps the ones next to something known as targets", () => {
        const campaign = createCampaign(SEED)
        // 3/0 is next to the target once that is known, 2/3 is too far out to be a target
        hire(campaign, "2/0", {
            ...ROUTE,
            kind: "EMPTY",
            passed: [{ q: 3, r: 0, kind: "DUNGEON" }, { q: 2, r: 3, kind: "EMPTY" }]
        })
        for (let i = 0; i < 10; i++)
        {
            advanceDay(campaign)
        }

        const { known, rough } = mapContent(campaign)
        assert(known.some(({ q, r }) => q === 2 && r === 0))
        assert.sameMembers(rough.map(({ q, r }) => q + "/" + r), ["3/0", "2/3"])

        const { targets } = mapContent(campaign)
        assert(targets.find(({ key }) => key === "3/0")?.impression === "dangerous")
        assert(marker(campaign, "3/0")?.type === "passed")
        const far = marker(campaign, "2/3")
        assert(far?.type === "passed" && far.impression === "safe")
    })

    it("stays rough while an explorer is on the way to a passed patch", () => {
        const campaign = createCampaign(SEED)
        hire(campaign, "2/0", { ...ROUTE, kind: "EMPTY", passed: [{ q: 3, r: 0, kind: "EMPTY" }] })
        for (let i = 0; i < 10; i++)
        {
            advanceDay(campaign)
        }
        hire(campaign, "3/0", { ...ROUTE, kind: "EMPTY" })

        const { rough } = mapContent(campaign)
        assert(rough.length === 1 && rough[0].q === 3 && rough[0].state === "targeted")
    })

    it("doesn't tell the kind of a patch that isn't discovered", () => {
        const campaign = createCampaign(SEED)
        hire(campaign, "2/0")
        assert(!mapContent(campaign).markers.some(m => m.key === "2/0" && "kind" in m))
    })
})


describe("borderArrow", () => {

    const BAND = 50
    const content = mapContent(createCampaign(SEED))

    function at(q: number, r: number, fx: number, fy: number)
    {
        const [x, y] = patchCenter(q, r)
        return borderArrow(content, x + fx * PATCH_WIDTH / 2, y + fy * PATCH_DEPTH / 2, BAND)
    }

    it("appears close to a side shared with an unknown patch", () => {
        const arrow = at(1, 0, 0.95, 0)!
        assert(arrow.target.key === "2/0" && arrow.dq === 1 && arrow.dr === 0)
        assert(Math.abs(arrow.x - (patchCenter(1, 0)[0] + PATCH_WIDTH / 2)) < 0.001)
    })

    it("doesn't appear inside the known part or away from the sides", () => {
        assert(at(0, 0, 0.95, 0) === null)
        assert(at(1, 0, -0.95, 0) === null)
        assert(at(1, 0, 0, 0) === null)
    })

    it("points at the diagonal neighbor at a corner", () => {
        const arrow = at(1, 1, 0.95, 0.95)!
        assert(arrow.target.key === "2/2" && arrow.dq === 1 && arrow.dr === 1)
    })

    it("points straight where two patches meet along an edge", () => {
        // close to the corner of 0/-1, with 1/-2 across it, which has 1/-1 below it
        const arrow = at(0, -1, 0.95, -0.95)!
        assert(arrow.target.key === "0/-2" && arrow.dq === 0 && arrow.dr === -1)

        const east = at(1, 0, 0.95, 0.95)!
        assert(east.target.key === "2/0" && east.dq === 1 && east.dr === 0)
    })

    it("takes the closer of two sides next to a corner of a block of targets", () => {
        const known = content.known.filter(({ q, r }) => q !== 2)
        const targets = content.targets.filter(({ key }) => key !== "2/2")
        const [x, y] = patchCenter(1, 1)
        const arrow = borderArrow({ known, targets }, x + PATCH_WIDTH / 2 - 5, y + PATCH_DEPTH / 2 - 40, BAND)!
        assert(arrow.target.key === "2/1" && arrow.dq === 1 && arrow.dr === 0)
    })

    it("also appears with the pointer past the border, coming from the patch sharing a side", () => {
        const side = at(2, 0, 0, 0)!
        assert(side.target.key === "2/0" && side.dq === 1 && side.dr === 0)
        const corner = at(2, 2, 0, 0)!
        assert(corner.target.key === "2/2" && corner.dq === 1 && corner.dr === 1)
        assert(at(5, 5, 0, 0) === null)
    })
})


describe("patchCenter", () => {

    it("is the middle of the patch", () => {
        // generating logs every hexagon count
        const log = vi.spyOn(console, "log").mockImplementation(() => {})
        for (const [q, r] of [[0, 0], [2, 1], [-3, -2]])
        {
            const { positions } = generatePatch(q * PATCH_SIZE, r * PATCH_SIZE, SEED, FACE_SIZE, "EMPTY").patch
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
            for (let i = 0; i < positions.length; i += 3)
            {
                minX = Math.min(minX, positions[i])
                maxX = Math.max(maxX, positions[i])
                minY = Math.min(minY, positions[i + 1])
                maxY = Math.max(maxY, positions[i + 1])
            }
            const [x, y] = patchCenter(q, r)
            assert(Math.abs(x - (minX + maxX) / 2) < 1)
            assert(Math.abs(y - (minY + maxY) / 2) < 1)
        }
        log.mockRestore()
    })
})
