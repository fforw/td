import { patchSeed, withSeed } from "../math/random"
import { randomCharacter } from "../meeple/character"
import { meepleNameGenerator } from "../meeple/nameGenerator"
import { type Campaign, type Hero, overworld } from "./campaign"
import { travelDays } from "./missions"

/**
 * Mixed into the campaign seed for the heroes
 */
const HERO_SALT = 0x4e70


/**
 * Creates local heroes, gifted individuals born in the castle: meeples with at least one class beyond peasant. They
 * start out small-time and learn from their jobs.
 *
 * @param campaign  campaign, its next id is advanced
 * @param count     number of heroes
 */
export function createHeroes(campaign: Campaign, count: number): Hero[]
{
    return withSeed(patchSeed(campaign.seed ^ HERO_SALT, campaign.day, campaign.nextId), () => {
        const heroes: Hero[] = []
        while (heroes.length < count)
        {
            const character = randomCharacter()
            if (character.classes.some(name => name !== "peasant"))
            {
                heroes.push({ id: campaign.nextId++, name: meepleNameGenerator(4), character, experience: 0 })
            }
        }
        return heroes
    })
}


/**
 * Returns the keys of the known patches heroes can take a job at: every discovered patch but the castle.
 */
export function jobTargets(campaign: Campaign): string[]
{
    return Object.entries(overworld(campaign).patches)
        .filter(([, node]) => node.state === "discovered" && node.kind !== "CASTLE")
        .map(([key]) => key)
}


export function isAway(campaign: Campaign, hero: Hero): boolean
{
    return campaign.jobs.some(job => job.heroId === hero.id)
}


/**
 * Days a hero's job at the patch takes: the way there and back. What happens there comes with the levels.
 */
export function jobDays(target: string): number
{
    return travelDays(target, 1) * 2
}


/**
 * Sends a hero at home on a job at a known patch
 */
export function startJob(campaign: Campaign, heroId: number, target: string): void
{
    const hero = campaign.heroes.find(h => h.id === heroId)
    if (!hero)
    {
        throw new Error("No hero " + heroId)
    }
    if (isAway(campaign, hero))
    {
        throw new Error(hero.name + " is away")
    }
    if (jobTargets(campaign).indexOf(target) < 0)
    {
        throw new Error("Patch " + target + " is no job target")
    }
    campaign.jobs.push({ heroId, target, startDay: campaign.day, endDay: campaign.day + jobDays(target) })
}


/**
 * Brings the heroes whose jobs are done back home, a bit more experienced
 */
export function finishJobs(campaign: Campaign): void
{
    const { day } = campaign
    for (const job of campaign.jobs.filter(j => j.endDay <= day))
    {
        campaign.heroes.find(h => h.id === job.heroId)!.experience++
    }
    campaign.jobs = campaign.jobs.filter(j => j.endDay > day)
}

