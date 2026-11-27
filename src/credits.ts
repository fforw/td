import "./credits.css"
import "./game/game.css"
import GamepadControl from "./game/gamepadControl"

const SOUNDS = import.meta.env.BASE_URL + "media/sounds/"

const page = document.getElementById("credits")!
const back = page.querySelector<HTMLButtonElement>(".back")!

/**
 * Goes back to the title screen. Coming from there, it goes back in the history, as its URL holds the seed of a campaign
 * that isn't saved yet.
 */
function leave(): void
{
    if (document.referrer.startsWith(location.origin))
    {
        history.back()
    }
    else
    {
        location.href = import.meta.env.BASE_URL
    }
}

back.addEventListener("click", leave)

// one sound at a time, a new one cuts off the one playing
const player = new Audio()
for (const button of page.querySelectorAll<HTMLButtonElement>(".listen"))
{
    button.addEventListener("click", () =>
    {
        player.src = SOUNDS + button.dataset.sound
        void player.play()
    })
}

const gamepad = new GamepadControl()
gamepad.setTarget({
    scope: () => [page],
    prompts: () => [
        { glyph: "move", label: "Move" },
        { glyph: "confirm", label: "Listen" },
        { glyph: "back", label: "Back" }
    ],
    act: action =>
    {
        if (action === "back")
        {
            leave()
        }
    }
})
