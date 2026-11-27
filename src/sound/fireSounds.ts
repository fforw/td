import type { FireDrop } from "../monster/fireRain"
import { loadEffect, playEffect } from "./effects"

/**
 * A fireball, with seconds into it where it hits the floor after its whoosh
 */
const STRIKE_SOUND = "fire-strike.mp3"
const STRIKE_IMPACT = 0.2

const STRIKE_VOLUME = 0.6

/**
 * Lowest and highest playback rate of a strike, as there is only one recording. Lower ones sound bigger, higher ones
 * smaller.
 */
const STRIKE_RATE_MIN = 0.8
const STRIKE_RATE_MAX = 1.25

/**
 * Strikes that may sound at once, as a ring of them would be a roar otherwise, and seconds one sounds for this
 */
const STRIKE_VOICES = 4
const STRIKE_TIME = 0.6

/**
 * Seconds after its strike a drop still sounds, for one that wasn't seen before, so old fire doesn't go off again
 */
const STRIKE_LATE = 0.1

/**
 * Plays the fire of a rain striking the floor, each timed to hit as the drop does, in a different tone each
 */
export default class FireSounds
{
    /**
     * Drops whose strike played
     */
    private readonly played = new WeakSet<FireDrop>()

    /**
     * When the strikes that are sounding started, in seconds by performance.now()
     */
    private starts: number[] = []

    constructor()
    {
        void loadEffect(STRIKE_SOUND)
    }

    /**
     * Plays the strikes that are due by now
     *
     * @param drops     all fire of the level
     */
    update(drops: readonly FireDrop[]): void
    {
        const now = performance.now() / 1000
        this.starts = this.starts.filter(start => now - start < STRIKE_TIME)
        for (const drop of drops)
        {
            if (this.played.has(drop))
            {
                continue
            }
            const rate = STRIKE_RATE_MIN * Math.pow(STRIKE_RATE_MAX / STRIKE_RATE_MIN, Math.random())
            if (drop.age >= -STRIKE_IMPACT / rate)
            {
                this.played.add(drop)
                if (drop.age < STRIKE_LATE && this.starts.length < STRIKE_VOICES)
                {
                    this.starts.push(now)
                    // late for a frame that took long, so the impact still comes with the strike
                    const late = Math.max(0, drop.age + STRIKE_IMPACT / rate) * rate
                    playEffect(STRIKE_SOUND, rate, STRIKE_VOLUME, Math.min(late, STRIKE_IMPACT))
                }
            }
        }
    }
}
