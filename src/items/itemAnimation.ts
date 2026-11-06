import type { ItemName } from "./itemSprite"

// declarative item animations, plain data and functions without three.js, so they are easy to test

const TAU = Math.PI * 2

/**
 * Where and how an item is held
 */
export interface ItemPose
{
    /**
     * Point of the sprite that lies on the attachment point, from the sprite center with its longer side 1 unit long
     */
    pivot: readonly [number, number]
    /**
     * Height of the attachment point on the body from 0 at the bottom to 1 at the top, kept between MIN_HEIGHT and
     * MAX_HEIGHT
     */
    height: number
    /**
     * Angle of the attachment point in radians around the vertical, from the front toward the meeple's right
     */
    angle: number
    /**
     * Distance in meeple units the item floats above the body surface
     */
    lift: number
    /**
     * Angle in radians the item is turned around the attachment point, counter-clockwise from the sprite as it is
     * drawn when looking at the body from outside. The drawn items point up and to the right, so from 0.79 on they
     * lean away from the head on the right side of the body.
     */
    roll: number
    /**
     * Angle in radians the item swings around the attachment point with every step, for the widest gait
     */
    swing: number
    /**
     * Item drawn instead of the held one. It is not blended: it appears as soon as the transition into the pose
     * starts, and goes again when the transition into a pose without it starts.
     */
    image?: ItemName
}

type EasingCurve = "Quad" | "Cubic" | "Quart" | "Quint" | "Sine" | "Expo" | "Circ"

export type EasingName = "linear" | "easeIn" | "easeOut" | "easeInOut" | "easeInBack" | "easeOutBack"
    | `easeIn${EasingCurve}` | `easeOut${EasingCurve}` | `easeInOut${EasingCurve}`

/**
 * Easing functions from 0 at t = 0 to 1 at t = 1
 */
export const EASINGS: Record<EasingName, (t: number) => number> = {
    linear: t => t,
    easeIn: t => t * t,
    easeOut: t => t * (2 - t),
    easeInOut: t => t * t * (3 - 2 * t),
    // pulls back a little before it goes
    easeInBack: t => t * t * (2.7 * t - 1.7),
    // overshoots a little and comes back
    easeOutBack: t => 1 + (t - 1) * (t - 1) * (2.7 * (t - 1) + 1.7),

    // Robert Penner's easing equations (BSD License, http://robertpenner.com/easing/). The In variants accelerate
    // from zero velocity, the Out variants decelerate to zero velocity and the InOut variants accelerate until
    // halfway, then decelerate.
    easeInQuad: t => t * t,
    easeOutQuad: t => t * (2 - t),
    easeInOutQuad: t => t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) ** 2,
    easeInCubic: t => t ** 3,
    easeOutCubic: t => 1 - (1 - t) ** 3,
    easeInOutCubic: t => t < 0.5 ? 4 * t ** 3 : 1 - 4 * (1 - t) ** 3,
    easeInQuart: t => t ** 4,
    easeOutQuart: t => 1 - (1 - t) ** 4,
    easeInOutQuart: t => t < 0.5 ? 8 * t ** 4 : 1 - 8 * (1 - t) ** 4,
    easeInQuint: t => t ** 5,
    easeOutQuint: t => 1 - (1 - t) ** 5,
    easeInOutQuint: t => t < 0.5 ? 16 * t ** 5 : 1 - 16 * (1 - t) ** 5,
    easeInSine: t => 1 - Math.cos(t * Math.PI / 2),
    easeOutSine: t => Math.sin(t * Math.PI / 2),
    easeInOutSine: t => (1 - Math.cos(t * Math.PI)) / 2,
    // the exponential curves only come close to their ends, so these are set exactly
    easeInExpo: t => t <= 0 ? 0 : 2 ** (10 * (t - 1)),
    easeOutExpo: t => t >= 1 ? 1 : 1 - 2 ** (-10 * t),
    easeInOutExpo: t => t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : 1 - 2 ** (10 - 20 * t) / 2,
    easeInCirc: t => 1 - Math.sqrt(1 - t * t),
    easeOutCirc: t => Math.sqrt(1 - (1 - t) ** 2),
    easeInOutCirc: t => t < 0.5 ? (1 - Math.sqrt(1 - 4 * t * t)) / 2 : (1 + Math.sqrt(1 - 4 * (1 - t) ** 2)) / 2
}

export interface Transition
{
    /**
     * Duration in seconds
     */
    duration: number
    easing: EasingName
}

/**
 * Pose of an action, written as the differences to the READY pose
 */
export interface ActionStep extends Partial<ItemPose>
{
    /**
     * Transition from the previous pose to this one
     */
    transition: Transition
    /**
     * Seconds to hold the pose before the next step
     */
    hold?: number
}

export interface ItemAction<Step = ActionStep>
{
    /**
     * Poses played one after another, starting from READY
     */
    steps: readonly Step[]
    /**
     * Transition from the last step back to READY, or to IDLE with returnTo
     */
    out: Transition
    /**
     * Pose the action returns to, READY by default. From IDLE, the item is readied again if the meeple still wants
     * it readied or keeps acting, e.g. to nock the next arrow.
     */
    returnTo?: "ready" | "idle"
    /**
     * Seconds to wait at READY before the action repeats, as long as the meeple keeps acting. Without it or when it is
     * negative, the action plays once.
     */
    repeat?: number
}

/**
 * How an item is held, readied and used. The order is always IDLE -> READY -> action steps -> READY -> IDLE, or
 * IDLE -> READY -> action steps -> IDLE with returnTo.
 */
export interface ItemAnimation
{
    /**
     * Pose while the meeple just carries the item
     */
    idle: ItemPose
    /**
     * Pose of the readied item, and the transition from IDLE to READY and back
     */
    ready: ItemPose & { transition: Transition }
    action: ItemAction<ItemPose & { transition: Transition, hold: number }>
}

/**
 * Item specific animation, with only what differs from the DEFAULT_ANIMATION. The action steps replace the default
 * ones.
 */
export interface ItemAnimationDef
{
    idle?: Partial<ItemPose>
    ready?: Partial<ItemPose> & { transition?: Transition }
    action?: Partial<ItemAction>
}

/**
 * Lowest and highest attachment height. Further down or up, the items stand out from the body at odd angles.
 */
export const MIN_HEIGHT = 0.1
export const MAX_HEIGHT = 0.9

// the default animation: carried at the right side, pointing away from the head, readied upright in front of the body,
// used with a chop. The Voxel Pack items have their handle in the lower left.

const DEFAULT_IDLE: ItemPose = { pivot: [-0.27, -0.27], height: 0.45, angle: 0.6, lift: 0.05, roll: 1.25, swing: 0.25 }
const DEFAULT_READY: ItemPose = { pivot: [-0.27, -0.27], height: 0.5, angle: 0.3, lift: 0.1, roll: 0.79, swing: 0.1 }
const DEFAULT_READY_TRANSITION: Transition = { duration: 0.25, easing: "easeInOut" }
const DEFAULT_ACTION: ItemAction = {
    steps: [
        { roll: 1.7, swing: 0, transition: { duration: 0.2, easing: "easeOut" } },
        { roll: -0.4, swing: 0, transition: { duration: 0.08, easing: "easeIn" }, hold: 0.05 }
    ],
    out: { duration: 0.3, easing: "easeInOut" }
}


/**
 * Chop again and again while acting
 */
const TOOL: ItemAnimationDef = {
    action: { repeat: 0.4 }
}

const ITEM_ANIMATIONS: Partial<Record<ItemName, ItemAnimationDef>> = {

    sword_silver: {

        // a quick slash and a short pause
        action: {

            steps: [
                {
                    roll: 2,
                    transition: {
                        duration: 0.15,
                        easing: "easeInBack"
                    }
                }
                ,

                {
                    roll: -0.6,
                    angle: 0,
                    swing: 0,
                    transition: {
                        duration: 0.07,
                        easing: "easeIn"
                    }
                    ,
                    hold: 0.08
                }

            ],

            out: {
                duration: 0.25,
                easing: "easeInOut"
            }

        }

    }
    ,

    shield_silver: {

        // flat on the arm, and quickly up in front of the body. Only ever readied, it has no action.
        idle: {
            pivot: [0, 0],
            height: 0.42,
            angle: 0.85,
            lift: 0.06,
            roll: 0,
            swing: 0.08
        },

        ready: {
            pivot: [0, 0],
            height: 0.5,
            angle: 0.45,
            lift: 0.16,
            roll: 0,
            swing: 0,
            transition: {
                duration: 0.08,
                easing: "easeOut"
            }
        }

    }
    ,

    axe_silver: TOOL,

    pick_silver: TOOL,

    hammer_silver: TOOL,

    hoe_silver: TOOL,

    shovel_silver: {

        // over the shoulder, blade down to dig
        idle: {
            height: 0.6,
            angle: 1.4,
            roll: 2.1
        },

        ready: {
            height: 0.4,
            angle: 0.4,
            lift: 0.12,
            roll: 3.93
        },

        action: {

            steps: [
                {
                    height: 0.25,
                    lift: 0.18,
                    swing: 0,
                    transition: {
                        duration: 0.15,
                        easing: "easeIn"
                    }
                },

                {
                    height: 0.4,
                    roll: 3.4,
                    swing: 0,
                    transition: {
                        duration: 0.2,
                        easing: "easeOut"
                    },
                    hold: 0.1
                }

            ],

            out: {
                duration: 0.2,
                easing: "easeInOut"
            },

            repeat: 0.3
        }

    },

    bow: {

        // held up in front with an arrow nocked, the string drawn back toward the body and released
        ready: {
            height: 0.6,
            angle: 0.1,
            lift: 0.2,
            roll: 0.79,
            image: "bowArrow"
        },

        action: {

            steps: [
                {
                    lift: 0.3,
                    swing: 0,
                    transition: {
                        duration: 0.4,
                        easing: "easeOut"
                    },
                    hold: 0.3
                },

                {
                    lift: 0.15,
                    swing: 0,
                    // the arrow is gone
                    image: "bow",
                    transition: {
                        duration: 0.05,
                        easing: "easeOutBack"
                    }
                }

            ],

            out: {
                duration: 0.3,
                easing: "easeInOut"
            },

            // and nock the next one when readied again
            returnTo: "idle"

        }

    },

    staff: {

        // a wizard's staff, planted on the ground like a walking stick, raised and struck down to cast
        idle: {
            pivot: [-0.15, -0.13],
            height: 0.5,
            angle: 1.1,
            roll: 0.79,
            swing: 0.1
        },

        ready: {
            pivot: [-0.15, -0.13],
            height: 0.55,
            angle: 0.4,
            lift: 0.15,
            roll: 1.2,
        },

        action: {

            steps: [
                {
                    height: 0.7,
                    lift: 0.1,
                    swing: 0,
                    transition: {
                        duration: 0.35,
                        easing: "easeOut"
                    },
                    hold: 0.1,
                    roll: 1.3,
                },

                {
                    height: 0.45,
                    lift: 0.15,
                    swing: 0,
                    transition: {
                        duration: 0.08,
                        easing: "easeIn"
                    },
                    hold: 0.3,
                    roll: 1,
                }

            ],

            out: {
                duration: 0.4,
                easing: "easeInOut"
            }
        }

    },

    apple: {

        // a bite, raised up to the head
        ready: {
            height: 0.55,
            angle: 0.2,
            roll: 0.3
        },

        action: {

            steps: [
                {
                    height: MAX_HEIGHT,
                    angle: 0,
                    lift: 0.2,
                    swing: 0,
                    transition: {
                        duration: 0.3,
                        easing: "easeOut"
                    },
                    hold: 0.3
                }

            ],

            out: {
                duration: 0.3,
                easing: "easeInOut"
            },

            repeat: 1
        }

    }

}


function clampHeight(height: number): number
{
    return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, height))
}


function pose(base: ItemPose, changes: Partial<ItemPose>): ItemPose
{
    const { pivot, height, angle, lift, roll, swing, image } = { ...base, ...changes }
    return { pivot, height: clampHeight(height), angle, lift, roll, swing, image }
}


/**
 * Fills in an item specific animation from the default animation
 */
export function resolveAnimation(def: ItemAnimationDef): ItemAnimation
{
    const ready = pose(DEFAULT_READY, def.ready ?? {})
    const { steps, out, returnTo, repeat } = { ...DEFAULT_ACTION, ...def.action }
    return {
        idle: pose(DEFAULT_IDLE, def.idle ?? {}),
        ready: { ...ready, transition: def.ready?.transition ?? DEFAULT_READY_TRANSITION },
        action: {
            steps: steps.map(step => ({ ...pose(ready, step), transition: step.transition, hold: step.hold ?? 0 })),
            out,
            returnTo,
            repeat
        }
    }
}


export const DEFAULT_ANIMATION = resolveAnimation({})


const animations = new Map<ItemName, ItemAnimation>()

/**
 * Returns the animation of an item
 */
export function itemAnimation(name: ItemName): ItemAnimation
{
    let animation = animations.get(name)
    if (!animation)
    {
        const def = ITEM_ANIMATIONS[name]
        animation = def ? resolveAnimation(def) : DEFAULT_ANIMATION
        animations.set(name, animation)
    }
    return animation
}


/**
 * Duration in seconds of one run of the action, from READY back to READY
 */
export function actionDuration(action: ItemAnimation["action"]): number
{
    return action.steps.reduce((sum, step) => sum + step.transition.duration + step.hold, action.out.duration)
}


export type ItemPhase = "idle" | "readying" | "ready" | "action" | "unreadying"

/**
 * Animation state of a held item
 */
export interface ItemState
{
    phase: ItemPhase
    /**
     * Time in seconds the phase started
     */
    since: number
    /**
     * An action run that has not started yet
     */
    requested: boolean
    /**
     * Keeps repeating the action
     */
    acting: boolean
}


export function newItemState(): ItemState
{
    return { phase: "idle", since: 0, requested: false, acting: false }
}


/**
 * Starts acting: readies the item if needed and plays the action, again and again if it repeats
 */
export function actItem(animation: ItemAnimation, state: ItemState): void
{
    state.requested = true
    state.acting = (animation.action.repeat ?? -1) >= 0
}


/**
 * Stops acting. A running action plays to its end.
 */
export function stopActing(state: ItemState): void
{
    state.requested = false
    state.acting = false
}


/**
 * Moves the state on to the given time. Transitions and actions always play to their end, so an item only goes back
 * to IDLE after the action returned to READY.
 *
 * @param animation item animation
 * @param state     state to update
 * @param ready     whether the meeple wants the item readied. Acting readies it as well.
 * @param time      time in seconds, never less than in the previous call
 */
export function advanceItem(animation: ItemAnimation, state: ItemState, ready: boolean, time: number): void
{
    const { action } = animation
    // phases that end on their own continue at their exact end, so repeats keep their rhythm. What follows on the
    // flags starts at the end of such a phase if it ended in this call, as the flags held since then.
    let chained = false
    for (;;)
    {
        const now = chained ? state.since : time
        chained = true
        switch (state.phase)
        {
            case "idle":
                if (!ready && !state.requested && !state.acting)
                {
                    return
                }
                enter(state, "readying", now)
                break
            case "readying":
                if (!finish(state, "ready", animation.ready.transition.duration, time))
                {
                    return
                }
                break
            case "ready":
                if (state.requested)
                {
                    state.requested = false
                    enter(state, "action", now)
                }
                else if (state.acting)
                {
                    const next = state.since + (action.repeat ?? 0)
                    if (time < next)
                    {
                        return
                    }
                    enter(state, "action", next)
                }
                else if (!ready)
                {
                    enter(state, "unreadying", now)
                }
                else
                {
                    return
                }
                break
            case "action":
                if (!finish(state, action.returnTo ?? "ready", actionDuration(action), time))
                {
                    return
                }
                break
            case "unreadying":
                if (!finish(state, "idle", animation.ready.transition.duration, time))
                {
                    return
                }
                break
        }
    }
}


function enter(state: ItemState, phase: ItemPhase, time: number): void
{
    state.phase = phase
    state.since = time
}


function finish(state: ItemState, next: ItemPhase, duration: number, time: number): boolean
{
    const end = state.since + duration
    if (time < end)
    {
        return false
    }
    enter(state, next, end)
    return true
}


/**
 * Sets the pose of an item at the given time
 *
 * @param animation item animation
 * @param state     state advanced to the time with advanceItem()
 * @param time      time in seconds
 * @param out       receives the pose
 */
export function itemPose(animation: ItemAnimation, state: ItemState, time: number, out: ItemPose): ItemPose
{
    const { idle, ready, action } = animation
    const elapsed = time - state.since
    switch (state.phase)
    {
        case "idle":
            return copyPose(idle, out)
        case "ready":
            return copyPose(ready, out)
        case "readying":
            return blendPose(idle, ready, ease(ready.transition, elapsed), out)
        case "unreadying":
            return blendPose(ready, idle, ease(ready.transition, elapsed), out)
        case "action":
        {
            let rest = elapsed
            let from: ItemPose = ready
            for (const step of action.steps)
            {
                const { duration } = step.transition
                if (rest < duration)
                {
                    return blendPose(from, step, ease(step.transition, rest), out)
                }
                rest -= duration
                if (rest < step.hold)
                {
                    return copyPose(step, out)
                }
                rest -= step.hold
                from = step
            }
            return blendPose(from, action.returnTo === "idle" ? idle : ready, ease(action.out, rest), out)
        }
    }
}


function ease(transition: Transition, elapsed: number): number
{
    const t = transition.duration > 0 ? Math.max(0, Math.min(1, elapsed / transition.duration)) : 1
    return EASINGS[transition.easing](t)
}


function copyPose(from: ItemPose, out: ItemPose): ItemPose
{
    return blendPose(from, from, 0, out)
}


/**
 * Blends two poses. The angle turns the short way around, the roll does not, so an item can spin. The image is the
 * one of the second pose from the start.
 */
export function blendPose(a: ItemPose, b: ItemPose, t: number, out: ItemPose): ItemPose
{
    const lerp = (x: number, y: number) => x + (y - x) * t
    out.pivot = a.pivot === b.pivot ? a.pivot : [lerp(a.pivot[0], b.pivot[0]), lerp(a.pivot[1], b.pivot[1])]
    out.height = clampHeight(lerp(a.height, b.height))
    out.angle = a.angle + ((b.angle - a.angle) % TAU + TAU * 1.5) % TAU * t - Math.PI * t
    out.lift = lerp(a.lift, b.lift)
    out.roll = lerp(a.roll, b.roll)
    out.swing = lerp(a.swing, b.swing)
    out.image = b.image
    return out
}
