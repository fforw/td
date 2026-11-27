import type { BeamState } from "../monster/wizards"
import { beamPhase } from "../render/beamTiming"
import { EffectLoop, foldLoop, loadEffect } from "./effects"

/**
 * A rising energy sound, which starts over every so many seconds on top of itself while a beam is on, for a drone
 */
const BEAM_SOUND = "beam-energy.mp3"
const BEAM_REPEAT = 2

const BEAM_VOLUME = 0.5

/**
 * Share of the volume the drone has while the staff charges, before the beam fires, as a warning
 */
const CHARGE_VOLUME = 0.3

let drone: Promise<AudioBuffer | null> | null = null

/**
 * Returns the drone, folded from the sound the first time
 */
function loadDrone(): Promise<AudioBuffer | null>
{
    drone ??= loadEffect(BEAM_SOUND).then(buffer => buffer && foldLoop(buffer, BEAM_REPEAT))
    return drone
}

/**
 * Plays a drone for each beam, which swells while the staff charges, is full while the beam is on, and fades with it
 */
export default class BeamSounds
{
    private readonly loops = new Map<BeamState, EffectLoop | null>()

    /**
     * Loads the drone, for beams to sound right away
     */
    constructor()
    {
        void loadDrone()
    }

    /**
     * Starts, follows and stops the drones of the beams there are now
     *
     * @param beams     all beams of the level
     */
    update(beams: readonly BeamState[]): void
    {
        for (const [beam, loop] of this.loops)
        {
            if (!beams.includes(beam))
            {
                loop?.stop()
                this.loops.delete(beam)
            }
        }
        for (const beam of beams)
        {
            const { charge, strength } = beamPhase(beam.age, beam.until)
            const volume = BEAM_VOLUME * Math.max(CHARGE_VOLUME * charge, strength)
            const loop = this.loops.get(beam)
            if (loop)
            {
                loop.volume = volume
            }
            else if (loop === undefined)
            {
                // null until the drone is there
                this.loops.set(beam, null)
                void loadDrone().then(buffer => {
                    if (buffer && this.loops.has(beam))
                    {
                        // each one somewhere else in the loop, so that several don't sound like one
                        this.loops.set(beam, new EffectLoop(buffer, 0, Math.random() * buffer.duration))
                    }
                })
            }
        }
    }

    /**
     * Stops all drones, as the level goes away
     */
    stop(): void
    {
        for (const loop of this.loops.values())
        {
            loop?.stop()
        }
        this.loops.clear()
    }
}
