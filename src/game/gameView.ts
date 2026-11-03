import { type Campaign, type Explorer, overworld, type PatchKind, patchKey } from "./campaign"
import CastleScene from "./castleScene"
import PatchImages, { PATCH_DEPTH, PATCH_WIDTH } from "./patchImages"
import { advanceDay, frontier, missionDays, startMission } from "./missions"
import { exportSave, importSave, type SaveStore } from "./storage"
import { price } from "./tavern"

/**
 * Placeholder icons per patch kind until the game has its own icon set
 */
const KIND_ICONS: Record<PatchKind, string> = {
    CASTLE: "🏰",
    EMPTY: "🌲",
    DUNGEON: "💀",
    TREASURE: "💰",
    TEMPLE: "⛩️"
}

const KIND_NAMES: Record<PatchKind, string> = {
    CASTLE: "Castle",
    EMPTY: "Wilderness",
    DUNGEON: "Dungeon",
    TREASURE: "Treasure",
    TEMPLE: "Temple"
}

const SVG_NS = "http://www.w3.org/2000/svg"

/**
 * Size of the icons and labels on the patch map relative to the patch depth
 */
const LABEL_SIZE = 0.28

/**
 * Most report lines shown
 */
const MAX_REPORTS = 5


type Child = Node | string | null | false

function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: Partial<HTMLElementTagNameMap[K]> = {},
    ...children: Child[]
): HTMLElementTagNameMap[K]
{
    const elem = Object.assign(document.createElement(tag), props)
    for (const child of children)
    {
        if (child)
        {
            elem.append(child)
        }
    }
    return elem
}


function present(children: Child[]): (Node | string)[]
{
    return children.filter(child => child !== null && child !== false)
}


function svg(tag: string, attrs: Record<string, string | number>, ...children: Child[]): SVGElement
{
    const elem = document.createElementNS(SVG_NS, tag)
    for (const [name, value] of Object.entries(attrs))
    {
        elem.setAttribute(name, String(value))
    }
    for (const child of children)
    {
        if (child)
        {
            elem.append(child)
        }
    }
    return elem
}


/**
 * The castle in 3D with the HUD over it, running missions and reports in a corner, and the tavern as a popup with the
 * patch map. The DOM parts are small, so every change renders them all again; the 3D scene stays.
 */
export default class GameView
{
    private readonly root: HTMLElement
    private campaign: Campaign
    private readonly store: SaveStore

    /** null where the browser has no WebGL */
    private castle: CastleScene | null

    private images: PatchImages

    private readonly hud = el("div", { className: "hud" })
    private readonly info = el("div", { className: "info" })
    private readonly popup = el("div", { className: "popup", hidden: true })

    /** frontier patch picked as the next mission target */
    private selected: string | null = null

    private reports: string[] = []

    constructor(root: HTMLElement, campaign: Campaign, store: SaveStore)
    {
        this.root = root
        this.campaign = campaign
        this.store = store
        this.castle = this.createCastle()
        this.images = this.createImages()

        this.popup.addEventListener("click", ev => {
            // a click on the backdrop closes the popup
            if (ev.target === this.popup)
            {
                this.closeTavern()
            }
        })
        window.addEventListener("keydown", ev => {
            if (ev.key === "Escape" && !this.popup.hidden)
            {
                this.closeTavern()
            }
        })

        this.render()
    }

    private createCastle(): CastleScene | null
    {
        let castle: CastleScene | null = null
        try
        {
            castle = new CastleScene(this.campaign.seed, () => this.openTavern())
            castle.setRunning(true)
        }
        catch (e)
        {
            console.error("No 3D view", e)
        }
        this.root.replaceChildren(
            ...(castle ? [castle.element, castle.compass] : [el("p", { className: "no-3d" }, "The 3D view needs WebGL.")]),
            this.hud,
            this.info,
            this.popup
        )
        return castle
    }

    private createImages(): PatchImages
    {
        return new PatchImages(this.campaign.seed, () => {
            if (!this.popup.hidden)
            {
                this.render()
            }
        })
    }

    private openTavern(): void
    {
        this.popup.hidden = false
        this.render()
    }

    private closeTavern(): void
    {
        this.popup.hidden = true
        this.selected = null
        this.render()
    }

    private changed(): void
    {
        this.store.save(this.campaign)
        this.render()
    }

    private endDay(): void
    {
        const { campaign } = this
        const { patches } = overworld(campaign)
        const due = campaign.missions.filter(m => m.endDay <= campaign.day + 1)

        advanceDay(campaign)

        for (const { explorer, target } of due)
        {
            const { kind, q, r } = patches[target]
            this.reports.unshift(
                "Day " + campaign.day + ": " + explorer.name + " found " + KIND_ICONS[kind] + " " + KIND_NAMES[kind] +
                " at " + q + "/" + r
            )
        }
        this.reports.length = Math.min(this.reports.length, MAX_REPORTS)
        this.changed()
    }

    private hire(explorer: Explorer): void
    {
        if (this.selected)
        {
            startMission(this.campaign, explorer.id, this.selected)
            this.selected = null
            this.changed()
        }
    }

    private render(): void
    {
        const { campaign } = this
        this.hud.replaceChildren(...present(this.renderHud()))
        this.info.replaceChildren(...present([this.renderMissions(), this.renderReports()]))
        this.info.hidden = this.info.childElementCount === 0
        if (!this.popup.hidden)
        {
            this.popup.replaceChildren(
                el("div", { className: "dialog" },
                    el("button", {
                        type: "button",
                        className: "close",
                        title: "Back to the castle",
                        onclick: () => this.closeTavern()
                    }, "✕"),
                    el("span", { className: "map-north", title: "North is up, like N on the compass" }, "N ↑"),
                    this.renderMap(),
                    this.renderTavern()
                )
            )
        }
        document.title = campaign.castleName + ", day " + campaign.day + " - Treasure & Dread"
    }

    private renderHud(): Child[]
    {
        const { campaign } = this
        return [
            el("span", { className: "castle" }, campaign.subtitle),
            el("span", { className: "day" }, "Day " + campaign.day),
            el("span", { className: "gold", title: "Gold" }, "🪙 " + campaign.gold),
            el("button", { type: "button", className: "end-day", onclick: () => this.endDay() }, "End day"),
            el("button", { type: "button", onclick: () => this.openTavern() }, "🍺 Tavern"),
            __DEV && el("span", { className: "dev" },
                el("button", { type: "button", onclick: () => exportSave(campaign) }, "Export"),
                el("button", {
                    type: "button",
                    onclick: () => importSave().then(
                        loaded => {
                            const newCastle = loaded.seed !== this.campaign.seed
                            this.campaign = loaded
                            this.selected = null
                            this.reports = []
                            if (newCastle)
                            {
                                this.castle?.dispose()
                                this.castle = this.createCastle()
                                this.images.dispose()
                                this.images = this.createImages()
                            }
                            this.changed()
                        },
                        e => alert(e.message)
                    )
                }, "Import")
            )
        ]
    }

    private renderMap(): Element
    {
        const { campaign, images } = this
        const nodes = Object.values(overworld(campaign).patches)
        const targets = frontier(campaign).map(key => {
            const [q, r] = key.split("/").map(Number)
            return { key, q, r }
        })

        const all = [...nodes, ...targets]
        const [x0, y0] = images.center(Math.min(...all.map(p => p.q)), Math.min(...all.map(p => p.r)))
        const [x1, y1] = images.center(Math.max(...all.map(p => p.q)), Math.max(...all.map(p => p.r)))
        const pad = PATCH_DEPTH * 0.05

        const map = svg("svg", {
            class: "patch-map",
            viewBox: [
                x0 - PATCH_WIDTH / 2 - pad,
                y0 - PATCH_DEPTH / 2 - pad,
                x1 - x0 + PATCH_WIDTH + pad * 2,
                y1 - y0 + PATCH_DEPTH + pad * 2
            ].join(" ")
        })

        // unknown and targeted patches as plain tiles below the jagged edges of the known ones
        for (const { key, q, r } of targets)
        {
            const cell = svg("g", { class: "patch frontier" + (key === this.selected ? " selected" : "") },
                this.tile(q, r),
                this.label(q, r, "?")
            )
            cell.addEventListener("click", () => {
                this.selected = key === this.selected ? null : key
                this.render()
            })
            map.append(cell)
        }

        const known = nodes.filter(node => node.state === "discovered")
        for (const node of nodes)
        {
            if (node.state === "targeted")
            {
                const mission = campaign.missions.find(m => m.target === patchKey(node.q, node.r))
                map.append(svg("g", { class: "patch targeted" },
                    svg("title", {}, "Explorer on the way"),
                    this.tile(node.q, node.r),
                    this.label(node.q, node.r, "⏳" + (mission ? mission.endDay - campaign.day : ""))
                ))
            }
        }
        for (const { q, r, kind } of known)
        {
            const image = images.get(q, r)
            map.append(svg("g", { class: "patch discovered " + kind.toLowerCase() },
                svg("title", {}, KIND_NAMES[kind]),
                image
                    ? svg("image", { href: image.href, x: image.x, y: image.y, width: image.width, height: image.height })
                    : this.tile(q, r)
            ))
        }
        // icons last, so no neighboring patch image covers them
        for (const { q, r, kind } of known)
        {
            map.append(svg("g", { class: "patch icon" }, this.label(q, r, KIND_ICONS[kind])))
        }
        return map
    }

    /**
     * Rectangle of a patch for patches without an image
     */
    private tile(q: number, r: number): SVGElement
    {
        const [x, y] = this.images.center(q, r)
        return svg("rect", { x: x - PATCH_WIDTH / 2, y: y - PATCH_DEPTH / 2, width: PATCH_WIDTH, height: PATCH_DEPTH })
    }

    private label(q: number, r: number, text: string): SVGElement
    {
        const [x, y] = this.images.center(q, r)
        return svg("text", { x, y, "font-size": PATCH_DEPTH * LABEL_SIZE }, text)
    }

    private renderTavern(): HTMLElement
    {
        const { campaign, selected } = this
        return el("section", { className: "tavern" },
            el("h3", {}, "🍺 Tavern"),
            el("p", { className: "hint" },
                selected ? "Hire someone to look at " + selected + "." : "Pick a ? on the map to send an explorer."
            ),
            campaign.tavern.length === 0 && el("p", {}, "Nobody is around today."),
            ...campaign.tavern.map(explorer => el("div", { className: "explorer" },
                el("span", { className: "name" }, explorer.name),
                el("span", { className: "stats" },
                    "speed " + explorer.speed.toFixed(2) + " · wisdom " + explorer.wisdom +
                    (explorer.experience ? " · " + explorer.experience +
                        (explorer.experience === 1 ? " mission" : " missions") : "") +
                    " · leaves in " + (explorer.leavesOn - campaign.day) + "d"
                ),
                el("button", {
                    type: "button",
                    disabled: !selected,
                    onclick: () => this.hire(explorer)
                }, "🪙 " + price(explorer) + (selected ? " · " + missionDays(explorer, selected) + "d" : ""))
            ))
        )
    }

    private renderMissions(): HTMLElement | null
    {
        const { campaign } = this
        if (campaign.missions.length === 0)
        {
            return null
        }
        return el("section", { className: "missions" },
            el("h3", {}, "Missions"),
            ...campaign.missions.map(({ explorer, target, endDay }) => el("div", {},
                explorer.name + " → " + target + ", back in " + (endDay - campaign.day) + "d"
            ))
        )
    }

    private renderReports(): HTMLElement | null
    {
        if (this.reports.length === 0)
        {
            return null
        }
        return el("section", { className: "reports" },
            el("h3", {}, "Reports"),
            ...this.reports.map(line => el("div", {}, line))
        )
    }
}
