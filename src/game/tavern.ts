import { patchSeed, rng, withSeed } from "../math/random"
import { meepleNameGenerator } from "../meeple/nameGenerator"
import type { Campaign, Explorer } from "./campaign"

/**
 * Most explorers loitering in the tavern at once
 */
export const MAX_LOITERING = 4

/**
 * Speed gained per mission, as a factor, and the most an explorer can reach
 */
const SPEED_GAIN = 1.1
const MAX_SPEED = 2.5

/**
 * Mixed into the seed of a day so the tavern gets a random sequence of its own
 */
const TAVERN_SALT = 0x7a7e


/**
 * Price in gold for hiring an explorer for one mission
 */
export function price(explorer: Explorer): number
{
    return Math.round(explorer.speed * 40 + explorer.wisdom * 15)
}


/**
 * Days an explorer stays in the tavern, counted from the given day
 */
function stay(day: number): number
{
    return day + rng.nextInt(2, 5)
}


/**
 * Creates new explorers arriving at the tavern on the campaign's current day. The day decides who arrives, so the
 * crowd is reproducible from the seed.
 *
 * @param campaign  campaign, its next id is advanced
 * @param count     maximum number of arrivals, the actual number is random unless this is the first day
 */
export function arrivals(campaign: Campaign, count: number): Explorer[]
{
    const { seed, day } = campaign
    return withSeed(patchSeed(seed ^ TAVERN_SALT, day, 0), () => {

        const n = day === 1 ? count : rng.nextInt(0, count)
        const explorers: Explorer[] = []
        for (let i = 0; i < n; i++)
        {
            explorers.push({
                id: campaign.nextId++,
                name: meepleNameGenerator(4),
                speed: Math.round(rng.next(0.8, 1.5) * 100) / 100,
                wisdom: rng.nextInt(1, 5),
                experience: 0,
                leavesOn: stay(day)
            })
        }
        return explorers
    })
}


/**
 * Lets the crowd change at the start of a new day: explorers whose stay is over leave, new ones may arrive.
 */
export function updateTavern(campaign: Campaign): void
{
    const { day } = campaign
    campaign.tavern = campaign.tavern.filter(explorer => explorer.leavesOn > day)

    const room = MAX_LOITERING - campaign.tavern.length
    if (room > 0)
    {
        campaign.tavern.push(...arrivals(campaign, Math.min(2, room)))
    }
}


/**
 * An explorer back from a mission gained experience and hangs around the tavern for a while.
 */
export function returnToTavern(campaign: Campaign, explorer: Explorer): void
{
    const { seed, day } = campaign
    explorer.experience++
    explorer.speed = Math.min(MAX_SPEED, Math.round(explorer.speed * SPEED_GAIN * 100) / 100)
    explorer.leavesOn = withSeed(patchSeed(seed ^ TAVERN_SALT, day, explorer.id), () => stay(day))
    campaign.tavern.push(explorer)
}
