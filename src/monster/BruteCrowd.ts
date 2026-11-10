import {
    type AnimationAction,
    AnimationClip,
    AnimationMixer,
    type Color,
    Group,
    LoopOnce,
    type MeshBasicMaterial,
    type MeshStandardMaterial,
    type Object3D,
    SkinnedMesh
} from "three"
import { createSilhouetteMaterial, MEEPLE_SCALE, NO_SILHOUETTE, SILHOUETTE_FILL, SILHOUETTE_RIM } from "../meeple/Meeple3D"
import { applyLightField, type LightField } from "../render/dungeonLighting"
import { animations, model } from "../render/scene3d"
import { type Brute, ATTACK_TIME } from "./brutes"
import { FLASH, PLAIN, SILHOUETTE } from "./MonsterCrowd"

/**
 * World units walked in one loop of the walk clip, so that the feet keep up with the ground
 */
const STRIDE = 0.7

/**
 * Seconds it takes to start and stop walking, and to go from walking to swinging and back
 */
const FADE_TIME = 0.25


interface Figure
{
    root: Object3D
    mixer: AnimationMixer
    walk: AnimationAction
    attack: AnimationAction
    /** lit materials with their own colors */
    bodies: { material: MeshStandardMaterial, color: Color }[]
    rim: MeshBasicMaterial
    fill: MeshBasicMaterial
    walking: boolean
    attacking: boolean
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
        this.group.renderOrder = 1
    }

    /**
     * Shows the given brutes, and no longer those that died
     *
     * @param brutes    brutes to show
     * @param delta     seconds since the last call
     */
    update(brutes: readonly Brute[], delta: number): void
    {
        const { figures } = this
        for (const [brute, figure] of figures)
        {
            if (!brutes.includes(brute))
            {
                this.group.remove(figure.root)
                figures.delete(brute)
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

    private pose(brute: Brute, figure: Figure, delta: number): void
    {
        const { kind, x, z, yaw, walked, moving, attack, flash, chase } = brute
        const { root, mixer, walk, bodies, rim, fill } = figure

        root.position.set(x, 0, z)
        root.rotation.y = yaw
        root.scale.setScalar(kind.scale * MEEPLE_SCALE)

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

        const color = flash > 0 ? FLASH : PLAIN
        for (const body of bodies)
        {
            body.material.color.copy(body.color).multiply(color)
        }
        const silhouette = chase > 0 ? SILHOUETTE : NO_SILHOUETTE
        rim.color.copy(silhouette)
        fill.color.copy(silhouette).multiplyScalar(SILHOUETTE_FILL)
    }

    private createFigure(): Figure
    {
        const root = model("brute")
        const rim = createSilhouetteMaterial(1, SILHOUETTE_RIM)
        const fill = createSilhouetteMaterial(SILHOUETTE_FILL, 0)
        const bodies: Figure["bodies"] = []

        // glTF makes one mesh per material
        const meshes: SkinnedMesh[] = []
        root.traverse(obj => (obj as SkinnedMesh).isSkinnedMesh && meshes.push(obj as SkinnedMesh))
        for (const mesh of meshes)
        {
            // the flash and the light field belong to this brute
            const material = (mesh.material as MeshStandardMaterial).clone()
            applyLightField(material, this.field)
            bodies.push({ material, color: material.color.clone() })
            mesh.material = material
            mesh.frustumCulled = false

            // all rims before all fills, see MeepleCrowd.showSilhouettes()
            for (const [shape, order] of [[rim, -2], [fill, -1]] as const)
            {
                const silhouette = new SkinnedMesh(mesh.geometry, shape)
                silhouette.bind(mesh.skeleton, mesh.bindMatrix)
                silhouette.renderOrder = order
                silhouette.frustumCulled = false
                mesh.add(silhouette)
            }
        }

        const clips = [...animations("brute")]
        const mixer = new AnimationMixer(root)
        const walk = mixer.clipAction(AnimationClip.findByName(clips, "walk")!)
        const attack = mixer.clipAction(AnimationClip.findByName(clips, "attack")!)
        // both are posed by hand, by the ground covered and the time into the swing
        walk.timeScale = 0
        attack.timeScale = 0
        attack.setLoop(LoopOnce, 1)
        attack.clampWhenFinished = true
        return { root, mixer, walk, attack, bodies, rim, fill, walking: false, attacking: false }
    }
}
