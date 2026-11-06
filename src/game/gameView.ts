import {
    type Campaign,
    type Explorer,
    type Hero,
    type Impression,
    type Job,
    type Journey,
    type Mission,
    overworld,
    type PatchKind,
    type PatchNode
} from "./campaign"
import { enterJob, hasArrived, isAway, jobDays, returnHome, startJob } from "./heroes"
import CastleScene, { type Walker } from "./castleScene"
import type { PadAction } from "./gamepad"
import type { PadTarget, Prompt } from "./gamepadControl"
import { dayMarks } from "./journey"
import { type ExploreTarget, mapContent, type MapMarker, type MissionMarker } from "./mapContent"
import MapSheet from "./mapSheet"
import Portraits, { meepleSitter } from "./portraits"
import { advanceDay, frontier, type MissionRoute, startMission } from "./missions"
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
 * Most report lines and notices shown
 */
const MAX_REPORTS = 5
const MAX_NOTICES = 3

/**
 * Walking speed of heroes, explorers have their own
 */
const HERO_SPEED = 1


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
 * Returns the walking style of a meeple, which follows from the id like the look
 */
function gaitOf(id: number): number
{
    return id * 0.618 % 1
}


/**
 * Returns what a report says an explorer found out
 */
function missionResult(campaign: Campaign, mission: Mission): string
{
    const { explorer, target, failed } = mission
    if (failed)
    {
        return explorer.name + " found no way to " + target + passedNote(mission)
    }
    const { kind, q, r } = overworld(campaign).patches[target]
    return explorer.name + " found " + KIND_ICONS[kind] + " " + KIND_NAMES[kind] + " at " + q + "/" + r + passedNote(mission)
}


/**
 * The castle in 3D with the HUD over it, running missions and reports in a corner. The map is a popup over the paused 3D
 * view, with a smaller popup on top to start a mission from what was clicked on it. The view can leave the castle to follow
 * someone on a journey. The DOM parts are small, so every change renders them all again; the 3D scene and the sheet of the
 * map stay.
 */
export default class GameView implements PadTarget
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
    private readonly notices = el("div", { className: "notices" })
    private readonly popup = el("div", { className: "popup", hidden: true })
    private readonly dialog = el("div", { className: "popup mission-popup", hidden: true })

    /** marker a mission is being set up for */
    private selected: MissionMarker | null = null

    /** hero picked for the mission */
    private pickedHero: number | null = null

    /** someone is about to leave and waiting for the route to be found */
    private sending = false

    private reports: string[] = []

    /** latest route for a hero, for the target and the amount of known land in its key */
    private heroRoute: { key: string, route: MissionRoute | null } | null = null

    /** what happened out of sight and hasn't been dismissed */
    private news: string[] = []

    /** id of the explorer or hero the view follows, null for the castle */
    private following: number | null = null

    /** mission just finished by the explorer the view follows, who stays there for now */
    private finished: Mission | null = null

    /** a controller is in charge */
    private padMode = false

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
                this.closePopup()
            }
        })

        this.render()
    }

    /**
     * Closes the topmost popup, if any
     *
     * @returns true if a popup was closed
     */
    private closePopup(): boolean
    {
        if (!this.dialog.hidden)
        {
            this.closeDialog()
            return true
        }
        if (!this.popup.hidden)
        {
            this.closeMap()
            return true
        }
        return false
    }

    scope(): Element[]
    {
        const { hud, info, notices, popup, dialog } = this
        if (!dialog.hidden)
        {
            return [dialog]
        }
        const around = [hud, info, notices, document.getElementById("sound")!]
        return popup.hidden ? around : [popup, ...around]
    }

    prompts(): Prompt[]
    {
        const { dialog, popup, following, castle } = this
        const prompts: Prompt[] = [{ glyph: "move", label: "Move" }, { glyph: "confirm", label: "Select" }]
        if (!dialog.hidden)
        {
            return [...prompts, { glyph: "back", label: "Back" }]
        }
        if (!popup.hidden)
        {
            prompts.push({ glyph: "back", label: "Close map" })
        }
        else
        {
            if (following !== null)
            {
                prompts.push({ glyph: "back", label: "To the castle" })
            }
            prompts.push({ glyph: "map", label: "Map" })
        }
        prompts.push({ glyph: "menu", label: "End day" })
        if (popup.hidden && castle)
        {
            prompts.push(
                { glyph: "look", label: "Look" },
                { glyph: "zoomOut", label: "Out" },
                { glyph: "zoomIn", label: "In" }
            )
        }
        return prompts
    }

    act(action: Exclude<PadAction, "confirm">): void
    {
        const { dialog, popup, following } = this
        if (action === "back")
        {
            if (!this.closePopup() && following !== null)
            {
                this.follow(null)
            }
        }
        else if (dialog.hidden)
        {
            if (action === "menu")
            {
                this.endDay()
            }
            else if (popup.hidden)
            {
                this.openMap()
            }
            else
            {
                this.closeMap()
            }
        }
    }

    look(yaw: number, pitch: number, zoom: number): void
    {
        if (this.popup.hidden)
        {
            this.castle?.look(yaw, pitch, zoom)
        }
    }

    setPadMode(active: boolean): void
    {
        this.padMode = active
        this.sheet.showAllArrows(active)
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
            this.notices,
            this.popup,
            this.dialog
        )
        return castle
    }

    private createSheet(): MapSheet
    {
        const sheet = new MapSheet(this.campaign.seed, () => this.hud.offsetHeight)
        sheet.showAllArrows(this.padMode)
        return sheet
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

    private follow(id: number | null): void
    {
        this.following = id
        this.finished = null
        this.castle?.follow(id)
        this.render()
    }

    private endDay(): void
    {
        const { campaign, following } = this
        const { patches } = overworld(campaign)
        const due = campaign.missions.filter(m => m.endDay <= campaign.day + 1)
        const arriving = campaign.jobs.filter(j => j.endDay === campaign.day + 1)

        advanceDay(campaign)

        for (const { heroId, target, returning } of arriving)
        {
            const hero = campaign.heroes.find(h => h.id === heroId)!
            if (returning)
            {
                const result = hero.name + " is back at " + campaign.castleName
                this.reports.unshift("Day " + campaign.day + ": " + result)
                if (heroId === following)
                {
                    this.follow(null)
                }
                else
                {
                    this.news.unshift("🛡️ " + result)
                }
                continue
            }
            const { kind } = patches[target]
            this.reports.unshift(
                "Day " + campaign.day + ": " + hero.name + " got to " + KIND_ICONS[kind] + " " + KIND_NAMES[kind] +
                " at " + target
            )
        }

        for (const mission of due)
        {
            const result = missionResult(campaign, mission)
            this.reports.unshift("Day " + campaign.day + ": " + result)
            if (mission.explorer.id === following)
            {
                this.finished = mission
            }
            else
            {
                this.news.unshift("🧭 " + result)
            }
        }
        this.reports.length = Math.min(this.reports.length, MAX_REPORTS)
        this.news.length = Math.min(this.news.length, MAX_NOTICES)
        this.changed()
    }

    private enter({ heroId, target }: Job): void
    {
        const { campaign } = this
        enterJob(campaign, heroId)
        const hero = campaign.heroes.find(h => h.id === heroId)!
        const { kind } = overworld(campaign).patches[target]
        this.reports.unshift(
            "Day " + campaign.day + ": " + hero.name + " is back from " + KIND_ICONS[kind] + " " + KIND_NAMES[kind] +
            " at " + target
        )
        this.reports.length = Math.min(this.reports.length, MAX_REPORTS)
        this.store.save(campaign)
        this.follow(null)
    }

    private sendHome({ heroId }: Job): void
    {
        returnHome(this.campaign, heroId)
        this.changed()
    }

    private sendHero(route: MissionRoute): void
    {
        const { campaign, selected, pickedHero } = this
        if (selected && pickedHero !== null)
        {
            startJob(campaign, pickedHero, selected.key, route)
            this.closeDialog()
            this.changed()
        }
    }

    /**
     * Returns the route for a hero to the given patch, null while it is being looked for. More known land can open up a
     * way, so it looks again after each discovery.
     */
    private routeForHero(target: string): MissionRoute | null
    {
        const { campaign } = this
        const known = Object.values(overworld(campaign).patches).filter(node => node.state === "discovered").length
        const key = target + "@" + known
        if (this.heroRoute?.key !== key)
        {
            const request: { key: string, route: MissionRoute | null } = { key, route: null }
            this.heroRoute = request
            this.sim.heroRoute(campaign, target).then(
                route => {
                    if (this.heroRoute === request)
                    {
                        request.route = route
                        this.render()
                    }
                },
                e => console.error("No route to " + target, e)
            )
        }
        return this.heroRoute!.route
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
                        if (this.finished?.explorer === explorer)
                        {
                            // off again, the view can't stay with them where they were
                            this.follow(null)
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

    /**
     * Returns the journey the view follows and what it is about, if any
     */
    private followedJourney(): Mission | Job | undefined
    {
        const { campaign, following, finished } = this
        return finished ??
            campaign.missions.find(m => m.explorer.id === following) ??
            campaign.jobs.find(j => j.heroId === following)
    }

    /**
     * Returns everyone on a journey who can be seen, plus an explorer the view stays with after their report
     */
    private walkers(): Walker[]
    {
        const { campaign, finished } = this
        const { seed, day } = campaign
        const walker = (id: number, speed: number, dex: number, journey: Journey, homeward = false): Walker[] => {
            if (!journey.way)
            {
                return []
            }
            const [reached, next] = dayMarks(journey, day)
            return [{ id, look: meepleSitter(seed, id).look, gait: gaitOf(id), dex, way: journey.way, speed, reached, next, homeward }]
        }
        return [
            ...campaign.missions.flatMap(m => walker(m.explorer.id, m.explorer.speed, m.explorer.dex, m)),
            ...campaign.jobs.flatMap(j => walker(j.heroId, HERO_SPEED, campaign.heroes.find(h => h.id === j.heroId)!.character.stats.dex, j, j.returning)),
            ...(finished ? walker(finished.explorer.id, finished.explorer.speed, finished.explorer.dex, finished) : [])
        ]
    }

    /**
     * Returns the patches shown in 3D: what is known, and what someone the view follows is crossing or heading to. The
     * latter doesn't make them known, they are just there to walk on.
     */
    private shownPatches(): Pick<PatchNode, "q" | "r" | "kind">[]
    {
        const { patches } = overworld(this.campaign)
        const journey = this.followedJourney()
        return [
            ...Object.values(patches).filter(node => node.state === "discovered"),
            ...(journey?.way && "explorer" in journey ? [...(journey.passed ?? []), patches[journey.target]].filter(Boolean) : [])
        ]
    }

    private render(): void
    {
        const { campaign } = this
        this.castle?.show(this.shownPatches())
        this.castle?.setWalkers(this.walkers())
        this.hud.replaceChildren(...present(this.renderHud()))
        this.info.replaceChildren(...present([this.renderMissions(), this.renderReports()]))
        this.info.hidden = this.info.childElementCount === 0
        this.notices.replaceChildren(...present([this.renderFollowed(), ...this.renderArrivals(), ...this.renderNews()]))
        if (!this.popup.hidden)
        {
            this.popup.replaceChildren(this.sheet.element)
            this.sheet.extras.replaceChildren(
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
                className: "pad-start",
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
                            this.news = []
                            this.heroRoute = null
                            this.following = null
                            this.finished = null
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
                    title: KIND_NAMES[kind] + ": " + (days ? "a hero gets there in " + days + "d" : "a hero waits to enter")
                }, KIND_ICONS[kind], el("small", {}, days ? "⏳" + days : "🚪"))
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
                    "speed " + explorer.speed.toFixed(2) + " · dex " + explorer.dex + " · wisdom " + explorer.wisdom +
                    (explorer.experience ? " · " + explorer.experience +
                        (explorer.experience === 1 ? " mission" : " missions") : "") +
                    " · leaves in " + (explorer.leavesOn - campaign.day) + "d"
                ),
                el("button", {
                    type: "button",
                    className: "pad-start",
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
        const route = this.routeForHero(key)
        const blocked = route !== null && !route.reachable
        return el("section", { className: "mission" },
            this.renderDialogClose(),
            el("h3", {}, KIND_ICONS[kind] + " " + KIND_NAMES[kind] + " at " + key),
            el("p", { className: "hint" }, blocked
                ? "🚧 No known way there. Heroes only travel over discovered land, so explorers have to find one first."
                : "Who should go there?"
            ),
            ...campaign.heroes.map(hero => {
                const away = campaign.jobs.find(j => j.heroId === hero.id)
                const { stats, classes } = hero.character
                return el("label", { className: "explorer" + (away ? " away" : "") },
                    this.renderPortrait(hero),
                    el("span", { className: "name" }, hero.name + " · " + classes.join(", ")),
                    el("span", { className: "stats" },
                        "hp " + stats.hp + " · mp " + stats.mp + " · str " + stats.str + " · dex " + stats.dex +
                        (hero.experience ? " · " + hero.experience + (hero.experience === 1 ? " job" : " jobs") : "") +
                        (away ? " · " + this.jobStatus(away) : "")
                    ),
                    el("input", {
                        type: "radio",
                        className: "pad-start",
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
                disabled: pickedHero === null || !route?.reachable,
                onclick: () => route && this.sendHero(route)
            }, route ? "Launch mission · " + jobDays(key) + "d" : "Looking for a way…")
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

    private jobStatus(job: Job): string
    {
        const days = job.endDay - this.campaign.day
        return hasArrived(this.campaign, job) ? "waits to enter" : (job.returning ? "home in " : "gets there in ") + days + "d"
    }

    /**
     * Returns the orders for a hero who got to the target of their job
     */
    private renderOrders(job: Job): HTMLElement[]
    {
        return [
            el("button", { type: "button", className: "enter", onclick: () => this.enter(job) }, "Enter"),
            el("button", { type: "button", onclick: () => this.sendHome(job) }, "Return to " + this.campaign.castleName)
        ]
    }

    /**
     * Returns a line of the mission list, which binds the view to whoever it is about
     */
    private renderTarget(text: string, id: number | null, canFollow: boolean): HTMLElement
    {
        const active = this.following === id
        return this.castle && canFollow
            ? el("button", {
                type: "button",
                className: "view-target" + (active ? " active" : ""),
                title: active ? "The view is here" : "Go there",
                onclick: () => {
                    if (!this.popup.hidden)
                    {
                        this.closeMap()
                    }
                    this.follow(id)
                }
            }, text)
            : el("div", {}, text)
    }

    private renderMissions(): HTMLElement | null
    {
        const { campaign, following, castle } = this
        if (campaign.missions.length === 0 && campaign.jobs.length === 0 && following === null)
        {
            return null
        }
        return el("section", { className: "missions" },
            el("h3", {}, "Missions"),
            castle && this.renderTarget("🏰 " + campaign.castleName, null, true),
            ...campaign.missions.map(({ explorer, target, endDay, way }) => this.renderTarget(
                "🧭 " + explorer.name + " → " + target + ", gets there in " + (endDay - campaign.day) + "d",
                explorer.id,
                !!way
            )),
            ...campaign.jobs.map(job => this.renderTarget(
                "🛡️ " + campaign.heroes.find(h => h.id === job.heroId)!.name + " → " +
                    (job.returning ? campaign.castleName : job.target) + ", " + this.jobStatus(job),
                job.heroId,
                !!job.way
            ))
        )
    }

    /**
     * Returns what there is to say about the journey the view follows, and the order to enter once the hero is there
     */
    private renderFollowed(): HTMLElement | null
    {
        const { campaign, following, finished } = this
        if (finished)
        {
            return el("div", { className: "notice followed" }, "🧭 " + missionResult(campaign, finished))
        }
        const mission = campaign.missions.find(m => m.explorer.id === following)
        if (mission)
        {
            return el("div", { className: "notice followed" },
                "🧭 " + mission.explorer.name + " → " + mission.target + ", gets there in " + (mission.endDay - campaign.day) + "d"
            )
        }
        const job = campaign.jobs.find(j => j.heroId === following)
        if (!job)
        {
            return null
        }
        const { name } = campaign.heroes.find(h => h.id === job.heroId)!
        const { kind } = overworld(campaign).patches[job.target]
        const place = KIND_ICONS[kind] + " " + KIND_NAMES[kind]
        return hasArrived(campaign, job)
            ? el("div", { className: "notice followed" }, "🛡️ " + name + " is at " + place, ...this.renderOrders(job))
            : el("div", { className: "notice followed" },
                "🛡️ " + name + " → " + (job.returning ? "🏰 " + campaign.castleName : place) + ", " + this.jobStatus(job)
            )
    }

    /**
     * Returns the notices of heroes waiting to enter out of sight, which stay until someone goes there
     */
    private renderArrivals(): HTMLElement[]
    {
        const { campaign, following, castle } = this
        return campaign.jobs
            .filter(job => hasArrived(campaign, job) && job.heroId !== following)
            .map(job => {
                const { kind } = overworld(campaign).patches[job.target]
                const { name } = campaign.heroes.find(h => h.id === job.heroId)!
                const text = "🛡️ " + name + " is at " + KIND_ICONS[kind] + " " + KIND_NAMES[kind]
                return el("div", { className: "notice" },
                    text,
                    ...castle && job.way
                        ? [el("button", { type: "button", onclick: () => this.follow(job.heroId) }, "Go there")]
                        : this.renderOrders(job)
                )
            })
    }

    private renderNews(): HTMLElement[]
    {
        return this.news.map(line => el("div", { className: "notice" },
            line,
            el("button", {
                type: "button",
                className: "dismiss",
                title: "Dismiss",
                onclick: () => {
                    this.news = this.news.filter(other => other !== line)
                    this.render()
                }
            }, "✕")
        ))
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
