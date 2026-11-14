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
 * Returns the scene of a trader who offers the given wares one after another. The hero is "a", the trader "b".
 *
 * @param wares     what the trader has
 * @param left      who of the hero and the trader is on the left of the screen
 */
export function traderScript(wares: readonly Ware[], left: "a" | "b" = "a"): Script
{
    const beats: Record<string, Beat<string>> = {
        start: { kind: "shot", shot: "two", next: "greet" },
        greet: { kind: "say", actor: "b", words: ["greeting", "trade"], emotion: "joy", next: wares.length ? "offer0" : "bye" },
        bye: { kind: "say", actor: "b", words: ["farewell"], next: "byeShot" },
        byeShot: { kind: "shot", shot: "two" }
    }
    wares.forEach((ware, i) => {
        const price = PRICES[ware]
        const after = i + 1 < wares.length ? "offer" + (i + 1) : "bye"
        beats["offer" + i] = { kind: "shot", shot: "overA", next: "show" + i }
        beats["show" + i] = { kind: "show", actor: "b", ware, price, next: "ask" + i }
        beats["ask" + i] = { kind: "shot", shot: "overB", next: "choice" + i }
        beats["choice" + i] = {
            kind: "choice",
            options: [{ label: DOUBTFUL_YES, next: "check" + i }, { label: DOUBTFUL_NO, next: after }]
        }
        beats["check" + i] = { kind: "check", condition: { gold: price }, then: "pay" + i, else: "short" + i }
        beats["pay" + i] = { kind: "pay", gold: price, next: "use" + i }
        beats["use" + i] = { kind: "use", ware, next: "glad" + i }
        // back to the face of the trader for how they take it
        beats["glad" + i] = { kind: "shot", shot: "overA", next: "thanks" + i }
        beats["thanks" + i] = { kind: "say", actor: "b", words: ["coin", "thanks"], emotion: "joy", next: after }
        beats["short" + i] = { kind: "shot", shot: "overA", next: "shake" + i }
        beats["shake" + i] = { kind: "act", actor: "b", clip: "shakeHead", next: after }
    })
    return { left, start: "start", beats }
}
