import {
    type Direction,
    type Glyph,
    glyphUrl,
    nextInDirection,
    type PadAction,
    PadTracker,
    readPad,
    type Scheme
} from "./gamepad"

/**
 * Icon with what it does right now
 */
export interface Prompt
{
    glyph: Glyph
    label: string
}

/**
 * What a controller works on: the title screen or the game
 */
export interface PadTarget
{
    /** returns the parts of the screen that can be used right now, the first one telling them apart and leading the focus */
    scope(): Element[]

    /** returns what to show at the bottom of the screen */
    prompts(): Prompt[]

    /** called for the buttons that don't just click on what has the focus */
    act(action: Exclude<PadAction, "confirm">): void

    /** called while the view is being moved, see CastleScene.look() */
    look?(yaw: number, pitch: number, zoom: number): void

    /** called when the controller takes over from mouse and keyboard, or gives back to them */
    setPadMode?(active: boolean): void
}

/**
 * Where the focus was
 */
interface FocusSpot
{
    key: string
    x: number
    y: number
}

const FOCUSABLE = "button:not(:disabled), input:not(:disabled)"

/**
 * Starting point of the focus in a scope, if not the first thing in it
 */
const PREFERRED = ".pad-start"

/**
 * Radians per second the camera turns at a fully tilted stick
 */
const LOOK_SPEED = 2

/**
 * Change of the camera distance per second at a fully pressed trigger, as the exponent of a factor
 */
const ZOOM_SPEED = 1

/**
 * Longest time in seconds a single frame moves the view for, so that a hiccup doesn't make it jump
 */
const MAX_FRAME_TIME = 0.1


function centerOf(elem: Element): { x: number, y: number }
{
    const { left, top, width, height } = elem.getBoundingClientRect()
    return { x: left + width / 2, y: top + height / 2 }
}


/**
 * Returns what tells an element apart from others across renders of the view, which replace all elements. It leaves out
 * the state of a job or the like that may be part of the text, where it would only cost going by the position instead.
 */
function keyOf(elem: HTMLElement): string
{
    return elem.className + "|" + elem.title + "|" + (elem.closest("label") ?? elem).textContent
}


/**
 * Lets a controller work the screen. The browser has no gamepad events to speak of, so this looks at the controllers on
 * each animation frame while there are some. All the buttons stay plain DOM elements: the direction moves the focus over
 * them and the confirm button clicks. The controller is in charge from its first use on, which shows the focus and the
 * prompts and doesn't do anything else, until the mouse or keyboard get used again.
 */
export default class GamepadControl
{
    private readonly bar = document.createElement("div")

    private readonly trackers = new Map<number, PadTracker>()

    private target: PadTarget | null = null
    private active = false
    private running = false
    private scheme: Scheme = "xbox"
    private lastTime = 0

    /** what the bar shows */
    private shown = ""

    /** first part of the scope the focus was last in */
    private scopeOwner: Element | null = null

    /** where the focus was in each scope, to get back there */
    private readonly spots = new Map<Element, FocusSpot>()

    constructor()
    {
        this.bar.className = "pad-prompts"
        this.bar.hidden = true
        document.body.append(this.bar)

        window.addEventListener("gamepadconnected", () => this.start())
        window.addEventListener("gamepaddisconnected", ({ gamepad }) => this.trackers.delete(gamepad.index))

        // a layout change under a resting mouse also creates move events
        const handOver = (ev: Event) => {
            if (!(ev instanceof PointerEvent) || ev.type !== "pointermove" || ev.movementX || ev.movementY)
            {
                this.setActive(false)
            }
        }
        // ahead of the handlers of the things on the screen, for them to see the mode they work in
        window.addEventListener("pointermove", handOver, true)
        window.addEventListener("pointerdown", handOver, true)
        window.addEventListener("keydown", handOver, true)

        this.start()
    }

    /**
     * Sets what the controller works on
     */
    setTarget(target: PadTarget): void
    {
        this.target = target
        target.setPadMode?.(this.active)
    }

    private start(): void
    {
        if (!this.running && this.pads().length > 0)
        {
            this.running = true
            this.lastTime = performance.now()
            requestAnimationFrame(time => this.frame(time))
        }
    }

    /**
     * Returns the controllers there are. Browsers only tell about them after a button got pressed, and not at all outside of
     * secure contexts.
     */
    private pads(): Gamepad[]
    {
        return (navigator.getGamepads?.() ?? []).filter(pad => pad?.connected) as Gamepad[]
    }

    private setActive(active: boolean): void
    {
        if (active !== this.active)
        {
            this.active = active
            document.body.classList.toggle("gamepad", active)
            this.bar.hidden = !active
            this.scopeOwner = null
            this.target?.setPadMode?.(active)
        }
    }

    private frame(time: number): void
    {
        const pads = this.pads()
        if (pads.length === 0)
        {
            this.running = false
            this.setActive(false)
            return
        }
        requestAnimationFrame(next => this.frame(next))

        const delta = Math.min(MAX_FRAME_TIME, (time - this.lastTime) / 1000)
        this.lastTime = time

        const pressed: PadAction[] = []
        let move: Direction | null = null
        let lookX = 0, lookY = 0, zoom = 0
        let used = false
        for (const pad of pads)
        {
            let tracker = this.trackers.get(pad.index)
            if (!tracker)
            {
                tracker = new PadTracker()
                this.trackers.set(pad.index, tracker)
            }
            const input = readPad(pad)
            const change = tracker.update(input, time)
            pressed.push(...change.pressed)
            move ??= change.move
            if (input.active)
            {
                used = true
                this.scheme = input.scheme
                lookX ||= input.lookX
                lookY ||= input.lookY
                zoom ||= input.zoom
            }
        }

        if (!this.active)
        {
            if (!used)
            {
                return
            }
            // only comes to the front for now, nobody knows yet what the buttons are about to do
            this.setActive(true)
            pressed.length = 0
            move = null
        }

        const { target } = this
        if (target)
        {
            const focused = this.updateFocus(target)
            if (move && focused)
            {
                this.moveFocus(focused, move, target)
            }
            for (const action of pressed)
            {
                if (action === "confirm")
                {
                    focused?.click()
                }
                else
                {
                    target.act(action)
                }
            }
            if (lookX || lookY || zoom)
            {
                target.look?.(-lookX * LOOK_SPEED * delta, -lookY * LOOK_SPEED * delta, Math.exp(-zoom * ZOOM_SPEED * delta))
            }
            this.showPrompts(target)
        }
    }

    /**
     * Returns what can get the focus right now
     */
    private candidates(target: PadTarget): HTMLElement[]
    {
        return target.scope()
            .flatMap(part => [...part.querySelectorAll<HTMLElement>(FOCUSABLE), ...(part.matches(FOCUSABLE) ? [part as HTMLElement] : [])])
            .filter(elem => elem.getClientRects().length > 0)
    }

    /**
     * Makes sure that something has the focus, which it can lose to any render of the view or a popup opening or closing.
     *
     * @returns what has the focus, null if there is nothing to focus at all
     */
    private updateFocus(target: PadTarget): HTMLElement | null
    {
        const candidates = this.candidates(target)
        const owner = target.scope()[0]
        const { activeElement } = document

        let focused: HTMLElement | undefined
        if (owner === this.scopeOwner && candidates.includes(activeElement as HTMLElement))
        {
            focused = activeElement as HTMLElement
        }
        else
        {
            // coming back to a place means the one left is done with, it starts over the next time
            if (this.scopeOwner && owner !== this.scopeOwner && this.spots.has(owner))
            {
                this.spots.delete(this.scopeOwner)
            }
            this.scopeOwner = owner
            focused = this.refocus(candidates, owner, this.spots.get(owner))
            focused?.focus()
        }
        if (!focused)
        {
            return null
        }
        this.spots.set(owner, { key: keyOf(focused), ...centerOf(focused) })
        return focused
    }

    /**
     * Returns what should get the focus: what had it in that place before, or what took its place, or the start of the scope
     */
    private refocus(candidates: HTMLElement[], owner: Element, spot: FocusSpot | undefined): HTMLElement | undefined
    {
        if (!spot)
        {
            return candidates.find(elem => elem.matches(PREFERRED) && owner.contains(elem)) ?? candidates[0]
        }
        const same = candidates.filter(elem => keyOf(elem) === spot.key)
        let best: HTMLElement | undefined
        let bestDistance = Infinity
        for (const elem of same.length ? same : candidates)
        {
            const { x, y } = centerOf(elem)
            const distance = Math.hypot(x - spot.x, y - spot.y)
            if (distance < bestDistance)
            {
                best = elem
                bestDistance = distance
            }
        }
        return best
    }

    private moveFocus(focused: HTMLElement, direction: Direction, target: PadTarget): void
    {
        const { x, y } = centerOf(focused)
        const others = this.candidates(target)
            .filter(elem => elem !== focused)
            .map(elem => ({ elem, ...centerOf(elem) }))
        const next = nextInDirection(x, y, direction, others)?.elem
        if (next)
        {
            next.focus()
            this.spots.set(target.scope()[0], { key: keyOf(next), ...centerOf(next) })
        }
    }

    /**
     * Shows the prompts, along with the tooltip of what has the focus as there is no mouse to bring that up
     */
    private showPrompts(target: PadTarget): void
    {
        const { scheme, bar } = this
        const prompts = target.prompts()
        const { title } = document.activeElement as HTMLElement
        const shown = [scheme, title, ...prompts.map(({ glyph, label }) => glyph + ":" + label)].join()
        if (shown === this.shown)
        {
            return
        }
        this.shown = shown

        const elements: HTMLElement[] = []
        if (title)
        {
            const about = document.createElement("span")
            about.className = "about"
            about.textContent = title
            elements.push(about)
        }
        for (const { glyph, label } of prompts)
        {
            const prompt = document.createElement("span")
            const icon = document.createElement("img")
            icon.src = glyphUrl(scheme, glyph)
            icon.alt = ""
            prompt.append(icon, label)
            elements.push(prompt)
        }
        bar.replaceChildren(...elements)
    }
}
