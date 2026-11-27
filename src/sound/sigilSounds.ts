import type { SigilState } from "../monster/sigils"
import { SIGIL_DRAW, SIGIL_STROKES, type SigilStroke } from "../render/sigilShape"
import { loadEffect, playEffect } from "./effects"

/**
 * A swish for each line of the star and for the circle around it, with seconds into it where it is loudest, which comes
 * as the stroke shoots to its end. The small circles in the points are drawn at the same time and stay silent.
 */
const STROKE_SOUND = "sigil-stroke.mp3"
const STROKE_PEAK = 0.2
const STROKE_VOLUME = 0.5

/**
 * Playback rates of the swish, quick for the short lines and a bit slower for the long circle
 */
const LINE_RATE = 1.6
const CIRCLE_RATE = 1.35

/**
 * Sound of the sigil flaring up as it starts to hurt
 */
const TRIGGER_SOUND = "sigil-trigger.mp3"
const TRIGGER_VOLUME = 0.6

/**
 * Seconds after it is due that a sound still plays, for a sigil that wasn't seen before
 */
const LATE = 0.1

/**
 * The star and the circle around it, in the order they are drawn
 */
const STROKES = SIGIL_STROKES.filter(stroke => stroke.type === "line" || stroke.r === 1)

function strokeRate(stroke: SigilStroke): number
{
    return stroke.type === "line" ? LINE_RATE : CIRCLE_RATE
}

/**
 * Plays the sigils drawing themselves and flaring up
 */
export default class SigilSounds
{
    /**
     * Sigils with how many of their sounds played, the strokes and then the trigger
     */
    private readonly played = new WeakMap<SigilState, number>()

    constructor()
    {
        void loadEffect(STROKE_SOUND)
        void loadEffect(TRIGGER_SOUND)
    }

    /**
     * Plays the sounds that are due by now
     *
     * @param sigils    all sigils of the level
     */
    update(sigils: readonly SigilState[]): void
    {
        for (const sigil of sigils)
        {
            if (sigil.broken !== null)
            {
                continue
            }
            let played = this.played.get(sigil) ?? 0
            while (played < STROKES.length)
            {
                const stroke = STROKES[played]
                const rate = strokeRate(stroke)
                const due = stroke.end * SIGIL_DRAW - STROKE_PEAK / rate
                if (sigil.age < due)
                {
                    break
                }
                played++
                const late = (sigil.age - due) * rate
                if (late < STROKE_PEAK + LATE * rate)
                {
                    // for a frame that took long, so the loudest part still comes as the stroke ends
                    playEffect(STROKE_SOUND, rate, STROKE_VOLUME, Math.min(late, STROKE_PEAK))
                }
            }
            if (played === STROKES.length && sigil.age >= SIGIL_DRAW)
            {
                played++
                if (sigil.age < SIGIL_DRAW + LATE)
                {
                    playEffect(TRIGGER_SOUND, 1, TRIGGER_VOLUME)
                }
            }
            this.played.set(sigil, played)
        }
    }
}
