import { type AnimationAction, AnimationClip, type Bone, AnimationMixer, Group, LoopOnce } from "three"
import { LEVEL_MEEPLE_SCALE, NO_SILHOUETTE } from "../meeple/Meeple3D"
import { FIGURE_SCALE } from "../meeple/figureScale"
import type { LightField } from "../render/dungeonLighting"
import { animations } from "../render/scene3d"
import { type Brute, ATTACK_TIME } from "./brutes"
import type Bursts from "./bursts"
import type { Death } from "./bursts"
import { type SkinnedFigure, skinnedFigure, tintFigure } from "./skinnedFigure"
import { FIGURE_ORDER } from "./MonsterCrowd"

/**
 * World units walked in one loop of the walk clip, so that the feet keep up with the ground
 */
const STRIDE = 0.7 * FIGURE_SCALE

/**
 * Seconds it takes to start and stop walking, and to go from walking to swinging and back
 */
const FADE_TIME = 0.25

/**
 * Material of the club, which is all that is left of a brute after its body burst
 */
const CLUB_MATERIAL = "Wood"

/**
 * Frames per second of the clips in the model
 */
const FPS = 24

/**
 * Frame of the die clip in which the club first hits the floor. It bursts in a random frame from this one to the end of
 * the clip.
 */
const CLUB_LANDED = 10


interface Figure extends SkinnedFigure
{
    mixer: AnimationMixer
    walk: AnimationAction
    attack: AnimationAction
    die: AnimationAction
    walking: boolean
    attacking: boolean
    /** how it died, null while it lives */
    death: Death | null
    /** seconds since it died */
    dead: number
    /** seconds after its death at which the club bursts */
    burst: number
}


/**
 * Animated 3D brutes, drawn with the silhouettes of a MeepleCrowd which shows them. They aren't instanced, as each has a
 * skeleton of its own, so this is for few of them. The model must be loaded first.
 */
export default class BruteCrowd
{
    readonly group = new Group()

    private readonly figures = new Map<Brute, Figure>()

    /**
     * @param field     light field of the level
     */
    constructor(private readonly field: LightField)
    {
        this.group.renderOrder = FIGURE_ORDER
    }

    /**
     * Shows the given brutes, and what is left of those that died: their bodies burst right away, see Bursts.add(), and
     * the club plays the die clip and bursts somewhere along it, once on the floor, smitten or not.
     *
     * @param brutes    brutes to show
     * @param deaths    monsters that died in this frame
     * @param bursts    where the clubs burst
     * @param delta     seconds since the last call
     */
    update(brutes: readonly Brute[], deaths: readonly Death[], bursts: Bursts, delta: number): void
    {
        const { figures } = this
        for (const [brute, figure] of figures)
        {
            if (brutes.includes(brute))
            {
                continue
            }
            if (!figure.death)
            {
                const death = deaths.find(({ monster }) => monster === brute)
                if (!death)
                {
                    this.remove(brute, figure, death, bursts)
                    continue
                }
                this.startDying(figure, death)
            }
            figure.dead += delta
            figure.mixer.update(delta)
            if (figure.dead >= figure.burst)
            {
                this.remove(brute, figure, figure.death, bursts)
            }
        }

        for (const brute of brutes)
        {
            let figure = figures.get(brute)
            if (!figure)
            {
                figure = this.createFigure()
                figures.set(brute, figure)
                this.group.add(figure.root)
            }
            this.pose(brute, figure, delta)
        }
    }

    /**
     * Hides the body, which burst, and has the club go on with the die clip
     */
    private startDying(figure: Figure, death: Death): void
    {
        figure.death = death
        const landed = CLUB_LANDED / FPS
        figure.burst = landed + Math.pow(Math.random(), 0.6) * (figure.die.getClip().duration - landed)
        for (const { material, mesh } of figure.bodies)
        {
            mesh.visible = material.name === CLUB_MATERIAL
        }
        figure.walk.fadeOut(FADE_TIME)
        figure.attack.fadeOut(FADE_TIME)
        figure.die.reset().fadeIn(FADE_TIME).play()
        figure.rim.color.copy(NO_SILHOUETTE)
        figure.fill.color.copy(NO_SILHOUETTE)
    }

    /**
     * Takes a figure out of the scene, and has what goes with its bones burst where they are now, after a death
     */
    private remove(brute: Brute, figure: Figure, death: Death | null | undefined, bursts: Bursts): void
    {
        if (death)
        {
            for (const sphere of death.kind.burst)
            {
                const bone = sphere.bone ? figure.root.getObjectByName(sphere.bone) as Bone | undefined : undefined
                if (bone)
                {
                    bone.updateWorldMatrix(true, false)
                    bursts.burst(sphere, bone.matrixWorld, death.away, death.share)
                }
            }
        }
        this.group.remove(figure.root)
        this.figures.delete(brute)
    }

    private pose(brute: Brute, figure: Figure, delta: number): void
    {
        const { kind, x, z, yaw, walked, moving, attack, flash, chase } = brute
        const { root, mixer, walk } = figure

        root.position.set(x, 0, z)
        root.rotation.y = yaw
        root.scale.setScalar(kind.scale * LEVEL_MEEPLE_SCALE)

        // the walk follows the ground covered, not the time
        walk.time = walked / STRIDE % walk.getClip().duration
        if (moving !== figure.walking)
        {
            figure.walking = moving
            if (moving)
            {
                walk.reset().fadeIn(FADE_TIME).play()
            }
            else
            {
                walk.fadeOut(FADE_TIME)
            }
        }

        const attacking = attack !== null
        if (attacking !== figure.attacking)
        {
            figure.attacking = attacking
            if (attacking)
            {
                figure.attack.reset().fadeIn(FADE_TIME).play()
            }
            else
            {
                figure.attack.fadeOut(FADE_TIME)
            }
        }
        if (attacking)
        {
            // the club comes down when the pack says it does
            figure.attack.time = Math.min(attack, ATTACK_TIME)
        }
        mixer.update(delta)
        tintFigure(figure, flash, chase)
    }

    private createFigure(): Figure
    {
        const figure = skinnedFigure("brute", this.field)
        const { root } = figure

        const clips = [...animations("brute")]
        const mixer = new AnimationMixer(root)
        const walk = mixer.clipAction(AnimationClip.findByName(clips, "walk")!)
        const attack = mixer.clipAction(AnimationClip.findByName(clips, "attack")!)
        // the club falls to the floor, from a rigid body simulation
        const die = mixer.clipAction(AnimationClip.findByName(clips, "die")!)
        die.setLoop(LoopOnce, 1)
        die.clampWhenFinished = true
        // both are posed by hand, by the ground covered and the time into the swing
        walk.timeScale = 0
        attack.timeScale = 0
        attack.setLoop(LoopOnce, 1)
        attack.clampWhenFinished = true
        return {
            ...figure, mixer, walk, attack, die,
            walking: false, attacking: false, death: null, dead: 0, burst: 0
        }
    }
}
