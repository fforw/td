import { type Campaign, type Explorer, overworld, type PatchKind, type PatchNode } from "./campaign"
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
 * Patch map with the tavern and running missions next to it. Small state, so every change renders everything again.
 */
export default class GameView
{
    private readonly root: HTMLElement
    private campaign: Campaign
    private readonly store: SaveStore

    /** frontier patch picked as the next mission target */
    private selected: string | null = null

    private reports: string[] = []

    constructor(root: HTMLElement, campaign: Campaign, store: SaveStore)
    {
        this.root = root
        this.campaign = campaign
        this.store = store
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
        this.root.replaceChildren(
            this.renderHud(),
            el("div", { className: "main" },
                this.renderMap(),
                el("div", { className: "side" },
                    this.renderTavern(),
                    this.renderMissions(),
                    this.renderReports()
                )
            )
        )
        document.title = campaign.castleName + ", day " + campaign.day + " - Treasure & Dread"
    }

    private renderHud(): HTMLElement
    {
        const { campaign } = this
        return el("div", { className: "hud" },
            el("span", { className: "castle" }, campaign.subtitle),
            el("span", { className: "day" }, "Day " + campaign.day),
            el("span", { className: "gold", title: "Gold" }, "🪙 " + campaign.gold),
            el("button", { type: "button", className: "end-day", onclick: () => this.endDay() }, "End day"),
            __DEV && el("span", { className: "dev" },
                el("button", { type: "button", onclick: () => exportSave(campaign) }, "Export"),
                el("button", {
                    type: "button",
                    onclick: () => importSave().then(
                        loaded => {
                            this.campaign = loaded
                            this.selected = null
                            this.reports = []
                            this.changed()
                        },
                        e => alert(e.message)
                    )
                }, "Import")
            )
        )
    }

    private renderMap(): Element
    {
        const { campaign } = this
        const nodes = Object.values(overworld(campaign).patches)
        const targets = frontier(campaign).map(key => {
            const [q, r] = key.split("/").map(Number)
            return { key, q, r }
        })

        const all = [...nodes, ...targets]
        const minQ = Math.min(...all.map(p => p.q))
        const maxQ = Math.max(...all.map(p => p.q))
        const minR = Math.min(...all.map(p => p.r))
        const maxR = Math.max(...all.map(p => p.r))

        const map = svg("svg", {
            class: "patch-map",
            viewBox: (minQ - 0.1) + " " + (minR - 0.1) + " " + (maxQ - minQ + 1.2) + " " + (maxR - minR + 1.2)
        })

        for (const node of nodes)
        {
            map.append(this.renderNode(node))
        }

        for (const { key, q, r } of targets)
        {
            const cell = svg("g", { class: "patch frontier" + (key === this.selected ? " selected" : "") },
                svg("rect", { x: q + 0.04, y: r + 0.04, width: 0.92, height: 0.92, rx: 0.08 }),
                svg("text", { x: q + 0.5, y: r + 0.5 }, "?")
            )
            cell.addEventListener("click", () => {
                this.selected = key === this.selected ? null : key
                this.render()
            })
            map.append(cell)
        }
        return map
    }

    private renderNode(node: PatchNode): Element
    {
        const { q, r, kind, state } = node
        const discovered = state === "discovered"
        const mission = this.campaign.missions.find(m => m.target === q + "/" + r)
        return svg("g", { class: "patch " + (discovered ? "discovered " + kind.toLowerCase() : "targeted") },
            svg("title", {}, discovered ? KIND_NAMES[kind] : "Explorer on the way"),
            svg("rect", { x: q + 0.04, y: r + 0.04, width: 0.92, height: 0.92, rx: 0.08 }),
            svg("text", { x: q + 0.5, y: r + 0.5 },
                discovered ? KIND_ICONS[kind] : "⏳" + (mission ? mission.endDay - this.campaign.day : "")
            )
        )
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
