import { type Campaign, GENERATOR_VERSION, overworld, patchKey, SAVE_VERSION, START_HEROES } from "./campaign"
import { createHeroes } from "./heroes"
import { patchSeed, withSeed } from "../math/random"
import { naturalKind } from "./patchKinds"
import { randomExplorerDex } from "./tavern"

/**
 * Where campaigns are kept. Only localStorage for now; a server can implement the same interface later.
 */
export interface SaveStore
{
    load(): Campaign | null
    save(campaign: Campaign): void
    clear(): void
}


/**
 * Brings saves of older formats up to date, one version at a time
 */
const MIGRATIONS: Record<number, (campaign: Campaign) => void> = {
    // version 2 added local heroes
    1: campaign => {
        campaign.heroes = createHeroes(campaign, START_HEROES)
        campaign.jobs = []
    },
    // version 3 keeps the kinds set by game rules apart from what's known about patches. Up to now that was only the
    // first dungeon. The old kind NONE is what a generator ended up with, not what it was asked for.
    2: campaign => {
        const level = overworld(campaign)
        level.kindEdits = Object.fromEntries(
            Object.values(level.patches)
                .filter(({ q, r, kind }) => kind as string !== "NONE" && kind !== naturalKind(campaign.seed, q, r))
                .map(({ q, r, kind }) => [patchKey(q, r), kind])
        )
    },
    // version 4 has generators without room fall back to EMPTY, which NONE was the same as in all but the name
    3: campaign => {
        const known = [
            ...Object.values(overworld(campaign).patches),
            ...campaign.missions.flatMap(mission => mission.passed ?? [])
        ]
        for (const patch of known)
        {
            if (patch.kind as string === "NONE")
            {
                patch.kind = "EMPTY"
            }
        }
    },
    // version 5 gives explorers dexterity
    4: campaign => {
        for (const explorer of [...campaign.tavern, ...campaign.missions.map(mission => mission.explorer)])
        {
            explorer.dex = withSeed(patchSeed(campaign.seed, explorer.id, 0), randomExplorerDex)
        }
    },
    // version 6 has chests in levels
    5: campaign => {
        campaign.chests = {}
    },
    // version 7 remembers where heroes have been in levels
    6: campaign => {
        campaign.explored = {}
    }
}


/**
 * Parses a saved campaign, migrating older formats, and refuses saves of unknown formats or of another generator
 * version, which would load with shifted patch contents.
 */
export function parseSave(json: string): Campaign
{
    const campaign = JSON.parse(json) as Campaign
    while (campaign.saveVersion < SAVE_VERSION && MIGRATIONS[campaign.saveVersion])
    {
        MIGRATIONS[campaign.saveVersion](campaign)
        campaign.saveVersion++
    }
    if (campaign.saveVersion !== SAVE_VERSION)
    {
        throw new Error("Save format " + campaign.saveVersion + " is not supported, expected " + SAVE_VERSION)
    }
    if (campaign.generatorVersion !== GENERATOR_VERSION)
    {
        throw new Error("Save was made with generator " + campaign.generatorVersion + ", this is " + GENERATOR_VERSION)
    }
    return campaign
}


export function serializeSave(campaign: Campaign): string
{
    return JSON.stringify(campaign, null, 4)
}


const STORAGE_KEY = "td.campaign"

export class LocalSaveStore implements SaveStore
{
    load(): Campaign | null
    {
        let json: string | null = null
        try
        {
            json = localStorage.getItem(STORAGE_KEY)
        }
        catch (e)
        {
            console.warn("Can't read the save", e)
        }
        if (json === null)
        {
            return null
        }
        try
        {
            return parseSave(json)
        }
        catch (e)
        {
            console.warn("Ignoring the save", e)
            return null
        }
    }

    save(campaign: Campaign): void
    {
        try
        {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(campaign))
        }
        catch (e)
        {
            console.warn("Can't write the save", e)
        }
    }

    clear(): void
    {
        try
        {
            localStorage.removeItem(STORAGE_KEY)
        }
        catch (e)
        {
            console.warn("Can't remove the save", e)
        }
    }
}


/**
 * Offers the campaign as a JSON download, named after the castle and day, to keep it as a fixture under
 * test/fixtures/saves/.
 */
export function exportSave(campaign: Campaign): void
{
    const blob = new Blob([serializeSave(campaign)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "save-" + campaign.castleName.toLowerCase().replace(/\W+/g, "-") + "-day" + campaign.day + ".json"
    a.click()
    // the download may not have read the url yet when click() returns
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}


/**
 * Lets the user pick a saved JSON file and resolves to the campaign in it.
 */
export function importSave(): Promise<Campaign>
{
    return new Promise((resolve, reject) => {
        const input = document.createElement("input")
        input.type = "file"
        input.accept = "application/json,.json"
        input.addEventListener("change", () => {
            const file = input.files?.[0]
            if (!file)
            {
                reject(new Error("No file picked"))
                return
            }
            file.text().then(json => resolve(parseSave(json)), reject)
        })
        input.click()
    })
}
