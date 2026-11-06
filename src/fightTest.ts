import LevelScene, { type LevelHero } from "./game/levelScene"
import { readPad } from "./game/gamepad"
import { randomLook } from "./meeple/look"

/*
 * Test page for fighting in a level with a controller, e.g. fight.html?seed=1&hp=20
 */

const params = new URLSearchParams(location.search)
const seed = Number(params.get("seed") ?? 1)
const maxHp = Number(params.get("hp") ?? 20)

const info = document.getElementById("info")!

function showHp(hp: number): void
{
    info.textContent = "hp " + hp + " / " + maxHp
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
})
document.body.prepend(level.element)
level.setHeroes([hero])
level.setFocus(hero.id)
level.setRunning(true)
showHp(maxHp)

function steer(): void
{
    const pad = navigator.getGamepads().find(pad => pad?.mapping === "standard")
    if (pad)
    {
        level.steer(readPad(pad))
    }
    requestAnimationFrame(steer)
}
steer()

Object.assign(window, { level })
