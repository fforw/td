/**
 * Families of controllers the game has icons for
 */
export type Scheme = "xbox" | "playstation" | "switch" | "steamdeck"

/**
 * What a button does in the game
 */
export type PadAction = "confirm" | "back" | "map" | "endDay" | "menu"

/**
 * What the game can show an icon for
 */
export type Glyph = PadAction | "move" | "look" | "zoomOut" | "zoomIn" | "run" | "dash" | "attack" | "block"

export type Direction = "up" | "down" | "left" | "right"

/**
 * Part of a controller's state as the browser reports it
 */
export type PadState = Pick<Gamepad, "id" | "buttons" | "axes">

/**
 * What a controller does at the moment
 */
export interface PadInput
{
    scheme: Scheme
    /** something is deliberately being used, which leaves out the noise of a resting stick */
    active: boolean
    actions: PadAction[]
    direction: Direction | null
    /** right stick */
    lookX: number
    lookY: number
    /** right trigger minus left trigger */
    zoom: number
    /** left stick, how far and where a hero is told to go */
    moveX: number
    moveY: number
    /** right stick, only for where it points */
    aimX: number
    aimY: number
    /** left shoulder button */
    dash: boolean
    /** right shoulder button */
    attack: boolean
    /** left trigger */
    block: boolean
    /** TEMP god mode: up on the cross kills all monsters in the room of the hero */
    godKill: boolean
}

/**
 * Button indices of the standard mapping, which go by position. A Nintendo controller has its A on the east, so that
 * family confirms there, like it does on its home console.
 */
const SOUTH = 0
const EAST = 1
const WEST = 2
const NORTH = 3
const LEFT_SHOULDER = 4
const RIGHT_SHOULDER = 5
const LEFT_TRIGGER = 6
const RIGHT_TRIGGER = 7
const START = 9
const DPAD_UP = 12
const DPAD_DOWN = 13
const DPAD_LEFT = 14
const DPAD_RIGHT = 15

/**
 * How far a stick needs to go to count as moving the focus or as being used at all, and how far it can rest off center
 */
const STICK_PRESS = 0.5
const STICK_DEAD_ZONE = 0.2

/**
 * How far the right stick needs to go to aim, which leaves out where it comes to rest when let go of
 */
const AIM_DEAD_ZONE = 0.4

/**
 * How far a trigger needs to go to count as used
 */
const TRIGGER_DEAD_ZONE = 0.1

/**
 * How far a trigger needs to go to count as held
 */
const TRIGGER_PRESS = 0.3

/**
 * Milliseconds a held direction waits before repeating, and between repeats
 */
const REPEAT_DELAY = 350
const REPEAT_INTERVAL = 150

/**
 * How much being off to the side of a direction counts against something over being far away in that direction
 */
const SIDEWAYS_WEIGHT = 2.5

const VENDOR_SONY = 0x054c
const VENDOR_NINTENDO = 0x057e
const VENDOR_VALVE = 0x28de
const PRODUCT_STEAM_DECK = 0x1205

const GLYPHS: Record<Scheme, Record<Glyph, string>> = {
    xbox: {
        confirm: "xbox_button_a",
        back: "xbox_button_b",
        map: "xbox_button_y",
        endDay: "xbox_button_x",
        menu: "xbox_button_menu",
        move: "xbox_dpad",
        look: "xbox_stick_r",
        zoomOut: "xbox_lt",
        zoomIn: "xbox_rt",
        run: "xbox_stick_l",
        dash: "xbox_lb",
        attack: "xbox_rb",
        block: "xbox_lt"
    },
    playstation: {
        confirm: "playstation_button_cross",
        back: "playstation_button_circle",
        map: "playstation_button_triangle",
        endDay: "playstation_button_square",
        menu: "playstation5_button_options",
        move: "playstation_dpad",
        look: "playstation_stick_r",
        zoomOut: "playstation_trigger_l2",
        zoomIn: "playstation_trigger_r2",
        run: "playstation_stick_l",
        dash: "playstation_trigger_l1",
        attack: "playstation_trigger_r1",
        block: "playstation_trigger_l2"
    },
    switch: {
        confirm: "switch_button_a",
        back: "switch_button_b",
        map: "switch_button_x",
        endDay: "switch_button_y",
        menu: "switch_button_plus",
        move: "switch_dpad",
        look: "switch_stick_r",
        zoomOut: "switch_button_zl",
        zoomIn: "switch_button_zr",
        run: "switch_stick_l",
        dash: "switch_button_l",
        attack: "switch_button_r",
        block: "switch_button_zl"
    },
    steamdeck: {
        confirm: "steamdeck_button_a",
        back: "steamdeck_button_b",
        map: "steamdeck_button_y",
        endDay: "steamdeck_button_x",
        menu: "steamdeck_button_options",
        move: "steamdeck_dpad",
        look: "steamdeck_stick_r",
        zoomOut: "steamdeck_button_l2",
        zoomIn: "steamdeck_button_r2",
        run: "steamdeck_stick_l",
        dash: "steamdeck_button_l1",
        attack: "steamdeck_button_r1",
        block: "steamdeck_button_l2"
    }
}


/**
 * Returns the URL of the icon for what the given family of controllers has at that place
 */
export function glyphUrl(scheme: Scheme, glyph: Glyph): string
{
    return "media/input/" + scheme + "/" + GLYPHS[scheme][glyph] + ".svg"
}


/**
 * Returns the vendor and product of a controller from its id, which browsers write in different ways:
 *
 * - Chrome: "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)"
 * - Firefox: "54c-ce6-Wireless Controller"
 *
 * Safari only has the name.
 */
function hardwareOf(id: string): [number, number] | null
{
    const match = /vendor:\s*([0-9a-f]+)\s+product:\s*([0-9a-f]+)/i.exec(id) ?? /^([0-9a-f]{1,4})-([0-9a-f]{1,4})-/i.exec(id)
    return match && [parseInt(match[1], 16), parseInt(match[2], 16)]
}


/**
 * Returns the family of a controller, going by the id the browser reports. The hardware ids decide if there are any, then
 * the name. Everything else gets Xbox icons, as that is the layout almost all other controllers copy.
 *
 * @param id    id of a Gamepad
 */
export function schemeOf(id: string): Scheme
{
    const hardware = hardwareOf(id)
    if (hardware)
    {
        const [vendor, product] = hardware
        if (vendor === VENDOR_SONY)
        {
            return "playstation"
        }
        if (vendor === VENDOR_NINTENDO)
        {
            return "switch"
        }
        if (vendor === VENDOR_VALVE && product === PRODUCT_STEAM_DECK)
        {
            return "steamdeck"
        }
    }
    if (/dualshock|dualsense|playstation/i.test(id))
    {
        return "playstation"
    }
    if (/nintendo|joy-?con|\bpro controller\b/i.test(id))
    {
        return "switch"
    }
    return /steam deck/i.test(id) ? "steamdeck" : "xbox"
}


function isPressed({ buttons }: PadState, index: number): boolean
{
    return !!buttons[index]?.pressed
}


function deadZone(value: number | undefined): number
{
    return value && Math.abs(value) >= STICK_DEAD_ZONE ? value : 0
}


/**
 * Returns the position of a stick that starts from nothing at the dead zone and gets to its full length at the rim
 */
function stickOf(x: number, y: number, dead: number): [number, number]
{
    const length = Math.hypot(x, y)
    if (length < dead)
    {
        return [0, 0]
    }
    const scale = Math.min(1, (length - dead) / (1 - dead)) / length
    return [x * scale, y * scale]
}


function directionOf(pad: PadState): Direction | null
{
    if (isPressed(pad, DPAD_UP))
    {
        return "up"
    }
    if (isPressed(pad, DPAD_DOWN))
    {
        return "down"
    }
    if (isPressed(pad, DPAD_LEFT))
    {
        return "left"
    }
    if (isPressed(pad, DPAD_RIGHT))
    {
        return "right"
    }
    const x = pad.axes[0] ?? 0
    const y = pad.axes[1] ?? 0
    if (Math.max(Math.abs(x), Math.abs(y)) < STICK_PRESS)
    {
        return null
    }
    return Math.abs(x) > Math.abs(y) ? (x < 0 ? "left" : "right") : (y < 0 ? "up" : "down")
}


/**
 * Returns what a controller does at the moment
 */
export function readPad(pad: PadState): PadInput
{
    const scheme = schemeOf(pad.id)
    const [confirm, back] = scheme === "switch" ? [EAST, SOUTH] : [SOUTH, EAST]
    const actions: PadAction[] = []
    for (const [action, index] of [["confirm", confirm], ["back", back], ["map", NORTH], ["endDay", WEST], ["menu", START]] as const)
    {
        if (isPressed(pad, index))
        {
            actions.push(action)
        }
    }

    const direction = directionOf(pad)
    const lookX = deadZone(pad.axes[2])
    const lookY = deadZone(pad.axes[3])
    const left = pad.buttons[LEFT_TRIGGER]?.value ?? 0
    const right = pad.buttons[RIGHT_TRIGGER]?.value ?? 0
    const zoom = (right >= TRIGGER_DEAD_ZONE ? right : 0) - (left >= TRIGGER_DEAD_ZONE ? left : 0)
    const [moveX, moveY] = stickOf(pad.axes[0] ?? 0, pad.axes[1] ?? 0, STICK_DEAD_ZONE)
    const [aimX, aimY] = stickOf(pad.axes[2] ?? 0, pad.axes[3] ?? 0, AIM_DEAD_ZONE)
    const dash = isPressed(pad, LEFT_SHOULDER)
    const attack = isPressed(pad, RIGHT_SHOULDER)
    const block = left >= TRIGGER_PRESS
    return {
        scheme,
        active: actions.length > 0 || direction !== null || !!lookX || !!lookY || !!zoom || !!moveX || !!moveY || dash || attack,
        actions,
        direction,
        lookX,
        lookY,
        zoom,
        moveX,
        moveY,
        aimX,
        aimY,
        dash,
        attack,
        block,
        godKill: isPressed(pad, DPAD_UP)
    }
}


/**
 * Turns what a controller does at each moment into what happened since the last one: buttons count once when pressed,
 * held directions repeat.
 */
export class PadTracker
{
    private held: PadAction[] = []
    private direction: Direction | null = null
    private nextMove = 0

    /**
     * @param input     what the controller does now
     * @param time      current time in milliseconds
     */
    update({ actions, direction }: PadInput, time: number): { pressed: PadAction[], move: Direction | null }
    {
        const pressed = actions.filter(action => !this.held.includes(action))
        this.held = actions

        let move: Direction | null = null
        if (direction !== this.direction)
        {
            this.direction = direction
            this.nextMove = time + REPEAT_DELAY
            move = direction
        }
        else if (direction && time >= this.nextMove)
        {
            this.nextMove = time + REPEAT_INTERVAL
            move = direction
        }
        return { pressed, move }
    }
}


/**
 * Returns which of the given positions is the next one in a direction, null if there is nothing that way.
 *
 * @param x             x-position to start from
 * @param y             y-position to start from
 * @param direction     direction, on the screen
 * @param candidates    what can be gone to, with x- and y-position
 */
export function nextInDirection<T extends { x: number, y: number }>(x: number, y: number, direction: Direction, candidates: T[]): T | null
{
    let best: T | null = null
    let bestScore = Infinity
    for (const candidate of candidates)
    {
        const dx = candidate.x - x
        const dy = candidate.y - y
        const horizontal = direction === "left" || direction === "right"
        const ahead = (horizontal ? dx : dy) * (direction === "left" || direction === "up" ? -1 : 1)
        const score = ahead + Math.abs(horizontal ? dy : dx) * SIDEWAYS_WEIGHT
        if (ahead > 1 && score < bestScore)
        {
            best = candidate
            bestScore = score
        }
    }
    return best
}
