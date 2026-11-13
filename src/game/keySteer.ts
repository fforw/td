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

/**
 * Keys that do what a button on the face of a controller does in a level
 */
const ACTION_KEYS: Record<string, Exclude<PadAction, "menu">> = {
    KeyE: "confirm",
    KeyF: "map",
    KeyM: "endDay"
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
 * Keeps track of the keys and mouse buttons that steer a hero in a level: WASD to go, the pointer to aim at, the mouse
 * buttons to attack and block. Plain state without the page, which feeds it the events.
 */
export default class KeySteer
{
    private readonly held = new Set<string>()
    private readonly buttons = new Set<number>()
    private pointerX: number | null = null
    private pointerY: number | null = null

    /**
     * Takes a key going down
     *
     * @return true if the key steers, for the page to keep it from doing anything else
     */
    keyDown(code: string): boolean
    {
        if (code in MOVE_KEYS || DASH_KEYS.includes(code))
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
     * Lets go of everything, for when the keys and buttons go elsewhere and their release might never show up. The pointer
     * stays where it is.
     */
    release(): void
    {
        this.held.clear()
        this.buttons.clear()
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
            pointerX,
            pointerY
        }
    }
}
