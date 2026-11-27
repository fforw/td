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
    mesh: Beam
    beam: BeamState | null
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

    /** whether any of them shows */
    get visible(): boolean
    {
        return this.shown.some(({ beam, over }) => beam || over < LINGER)
    }

    /**
     * @param count     most beams at once. They are all made here, as more lights later on would have every material of the
     *                  level compiled again.
     */
    constructor(count: number)
    {
        this.shown = Array.from({ length: count }, (_, i) =>
        {
            const mesh = new Beam(new Color(ROBE_COLORS.purple), BEAM_WIDTH * LEVEL_MEEPLE_SCALE, i < MOST_LIT)
            mesh.visible = false
            this.group.add(mesh.group)
            return { mesh, beam: null, from: new Vector3(), to: new Vector3(), over: LINGER }
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
        for (const beam of beams)
        {
            if (!shown.some(slot => slot.beam === beam))
            {
                // the first ones are lit
                const slot = shown.find(slot => !slot.beam && slot.over >= LINGER)
                if (slot)
                {
                    slot.beam = beam
                }
            }
        }
        for (const slot of shown)
        {
            const { mesh, from, beam } = slot
            if (beam && !beams.includes(beam))
            {
                slot.beam = null
                slot.over = 0
            }
            if (slot.beam)
            {
                const { age, until, x, z, yaw, reach } = slot.beam
                findTip(slot.beam.caster, from)
                slot.to.set(x + Math.sin(yaw) * reach, from.y, z + Math.cos(yaw) * reach)
                const { charge, strength } = beamPhase(age, until)
                mesh.visible = true
                mesh.update(from, slot.to, charge, strength, time, delta)
            }
            else if (slot.over < LINGER)
            {
                slot.over += delta
                mesh.update(from, slot.to, 0, 0, time, delta)
                mesh.visible = slot.over < LINGER
            }
        }
    }
}
