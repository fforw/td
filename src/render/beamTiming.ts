/*
 * Timing of a beam and the cast-2 clip of the wizard that goes with it, kept apart from the 3D modules so the game logic
 * can use it
 */

/**
 * Seconds until the staff points ahead and the beam fires, which is frame 11 of cast-2 at 24 frames per second, and
 * seconds it takes to get to full strength
 */
export const BEAM_FIRE = 11 / 24
export const BEAM_FIRE_TIME = 0.08

/**
 * Seconds a beam takes to fade
 */
export const BEAM_FADE_TIME = 0.3

/**
 * Second of cast-2 that is held while the beam lasts
 */
const HELD = BEAM_FIRE + 1 / 24

/**
 * Seconds of cast-2
 */
const CLIP_TIME = 1

/**
 * Seconds of cast-2 left once the beam is over
 */
export const BEAM_CAST_END = CLIP_TIME - HELD

export interface BeamPhase
{
    /** how far the staff has charged, from 0 to 1 */
    charge: number
    /** how far the beam has fired, from 0 to 1 */
    strength: number
    /** whether it hurts who it hits */
    hurts: boolean
}


/**
 * Returns how far a beam is
 *
 * @param age       seconds since it started to charge
 * @param until     age at which it starts to fade, which can be before it fires
 */
export function beamPhase(age: number, until: number): BeamPhase
{
    const t = Math.min(age, until)
    const fade = Math.max(0, 1 - Math.max(0, age - until) / BEAM_FADE_TIME)
    const charge = Math.min(1, t / BEAM_FIRE) * fade
    const strength = Math.max(0, Math.min(1, (t - BEAM_FIRE) / BEAM_FIRE_TIME)) * fade
    return { charge: charge * charge, strength, hurts: strength > 0 && age >= BEAM_FIRE + BEAM_FIRE_TIME && age < until }
}

/**
 * Returns the second of cast-2 to show: on until the staff points ahead, held there while the beam lasts, then on to its
 * end
 *
 * @param age       seconds since the beam started to charge
 * @param until     age at which it starts to fade
 */
export function beamCastTime(age: number, until: number): number
{
    return Math.min(CLIP_TIME, Math.min(age, HELD) + Math.max(0, age - Math.max(until, HELD)))
}
