import AXE_SVG from "../icons/axe.svg?raw"
import DAGGER_SVG from "../icons/dagger.svg?raw"
import SCROLL_SVG from "../icons/scroll.svg?raw"
import WAND_SVG from "../icons/wand.svg?raw"
import { ELEMENT_COLORS, type Gear, type GearKind, gearName, isThrown } from "./gear"

const ICONS: Readonly<Record<GearKind, string>> = {
    dagger: DAGGER_SVG,
    axe: AXE_SVG,
    wand: WAND_SVG,
    scroll: SCROLL_SVG
}

/**
 * What the HUD in the lower left corner shows while a hero is in a level, see plans/action/gear.md
 */
export interface GaugeState
{
    /** campaign level */
    level: number
    /** experience gained on the way to the next level, and what that takes from the current one */
    xpGained: number
    xpNeeded: number
    hp: number
    maxHp: number
    /** what the hero carries, with how much of each is left to use right now */
    gear: readonly { piece: Gear, left: number }[]
    /** index of the piece in use */
    currentGear: number
}


function div(className: string, ...children: (Node | string)[]): HTMLDivElement
{
    const elem = document.createElement("div")
    elem.className = className
    elem.append(...children)
    return elem
}


/**
 * Returns the parts of the HUD: the circle with the level, filled from the bottom as far as the next one is, then the hit
 * points as a bar, and the gear under it with a frame around the piece in use
 */
export function renderGauge({ level, xpGained, xpNeeded, hp, maxHp, gear, currentGear }: GaugeState): HTMLElement[]
{
    const ring = div("level-ring", div("level-fill"), div("level-number", String(level)))
    ring.style.setProperty("--progress", String(Math.max(0, Math.min(1, xpNeeded > 0 ? xpGained / xpNeeded : 0))))
    ring.title = "Campaign level " + level + ", " + xpGained + " of " + xpNeeded + " experience to the next"

    const fill = div("hp-fill")
    fill.style.width = Math.max(0, Math.min(1, hp / maxHp)) * 100 + "%"
    const bar = div("hp-bar", fill, div("hp-text", hp + " / " + maxHp))
    bar.title = "Hit points"

    const icons = gear.map(({ piece, left }, index) => {
        const icon = div("gear-icon" + (index === currentGear ? " current" : "") + (left <= 0 ? " empty" : ""))
        icon.innerHTML = ICONS[piece.kind]
        if (piece.element)
        {
            icon.style.color = ELEMENT_COLORS[piece.element].glow
        }
        // a wand goes without end, the others count down
        if (piece.kind !== "wand")
        {
            icon.append(div("gear-count", String(left)))
        }
        icon.title = gearName(piece) + (isThrown(piece.kind) && left < piece.count ? ", " + left + " in hand" : "")
        return icon
    })
    return [ring, div("gauge-rows", bar, div("gear-row", ...icons))]
}
