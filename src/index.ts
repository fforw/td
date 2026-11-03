import "./style.css"
import "./game/title.css"
import { randomSeed, resetRandom } from "./math/random"
import { createSubtitle } from "./game/subtitle"

const seedParam = new URLSearchParams(location.search).get("seed")
const seed = randomSeed(seedParam ? +seedParam : null)
resetRandom(seed)

const subtitle = createSubtitle()

document.title = "Treasure & Dread: " + subtitle.text
document.querySelector("#title .subtitle")!.textContent = subtitle.text

const music = document.querySelector<HTMLAudioElement>("#title audio")!
const soundButton = document.querySelector<HTMLButtonElement>("#title .sound")!

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

music.play().catch(() => {
    window.addEventListener("pointerdown", startOnGesture)
    window.addEventListener("keydown", startOnGesture)
})
