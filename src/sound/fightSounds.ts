import type { Blow, HitMaterial } from "../monster/monsters"
import { loadEffect, playEffect } from "./effects"

/**
 * A sound that lands on something: its file, and seconds into it where the blade lands, after the whoosh of the swing
 */
interface HitSound
{
    name: string
    impact: number
}

/**
 * Sword hits by what they land on. A shield that stops the blow sounds of wood.
 */
const HIT_SOUNDS: Record<HitMaterial | "shield", HitSound> = {
    flesh: { name: "sword-on-flesh.mp3", impact: 0.13 },
    metal: { name: "sword-on-metal.mp3", impact: 0.18 },
    armor: { name: "sword-on-armor.mp3", impact: 0.16 },
    shield: { name: "sword-on-wood.mp3", impact: 0.09 }
}

/**
 * Seconds of the whoosh left before the blade lands. The blow only counts once the swing is done, so most of the whoosh
 * that leads into a hit is left out.
 */
const HIT_LEAD = 0.03

const HIT_VOLUME = 0.8

/**
 * Recorded swings through the air and the ouches of heroes, which play a bit faster and higher than recorded
 */
const MISS_SOUNDS = numbered("sword-miss", 10)
const MISS_RATE = 1.15
const MISS_VOLUME = 0.6

const HURT_SOUNDS = numbered("meeple-hurt", 7)
const HURT_RATE = 1.12
const HURT_VOLUME = 0.8

/**
 * How far the rate of a variant strays either way, so that a sound repeating doesn't sound the same each time
 */
const RATE_SPREAD = 0.04

function numbered(prefix: string, count: number): string[]
{
    return Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(2, "0")}.mp3`)
}

/**
 * Picks one of the recordings of a sound at random, but never the one picked before
 */
class Variants
{
    private last = -1

    constructor(readonly names: readonly string[])
    {
    }

    next(): string
    {
        const first = this.last < 0
        let index = Math.floor(Math.random() * (this.names.length - (first ? 0 : 1)))
        if (!first && index >= this.last)
        {
            index++
        }
        this.last = index
        return this.names[index]
    }
}

const misses = new Variants(MISS_SOUNDS)
const hurts = new Variants(HURT_SOUNDS)

function spread(rate: number): number
{
    return rate * (1 + (Math.random() * 2 - 1) * RATE_SPREAD)
}

/**
 * Loads all sounds of a fight, for them to play right away
 */
export function loadFightSounds(): void
{
    for (const name of [...Object.values(HIT_SOUNDS).map(({ name }) => name), ...MISS_SOUNDS, ...HURT_SOUNDS])
    {
        void loadEffect(name)
    }
}

/**
 * Plays a sword blow as it lands: a swing through the air if it hits nothing, otherwise the sound of each thing it lands
 * on once, whether flesh, metal, armor or a shield
 *
 * @param blows     what the blow did to each monster, see MonsterPack.strike()
 */
export function playBlow(blows: readonly Blow[]): void
{
    if (blows.length === 0)
    {
        playEffect(misses.next(), spread(MISS_RATE), MISS_VOLUME)
        return
    }
    const sounds = new Set(blows.map(({ material, stopped }) => HIT_SOUNDS[stopped ? "shield" : material]))
    for (const { name, impact } of sounds)
    {
        playEffect(name, spread(1), HIT_VOLUME, Math.max(0, impact - HIT_LEAD))
    }
}

/**
 * Plays a hero saying ouch
 */
export function playHurt(): void
{
    playEffect(hurts.next(), spread(HURT_RATE), HURT_VOLUME)
}
