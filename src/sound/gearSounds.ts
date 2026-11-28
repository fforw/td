import type { Element } from "../game/gear"
import { loadEffect, playEffect } from "./effects"

/**
 * Throws sound like a sword swing, but quicker and higher, as a smaller thing flies off the hand
 */
const THROW_SOUNDS = ["sword-miss-02.mp3", "sword-miss-05.mp3", "sword-miss-08.mp3"]
const THROW_RATE = 1.4
const THROW_VOLUME = 0.5

/**
 * A weapon that hits a wall
 */
const WALL_SOUND = "sword-on-wood.mp3"
const WALL_IMPACT = 0.09
const WALL_VOLUME = 0.5

/**
 * Casting a ball is the fire strike of the wizards, higher and quieter, pitched by element
 */
const CAST_SOUND = "fire-strike-02.mp3"
const CAST_VOLUME = 0.35
const CAST_RATES: Readonly<Record<Element, number>> = { fire: 1.5, frost: 1.9, venom: 1.25, arcane: 1.7 }

/**
 * A ball bursting on something
 */
const BURST_SOUND = "fire-strike-01.mp3"
const BURST_VOLUME = 0.3
const BURST_RATE = 1.8

/**
 * How far the rate strays either way, so that a sound repeating doesn't sound the same each time
 */
const RATE_SPREAD = 0.05


function spread(rate: number): number
{
    return rate * (1 + (Math.random() * 2 - 1) * RATE_SPREAD)
}


/**
 * Loads the sounds of using gear, for them to play right away
 */
export function loadGearSounds(): void
{
    for (const name of [...THROW_SOUNDS, WALL_SOUND, CAST_SOUND, BURST_SOUND])
    {
        void loadEffect(name)
    }
}


export function playThrow(): void
{
    playEffect(THROW_SOUNDS[Math.floor(Math.random() * THROW_SOUNDS.length)], spread(THROW_RATE), THROW_VOLUME)
}


export function playWallHit(): void
{
    playEffect(WALL_SOUND, spread(1.2), WALL_VOLUME, WALL_IMPACT)
}


export function playCast(element: Element): void
{
    playEffect(CAST_SOUND, spread(CAST_RATES[element]), CAST_VOLUME)
}


export function playBallBurst(): void
{
    playEffect(BURST_SOUND, spread(BURST_RATE), BURST_VOLUME)
}
