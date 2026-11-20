import { type AnimationAction, AnimationClip, AnimationMixer, Color, Group, LoopOnce } from "three"
import { LEVEL_MEEPLE_SCALE } from "../meeple/Meeple3D"
import type { LightField } from "../render/dungeonLighting"
import { animations } from "../render/scene3d"
import { type SkinnedFigure, skinnedFigure, tintFigure } from "./skinnedFigure"
import type { Wizard } from "./wizards"

/**
 * Seconds it takes to start and stop walking
 */
const FADE_TIME = 0.2

/**
 * Colors of the robes of wizards, as many as ROBE_COUNT. The robe of the model is a gradient from white at the head to
 * middle grey at the hem, which these tint.
 */
export const ROBE_COLORS: readonly string[] = [
    "#3d4fb8",
    "#8e2f9c",
    "#b3322c",
    "#2f8a4a",
    "#c08a2a",
    "#2a8a8c",
    "#5a5560"
]

interface Figure extends SkinnedFigure
{
    mixer: AnimationMixer
    walk: AnimationAction
    /** how far it has started walking, from 0 to 1 */
    walking: number
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
                figure = this.createFigure(wizard.robe)
                figures.set(wizard, figure)
                this.group.add(figure.root)
            }
            this.pose(wizard, figure, delta)
        }
    }

    /**
     * Poses a figure by the state of its wizard, with the walk fading in and out
     */
    private pose(wizard: Wizard, figure: Figure, delta: number): void
    {
        const { kind, x, z, yaw, walked, moving, flash, chase } = wizard
        const { root, mixer, walk } = figure

        root.position.set(x, 0, z)
        root.rotation.y = yaw
        root.scale.setScalar(kind.scale * LEVEL_MEEPLE_SCALE)

        // at full speed the walk goes as fast as it was made
        const step = delta / FADE_TIME
        figure.walking = moving ? Math.min(1, figure.walking + step) : Math.max(0, figure.walking - step)
        walk.setEffectiveWeight(figure.walking)
        walk.time = walked / kind.speed % walk.getClip().duration
        mixer.update(0)

        tintFigure(figure, flash, chase)
    }

    private createFigure(robe: number): Figure
    {
        const figure = skinnedFigure("wizard", this.field, { Robe: new Color(ROBE_COLORS[robe % ROBE_COLORS.length]) })
        const mixer = new AnimationMixer(figure.root)

        // posed by hand, by the ground covered
        const walk = mixer.clipAction(AnimationClip.findByName([...animations("wizard")], "walk")!)
        walk.timeScale = 0
        walk.setLoop(LoopOnce, 1)
        walk.clampWhenFinished = true
        walk.setEffectiveWeight(0)
        walk.play()
        return { ...figure, mixer, walk, walking: 0 }
    }
}
