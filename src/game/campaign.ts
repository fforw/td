import { withSeed } from "../math/random"
import { createSubtitle } from "./subtitle"
import type { Character } from "../meeple/character"
import type { OpenedChests } from "../treasure/chests"
import { createHeroes } from "./heroes"
import { startEdits, startPatches } from "./patchKinds"
import { arrivals } from "./tavern"

/**
 * Increases whenever generation changes in a way that shifts patch contents or face indexes. Saves made with
 * another version are refused.
 */
export const GENERATOR_VERSION = 3

/**
 * Version of the save format
 */
export const SAVE_VERSION = 6

export const START_GOLD = 1000

/**
 * Local heroes a campaign starts with
 */
export const START_HEROES = 3

export const OVERWORLD = "overworld"

/**
 * EMPTY is also what a patch falls back to when its generator found no room for its points of interest
 */
export type PatchKind = "CASTLE" | "EMPTY" | "DUNGEON" | "TREASURE" | "TEMPLE"

/**
 * Kinds the game rules set instead of the natural kind of a patch by patch key, see wantedKind()
 */
export type KindEdits = Record<string, PatchKind>

/**
 * All an explorer can tell about a patch they only passed through
 */
export type Impression = "safe" | "dangerous"

export interface PatchNode
{
    q: number
    r: number
    /** what the patch ended up as, only known to the player once the patch is discovered */
    kind: PatchKind
    /** a patch that was only passed through still counts as unknown, it never affects the story */
    state: "targeted" | "discovered" | "passed"
    /** key of the patch it was discovered from, null for the castle and patches not discovered yet */
    parent: string | null
    /** noted by an explorer passing through, stays when the patch gets targeted */
    impression?: Impression
}

/**
 * Unknown patch on the route of a mission
 */
export interface PassedPatch
{
    q: number
    r: number
    kind: PatchKind
}

export interface LevelRecord
{
    id: string
    kind: "OVERWORLD"
    patches: Record<string, PatchNode>
    kindEdits: KindEdits
}

export interface Explorer
{
    id: number
    name: string
    /** divides the days of a mission, grows with experience */
    speed: number
    /** how much of a patch the report reveals, 1 to 5 */
    wisdom: number
    /** dexterity, which is high for all of them as sneaking around is the job */
    dex: number
    /** number of missions done */
    experience: number
    /** day the explorer leaves the tavern for good unless hired before */
    leavesOn: number
}

/**
 * Someone walking from the castle to a patch. Days are all that counts: how far along someone is follows from them, the
 * way is only there to see it.
 */
export interface Journey
{
    /** patch key in the overworld */
    target: string
    startDay: number
    /** day of arriving */
    endDay: number
    /** the way as x and y in map units, missing in journeys from older saves, which nobody gets to see */
    way?: number[]
}

/**
 * Journey of an explorer to an unknown patch, which ends in a report. The patches on the way get noted with it.
 */
export interface Mission extends Journey
{
    explorer: Explorer
    /** no way to all points of interest, the explorer comes back with nothing */
    failed?: boolean
    /** unknown patches on the way */
    passed?: PassedPatch[]
}

/**
 * Gifted local born in the castle, who takes on special jobs and learns from them
 */
export interface Hero
{
    id: number
    name: string
    /** stats and classes, at least one beyond peasant */
    character: Character
    /** number of jobs done */
    experience: number
}

/**
 * Journey of a hero to a point of interest on a known patch, over known patches only. Once there, the hero waits outside
 * for the order to enter, or to come back without having done so.
 */
export interface Job extends Journey
{
    heroId: number
    /** walking back to the castle, with the days and the way being the ones of that */
    returning?: boolean
    /** in the level at the target */
    inside?: boolean
    /** global id of the face the hero last got to inside the level, missing before they moved */
    face?: number
    /** hit points left after getting hurt in the level, missing while unhurt */
    hp?: number
    /** went into the level at some point of the job */
    entered?: boolean
    /** gold found in levels and carried along, which only goes to the castle's once the hero is back, missing without */
    gold?: number
}

/**
 * Persistent game state. Plain JSON, so it can be saved as is.
 */
export interface Campaign
{
    saveVersion: number
    generatorVersion: number
    seed: number
    subtitle: string
    castleName: string
    characterName: string
    gold: number
    day: number
    levels: Record<string, LevelRecord>
    /** explorers loitering in the tavern */
    tavern: Explorer[]
    missions: Mission[]
    /** local heroes, on a job or at home */
    heroes: Hero[]
    jobs: Job[]
    /** what's left of the chests that got opened, by the key of the patch of their level */
    chests: Record<string, OpenedChests>
    /** keys of the patches whose levels start anew once nobody is inside, after a hero got carried out, missing without */
    resets?: string[]
    /** id for the next explorer or hero */
    nextId: number
}


export function patchKey(q: number, r: number): string
{
    return q + "/" + r
}


export function overworld(campaign: Campaign): LevelRecord
{
    return campaign.levels[OVERWORLD]
}


/**
 * Creates a new campaign. Everything derives from the seed, so the same seed gives the same campaign.
 */
export function createCampaign(seed: number): Campaign
{
    const { text, castleName, characterName } = withSeed(seed, createSubtitle)
    const kindEdits = startEdits(seed)

    const campaign: Campaign = {
        saveVersion: SAVE_VERSION,
        generatorVersion: GENERATOR_VERSION,
        seed,
        subtitle: text,
        castleName,
        characterName,
        gold: START_GOLD,
        day: 1,
        levels: {
            [OVERWORLD]: {
                id: OVERWORLD,
                kind: "OVERWORLD",
                patches: Object.fromEntries(startPatches(seed, kindEdits).map(node => [patchKey(node.q, node.r), node])),
                kindEdits
            }
        },
        tavern: [],
        missions: [],
        heroes: [],
        jobs: [],
        chests: {},
        nextId: 1
    }

    campaign.tavern = arrivals(campaign, 3)
    campaign.heroes = createHeroes(campaign, START_HEROES)
    return campaign
}
