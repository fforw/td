import Prando from "prando"

import { dripLoop } from "./ambience"
import type { Mixer } from "./mixer"
import SoundSpaces, { type Heard, hopCutoff, hopGain } from "./soundSpaces"

/**
 * Different ambience loops to go around the rooms
 */
const LOOPS = 3
const LOOP_SECONDS = 9

/**
 * Seconds it takes gain, cutoff and position to get about two thirds of the way to a new value
 */
const RAMP = 0.12

/**
 * Seconds it takes the sound of a level to fade in or out when it starts or stops
 */
const FADE = 0.4

/**
 * Distance in world units within which a sound is heard at full volume
 */
const REF_DISTANCE = 2

/**
 * A sound in a space of the level
 */
interface SpaceSound
{
    space: number
    /** where it is, in world units */
    x: number
    z: number
    source: AudioBufferSourceNode
    filter: BiquadFilterNode
    gain: GainNode
    panner: PannerNode
}


/**
 * Sets an AudioParam smoothly from now on
 */
function ramp(param: AudioParam, value: number, now: number): void
{
    param.setTargetAtTime(value, now, RAMP)
}


/**
 * The sounds of a dungeon level, heard by a listener who goes from space to space. A sound in another space gets
 * quieter and more muffled with every doorway between them, and comes from the doorway it enters the listener's space
 * through.
 */
export default class LevelSound
{
    private readonly context: AudioContext
    private readonly out: GainNode
    private readonly sounds: SpaceSound[] = []
    /** space of the listener, null before they are in one */
    private listener: number | null = null

    /**
     * @param mixer     mixer to play through
     * @param spaces    spaces of the level
     * @param rooms     middle of each room in world units, by room index
     * @param seed      seed of the level
     */
    constructor(mixer: Mixer, private readonly spaces: SoundSpaces, rooms: readonly (readonly [number, number])[], seed: number)
    {
        const { context } = mixer
        this.context = context
        this.out = new GainNode(context, { gain: 0 })
        this.out.connect(mixer.input("ambience"))

        const random = new Prando(seed)
        const loops = Array.from({ length: LOOPS }, () => {
            const samples = dripLoop(random.nextInt(0, 0x7fffffff), context.sampleRate, LOOP_SECONDS)
            const buffer = context.createBuffer(1, samples.length, context.sampleRate)
            buffer.copyToChannel(samples, 0)
            return buffer
        })

        rooms.forEach(([x, z], space) => {
            const source = new AudioBufferSourceNode(context, {
                buffer: loops[random.nextInt(0, LOOPS - 1)],
                loop: true,
                playbackRate: random.next(0.85, 1.15)
            })
            const filter = new BiquadFilterNode(context, { type: "lowpass", frequency: hopCutoff(0) })
            const gain = new GainNode(context, { gain: 0 })
            const panner = new PannerNode(context, {
                panningModel: "equalpower",
                distanceModel: "inverse",
                refDistance: REF_DISTANCE,
                positionX: x,
                positionZ: z
            })
            source.connect(filter).connect(gain).connect(panner).connect(this.out)
            source.start(0, random.next(0, LOOP_SECONDS))
            this.sounds.push({ space, x, z, source, filter, gain, panner })
        })
    }

    /**
     * Moves the listener
     *
     * @param face      floor face the listener is on, null to keep the space they were in
     * @param x         where they are, in world units
     * @param z
     * @param forwardX  direction on the ground that is up on screen, for left and right to match it
     * @param forwardZ
     */
    listen(face: number | null, x: number, z: number, forwardX: number, forwardZ: number): void
    {
        const { context } = this
        const now = context.currentTime
        const { listener } = context
        if (listener.positionX)
        {
            ramp(listener.positionX, x, now)
            ramp(listener.positionZ, z, now)
            ramp(listener.forwardX, forwardX, now)
            ramp(listener.forwardZ, forwardZ, now)
        }
        else
        {
            // Firefox has no AudioParams on the listener
            listener.setPosition(x, 0, z)
            listener.setOrientation(forwardX, 0, forwardZ, 0, 1, 0)
        }

        const space = face !== null ? this.spaces.space(face) : null
        if (space !== null && space !== this.listener)
        {
            this.listener = space
            this.hear(this.spaces.hear(space), now)
        }
    }

    private hear(heard: Heard[], now: number): void
    {
        for (const { space, x, z, filter, gain, panner } of this.sounds)
        {
            const { hops, entry } = heard[space]
            ramp(gain.gain, hopGain(hops), now)
            ramp(filter.frequency, hopCutoff(hops), now)
            ramp(panner.positionX, entry ? entry.x : x, now)
            ramp(panner.positionZ, entry ? entry.z : z, now)
        }
    }

    /**
     * Fades the sound of the level in or out, e.g. while it is hidden
     */
    setRunning(running: boolean): void
    {
        this.out.gain.setTargetAtTime(running ? 1 : 0, this.context.currentTime, FADE / 3)
    }

    /**
     * Stops all sounds of the level
     */
    dispose(): void
    {
        for (const { source } of this.sounds)
        {
            source.stop()
        }
        this.out.disconnect()
    }
}
