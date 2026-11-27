import { type AnimationAction, AnimationClip, AnimationMixer, Color, Group, LoopOnce, type Object3D, type Vector3 } from "three"
import { LEVEL_MEEPLE_SCALE } from "../meeple/Meeple3D"
import type { LightField } from "../render/dungeonLighting"
import { animations } from "../render/scene3d"
import { type SkinnedFigure, skinnedFigure, tintFigure } from "./skinnedFigure"
import { SIGIL_HUE_RANGE } from "../render/sigil"
import { beamCastTime } from "../render/beamTiming"
import { RAISE_TIME, type Robe, type Wizard } from "./wizards"

/**
 * Seconds it takes to start and stop walking
 */
const FADE_TIME = 0.2

/**
 * Seconds it takes to start and stop casting
 */
const CAST_FADE_TIME = 0.12

/**
 * Colors of the robes of wizards. The robe of the model is a gradient from white at the head to middle grey at the hem,
 * which these tint.
 */
export const ROBE_COLORS: Readonly<Record<Robe, string>> = {
    blue: "#3d4fb8",
    red: "#b3322c",
    purple: "#8e2f9c"
}

/**
 * Length of the staff bone, from the wizard's Blender file
 */
export const STAFF_LENGTH = 0.617

interface Figure extends SkinnedFigure
{
    mixer: AnimationMixer
    staff: Object3D
    walk: AnimationAction
    /** how far it has started walking, from 0 to 1 */
    walking: number
    cast: AnimationAction
    /** how far it has started casting, from 0 to 1 */
    casting: number
    block: AnimationAction
}

/**
 * Returns the time into the block clip for how far up the staff of a wizard is: the first half raises it, the second half
 * lowers it, and it holds in between for as long as the wizard guards. Lowering starts from as far up as the staff got.
 *
 * @param duration  length of the block clip in seconds
 */
export function staffTime({ guarding, staff }: Wizard, duration: number): number
{
    return guarding ? staff * RAISE_TIME : duration - staff * (duration - RAISE_TIME)
}


/**
 * Animated 3D wizards in robes of different colors, drawn with the silhouettes of a MeepleCrowd which shows them. They
 * aren't instanced, as each has a skeleton of its own, so this is for few of them. The model must be loaded first.
 */
export default class WizardCrowd
{
    readonly group = new Group()

    private readonly figures = new Map<Wizard, Figure>()

    /**
     * @param field     light field of the level
     */
    constructor(private readonly field: LightField)
    {
        this.group.renderOrder = 1
    }

    /**
     * Shows the given wizards
     *
     * @param delta     seconds since the last call
     */
    update(wizards: readonly Wizard[], delta: number): void
    {
        const { figures } = this
        for (const [wizard, figure] of figures)
        {
            if (!wizards.includes(wizard))
            {
                this.group.remove(figure.root)
                figures.delete(wizard)
            }
        }

        for (const wizard of wizards)
        {
            let figure = figures.get(wizard)
            if (!figure)
            {
                figure = this.createFigure(wizard)
                figures.set(wizard, figure)
                this.group.add(figure.root)
            }
            this.pose(wizard, figure, delta)
        }
    }

    /**
     * Writes where the tip of the staff of a wizard is in the world
     *
     * @return false if the wizard isn't shown
     */
    findTip(wizard: Wizard, out: Vector3): boolean
    {
        const figure = this.figures.get(wizard)
        if (!figure)
        {
            return false
        }
        figure.staff.updateWorldMatrix(true, false)
        figure.staff.localToWorld(out.set(0, STAFF_LENGTH, 0))
        return true
    }

    /**
     * Poses a figure by the state of its wizard, with the walk and the cast fading in and out
     */
    private pose(wizard: Wizard, figure: Figure, delta: number): void
    {
        const { kind, x, z, yaw, walked, moving, casting, staff, flash, chase } = wizard
        const { root, mixer, walk, cast, block } = figure

        root.position.set(x, 0, z)
        root.rotation.y = yaw
        root.scale.setScalar(kind.scale * LEVEL_MEEPLE_SCALE)

        // at full speed the walk goes as fast as it was made
        const step = delta / FADE_TIME
        figure.walking = moving ? Math.min(1, figure.walking + step) : Math.max(0, figure.walking - step)
        walk.setEffectiveWeight(figure.walking)
        const walkDuration = walk.getClip().duration
        // backing off walks it backwards
        walk.time = (walked / kind.speed % walkDuration + walkDuration) % walkDuration

        const castStep = delta / CAST_FADE_TIME
        figure.casting = casting ? Math.min(1, figure.casting + castStep) : Math.max(0, figure.casting - castStep)
        cast.setEffectiveWeight(figure.casting)
        if (casting)
        {
            const { age, beam } = casting
            cast.time = beam ? beamCastTime(age, beam.until) : Math.min(age, cast.getClip().duration)
        }
        block.setEffectiveWeight(staff > 0 ? 1 : 0)
        block.time = staffTime(wizard, block.getClip().duration)
        mixer.update(0)

        tintFigure(figure, flash, chase)
    }

    private createFigure({ kind: { robe }, hue }: Wizard): Figure
    {
        const color = new Color(ROBE_COLORS[robe])
        if (robe === "blue")
        {
            // as its sigils
            color.offsetHSL((hue * 2 - 1) * SIGIL_HUE_RANGE, 0, 0)
        }
        const figure = skinnedFigure("wizard", this.field, { Robe: color })
        const mixer = new AnimationMixer(figure.root)

        // posed by hand, by the ground covered, by how far the spell is and how far up the staff
        const [walk, cast, block] = ["walk", robe === "purple" ? "cast-2" : "cast", "block"].map(name => {
            const action = mixer.clipAction(AnimationClip.findByName([...animations("wizard")], name)!)
            action.timeScale = 0
            action.setLoop(LoopOnce, 1)
            action.clampWhenFinished = true
            action.setEffectiveWeight(0)
            action.play()
            return action
        })
        return { ...figure, mixer, staff: figure.root.getObjectByName("Staff")!, walk, cast, block, walking: 0, casting: 0 }
    }
}
