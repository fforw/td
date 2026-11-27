import LevelScene, { type LevelHero } from "./game/levelScene"
import { PadTracker, readPad } from "./game/gamepad"
import { randomLook } from "./meeple/look"
import SceneBox from "./scene/SceneBox"

/*
 * Test page for fighting, looting and talking to the stranger in a level with a controller, e.g.
 * fight.html?seed=1&hp=20&gold=100
 */

const params = new URLSearchParams(location.search)
const seed = Number(params.get("seed") ?? 1)
const maxHp = Number(params.get("hp") ?? 20)

const info = document.getElementById("info")!

let shownHp = maxHp
let gold = Number(params.get("gold") ?? 0)
const concepts = new Set<string>()

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
    str: 5,
    hp: maxHp,
    maxHp,
    item: "sword_silver",
    leftItem: "shield_silver"
}

function startOver(): void
{
    // back at the entrance, good as new
    level.setHeroes([])
    level.setHeroes([hero])
    showHp(maxHp)
}

const level = new LevelScene(seed, () => {}, startOver, (_, hp) => showHp(hp), startOver, {}, (_, found) => {
    gold += found
    showHp(shownHp)
}, () => {}, undefined, () => {}, {
    monsterSkill: 0,
    achieve: () => {},
    knows: concept => concepts.has(concept),
    learn: concept => concepts.add(concept),
    gold: () => gold,
    pay: (_, paid) => {
        gold -= paid
        showHp(shownHp)
    }
}, () => box.show(level.playingScene))
const box = new SceneBox(actor => level.actorOnScreen(actor))
document.body.prepend(level.element)
document.body.append(box.element)
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
            // in a scene, confirm goes on or takes the first choice and back the last one
            if (level.playingScene)
            {
                const buttons = box.element.querySelectorAll("button")
                if (action === "confirm")
                {
                    box.confirm()
                }
                else if (action === "back" && !box.leave())
                {
                    buttons[buttons.length - 1]?.click()
                }
            }
            else
            {
                level.act(action)
            }
        }
    }
    requestAnimationFrame(steer)
}
requestAnimationFrame(steer)

Object.assign(window, { level })
