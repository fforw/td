import type { Campaign } from "./campaign"

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
 * Experience it takes in all to reach level 3. Each level takes more than the one before, as the total grows by the
 * power, so levels come slower the further the campaign goes.
 */
const THIRD_LEVEL_XP = 800
const LEVEL_XP_POWER = 1.5

/**
 * Experience it takes to get from level 1 to level 2, which the power makes the total for level 3
 */
const FIRST_LEVEL_XP = THIRD_LEVEL_XP / 2 ** LEVEL_XP_POWER

/**
 * Campaign level at which monsters are halfway to the best they get, which they get ever slower towards
 */
const HALF_SKILL_LEVEL = 9

/**
 * Returns the experience it takes in all to reach a campaign level, 0 for level 1
 */
export function levelXp(level: number): number
{
    return Math.round(FIRST_LEVEL_XP * (level - 1) ** LEVEL_XP_POWER)
}

/**
 * Returns the campaign level for the experience gained, starting at 1
 */
export function campaignLevel(xp: number): number
{
    let level = 1 + Math.floor((Math.max(0, xp) / FIRST_LEVEL_XP) ** (1 / LEVEL_XP_POWER))
    // the power can be off by a bit either way
    while (levelXp(level + 1) <= xp)
    {
        level++
    }
    while (level > 1 && levelXp(level) > xp)
    {
        level--
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
 * Has the campaign gain the experience of a deed
 *
 * @return the levels it went up by
 */
export function gainXp(campaign: Campaign, deed: Deed): number
{
    const before = campaignLevel(campaign.xp)
    campaign.xp += DEED_XP[deed]
    return campaignLevel(campaign.xp) - before
}
