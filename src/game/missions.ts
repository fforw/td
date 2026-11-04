import type { Route } from "../map/route"
import { type Campaign, type Explorer, overworld, type PassedPatch, type PatchKind, patchKey } from "./campaign"
import { impressionOf, NEIGHBORS } from "./patchKinds"
import { finishJobs } from "./heroes"
import { price, returnToTavern, updateTavern } from "./tavern"

/**
 * Days per patch of distance from the castle for a job of a hero
 */
const DAYS_PER_PATCH = 3

/**
 * Highest route cost of a mission that takes the fewest days, and the route cost per further step of days. Measured on
 * generated worlds: the median route to the first targets costs about 120 and every ring further out adds about 85,
 * routes around a lake can land a few steps later.
 */
const FIRST_STEP_COST = 180
const STEP_COST = 75

/**
 * Days per step. Mission days are always 1, 3, 5, ...
 */
const DAYS_PER_STEP = 2

/**
 * Speeds at which an explorer gets a mission done one step earlier
 */
const FASTER_SPEEDS = [1.5, 2]

/**
 * Route of a mission and the kind of the target patch, which only shows after the patch got built
 */
export interface MissionRoute extends Route
{
    kind: PatchKind
    /**
     * Unknown patches the route crosses on the way
     */
    passed: PassedPatch[]
}

/**
 * Returns the keys of all unknown patches next to a discovered one, the possible mission targets.
 */
export function frontier(campaign: Campaign): string[]
{
    const { patches } = overworld(campaign)
    const keys = new Set<string>()
    for (const node of Object.values(patches))
    {
        if (node.state === "discovered")
        {
            for (const [dq, dr] of NEIGHBORS)
            {
                const key = patchKey(node.q + dq, node.r + dr)
                if (!patches[key] || patches[key].state === "passed")
                {
                    keys.add(key)
                }
            }
        }
    }
    return [...keys]
}


function parseKey(key: string): [number, number]
{
    const [q, r] = key.split("/").map(Number)
    return [q, r]
}


/**
 * Days a mission of the given explorer takes for a route of the given cost, the way back included. A failed mission
 * takes as long as what the explorer tried, so failing isn't free.
 */
export function missionDays(explorer: Pick<Explorer, "speed">, cost: number): number
{
    const steps = Math.max(0, Math.ceil((cost - FIRST_STEP_COST) / STEP_COST))
    const faster = FASTER_SPEEDS.filter(speed => explorer.speed >= speed).length
    return 1 + Math.max(0, steps - faster) * DAYS_PER_STEP
}


/**
 * Days to get from the castle to the patch at the given speed
 */
export function travelDays(target: string, speed: number): number
{
    const [q, r] = parseKey(target)
    const distance = Math.max(Math.abs(q), Math.abs(r))
    return Math.max(1, Math.ceil(distance * DAYS_PER_PATCH / speed))
}


/**
 * Returns the discovered neighbor the target is discovered from, preferring the one closest to the castle.
 */
function parentOf(campaign: Campaign, q: number, r: number): string
{
    const { patches } = overworld(campaign)
    let best: string | null = null
    let bestDistance = Infinity
    for (const [dq, dr] of NEIGHBORS)
    {
        const node = patches[patchKey(q + dq, r + dr)]
        const distance = node && Math.max(Math.abs(node.q), Math.abs(node.r))
        if (node && node.state === "discovered" && distance < bestDistance)
        {
            best = patchKey(node.q, node.r)
            bestDistance = distance
        }
    }
    if (best === null)
    {
        throw new Error("No discovered patch next to " + patchKey(q, r))
    }
    return best
}


/**
 * Hires an explorer from the tavern and sends them to an unknown patch next to a discovered one. The kind of the
 * target is known now, but only shown once the explorer reports back.
 *
 * @param campaign      campaign
 * @param explorerId    id of the explorer
 * @param target        key of the target patch
 * @param route         route to the target
 */
export function startMission(campaign: Campaign, explorerId: number, target: string, route: MissionRoute): void
{
    const explorer = campaign.tavern.find(e => e.id === explorerId)
    if (!explorer)
    {
        throw new Error("Explorer " + explorerId + " is not in the tavern")
    }
    if (frontier(campaign).indexOf(target) < 0)
    {
        throw new Error("Patch " + target + " is no mission target")
    }

    const [q, r] = parseKey(target)
    const { patches } = overworld(campaign)
    const impression = patches[target]?.impression
    patches[target] = {
        q,
        r,
        kind: route.kind,
        state: "targeted",
        parent: parentOf(campaign, q, r),
        ...(impression ? { impression } : {})
    }

    campaign.gold -= price(explorer)
    campaign.tavern = campaign.tavern.filter(e => e !== explorer)
    campaign.missions.push({
        explorer,
        target,
        startDay: campaign.day,
        endDay: campaign.day + missionDays(explorer, route.cost),
        ...(route.reachable ? {} : { failed: true }),
        ...(route.passed.length ? { passed: route.passed } : {})
    })
}


/**
 * Advances the game by one day: missions that are due report back, the tavern crowd changes and heroes come home
 * from finished jobs.
 */
export function advanceDay(campaign: Campaign): void
{
    campaign.day++
    const { day } = campaign
    const { patches } = overworld(campaign)

    const due = campaign.missions.filter(m => m.endDay <= day)
    campaign.missions = campaign.missions.filter(m => m.endDay > day)

    updateTavern(campaign)
    finishJobs(campaign)

    for (const mission of due)
    {
        for (const { q, r, kind } of mission.passed ?? [])
        {
            const key = patchKey(q, r)
            if (!patches[key])
            {
                patches[key] = { q, r, kind, state: "passed", parent: null, impression: impressionOf(kind) }
            }
        }

        const node = patches[mission.target]
        if (!mission.failed)
        {
            node.state = "discovered"
        }
        else if (node.impression)
        {
            // still unknown, it can be tried again
            node.state = "passed"
            node.parent = null
        }
        else
        {
            delete patches[mission.target]
        }
        returnToTavern(campaign, mission.explorer)
    }
}
