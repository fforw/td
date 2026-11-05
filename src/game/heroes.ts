import { patchSeed, withSeed } from "../math/random"
import { randomCharacter } from "../meeple/character"
import { meepleNameGenerator } from "../meeple/nameGenerator"
import { type Campaign, type Hero, type Job, overworld } from "./campaign"
import { reverseWay } from "./journey"
import { type MissionRoute, travelDays } from "./missions"

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
 * Days a hero takes to get to the patch of a job
 */
export function jobDays(target: string): number
{
    return travelDays(target, 1)
}


/**
 * Returns whether the hero of the job has got there and waits for the order to enter
 */
export function hasArrived({ day }: Campaign, job: Job): boolean
{
    return job.endDay <= day
}


/**
 * Sends a hero at home on a job at a known patch
 *
 * @param campaign  campaign
 * @param heroId    id of the hero
 * @param target    key of the target patch
 * @param route     route over known patches, without one the hero gets there unseen
 */
export function startJob(campaign: Campaign, heroId: number, target: string, route?: Pick<MissionRoute, "reachable" | "way">): void
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
    if (route && !route.reachable)
    {
        throw new Error("No known way to " + target)
    }
    campaign.jobs.push({
        heroId,
        target,
        startDay: campaign.day,
        endDay: campaign.day + jobDays(target),
        ...(route?.way ? { way: route.way } : {})
    })
}


/**
 * Has a hero who got to the target of their job enter it. What happens there comes with the levels, for now the hero
 * comes straight back home a bit more experienced.
 */
export function enterJob(campaign: Campaign, heroId: number): void
{
    const job = campaign.jobs.find(j => j.heroId === heroId)
    if (!job || !hasArrived(campaign, job))
    {
        throw new Error("Hero " + heroId + " isn't at a target")
    }
    campaign.heroes.find(h => h.id === heroId)!.experience++
    campaign.jobs = campaign.jobs.filter(j => j !== job)
}


/**
 * Has a hero who got to the target of their job walk back to the castle without entering it, which takes as long as
 * getting there did. The hero is home and learned nothing once the days are up.
 */
export function returnHome(campaign: Campaign, heroId: number): void
{
    const job = campaign.jobs.find(j => j.heroId === heroId)
    if (!job || !hasArrived(campaign, job))
    {
        throw new Error("Hero " + heroId + " isn't at a target")
    }
    job.returning = true
    job.startDay = campaign.day
    job.endDay = campaign.day + jobDays(job.target)
    if (job.way)
    {
        job.way = reverseWay(job.way)
    }
}
