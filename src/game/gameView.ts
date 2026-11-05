import { type Campaign, type Explorer, type Hero, type Impression, type Mission, overworld, type PatchKind } from "./campaign"
import { isAway, jobDays, startJob } from "./heroes"
import CastleScene from "./castleScene"
import { type ExploreTarget, mapContent, type MapMarker, type MissionMarker } from "./mapContent"
import MapSheet from "./mapSheet"
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
    TEMPLE: "⛩️"
}

const KIND_NAMES: Record<PatchKind, string> = {
    CASTLE: "Castle",
    EMPTY: "Wilderness",
    DUNGEON: "Dungeon",
    TREASURE: "Treasure",
    TEMPLE: "Temple"
}

const IMPRESSION_ICONS: Record<Impression, string> = {
    safe: "🌿",
    dangerous: "⚠️"
}

const IMPRESSION_NAMES: Record<Impression, string> = {
    safe: "Looked safe",
    dangerous: "Looked dangerous"
}

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
 * The castle in 3D with the HUD over it, running missions and reports in a corner. The map is a popup over the paused 3D
 * view, with a smaller popup on top to start a mission from what was clicked on it. The DOM parts are small, so every
 * change renders them all again; the 3D scene and the sheet of the map stay.
 */
export default class GameView
{
    private readonly root: HTMLElement
    private campaign: Campaign
    private readonly store: SaveStore

    /** null where the browser has no WebGL */
    private castle: CastleScene | null

    private sheet: MapSheet

    private sim: SimWorld

    private readonly portraits = new Portraits(() => {
        if (!this.dialog.hidden)
        {
            this.render()
        }
    })

    private readonly hud = el("div", { className: "hud" })
    private readonly info = el("div", { className: "info" })
    private readonly popup = el("div", { className: "popup", hidden: true })
    private readonly dialog = el("div", { className: "popup mission-popup", hidden: true })

    /** marker a mission is being set up for */
    private selected: MissionMarker | null = null

    /** hero picked for the mission */
    private pickedHero: number | null = null

    /** an explorer is hired and waiting for the route to be found */
    private sending = false

    private reports: string[] = []

    constructor(root: HTMLElement, campaign: Campaign, store: SaveStore)
    {
        this.root = root
        this.campaign = campaign
        this.store = store
        this.castle = this.createCastle()
        this.sheet = this.createSheet()
        this.sim = new SimWorld(campaign.seed)

        // a click on the backdrop closes a popup
        this.popup.addEventListener("click", ev => {
            if (ev.target === this.popup)
            {
                this.closeMap()
            }
        })
        this.dialog.addEventListener("click", ev => {
            if (ev.target === this.dialog)
            {
                this.closeDialog()
            }
        })
        window.addEventListener("keydown", ev => {
            if (ev.key === "Escape")
            {
                if (!this.dialog.hidden)
                {
                    this.closeDialog()
                }
                else if (!this.popup.hidden)
                {
                    this.closeMap()
                }
            }
        })

        this.render()
    }

    private createCastle(): CastleScene | null
    {
        let castle: CastleScene | null = null
        try
        {
            castle = new CastleScene(this.campaign.seed, () => this.openMap(), () => this.endDay())
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
            this.popup,
            this.dialog
        )
        return castle
    }

    private createSheet(): MapSheet
    {
        return new MapSheet(this.campaign.seed, () => this.hud.offsetHeight)
    }

    private openMap(): void
    {
        this.popup.hidden = false
        this.castle?.setRunning(false)
        this.render()
    }

    private closeMap(): void
    {
        this.popup.hidden = true
        this.selected = null
        this.dialog.hidden = true
        this.castle?.setRunning(true)
        this.render()
    }

    private openDialog(marker: MissionMarker): void
    {
        this.selected = marker
        this.pickedHero = null
        this.dialog.hidden = false
        this.render()
    }

    private closeDialog(): void
    {
        this.selected = null
        this.dialog.hidden = true
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

    private sendHero(): void
    {
        const { campaign, selected, pickedHero } = this
        if (selected && pickedHero !== null)
        {
            startJob(campaign, pickedHero, selected.key)
            this.closeDialog()
            this.changed()
        }
    }

    private hire(explorer: Explorer): void
    {
        const { campaign, selected } = this
        if (selected)
        {
            const target = selected.key
            this.sending = true
            this.render()
            this.sim.route(campaign, target).then(
                route => {
                    this.sending = false
                    // the route takes a moment, in which a click may have changed things
                    if (campaign === this.campaign && campaign.tavern.includes(explorer) && frontier(campaign).includes(target))
                    {
                        startMission(campaign, explorer.id, target, route)
                        if (this.selected === selected)
                        {
                            this.closeDialog()
                        }
                        this.changed()
                    }
                },
                e => {
                    this.sending = false
                    console.error("No route to " + target, e)
                    this.render()
                }
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
                this.sheet.element,
                el("span", { className: "map-north", title: "North is up, like N on the compass" }, "N ↑"),
                el("button", {
                    type: "button",
                    className: "close",
                    title: "Back to the castle",
                    onclick: () => this.closeMap()
                }, "✕")
            )
            this.sheet.update(mapContent(campaign), marker => this.renderMarker(marker), target => this.openDialog(target))
        }
        if (!this.dialog.hidden && this.selected)
        {
            this.dialog.replaceChildren(
                this.selected.type === "explore" ? this.renderExplorers(this.selected) : this.renderHeroes(this.selected)
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
            el("button", {
                type: "button",
                onclick: () => this.popup.hidden ? this.openMap() : this.closeMap()
            }, "🗺️ Map"),
            __DEV && el("span", { className: "dev" },
                el("button", { type: "button", onclick: () => exportSave(campaign) }, "Export"),
                el("button", {
                    type: "button",
                    onclick: () => importSave().then(
                        loaded => {
                            this.campaign = loaded
                            this.selected = null
                            this.popup.hidden = true
                            this.dialog.hidden = true
                            this.reports = []
                            // the old ones hold the edits of another timeline, even for the same seed
                            this.castle?.dispose()
                            this.castle = this.createCastle()
                            this.sheet.dispose()
                            this.sheet = this.createSheet()
                            this.sim.dispose()
                            this.sim = new SimWorld(loaded.seed)
                            this.changed()
                        },
                        e => alert(e.message)
                    )
                }, "Import")
            )
        ]
    }

    private renderMarker(marker: MapMarker): HTMLElement
    {
        const { type } = marker
        if (type === "poi")
        {
            const { kind, days } = marker
            if (days !== undefined)
            {
                return el("span", {
                    className: "marker poi away",
                    title: KIND_NAMES[kind] + ": a hero is on the way, back in " + days + "d"
                }, KIND_ICONS[kind], el("small", {}, "⏳" + days))
            }
            return el("button", {
                type: "button",
                className: "marker poi",
                title: KIND_NAMES[kind] + ": send a hero",
                onclick: () => this.openDialog(marker)
            }, KIND_ICONS[kind])
        }
        if (type === "targeted")
        {
            return el("span", { className: "marker targeted", title: "Explorer on the way" }, "⏳" + marker.days)
        }
        return el("span", {
            className: "marker passed",
            title: IMPRESSION_NAMES[marker.impression]
        }, IMPRESSION_ICONS[marker.impression])
    }

    /**
     * Popup to hire an explorer for an unknown patch
     */
    private renderExplorers({ key, impression }: ExploreTarget): HTMLElement
    {
        const { campaign, sending } = this
        return el("section", { className: "mission small" },
            this.renderDialogClose(),
            el("h3", {}, "🧭 Unknown patch at " + key),
            el("p", { className: "hint" },
                (impression ? IMPRESSION_ICONS[impression] + " " + IMPRESSION_NAMES[impression] + ". " : "") +
                (sending ? "Getting ready…" : "Hire someone to have a look.")
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
                    disabled: sending,
                    onclick: () => this.hire(explorer)
                }, "🪙 " + price(explorer))
            ))
        )
    }

    /**
     * Popup to send one hero to a point of interest
     */
    private renderHeroes({ key, kind }: Extract<MapMarker, { type: "poi" }>): HTMLElement
    {
        const { campaign, pickedHero } = this
        return el("section", { className: "mission" },
            this.renderDialogClose(),
            el("h3", {}, KIND_ICONS[kind] + " " + KIND_NAMES[kind] + " at " + key),
            el("p", { className: "hint" }, "Who should go there?"),
            ...campaign.heroes.map(hero => {
                const away = campaign.jobs.find(j => j.heroId === hero.id)
                const { stats, classes } = hero.character
                return el("label", { className: "explorer" + (away ? " away" : "") },
                    this.renderPortrait(hero),
                    el("span", { className: "name" }, hero.name + " · " + classes.join(", ")),
                    el("span", { className: "stats" },
                        "hp " + stats.hp + " · mp " + stats.mp + " · str " + stats.str + " · dex " + stats.dex +
                        (hero.experience ? " · " + hero.experience + (hero.experience === 1 ? " job" : " jobs") : "") +
                        (away ? " · away, back in " + (away.endDay - campaign.day) + "d" : "")
                    ),
                    el("input", {
                        type: "radio",
                        name: "hero",
                        checked: pickedHero === hero.id,
                        disabled: isAway(campaign, hero),
                        onchange: () => {
                            this.pickedHero = hero.id
                            this.render()
                        }
                    })
                )
            }),
            el("button", {
                type: "button",
                className: "launch",
                disabled: pickedHero === null,
                onclick: () => this.sendHero()
            }, "Launch mission · " + jobDays(key) + "d")
        )
    }

    private renderDialogClose(): HTMLElement
    {
        return el("button", { type: "button", className: "close", title: "Back to the map", onclick: () => this.closeDialog() }, "✕")
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
