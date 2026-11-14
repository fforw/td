import { mixer } from "./mixer"

const SOUNDS = import.meta.env.BASE_URL + "media/sounds/"

const buffers = new Map<string, Promise<AudioBuffer | null>>()


/**
 * Loads a sound effect from the sounds directory once, for playEffect() to play it without waiting. A sound that doesn't
 * load comes out as null.
 *
 * @param name  file name
 */
export function loadEffect(name: string): Promise<AudioBuffer | null>
{
    let buffer = buffers.get(name)
    if (!buffer)
    {
        buffer = fetch(SOUNDS + name)
            .then(response => response.arrayBuffer())
            .then(data => mixer().context.decodeAudioData(data))
            .catch(error => {
                console.warn("Sound effect", name, "didn't load:", error)
                return null
            })
        buffers.set(name, buffer)
    }
    return buffer
}

/**
 * Plays a sound effect from the sounds directory once through the effects of the mixer, from nowhere in particular, as
 * soon as it is loaded. It plays to its end, whatever happens meanwhile.
 *
 * @param name  file name
 */
export function playEffect(name: string): void
{
    void loadEffect(name).then(buffer => {
        if (buffer)
        {
            const source = new AudioBufferSourceNode(mixer().context, { buffer })
            source.connect(mixer().input("effects"))
            source.start()
        }
    })
}


/**
 * Pitch in hertz a plop starts at and drops to, and seconds it takes for that
 */
const PLOP_FROM = 900
const PLOP_TO = 180
const PLOP_DROP = 0.07

/**
 * Seconds a plop takes to fade out, and its loudness
 */
const PLOP_TIME = 0.14
const PLOP_GAIN = 0.5

/**
 * Share by which the pitch of plops varies, so many in a row don't sound the same
 */
const PLOP_SPREAD = 0.15


/**
 * Plays a plop, like a bubble bursting, made up on the spot: a sine that drops in pitch quickly
 */
export function playPlop(): void
{
    const { context } = mixer()
    const start = context.currentTime
    const pitch = 1 + (Math.random() * 2 - 1) * PLOP_SPREAD
    const oscillator = new OscillatorNode(context, { type: "sine", frequency: PLOP_FROM * pitch })
    oscillator.frequency.exponentialRampToValueAtTime(PLOP_TO * pitch, start + PLOP_DROP)
    const gain = new GainNode(context, { gain: 0 })
    gain.gain.linearRampToValueAtTime(PLOP_GAIN, start + 0.004)
    gain.gain.exponentialRampToValueAtTime(0.001, start + PLOP_TIME)
    oscillator.connect(gain).connect(mixer().input("effects"))
    oscillator.start(start)
    oscillator.stop(start + PLOP_TIME)
}
