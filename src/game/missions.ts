import { type Campaign, type Explorer, overworld, patchKey } from "./campaign"
import { NEIGHBORS, randomKind } from "./patchKinds"
import { finishJobs } from "./heroes"
import { price, returnToTavern, updateTavern } from "./tavern"

/**
 * Days per patch of distance from the castle for an explorer of speed 1. Stands in for the path cost until missions
 * use A* (plan 1.1).
 */
const DAYS_PER_PATCH = 3

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
                if (!patches[key])
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
 * Days a mission of the given explorer to the given patch takes
 */
export function missionDays(explorer: Explorer, target: string): number
{
    return travelDays(target, explorer.speed)
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
 * target is rolled now, but only shown once the explorer reports back.
 */
export function startMission(campaign: Campaign, explorerId: number, target: string): void
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
    overworld(campaign).patches[target] = {
        q,
        r,
        kind: randomKind(campaign.seed, q, r),
        state: "targeted",
        parent: parentOf(campaign, q, r)
    }

    campaign.gold -= price(explorer)
    campaign.tavern = campaign.tavern.filter(e => e !== explorer)
    campaign.missions.push({
        explorer,
        target,
        startDay: campaign.day,
        endDay: campaign.day + missionDays(explorer, target)
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
        patches[mission.target].state = "discovered"
        returnToTavern(campaign, mission.explorer)
    }
}
