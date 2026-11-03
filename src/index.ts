import "./style.css"
import "./game/title.css"
import "./game/game.css"
import { randomSeed } from "./math/random"
import { type Campaign, createCampaign } from "./game/campaign"
import GameView from "./game/gameView"
import { LocalSaveStore } from "./game/storage"

const store = new LocalSaveStore()

const title = document.getElementById("title")!
const game = document.getElementById("game")!
const subtitle = title.querySelector(".subtitle")!
const continueButton = title.querySelector<HTMLButtonElement>(".continue")!

/**
 * Campaign shown on the title screen, created from its seed but not saved before play
 */
let preview: Campaign

function showPreview(seed: number): void
{
    preview = createCampaign(seed)
    subtitle.textContent = preview.subtitle
    document.title = "Treasure & Dread: " + preview.subtitle
    history.replaceState(null, "", "?seed=" + seed)
}

function play(campaign: Campaign): void
{
    store.save(campaign)
    title.hidden = true
    game.hidden = false
    new GameView(game, campaign, store)
}

const seedParam = new URLSearchParams(location.search).get("seed")
showPreview(randomSeed(seedParam ? +seedParam : null))

const saved = store.load()
if (saved)
{
    continueButton.hidden = false
    continueButton.textContent = "Continue: " + saved.subtitle
    continueButton.addEventListener("click", () => play(saved))
}
title.querySelector(".play")!.addEventListener("click", () => play(preview))
title.querySelector(".reroll")!.addEventListener("click", () => showPreview(randomSeed()))

const music = document.querySelector<HTMLAudioElement>("audio")!
const soundButton = document.getElementById("sound")!

music.addEventListener("play", () => soundButton.textContent = "🔊")
music.addEventListener("pause", () => soundButton.textContent = "🔇")

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
    window.removeEventListener("pointerdown", startOnGesture)
    window.removeEventListener("keydown", startOnGesture)
    if (ev.target !== soundButton)
    {
        void music.play()
    }
}

if (__DISABLE_MUSIC)
{
    soundButton.hidden = true
}
else
{
    music.play().catch(() => {
        window.addEventListener("pointerdown", startOnGesture)
        window.addEventListener("keydown", startOnGesture)
    })
}
