import { type AnimationAction, AnimationClip, AnimationMixer, Group, LoopOnce, PropertyBinding } from "three"
import { LEVEL_MEEPLE_SCALE } from "../meeple/Meeple3D"
import type { LightField } from "../render/dungeonLighting"
import { animations } from "../render/scene3d"
import { type SkinnedFigure, skinnedFigure, tintFigure } from "./skinnedFigure"
import { FIGURE_ORDER } from "./MonsterCrowd"
import { RAISE_TIME, type Soldier } from "./soldiers"

/**
 * Seconds it takes to start and stop walking, and for the arms to go from walking to swinging or guarding and back
 */
const FADE_TIME = 0.2

interface Figure extends SkinnedFigure
{
    mixer: AnimationMixer
    attack: AnimationAction
    block: AnimationAction
    /** the walk of the bones that neither swinging nor guarding move, and of those that do */
    walkBody: AnimationAction
    walkArms: AnimationAction
    /** how far it has started walking, from 0 to 1 */
    walking: number
    /** how far its arms are free to walk, from 0 to 1 */
    armsFree: number
}


/**
 * Returns the name of the bone or node a track of a clip moves
 */
function trackNode(name: string): string
{
    return PropertyBinding.parseTrackName(name).nodeName
}

/**
 * Returns a value moved towards a target by at most the given step
 */
function approach(value: number, target: number, step: number): number
{
    return value < target ? Math.min(target, value + step) : Math.max(target, value - step)
}


/**
 * Returns the time into the block clip for how far up the shield of a soldier is: the first half raises it, the second
 * half lowers it, and it holds in between for as long as the soldier guards. Lowering starts from as far up as the shield
 * got, so a guard dropped early doesn't jump.
 *
 * @param duration  length of the block clip in seconds
 */
export function blockTime({ guarding, shield }: Soldier, duration: number): number
{
    return guarding ? shield * RAISE_TIME : duration - shield * (duration - RAISE_TIME)
}


/**
 * Animated 3D soldiers, drawn with the silhouettes of a MeepleCrowd which shows them. They aren't instanced, as each has a
 * skeleton of its own, so this is for few of them. The model must be loaded first. Dead ones just burst, see Bursts.add().
 */
export default class SoldierCrowd
{
    readonly group = new Group()

    private readonly figures = new Map<Soldier, Figure>()

    /**
     * @param field     light field of the level
     */
    constructor(private readonly field: LightField)
    {
        this.group.renderOrder = FIGURE_ORDER
    }

    /**
     * Shows the given soldiers
     *
     * @param delta     seconds since the last call
     */
    update(soldiers: readonly Soldier[], delta: number): void
    {
        const { figures } = this
        for (const [soldier, figure] of figures)
        {
            if (!soldiers.includes(soldier))
            {
                this.group.remove(figure.root)
                figures.delete(soldier)
            }
        }

        for (const soldier of soldiers)
        {
            let figure = figures.get(soldier)
            if (!figure)
            {
                figure = this.createFigure()
                figures.set(soldier, figure)
                this.group.add(figure.root)
            }
            this.pose(soldier, figure, delta)
        }
    }

    /**
     * Poses a figure by the state of its soldier. Swinging and guarding never overlap and both start and end at the rest
     * pose, so one clip takes over from the other without fading. The walk fades in and out, and its arms give way to
     * swinging and guarding, while the body goes on walking.
     */
    private pose(soldier: Soldier, figure: Figure, delta: number): void
    {
        const { kind, x, z, yaw, attack, shield, walked, moving, flash, chase } = soldier
        const { root, mixer, block, walkBody, walkArms } = figure

        root.position.set(x, 0, z)
        root.rotation.y = yaw
        root.scale.setScalar(kind.scale * LEVEL_MEEPLE_SCALE)

        figure.attack.setEffectiveWeight(attack !== null ? 1 : 0)
        figure.attack.time = Math.min(attack ?? 0, figure.attack.getClip().duration)
        block.setEffectiveWeight(attack === null && shield > 0 ? 1 : 0)
        block.time = blockTime(soldier, block.getClip().duration)

        // at full speed the walk goes as fast as it was made
        const step = delta / FADE_TIME
        figure.walking = approach(figure.walking, moving ? 1 : 0, step)
        figure.armsFree = approach(figure.armsFree, attack === null && shield === 0 ? 1 : 0, step)
        const walkTime = walked / kind.speed % walkBody.getClip().duration
        walkBody.setEffectiveWeight(figure.walking)
        walkBody.time = walkTime
        walkArms.setEffectiveWeight(figure.walking * figure.armsFree)
        walkArms.time = walkTime
        mixer.update(0)

        tintFigure(figure, flash, chase)
    }

    private createFigure(): Figure
    {
        const figure = skinnedFigure("soldier", this.field)
        const { root } = figure

        const clips = [...animations("soldier")]
        const mixer = new AnimationMixer(root)
        const attackClip = AnimationClip.findByName(clips, "attack")!
        const blockClip = AnimationClip.findByName(clips, "block")!
        const walkClip = AnimationClip.findByName(clips, "walk")!
        // the walk splits by the bones swinging and guarding move
        const arms = new Set([...attackClip.tracks, ...blockClip.tracks].map(({ name }) => trackNode(name)))
        const body = new AnimationClip("walk body", walkClip.duration, walkClip.tracks.filter(({ name }) => !arms.has(trackNode(name))))
        const armsWalk = new AnimationClip("walk arms", walkClip.duration, walkClip.tracks.filter(({ name }) => arms.has(trackNode(name))))

        // all are posed by hand, by the time into the swing, how far up the shield is and the ground covered
        const [attack, block, walkBody, walkArms] = [attackClip, blockClip, body, armsWalk].map(clip => {
            const action = mixer.clipAction(clip)
            action.timeScale = 0
            action.setLoop(LoopOnce, 1)
            action.clampWhenFinished = true
            action.setEffectiveWeight(0)
            action.play()
            return action
        })
        return { ...figure, mixer, attack, block, walkBody, walkArms, walking: 0, armsFree: 1 }
    }
}
