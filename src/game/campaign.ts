import { withSeed } from "../math/random"
import { createSubtitle } from "./subtitle"
import { arrivals } from "./tavern"

/**
 * Increases whenever generation changes in a way that shifts patch contents or face indexes. Saves made with
 * another version are refused.
 */
export const GENERATOR_VERSION = 1

/**
 * Version of the save format
 */
export const SAVE_VERSION = 1

export const START_GOLD = 1000

export const OVERWORLD = "overworld"

export type PatchKind = "CASTLE" | "EMPTY" | "DUNGEON" | "TREASURE" | "TEMPLE"

export interface PatchNode
{
    q: number
    r: number
    kind: PatchKind
    state: "targeted" | "discovered"
    /** key of the patch it was discovered from, null for the castle */
    parent: string | null
}

export interface LevelRecord
{
    id: string
    kind: "OVERWORLD"
    patches: Record<string, PatchNode>
}

export interface Explorer
{
    id: number
    name: string
    /** divides the days of a mission, grows with experience */
    speed: number
    /** how much of a patch the report reveals, 1 to 5 */
    wisdom: number
    /** number of missions done */
    experience: number
    /** day the explorer leaves the tavern for good unless hired before */
    leavesOn: number
}

export interface Mission
{
    explorer: Explorer
    /** patch key in the overworld */
    target: string
    startDay: number
    endDay: number
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
    /** id for the next explorer */
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

    const castle: PatchNode = { q: 0, r: 0, kind: "CASTLE", state: "discovered", parent: null }

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
                patches: { [patchKey(0, 0)]: castle }
            }
        },
        tavern: [],
        missions: [],
        nextId: 1
    }

    campaign.tavern = arrivals(campaign, 3)
    return campaign
}
