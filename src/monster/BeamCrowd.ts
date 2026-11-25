import { Color, Group, Vector3 } from "three"
import { LEVEL_MEEPLE_SCALE } from "../meeple/Meeple3D"
import Beam from "../render/beam"
import { beamPhase } from "../render/beamTiming"
import { ROBE_COLORS } from "./WizardCrowd"
import type { BeamState, Wizard } from "./wizards"

/**
 * Width of a beam, in meeple units
 */
const BEAM_WIDTH = 0.35

/**
 * Most beams that light up what is around them, as every light costs on all of the level
 */
const MOST_LIT = 3

/**
 * Seconds a beam stays after it is gone, for its sparks to burn out
 */
const LINGER = 0.5

interface Shown
{
    beam: Beam
    state: BeamState | null
    /** where it started last */
    from: Vector3
    /** where it hit last */
    to: Vector3
    /** seconds since it was over */
    over: number
}


/**
 * Shows the beams of the wizards of a level
 */
export default class BeamCrowd
{
    readonly group = new Group()

    private readonly shown: Shown[]

    /**
     * @param count     most beams at once. They are all made here, as more lights later on would have every material of the
     *                  level compiled again.
     */
    constructor(count: number)
    {
        this.shown = Array.from({ length: count }, (_, i) =>
        {
            const beam = new Beam(new Color(ROBE_COLORS.purple), BEAM_WIDTH * LEVEL_MEEPLE_SCALE, false, i < MOST_LIT)
            beam.visible = false
            this.group.add(beam.group)
            return { beam, state: null, from: new Vector3(), to: new Vector3(), over: LINGER }
        })
    }

    /**
     * @param beams     beams to show
     * @param findTip   writes where the tip of the staff of a wizard is, returns false if the wizard isn't shown anymore
     * @param time      seconds
     * @param delta     seconds since the last call
     */
    update(beams: readonly BeamState[], findTip: (wizard: Wizard, out: Vector3) => boolean, time: number, delta: number): void
    {
        const { shown } = this
        for (const state of beams)
        {
            if (!shown.some(slot => slot.state === state))
            {
                // the first ones are lit
                const slot = shown.find(slot => !slot.state && slot.over >= LINGER)
                if (slot)
                {
                    slot.state = state
                }
            }
        }
        for (const slot of shown)
        {
            const { beam, from, state } = slot
            if (state && !beams.includes(state))
            {
                slot.state = null
                slot.over = 0
            }
            if (slot.state)
            {
                const { age, until, x, z, yaw, reach } = slot.state
                findTip(slot.state.caster, from)
                slot.to.set(x + Math.sin(yaw) * reach, from.y, z + Math.cos(yaw) * reach)
                const { charge, strength } = beamPhase(age, until)
                beam.visible = true
                beam.update(from, slot.to, charge, strength, time, delta)
            }
            else if (slot.over < LINGER)
            {
                slot.over += delta
                beam.update(from, slot.to, 0, 0, time, delta)
                beam.visible = slot.over < LINGER
            }
        }
    }
}
