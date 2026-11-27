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
 * @param skip    seconds of the recording to leave out at its start
 */
export function playEffect(name: string, rate = 1, volume = 1, skip = 0): void
{
    void loadEffect(name).then(buffer => {
        if (buffer)
        {
            start(buffer, mixer().context.currentTime, rate, volume, skip)
        }
    })
}

/**
 * Starts a loaded sound effect through the effects of the mixer at the given time of the audio context
 */
function start(buffer: AudioBuffer, when: number, rate: number, volume: number, skip = 0): void
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
    source.start(when, skip)
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

/**
 * Loudest sample of a folded loop
 */
const LOOP_PEAK = 0.9

/**
 * Returns a loop that sounds like the given sound starting over at an even interval, each start on top of those still
 * ringing. Once all of them overlap that repeats with the interval, so folding the sound onto itself at that length makes
 * a loop without a seam. The loop is scaled for its loudest sample to stay below 1.
 *
 * @param buffer    the sound
 * @param period    seconds between the starts, and length of the loop
 */
export function foldLoop(buffer: AudioBuffer, period: number): AudioBuffer
{
    const { numberOfChannels, sampleRate } = buffer
    const length = Math.round(period * sampleRate)
    const loop = new AudioBuffer({ numberOfChannels, length, sampleRate })
    let peak = 0
    for (let channel = 0; channel < numberOfChannels; channel++)
    {
        const from = buffer.getChannelData(channel)
        const to = loop.getChannelData(channel)
        for (let i = 0; i < from.length; i++)
        {
            to[i % length] += from[i]
        }
        for (const sample of to)
        {
            peak = Math.max(peak, Math.abs(sample))
        }
    }
    if (peak > LOOP_PEAK)
    {
        for (let channel = 0; channel < numberOfChannels; channel++)
        {
            const to = loop.getChannelData(channel)
            for (let i = 0; i < length; i++)
            {
                to[i] *= LOOP_PEAK / peak
            }
        }
    }
    return loop
}

/**
 * Seconds a loop takes to follow a change of its volume, short enough to keep up and long enough not to click
 */
const LOOP_SMOOTHING = 0.03

/**
 * Plays a sound over and over through the effects of the mixer, at a volume that can change while it plays, until it is
 * stopped
 */
export class EffectLoop
{
    private readonly source: AudioBufferSourceNode
    private readonly gain: GainNode

    /**
     * @param buffer    the loop
     * @param volume    gain it starts at
     * @param offset    seconds into the loop it starts at, for loops of the same sound not to play in step
     */
    constructor(buffer: AudioBuffer, volume: number, offset = 0)
    {
        const { context } = mixer()
        this.gain = new GainNode(context, { gain: volume })
        this.source = new AudioBufferSourceNode(context, { buffer, loop: true })
        this.source.connect(this.gain).connect(mixer().input("effects"))
        this.source.start(context.currentTime, offset % buffer.duration)
    }

    set volume(volume: number)
    {
        this.gain.gain.setTargetAtTime(volume, mixer().context.currentTime, LOOP_SMOOTHING)
    }

    stop(): void
    {
        this.source.stop()
        this.source.disconnect()
        this.gain.disconnect()
    }
}
