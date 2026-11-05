import { type Campaign, type Explorer, type Hero, type Impression, type Mission, overworld, type PatchKind, patchKey } from "./campaign"
import { isAway, jobDays, jobTargets, startJob } from "./heroes"
import CastleScene from "./castleScene"
import PatchImages, { PATCH_DEPTH, PATCH_WIDTH } from "./patchImages"
import Portraits, { meepleSitter } from "./portraits"
import { advanceDay, frontier, startMission } from "./missions"
import SimWorld from "./SimWorld"
import { exportSave, importSave, type SaveStore } from "./storage"
import { impressionOf } from "./patchKinds"
import { price } from "./tavern"

/**
 * Placeholder icons per patch kind until the game has its own icon set
 */
const KIND_ICONS: Record<PatchKind, string> = {
    CASTLE: "🏰",
    EMPTY: "🌲",
    DUNGEON: "💀",
    TREASURE: "💰",
    TEMPLE: "⛩️",
    NONE: "🌲"
}

const KIND_NAMES: Record<PatchKind, string> = {
    CASTLE: "Castle",
    EMPTY: "Wilderness",
    DUNGEON: "Dungeon",
    TREASURE: "Treasure",
    TEMPLE: "Temple",
    NONE: "Wilderness"
}

const IMPRESSION_ICONS: Record<Impression, string> = {
    safe: "🌿",
    dangerous: "⚠️"
}

const IMPRESSION_NAMES: Record<Impression, string> = {
    safe: "Looked safe",
    dangerous: "Looked dangerous"
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
 * Returns what an explorer has to tell about the unknown patches on the way, for the end of a report line
 */
function passedNote({ passed }: Mission): string
{
    if (!passed)
    {
        return ""
    }
    const dangerous = passed.filter(({ kind }) => impressionOf(kind) === "dangerous").length
    return ", passing " + passed.length + " unknown " + (passed.length === 1 ? "patch" : "patches") +
        (dangerous ? " (" + dangerous + " looked dangerous)" : "")
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

    private sim: SimWorld

    private readonly portraits = new Portraits(() => {
        if (!this.popup.hidden)
        {
            this.render()
        }
    })

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
        this.sim = new SimWorld(campaign.seed)

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
        const done = campaign.jobs.filter(j => j.endDay <= campaign.day + 1)

        advanceDay(campaign)

        for (const { heroId, target } of done)
        {
            const hero = campaign.heroes.find(h => h.id === heroId)!
            const { kind } = patches[target]
            this.reports.unshift(
                "Day " + campaign.day + ": " + hero.name + " is back from " + KIND_ICONS[kind] + " " + KIND_NAMES[kind] +
                " at " + target
            )
        }

        for (const mission of due)
        {
            const { explorer, target, failed } = mission
            if (failed)
            {
                this.reports.unshift("Day " + campaign.day + ": " + explorer.name + " found no way to " + target + passedNote(mission))
                continue
            }
            const { kind, q, r } = patches[target]
            this.reports.unshift(
                "Day " + campaign.day + ": " + explorer.name + " found " + KIND_ICONS[kind] + " " + KIND_NAMES[kind] +
                " at " + q + "/" + r + passedNote(mission)
            )
        }
        this.reports.length = Math.min(this.reports.length, MAX_REPORTS)
        this.changed()
    }

    private sendHero(hero: Hero): void
    {
        if (this.selected)
        {
            startJob(this.campaign, hero.id, this.selected)
            this.selected = null
            this.changed()
        }
    }

    private hire(explorer: Explorer): void
    {
        const { campaign, selected } = this
        if (selected)
        {
            this.sim.route(campaign, selected).then(
                route => {
                    // the route takes a moment, in which a click or the end of the day may have changed things
                    if (campaign === this.campaign && campaign.tavern.includes(explorer) && frontier(campaign).includes(selected))
                    {
                        startMission(campaign, explorer.id, selected, route)
                        this.selected = null
                        this.changed()
                    }
                },
                e => console.error("No route to " + selected, e)
            )
        }
    }

    private render(): void
    {
        const { campaign } = this
        this.castle?.show(
            Object.values(overworld(campaign).patches)
                .filter(node => node.state === "discovered")
        )
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
                                this.sim.dispose()
                                this.sim = new SimWorld(loaded.seed)
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
            const { impression } = overworld(campaign).patches[key] ?? {}
            const cell = svg("g", { class: "patch frontier" + (impression ? " passed" : "") + (key === this.selected ? " selected" : "") },
                impression ? svg("title", {}, IMPRESSION_NAMES[impression]) : null,
                this.tile(q, r),
                this.label(q, r, impression ? IMPRESSION_ICONS[impression] : "?")
            )
            cell.addEventListener("click", () => this.select(key))
            map.append(cell)
        }

        // passed on the way, too far out to be a target yet
        for (const { q, r, state, impression } of nodes)
        {
            if (state === "passed" && impression && !targets.some(t => t.q === q && t.r === r))
            {
                map.append(svg("g", { class: "patch passed" },
                    svg("title", {}, IMPRESSION_NAMES[impression]),
                    this.tile(q, r),
                    this.label(q, r, IMPRESSION_ICONS[impression])
                ))
            }
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
        const jobs = jobTargets(campaign)
        for (const { q, r, kind } of known)
        {
            const key = patchKey(q, r)
            const image = images.get(q, r, kind)
            const cell = svg("g", { class: "patch discovered " + kind.toLowerCase() + (jobs.includes(key) ? " job" : "") },
                svg("title", {}, KIND_NAMES[kind]),
                image
                    ? svg("image", { href: image.href, x: image.x, y: image.y, width: image.width, height: image.height })
                    : this.tile(q, r)
            )
            if (jobs.includes(key))
            {
                cell.addEventListener("click", () => this.select(key))
            }
            map.append(cell)
        }
        // icons and the selection last, so no neighboring patch image covers them
        for (const { q, r, kind } of known)
        {
            map.append(svg("g", { class: "patch icon" }, this.label(q, r, KIND_ICONS[kind])))
        }
        const picked = known.find(({ q, r }) => patchKey(q, r) === this.selected)
        if (picked)
        {
            map.append(svg("g", { class: "patch picked" }, this.tile(picked.q, picked.r)))
        }
        return map
    }

    /**
     * Picks a patch as the target for an explorer or a hero, or drops it when picked again
     */
    private select(key: string): void
    {
        this.selected = key === this.selected ? null : key
        this.render()
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
        // an unknown patch is for explorers, a known one for heroes
        const explore = selected !== null && !overworld(campaign).patches[selected]
        const job = selected !== null && jobTargets(campaign).includes(selected)
        return el("section", { className: "tavern" },
            el("h3", {}, "🍺 Tavern"),
            el("p", { className: "hint" },
                explore ? "Hire someone to look at " + selected + "." : "Pick a ? on the map to send an explorer."
            ),
            campaign.tavern.length === 0 && el("p", {}, "Nobody is around today."),
            ...campaign.tavern.map(explorer => el("div", { className: "explorer" },
                this.renderPortrait(explorer),
                el("span", { className: "name" }, explorer.name),
                el("span", { className: "stats" },
                    "speed " + explorer.speed.toFixed(2) + " · wisdom " + explorer.wisdom +
                    (explorer.experience ? " · " + explorer.experience +
                        (explorer.experience === 1 ? " mission" : " missions") : "") +
                    " · leaves in " + (explorer.leavesOn - campaign.day) + "d"
                ),
                el("button", {
                    type: "button",
                    disabled: !explore,
                    onclick: () => this.hire(explorer)
                }, "🪙 " + price(explorer))
            )),
            el("h3", {}, "🛡️ Local heroes"),
            el("p", { className: "hint" },
                job ? "Give someone a job at " + selected + "." : "Pick a known patch on the map for a job."
            ),
            ...campaign.heroes.map(hero => {
                const away = campaign.jobs.find(j => j.heroId === hero.id)
                const { stats, classes } = hero.character
                return el("div", { className: "explorer" },
                    this.renderPortrait(hero),
                    el("span", { className: "name" }, hero.name + " · " + classes.join(", ")),
                    el("span", { className: "stats" },
                        "hp " + stats.hp + " · mp " + stats.mp + " · str " + stats.str + " · dex " + stats.dex +
                        (hero.experience ? " · " + hero.experience + (hero.experience === 1 ? " job" : " jobs") : "") +
                        (away ? " · away, back in " + (away.endDay - campaign.day) + "d" : "")
                    ),
                    el("button", {
                        type: "button",
                        disabled: !job || isAway(campaign, hero),
                        onclick: () => this.sendHero(hero)
                    }, job ? "Send · " + jobDays(selected) + "d" : "Send")
                )
            })
        )
    }

    private renderPortrait({ id, name }: Explorer | Hero): HTMLElement
    {
        const { seed } = this.campaign
        const src = this.portraits.get(seed + "/" + id, () => meepleSitter(seed, id))
        return src
            ? el("img", { className: "portrait", src, alt: name })
            : el("span", { className: "portrait" })
    }

    private renderMissions(): HTMLElement | null
    {
        const { campaign } = this
        if (campaign.missions.length === 0 && campaign.jobs.length === 0)
        {
            return null
        }
        return el("section", { className: "missions" },
            el("h3", {}, "Missions"),
            ...campaign.missions.map(({ explorer, target, endDay }) => el("div", {},
                "🧭 " + explorer.name + " → " + target + ", back in " + (endDay - campaign.day) + "d"
            )),
            ...campaign.jobs.map(({ heroId, target, endDay }) => el("div", {},
                "🛡️ " + campaign.heroes.find(h => h.id === heroId)!.name + " → " + target +
                ", back in " + (endDay - campaign.day) + "d"
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
