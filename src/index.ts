import "./style.css"
import "./game/title.css"
import "./game/game.css"
import { randomSeed } from "./math/random"
import { type Campaign, createCampaign } from "./game/campaign"
import GameView from "./game/gameView"
import GamepadControl from "./game/gamepadControl"
import { LocalSaveStore } from "./game/storage"
import { mixer } from "./sound/mixer"

const store = new LocalSaveStore()

const title = document.getElementById("title")!
const game = document.getElementById("game")!
const subtitle = title.querySelector(".subtitle")!
const startButton = title.querySelector<HTMLButtonElement>(".play")!
const soundButton = document.getElementById("sound")!

const gamepad = new GamepadControl()
gamepad.setTarget({
    scope: () => [title, soundButton],
    prompts: () => [{ glyph: "move", label: "Move" }, { glyph: "confirm", label: "Select" }],
    act: () => {}
})

/**
 * Campaign shown on the title screen: the saved one, or a new one that is only saved once it is played
 */
let current: Campaign

/**
 * Shows the campaign's name on the title screen. A new campaign keeps its seed in the URL, so a reload shows it again.
 */
function show(campaign: Campaign, played: boolean): void
{
    current = campaign
    subtitle.textContent = campaign.subtitle
    startButton.textContent = played ? "Continue" : "Start"
    document.title = "Treasure & Dread: " + campaign.subtitle
    history.replaceState(null, "", played ? location.pathname : "?seed=" + campaign.seed)
}

function play(campaign: Campaign): void
{
    store.save(campaign)
    title.hidden = true
    game.hidden = false
    gamepad.setTarget(new GameView(game, campaign, store))
}

const seedParam = new URLSearchParams(location.search).get("seed")
const saved = store.load()
if (saved && (!seedParam || +seedParam === saved.seed))
{
    show(saved, true)
}
else
{
    show(createCampaign(randomSeed(seedParam ? +seedParam : null)), false)
}

startButton.addEventListener("click", () => play(current))
title.querySelector(".new")!.addEventListener("click", () => show(createCampaign(randomSeed()), false))
title.querySelector(".credits")!.addEventListener("click", () => {
    location.href = import.meta.env.BASE_URL + "credits.html"
})

const music = document.querySelector<HTMLAudioElement>("audio")!

// the sound button stands for all sounds, not just the music
music.addEventListener("play", () => {
    soundButton.textContent = "🔊"
    mixer().mute(false)
})
music.addEventListener("pause", () => {
    soundButton.textContent = "🔇"
    mixer().mute(true)
})

soundButton.addEventListener("click", () => {
    if (music.paused)
    {
        void music.play()
    }
    else
    {
        music.pause()
    }
})

/**
 * Browsers only allow sound after a user gesture, so if autoplay is refused, the music starts with the first click
 * or key press. A click on the sound button is left to its own handler.
 */
function startOnGesture(ev: Event): void
{
    stopWaiting()
    if (ev.target !== soundButton)
    {
        void music.play()
    }
}

function stopWaiting(): void
{
    window.removeEventListener("pointerdown", startOnGesture)
    window.removeEventListener("keydown", startOnGesture)
    window.removeEventListener("gamepadconnected", startOnPad)
}

/**
 * Not every browser counts a controller as a user gesture, so the other gestures stay in the race unless this works.
 */
function startOnPad(): void
{
    music.play().then(stopWaiting, () => {})
}

if (__DISABLE_MUSIC)
{
    soundButton.hidden = true
}
else
{
    mixer().attach(music, "music")
    music.play().catch(() => {
        window.addEventListener("pointerdown", startOnGesture)
        window.addEventListener("keydown", startOnGesture)
        window.addEventListener("gamepadconnected", startOnPad)
    })
}
