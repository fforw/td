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
 * @param name    file name
 * @param rate    playback rate, which shifts pitch and length together
 * @param volume  gain the sound plays at
 */
export function playEffect(name: string, rate = 1, volume = 1): void
{
    void loadEffect(name).then(buffer => {
        if (buffer)
        {
            start(buffer, mixer().context.currentTime, rate, volume)
        }
    })
}

/**
 * Starts a loaded sound effect through the effects of the mixer at the given time of the audio context
 */
function start(buffer: AudioBuffer, when: number, rate: number, volume: number): void
{
    const { context } = mixer()
    const source = new AudioBufferSourceNode(context, { buffer, playbackRate: rate })
    const output = mixer().input("effects")
    if (volume === 1)
    {
        source.connect(output)
    }
    else
    {
        source.connect(new GainNode(context, { gain: volume })).connect(output)
    }
    source.start(when)
}


/**
 * Plays copies of one sound effect, at most so many at once and each a moment after the one before, so a burst of them
 * comes out as a quick run instead of one loud chord. Copies beyond the limit are left out.
 */
export class EffectVoices
{
    /**
     * Audio context times the copies that are playing or waiting to start end at
     */
    private ends: number[] = []

    /**
     * Audio context time the last copy starts at
     */
    private lastStart = -Infinity

    /**
     * @param name  file name in the sounds directory
     * @param max   copies that may sound at once
     * @param gap   seconds at least between the starts of two copies
     */
    constructor(
        private readonly name: string,
        private readonly max: number,
        private readonly gap: number
    )
    {
    }

    /**
     * Plays a copy, a little later if the last one started just now, or not at all if too many are playing
     *
     * @param rate    playback rate, which shifts pitch and length together
     * @param volume  gain the copy plays at
     */
    play(rate = 1, volume = 1): void
    {
        void loadEffect(this.name).then(buffer => {
            if (!buffer)
            {
                return
            }
            const now = mixer().context.currentTime
            this.ends = this.ends.filter(end => end > now)
            if (this.ends.length >= this.max)
            {
                return
            }
            const when = Math.max(now, this.lastStart + this.gap)
            this.lastStart = when
            this.ends.push(when + buffer.duration / rate)
            start(buffer, when, rate, volume)
        })
    }
}
