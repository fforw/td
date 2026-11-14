import "./scene.css"

import { COIN_VALUE } from "../treasure/chests"
import type { ActorRole, Emotion, Offer, Saying, Ware, Word } from "./script"
import type SceneStage from "./stage"

/**
 * Emoji for the words of scenes, until the glyph language of 2.5 shows them
 */
const WORD_EMOJI: Record<Word, string> = {
    greeting: "👋",
    farewell: "👋",
    trade: "⚖️",
    coin: "🪙",
    thanks: "🙏"
}

/**
 * What a ware looks like, until there are sprites of them
 */
const WARE_ITEM: Record<Ware, string> = {
    healing: "🧪",
    speed: "🧪",
    strength: "🧪",
    map: "📜"
}

/**
 * Glyphs of the wares while the player doesn't know them, placeholders until the glyph language of 2.5 makes them
 */
const WARE_GLYPH: Record<Ware, string> = {
    healing: "ᛉ",
    speed: "ᚱ",
    strength: "ᛏ",
    map: "ᛞ"
}

/**
 * Glyphs of the wares once the player knows them
 */
const WARE_MEANING: Record<Ware, string> = {
    healing: "❤️",
    speed: "💨",
    strength: "💪",
    map: "🗺️"
}

const WARE_NAME: Record<Ware, string> = {
    healing: "Healing potion",
    speed: "Speed potion",
    strength: "Strength potion",
    map: "Map of the level"
}

const WARE_EMOJI: Record<Ware, string> = {
    healing: "🧪❤️",
    speed: "🧪💨",
    strength: "🧪💪",
    map: "🗺️"
}

const EMOTION_EMOJI: Record<Emotion, string> = {
    joy: "😊",
    anger: "😠",
    fear: "😨",
    love: "😍",
    sad: "😢",
    puzzled: "🤔"
}

/**
 * Shown for a word that has no emoji
 */
const UNKNOWN_WORD = "❓"


/**
 * Shows what goes on in a scene over the level: speech bubbles, and buttons for the player to go on or to choose. The
 * buttons work with the mouse and, as the only things to focus, with a controller.
 */
export default class SceneBox
{
    readonly element = document.createElement("div")
    private readonly bubble = document.createElement("div")
    private readonly buttons = document.createElement("div")
    private readonly trade = document.createElement("div")
    /** the scene shown, null without one */
    private stage: SceneStage | null = null

    /**
     * @param onScreen  returns where the head of an actor is on the screen, from 0 to 1 from the top left
     */
    constructor(private readonly onScreen: (actor: ActorRole) => [number, number] | null)
    {
        const { element, bubble, buttons, trade } = this
        element.className = "scene-box"
        bubble.className = "scene-bubble"
        buttons.className = "scene-buttons"
        trade.className = "scene-trade"
        element.append(bubble, buttons, trade)
        element.hidden = true
    }

    /**
     * Shows the beat the scene waits on, nothing between beats or without a scene
     */
    show(stage: SceneStage | null): void
    {
        const { element, bubble, buttons, trade } = this
        const beat = stage?.beat
        // a trade shown again after buying keeps the focus on the same offer
        const focused = this.stage === stage && beat?.kind === "trade" ? trade.querySelector<HTMLElement>("button:focus")?.dataset.index : undefined
        this.stage = stage
        element.hidden = !beat
        bubble.hidden = true
        trade.hidden = true
        buttons.replaceChildren()
        trade.replaceChildren()
        if (!stage || !beat)
        {
            return
        }
        if (beat.kind === "say" || beat.kind === "show")
        {
            bubble.replaceChildren(...(beat.kind === "say" ? this.saying(beat.words, beat.emotion) : this.showing(beat.ware, beat.price)))
            this.place(beat.actor)
            buttons.append(this.button("…", "Go on", () => stage.next()))
        }
        else if (beat.kind === "choice")
        {
            if (beat.say)
            {
                this.say(beat.say)
            }
            buttons.append(...beat.options.map(({ label }, index) => this.button(label, label, () => stage.choose(index))))
        }
        else if (beat.kind === "trade")
        {
            this.showTrade(stage, beat.offers, focused)
            return
        }
        buttons.firstElementChild?.classList.add("pad-start")
    }

    /**
     * Leaves a trade, which is what the back button does in one
     *
     * @returns false without a trade to leave
     */
    leave(): boolean
    {
        const { stage } = this
        if (stage?.beat?.kind !== "trade")
        {
            return false
        }
        stage.next()
        return true
    }

    private say({ actor, words, emotion }: Saying): void
    {
        this.bubble.replaceChildren(...this.saying(words, emotion))
        this.place(actor)
    }

    /**
     * Shows what the trader has, each with what it looks like, its glyph and its price, and what the hero carries
     */
    private showTrade(stage: SceneStage, offers: readonly Offer[], focused: string | undefined): void
    {
        const { trade } = this
        const { player } = stage
        trade.hidden = false
        const rows = offers.map(({ ware, price }, index) => {
            const known = player.knows(ware)
            const row = this.button("", known ? WARE_NAME[ware] : "Something", () => {
                stage.buy(index)
            })
            row.dataset.index = String(index)
            row.disabled = !player.affords(index) || player.sold(index)
            row.append(
                span("scene-item scene-" + ware, WARE_ITEM[ware]),
                span(known ? "scene-symbol scene-known" : "scene-symbol", known ? WARE_MEANING[ware] : WARE_GLYPH[ware]),
                span("scene-price", "🪙 ×" + Math.ceil(price / COIN_VALUE))
            )
            return row
        })
        const leave = this.button("✕", "Back to the dungeon", () => this.leave())
        leave.classList.add("scene-leave")
        trade.append(
            span("scene-purse", "🪙 ×" + Math.floor(player.gold() / COIN_VALUE)),
            ...rows,
            leave
        )
        const start = rows.find(row => row.dataset.index === focused && !row.disabled) ?? rows.find(row => !row.disabled) ?? leave
        start.classList.add("pad-start")
        if (focused !== undefined)
        {
            start.focus()
        }
    }

    /**
     * Clicks the button that has the focus, or else the first one
     */
    confirm(): void
    {
        const { element } = this
        const focused = element.querySelector<HTMLButtonElement>("button:focus") ?? element.querySelector(".pad-start")
        focused?.click()
    }

    private saying(words: readonly Word[], emotion: Emotion | undefined): Node[]
    {
        return [
            ...(emotion ? [span("scene-emotion", EMOTION_EMOJI[emotion])] : []),
            ...words.map(word => span("scene-word", WORD_EMOJI[word] ?? UNKNOWN_WORD))
        ]
    }

    private showing(ware: Ware, price: number): Node[]
    {
        return [span("scene-ware", WARE_EMOJI[ware]), span("scene-price", "🪙 ×" + Math.ceil(price / COIN_VALUE))]
    }

    /**
     * Puts the bubble above the head of who speaks
     */
    private place(actor: ActorRole): void
    {
        const { bubble } = this
        const at = this.onScreen(actor)
        bubble.hidden = false
        bubble.classList.toggle("scene-bubble-right", !!at && at[0] > 0.5)
        if (at)
        {
            bubble.style.left = (at[0] * 100).toFixed(2) + "%"
            bubble.style.top = (at[1] * 100).toFixed(2) + "%"
        }
    }

    private button(text: string, title: string, onClick: () => void): HTMLButtonElement
    {
        const button = document.createElement("button")
        button.type = "button"
        button.textContent = text
        button.title = title
        button.addEventListener("click", onClick)
        return button
    }
}


function span(className: string, text: string): HTMLSpanElement
{
    const element = document.createElement("span")
    element.className = className
    element.textContent = text
    return element
}
