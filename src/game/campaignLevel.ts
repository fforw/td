import type { Campaign } from "./campaign"
import { addGear, baseGear } from "./gear"

/**
 * What the heroes and explorers do that gains the campaign experience. Progress belongs to the campaign rather than to
 * single heroes, as the player plays all of them.
 */
export type Deed = "tile" | "dungeon" | "room" | "temple" | "treasure" | "kill" | "boss"

/**
 * Experience each deed gains: little for finding things, more for what takes going there and fighting, the most for
 * beating the end boss of a level
 */
export const DEED_XP: Readonly<Record<Deed, number>> = {
    tile: 5,
    dungeon: 5,
    room: 5,
    temple: 25,
    treasure: 25,
    kill: 25,
    boss: 250
}

/**
 * Experience it takes to get from level 1 to level 2
 */
const FIRST_LEVEL_XP = 300

/**
 * Experience it takes to get from level 2 to level 3. Each level after takes the growth more than the one before, so
 * levels come slower the further the campaign goes.
 */
const SECOND_LEVEL_XP = 500
const LEVEL_XP_GROWTH = 100

/**
 * Campaign level at which monsters are halfway to the best they get, which they get ever slower towards
 */
const HALF_SKILL_LEVEL = 9

/**
 * Returns the experience it takes in all to reach a campaign level, 0 for level 1
 */
export function levelXp(level: number): number
{
    if (level <= 1)
    {
        return 0
    }
    // the steps after the first one, from SECOND_LEVEL_XP on, growing by LEVEL_XP_GROWTH
    const steps = level - 2
    return FIRST_LEVEL_XP + steps * SECOND_LEVEL_XP + LEVEL_XP_GROWTH * steps * (steps - 1) / 2
}

/**
 * Returns the campaign level for the experience gained, starting at 1
 */
export function campaignLevel(xp: number): number
{
    let level = 1
    while (levelXp(level + 1) <= xp)
    {
        level++
    }
    return level
}

/**
 * Returns the skill of all monsters at a campaign level, from 0 at level 1 towards 1, ever slower
 */
export function monsterSkill(level: number): number
{
    return (level - 1) / (level - 1 + HALF_SKILL_LEVEL)
}

/**
 * Has the campaign gain the experience of a deed. Every hero gets the base gear of each level it reaches.
 *
 * @return the levels it went up by
 */
export function gainXp(campaign: Campaign, deed: Deed): number
{
    const before = campaignLevel(campaign.xp)
    campaign.xp += DEED_XP[deed]
    const after = campaignLevel(campaign.xp)
    for (let level = before + 1; level <= after; level++)
    {
        for (const hero of campaign.heroes)
        {
            for (const piece of baseGear(level))
            {
                addGear(hero.gear, piece)
            }
        }
    }
    return after - before
}
