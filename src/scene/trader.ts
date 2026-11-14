import type { Beat, Script, Ware } from "./script"

/**
 * Gold a ware costs, placeholders until there is more of an economy. Coins are worth 10 gold each.
 */
export const PRICES: Record<Ware, number> = {
    healing: 30,
    speed: 20,
    strength: 40,
    map: 150
}

/**
 * Seconds a speed or strength potion lasts
 */
export const POTION_TIME = 120

/**
 * Answers of a hero who only half understands what they are offered
 */
const DOUBTFUL_YES = "Yes?"
const DOUBTFUL_NO = "No, I guess?"


/**
 * Returns the scene of a trader: they offer to trade, and if the hero agrees, show what they have. The hero is "a",
 * the trader "b". Saying no ends the scene, so the hero can talk to them again.
 *
 * @param wares     what the trader has
 * @param left      who of the hero and the trader is on the left of the screen
 */
export function traderScript(wares: readonly Ware[], left: "a" | "b" = "a"): Script
{
    const beats: Record<string, Beat<string>> = {
        start: { kind: "shot", shot: "two", next: "offer" },
        offer: {
            kind: "choice",
            say: { actor: "b", words: ["greeting", "trade"], emotion: "joy" },
            options: [{ label: DOUBTFUL_YES, next: "look" }, { label: DOUBTFUL_NO }]
        },
        // over the shoulder of the hero, at the trader and what they have
        look: { kind: "shot", shot: "overA", next: "trade" },
        trade: { kind: "trade", offers: wares.map(ware => ({ ware, price: PRICES[ware], once: ware === "map" })) }
    }
    return { left, start: "start", beats }
}
