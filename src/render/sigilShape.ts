/*
 * Strokes and timing of the sigil a blue wizard draws on the floor, kept apart from the 3D modules so the game logic can
 * use it. Everything is in units of the sigil's radius, with x to the right and y towards the camera.
 */

const TAU = Math.PI * 2

/**
 * Seconds the sigil takes to draw itself, as a warning
 */
export const SIGIL_DRAW = 1.25

/**
 * Seconds it hurts once it is drawn, less than HURT_WAIT so it hurts someone staying in it only once
 */
export const SIGIL_ACTIVE = 0.9

/**
 * Seconds it takes to dissolve, not hurting anymore
 */
export const SIGIL_FADE = 0.4

/**
 * Seconds of the flash when it starts to hurt, the first part of SIGIL_ACTIVE
 */
const FLASH = 0.2

/**
 * Distance of the small circles from the middle, and their radius
 */
const MARK_DISTANCE = 0.5
const MARK_RADIUS = 0.0375

/**
 * A full circle, drawn clockwise from its top
 */
export interface SigilCircle
{
    type: "circle"
    cx: number
    cy: number
    r: number
    /** when it gets drawn, as shares of SIGIL_DRAW */
    start: number
    end: number
}

export interface SigilLine
{
    type: "line"
    x0: number
    y0: number
    x1: number
    y1: number
    /** when it gets drawn, as shares of SIGIL_DRAW */
    start: number
    end: number
}

export type SigilStroke = SigilCircle | SigilLine

/**
 * What the sigil does at some point of its time
 */
export interface SigilPhase
{
    /** how much of it is drawn, from 0 to 1 */
    drawn: number
    /** how far it blazes, from 0 for the warning to 1 */
    power: number
    /** flash as it starts to hurt, from 1 to 0 */
    flash: number
    /** how visible it is */
    opacity: number
    /** whether touching it hurts */
    hurts: boolean
}


function circle(cx: number, cy: number, r: number): SigilCircle
{
    return { type: "circle", cx, cy, r, start: 0, end: 0 }
}


/**
 * Returns a line between two points of the outer circle, given as fifths of a turn from the top
 */
function chord(from: number, to: number): SigilLine
{
    const a = from * TAU / 5, b = to * TAU / 5
    return { type: "line", x0: Math.sin(a), y0: -Math.cos(a), x1: Math.sin(b), y1: -Math.cos(b), start: 0, end: 0 }
}


function strokeLength(stroke: SigilStroke): number
{
    return stroke.type === "circle" ? TAU * stroke.r : Math.hypot(stroke.x1 - stroke.x0, stroke.y1 - stroke.y0)
}


/**
 * Has the strokes drawn one after the other, each for as long as its share of the whole length
 */
function inSequence(strokes: SigilStroke[]): SigilStroke[]
{
    const total = strokes.reduce((sum, stroke) => sum + strokeLength(stroke), 0)
    let sum = 0
    return strokes.map(stroke => {
        const start = sum / total
        sum += strokeLength(stroke)
        return { ...stroke, start, end: sum / total }
    })
}


/**
 * The star with the circle around it, and at the same time the small circles in its points
 */
export const SIGIL_STROKES: readonly SigilStroke[] = [
    ...inSequence([chord(0, 2), chord(2, 4), chord(4, 1), chord(1, 3), chord(3, 5), circle(0, 0, 1)]),
    ...inSequence([1, 2, 3, 4, 5].map(i => {
        const a = i * TAU / 5
        return circle(Math.sin(a) * MARK_DISTANCE, -Math.cos(a) * MARK_DISTANCE, MARK_RADIUS)
    }))
]


/**
 * Returns how much of the stroke is drawn, from 0 to 1. It starts slowly and then shoots to its end.
 *
 * @param stroke    stroke
 * @param drawn     how much of the sigil is drawn, from 0 to 1
 */
export function strokeProgress({ start, end }: SigilStroke, drawn: number): number
{
    return Math.max(0, Math.min(1, (drawn - start) / (end - start))) ** 5
}


/**
 * @param time      seconds since the sigil was cast
 * @param broken    seconds since it was broken off before it was drawn, with time staying where it was, null if it wasn't
 */
export function sigilPhase(time: number, broken: number | null = null): SigilPhase
{
    const sinceDrawn = time - SIGIL_DRAW
    const fade = Math.max(0, sinceDrawn - SIGIL_ACTIVE) / SIGIL_FADE
    const opacity = time < 0 ? 0 : Math.max(0, 1 - fade - (broken ?? 0) / SIGIL_FADE)
    return {
        drawn: Math.max(0, Math.min(1, time / SIGIL_DRAW)),
        // falls off faster than it fades, so it can't be taken for one that still hurts
        power: sinceDrawn < 0 ? 0 : opacity ** 3,
        flash: sinceDrawn < 0 ? 0 : Math.max(0, 1 - sinceDrawn / FLASH),
        opacity,
        hurts: broken === null && sinceDrawn >= 0 && sinceDrawn < SIGIL_ACTIVE
    }
}
