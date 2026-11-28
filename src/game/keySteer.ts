import type { PadAction } from "./gamepad"

/**
 * What keyboard and mouse tell the hero in a level to do at the moment
 */
export interface KeyInput
{
    /** where to go on the screen, to the right and down like a stick, with length 1 or none */
    moveX: number
    moveY: number
    dash: boolean
    attack: boolean
    block: boolean
    /** uses the current piece of gear */
    use: boolean
    /** where the pointer is in client pixels, null as long as nobody knows */
    pointerX: number | null
    pointerY: number | null
}

/**
 * Keys to go by, as KeyboardEvent.code, which is where they are on the keyboard whatever its layout calls them
 */
const MOVE_KEYS: Record<string, readonly [number, number]> = {
    KeyW: [0, -1],
    KeyA: [-1, 0],
    KeyS: [0, 1],
    KeyD: [1, 0]
}

const DASH_KEYS: readonly string[] = ["Space", "ShiftLeft"]

const USE_KEY = "KeyQ"

/**
 * Keys that pick the first ten pieces of gear, in the order of the row over the letters
 */
const SLOT_KEYS: readonly string[] = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0"]

/**
 * Pixels the mouse wheel turns for one step through the gear, about one notch of a wheel, so a touchpad's stream of
 * small turns doesn't race through all of it
 */
const WHEEL_STEP = 100

/**
 * Pixels a line or a page of the wheel counts as, for browsers that tell it in those
 */
const WHEEL_LINE = 33
const WHEEL_PAGE = 800

/**
 * Keys that do what a button on the face of a controller does in a level
 */
const ACTION_KEYS: Record<string, Exclude<PadAction, "menu">> = {
    KeyE: "confirm",
    KeyF: "endDay",
    KeyM: "map"
}

const ATTACK_BUTTON = 0
const BLOCK_BUTTON = 2

/**
 * What to tell the player about the keys, in the order of the prompts for a controller
 */
export const KEY_HINTS = {
    move: "WASD",
    aim: "Mouse",
    dash: "Space",
    attack: "Left click",
    block: "Right click",
    use: "Q",
    pick: "1-0 / Wheel",
    confirm: "E",
    light: "F",
    map: "M"
} as const


/**
 * Returns what the key with the given code does in a level when it is pressed, null for nothing
 */
export function keyAction(code: string): Exclude<PadAction, "menu"> | null
{
    return ACTION_KEYS[code] ?? null
}


/**
 * Returns the index of the piece of gear a key picks, null for a key that doesn't
 */
export function keySlot(code: string): number | null
{
    const index = SLOT_KEYS.indexOf(code)
    return index >= 0 ? index : null
}


/**
 * Keeps track of the keys and mouse buttons that steer a hero in a level: WASD to go, the pointer to aim at, the mouse
 * buttons to attack and block, the wheel to pick gear. Plain state without the page, which feeds it the events.
 */
export default class KeySteer
{
    private readonly held = new Set<string>()
    private readonly buttons = new Set<number>()
    private pointerX: number | null = null
    private pointerY: number | null = null

    /**
     * Pixels the wheel turned towards the next step through the gear, negative for the one before
     */
    private wheelTurned = 0

    /**
     * Takes a key going down
     *
     * @return true if the key steers, for the page to keep it from doing anything else
     */
    keyDown(code: string): boolean
    {
        if (code in MOVE_KEYS || DASH_KEYS.includes(code) || code === USE_KEY)
        {
            this.held.add(code)
            return true
        }
        return false
    }

    /**
     * Takes a key going up
     *
     * @return true if the key was steering
     */
    keyUp(code: string): boolean
    {
        return this.held.delete(code)
    }

    /**
     * Takes a mouse button going down or up, by its MouseEvent.button
     */
    button(button: number, down: boolean): void
    {
        if (down)
        {
            this.buttons.add(button)
        }
        else
        {
            this.buttons.delete(button)
        }
    }

    /**
     * Takes where the pointer is, in client pixels
     */
    point(x: number, y: number): void
    {
        this.pointerX = x
        this.pointerY = y
    }

    /**
     * Takes a turn of the mouse wheel, by WheelEvent.deltaY and deltaMode
     *
     * @return which way to step through the gear, down for the next piece, 0 for not yet
     */
    wheel(deltaY: number, deltaMode: number): -1 | 0 | 1
    {
        const pixels = deltaY * (deltaMode === 1 ? WHEEL_LINE : deltaMode === 2 ? WHEEL_PAGE : 1)
        // turning back starts over, so the first step that way comes as soon as one the other way would
        if (Math.sign(pixels) !== Math.sign(this.wheelTurned))
        {
            this.wheelTurned = 0
        }
        this.wheelTurned += pixels
        if (Math.abs(this.wheelTurned) < WHEEL_STEP)
        {
            return 0
        }
        const step = this.wheelTurned > 0 ? 1 : -1
        this.wheelTurned -= step * WHEEL_STEP
        return step
    }

    /**
     * Lets go of everything, for when the keys and buttons go elsewhere and their release might never show up. The pointer
     * stays where it is.
     */
    release(): void
    {
        this.held.clear()
        this.buttons.clear()
        this.wheelTurned = 0
    }

    /**
     * Returns what all of it tells the hero right now. Opposite keys cancel out, and going diagonally is as fast as going
     * straight.
     */
    input(): KeyInput
    {
        const { held, buttons, pointerX, pointerY } = this
        let moveX = 0, moveY = 0
        for (const code of held)
        {
            const move = MOVE_KEYS[code]
            if (move)
            {
                moveX += move[0]
                moveY += move[1]
            }
        }
        const length = Math.hypot(moveX, moveY) || 1
        return {
            moveX: moveX / length,
            moveY: moveY / length,
            dash: DASH_KEYS.some(code => held.has(code)),
            attack: buttons.has(ATTACK_BUTTON),
            block: buttons.has(BLOCK_BUTTON),
            use: held.has(USE_KEY),
            pointerX,
            pointerY
        }
    }
}
