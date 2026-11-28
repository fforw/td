import type Prando from "prando"
import { FIGURE_SCALE } from "../meeple/figureScale"

/**
 * What a hero carries besides sword and shield, used with R2: weapons to throw, and wands and scrolls that shoot glowing
 * balls. See plans/action/gear.md.
 */
export type GearKind = "dagger" | "axe" | "wand" | "scroll"

export const GEAR_KINDS: readonly GearKind[] = ["dagger", "axe", "wand", "scroll"]

/**
 * What the balls of a wand or scroll are made of, which only decides their color for now
 */
export type Element = "fire" | "frost" | "venom" | "arcane"

export const ELEMENTS: readonly Element[] = ["fire", "frost", "venom", "arcane"]

/**
 * Pieces of the same kind and element in one, plain JSON for the saves
 */
export interface Gear
{
    kind: GearKind
    /** what a wand or scroll shoots, missing for weapons */
    element?: Element
    /** how many weapons or uses of a scroll there are, 1 for a wand, which can be used without end */
    count: number
}

/**
 * How a kind of gear works when used
 */
export interface GearUse
{
    /** hit points it takes from a monster */
    damage: number
    /** world units per second it flies */
    speed: number
    /** world units it flies at most */
    range: number
    /** seconds until the next piece can be used */
    wait: number
}

export const GEAR_USES: Readonly<Record<GearKind, GearUse>> = {
    dagger: { damage: 3, speed: 9 * FIGURE_SCALE, range: 6 * FIGURE_SCALE, wait: 0.35 },
    axe: { damage: 5, speed: 6 * FIGURE_SCALE, range: 5 * FIGURE_SCALE, wait: 0.6 },
    // what goes without end has to be weak and slow to use
    wand: { damage: 1, speed: 7 * FIGURE_SCALE, range: 4 * FIGURE_SCALE, wait: 0.7 },
    scroll: { damage: 4, speed: 6 * FIGURE_SCALE, range: 5 * FIGURE_SCALE, wait: 0.6 }
}

/**
 * Colors of the glowing balls by element: the hot middle, and the glow around it
 */
export const ELEMENT_COLORS: Readonly<Record<Element, { core: string, glow: string }>> = {
    fire: { core: "#ffe0a0", glow: "#ff5a14" },
    frost: { core: "#e8f6ff", glow: "#3aa8ff" },
    venom: { core: "#eaffc0", glow: "#4fd21e" },
    arcane: { core: "#f6dcff", glow: "#b040ff" }
}

/**
 * Share of the chests with a piece of gear in them
 */
export const GEAR_CHANCE = 0.25

/**
 * Number of weapons or uses a piece found in a chest has
 */
const FOUND_COUNTS: Readonly<Record<GearKind, number>> = { dagger: 2, axe: 1, wand: 1, scroll: 3 }

/**
 * How often each kind gets found in chests, against the others
 */
const FOUND_WEIGHTS: Readonly<Record<GearKind, number>> = { dagger: 4, axe: 2, wand: 1, scroll: 3 }

const NAMES: Readonly<Record<GearKind, [string, string]>> = {
    dagger: ["dagger", "daggers"],
    axe: ["throwing axe", "throwing axes"],
    wand: ["wand", "wands"],
    scroll: ["scroll", "scrolls"]
}


/**
 * Returns whether a kind of gear gets thrown, and has to be fetched again, rather than shooting balls
 */
export function isThrown(kind: GearKind): boolean
{
    return kind === "dagger" || kind === "axe"
}


/**
 * Returns whether two pieces go together into one
 */
export function sameGear(a: Gear, b: Gear): boolean
{
    return a.kind === b.kind && a.element === b.element
}


/**
 * Adds a piece to what a hero carries, together with one of the same kind if there is one. Wands stay one, as one can be
 * used without end.
 */
export function addGear(gear: Gear[], piece: Gear): void
{
    const same = gear.find(other => sameGear(other, piece))
    if (!same)
    {
        gear.push({ ...piece, count: piece.kind === "wand" ? 1 : piece.count })
    }
    else if (same.kind !== "wand")
    {
        same.count += piece.count
    }
}


/**
 * Takes weapons or uses from a piece a hero carries, which goes once nothing is left of it. Wands don't get used up.
 *
 * @return the index of the current piece after, which stays on the same piece as far as it can
 */
export function spendGear(gear: Gear[], index: number, current: number, count = 1): number
{
    const piece = gear[index]
    if (!piece || piece.kind === "wand")
    {
        return current
    }
    piece.count -= count
    if (piece.count > 0)
    {
        return current
    }
    gear.splice(index, 1)
    return Math.max(0, Math.min(current > index ? current - 1 : current, gear.length - 1))
}


/**
 * Returns what every hero gets when the campaign reaches a level: daggers first, then wands, axes and scrolls, and from
 * then on more of them in turns, for the heroes to get stronger along with the monsters
 */
export function baseGear(level: number): Gear[]
{
    switch (level)
    {
        case 1:
            return [{ kind: "dagger", count: 4 }]
        case 2:
            return [{ kind: "wand", element: "fire", count: 1 }]
        case 3:
            return [{ kind: "axe", count: 2 }]
        case 4:
            return [{ kind: "scroll", element: "frost", count: 3 }]
        default:
            return level % 2 === 1
                ? [{ kind: "dagger", count: 2 }, { kind: "axe", count: 1 }]
                : [{ kind: "scroll", element: ELEMENTS[(level / 2) % ELEMENTS.length], count: 2 }]
    }
}


/**
 * Returns the base gear of all levels up to the given one, for a hero who only comes along at that level
 */
export function baseGearUpTo(level: number): Gear[]
{
    const gear: Gear[] = []
    for (let up = 1; up <= level; up++)
    {
        for (const piece of baseGear(up))
        {
            addGear(gear, piece)
        }
    }
    return gear
}


/**
 * Returns a piece of gear to be found in a chest
 */
export function foundGear(random: Prando): Gear
{
    const total = GEAR_KINDS.reduce((sum, kind) => sum + FOUND_WEIGHTS[kind], 0)
    let pick = random.next(0, total)
    const kind = GEAR_KINDS.find(kind => (pick -= FOUND_WEIGHTS[kind]) < 0) ?? GEAR_KINDS[0]
    // drawn for all kinds, for the same chest to have the same piece whatever else changes about them
    const element = ELEMENTS[random.nextInt(0, ELEMENTS.length - 1)]
    return isThrown(kind) ? { kind, count: FOUND_COUNTS[kind] } : { kind, element, count: FOUND_COUNTS[kind] }
}


/**
 * Returns what a piece is called, with its count
 */
export function gearName({ kind, element, count }: Gear): string
{
    const [one, more] = NAMES[kind]
    const elemental = element ? element[0].toUpperCase() + element.slice(1) + " " : ""
    switch (kind)
    {
        case "wand":
            return elemental + one
        case "scroll":
            return elemental + one + ", " + count + (count === 1 ? " use" : " uses")
        default:
            return count + " " + (count === 1 ? one : more)
    }
}
