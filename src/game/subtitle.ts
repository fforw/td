import { rng } from "../math/random"
import { cityNameGenerator, meepleNameGenerator } from "../meeple/nameGenerator"

/**
 * Subtitle patterns. "{city}" is replaced by the castle name, "{name}" by the name of a key figure. Each pattern
 * names only one of them.
 */
const PATTERNS = [
    "The Rise of {city}",
    "The Fall of {city}",
    "Debts of {city}",
    "The Curse of {city}",
    "The Ruins of {city}",
    "The Gold of {city}",
    "The Secret of {city}",
    "The Shadow over {city}",
    "Ashes of {city}",
    "The Oath of {name}",
    "The Revenge of {name}",
    "The Return of {name}",
    "The Folly of {name}",
    "The Greed of {name}",
    "The Daughter of {name}",
    "The Last Wish of {name}"
]

export interface Subtitle
{
    /** subtitle text, e.g. "The Rise of Blatopia" */
    text: string
    /** name of the starting castle */
    castleName: string
    /** name of the key figure of the opening story */
    characterName: string
}

/**
 * Creates the campaign subtitle from the current random sequence. Both names are always created, so the sequence
 * consumed doesn't depend on the pattern picked.
 */
export function createSubtitle(): Subtitle
{
    const castleName = cityNameGenerator(rng.nextInt(5, 8))
    const characterName = meepleNameGenerator(4)
    const pattern = PATTERNS[rng.nextInt(0, PATTERNS.length - 1)]

    const text = pattern
        .replace("{city}", castleName)
        .replace("{name}", characterName)

    return { text, castleName, characterName }
}
