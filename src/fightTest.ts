import LevelScene, { type LevelHero } from "./game/levelScene"
import { PadTracker, readPad } from "./game/gamepad"
import { randomLook } from "./meeple/look"

/*
 * Test page for fighting and looting in a level with a controller, e.g. fight.html?seed=1&hp=20
 */

const params = new URLSearchParams(location.search)
const seed = Number(params.get("seed") ?? 1)
const maxHp = Number(params.get("hp") ?? 20)

const info = document.getElementById("info")!

let shownHp = maxHp
let gold = 0

function showHp(hp: number): void
{
    shownHp = hp
    info.textContent = "hp " + hp + " / " + maxHp + ", gold " + gold
}

const hero: LevelHero = {
    id: 1,
    look: randomLook(),
    gait: 0.5,
    dex: 5,
    hp: maxHp,
    item: "sword_silver",
    leftItem: "shield_silver"
}

const level = new LevelScene(seed, () => {}, () => {}, (_, hp) => showHp(hp), () => {
    // back at the entrance, good as new
    level.setHeroes([])
    level.setHeroes([hero])
    showHp(maxHp)
}, {}, found => {
    gold += found
    showHp(shownHp)
})
document.body.prepend(level.element)
level.setHeroes([hero])
level.setFocus(hero.id)
level.setRunning(true)
showHp(maxHp)

const tracker = new PadTracker()

function steer(time: number): void
{
    const pad = navigator.getGamepads().find(pad => pad?.mapping === "standard")
    if (pad)
    {
        const input = readPad(pad)
        level.steer(input)
        for (const action of tracker.update(input, time).pressed)
        {
            level.act(action)
        }
    }
    requestAnimationFrame(steer)
}
requestAnimationFrame(steer)

Object.assign(window, { level })
