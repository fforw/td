import "./scene.css"

import { COIN_VALUE } from "../treasure/chests"
import type { ActorRole, Emotion, Ware, Word } from "./script"
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

    /**
     * @param onScreen  returns where the head of an actor is on the screen, from 0 to 1 from the top left
     */
    constructor(private readonly onScreen: (actor: ActorRole) => [number, number] | null)
    {
        const { element, bubble, buttons } = this
        element.className = "scene-box"
        bubble.className = "scene-bubble"
        buttons.className = "scene-buttons"
        element.append(bubble, buttons)
        element.hidden = true
    }

    /**
     * Shows the beat the scene waits on, nothing between beats or without a scene
     */
    show(stage: SceneStage | null): void
    {
        const { element, bubble, buttons } = this
        const beat = stage?.beat
        element.hidden = !beat
        bubble.hidden = true
        buttons.replaceChildren()
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
            buttons.append(...beat.options.map(({ label }, index) => this.button(label, label, () => stage.choose(index))))
        }
        buttons.firstElementChild?.classList.add("pad-start")
    }

    /**
     * Clicks the button that has the focus, or else the first one
     */
    confirm(): void
    {
        const { buttons } = this
        const focused = buttons.querySelector<HTMLButtonElement>("button:focus") ?? buttons.querySelector("button")
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
