import type { ItemName } from "../items/itemSprite"
import { rng } from "../math/random"

// stats, classes and the rules for what a character can equip. Plain data without three.js, like the item animations.

/**
 * Base stats of a meeple, monster or NPC
 */
export interface Stats
{
    /**
     * Hit points
     */
    hp: number
    /**
     * Magic points
     */
    mp: number
    /**
     * Strength
     */
    str: number
    /**
     * Dexterity
     */
    dex: number
}

/**
 * What kind of item something is, which decides who can equip it
 */
export type ItemType = "weapon" | "twoHanded" | "tool" | "magic" | "misc"

/**
 * Type of each item. Sprites that are only drawn instead of another item, like the nocked bow, have none and cannot
 * be equipped.
 */
export const ITEM_TYPES: Partial<Record<ItemName, ItemType>> = {
    sword_silver: "weapon",
    flail_silver: "weapon",
    shield_silver: "shield",
    // held in one hand, like Gandalf
    staff: "magic",
    axe_silver: "tool",
    pick_silver: "tool",
    hammer_silver: "tool",
    shovel_silver: "tool",
    hoe_silver: "tool",
    bow: "twoHanded",
    arrow: "misc",
    apple: "misc"
}

export interface CharacterClass
{
    /**
     * Item types characters of the class can equip
     */
    equip: readonly ItemType[]
    /**
     * Minimum stats a character needs to have the class
     */
    min?: Partial<Stats>
}

/**
 * All classes by name
 */
export const CLASSES = {
    peasant: { equip: ["tool", "misc"] },
    fighter: { equip: ["weapon", "twoHanded", "misc"], min: { hp: 10, str: 6 } },
    wizard: { equip: ["magic", "misc"], min: { mp: 8 } },
} as const satisfies Record<string, CharacterClass>

export type ClassName = keyof typeof CLASSES

/**
 * Share of the walking speed each point of dexterity above 1 adds
 */
const DEX_WALK_SPEED = 0.05

export interface Character
{
    stats: Stats
    /**
     * Classes of the character. It has the rules of all of them.
     */
    classes: readonly ClassName[]
}


/**
 * Returns whether the stats meet the minimum stats of a class
 */
export function canHaveClass(stats: Stats, name: ClassName): boolean
{
    const min: Partial<Stats> = (CLASSES[name] as CharacterClass).min ?? {}
    return (Object.keys(min) as (keyof Stats)[]).every(stat => stats[stat] >= min[stat]!)
}


/**
 * Checks whether a character meets the minimum stats of all its classes
 *
 * @return null if it does, or the reason why it does not
 */
export function checkClasses(character: Character): string | null
{
    const name = character.classes.find(name => !canHaveClass(character.stats, name))
    return name ? `stats too low for ${name}` : null
}


/**
 * Returns the factor the given dexterity has on the walking speed
 */
export function dexWalkFactor(dex: number): number
{
    return 1 + (dex - 1) * DEX_WALK_SPEED
}


/**
 * Returns the item types the character's classes allow
 */
export function equippableTypes(character: Character): Set<ItemType>
{
    return new Set(character.classes.flatMap(name => CLASSES[name].equip))
}


/**
 * Checks whether a character can hold the given items
 *
 * @param character character
 * @param right     item in the right hand
 * @param left      item in the left hand
 *
 * @return null if it can, or the reason why it cannot
 */
export function canEquip(character: Character, right?: ItemName, left?: ItemName): string | null
{
    for (const item of [right, left])
    {
        if (!item)
        {
            continue
        }
        const type = ITEM_TYPES[item]
        if (!type)
        {
            return `${item} is not an item`
        }
        if (!equippableTypes(character).has(type))
        {
            return `${item} needs a class that can equip ${type} items`
        }
        if (type === "twoHanded" && right && left)
        {
            return `${item} needs both hands`
        }
    }
    return null
}


/**
 * Returns random base stats from the shared random sequence
 */
export function randomStats(): Stats
{
    return {
        hp: rng.nextInt(5, 20),
        // one in ten has the magic for a wizard
        mp: rng.next() < 0.1 ? rng.nextInt(CLASSES.wizard.min.mp, 12) : rng.nextInt(0, CLASSES.wizard.min.mp - 1),
        str: rng.nextInt(1, 10),
        dex: rng.nextInt(1, 10)
    }
}


const CLASS_NAMES = Object.keys(CLASSES) as ClassName[]

/**
 * Returns a random character from the shared random sequence
 */
export function randomCharacter(): Character
{
    const stats = randomStats()
    // one or sometimes two of the classes the stats allow, in random order. Anyone can be a peasant, and anyone who
    // can be a wizard is one first.
    const classes = CLASS_NAMES
        .filter(name => canHaveClass(stats, name))
        .map(name => ({ name, order: name === "wizard" ? -1 : rng.next() }))
        .sort((a, b) => a.order - b.order)
        .map(c => c.name)
    return { stats, classes: classes.slice(0, rng.next() < 0.2 ? 2 : 1) }
}
