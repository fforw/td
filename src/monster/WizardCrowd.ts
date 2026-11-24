import { type AnimationAction, AnimationClip, AnimationMixer, Color, Group, LoopOnce } from "three"
import { LEVEL_MEEPLE_SCALE } from "../meeple/Meeple3D"
import type { LightField } from "../render/dungeonLighting"
import { animations } from "../render/scene3d"
import { type SkinnedFigure, skinnedFigure, tintFigure } from "./skinnedFigure"
import { SIGIL_HUE_RANGE } from "../render/sigil"
import { SIGIL_ROBE, type Wizard } from "./wizards"

/**
 * Seconds it takes to start and stop walking
 */
const FADE_TIME = 0.2

/**
 * Seconds it takes to start and stop casting
 */
const CAST_FADE_TIME = 0.12

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
    cast: AnimationAction
    /** how far it has started casting, from 0 to 1 */
    casting: number
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
     * Poses a figure by the state of its wizard, with the walk and the cast fading in and out
     */
    private pose(wizard: Wizard, figure: Figure, delta: number): void
    {
        const { kind, x, z, yaw, walked, moving, casting, flash, chase } = wizard
        const { root, mixer, walk, cast } = figure

        root.position.set(x, 0, z)
        root.rotation.y = yaw
        root.scale.setScalar(kind.scale * LEVEL_MEEPLE_SCALE)

        // at full speed the walk goes as fast as it was made
        const step = delta / FADE_TIME
        figure.walking = moving ? Math.min(1, figure.walking + step) : Math.max(0, figure.walking - step)
        walk.setEffectiveWeight(figure.walking)
        walk.time = walked / kind.speed % walk.getClip().duration

        const castStep = delta / CAST_FADE_TIME
        figure.casting = casting ? Math.min(1, figure.casting + castStep) : Math.max(0, figure.casting - castStep)
        cast.setEffectiveWeight(figure.casting)
        if (casting)
        {
            cast.time = Math.min(casting.age, cast.getClip().duration)
        }
        mixer.update(0)

        tintFigure(figure, flash, chase)
    }

    private createFigure({ robe, hue }: Wizard): Figure
    {
        const color = new Color(ROBE_COLORS[robe % ROBE_COLORS.length])
        if (robe === SIGIL_ROBE)
        {
            // as its sigils
            color.offsetHSL((hue * 2 - 1) * SIGIL_HUE_RANGE, 0, 0)
        }
        const figure = skinnedFigure("wizard", this.field, { Robe: color })
        const mixer = new AnimationMixer(figure.root)

        // posed by hand, by the ground covered and by how far the sigil is drawn
        const [walk, cast] = ["walk", "cast"].map(name => {
            const action = mixer.clipAction(AnimationClip.findByName([...animations("wizard")], name)!)
            action.timeScale = 0
            action.setLoop(LoopOnce, 1)
            action.clampWhenFinished = true
            action.setEffectiveWeight(0)
            action.play()
            return action
        })
        return { ...figure, mixer, walk, cast, walking: 0, casting: 0 }
    }
}
