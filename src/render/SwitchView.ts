import { type AnimationAction, AnimationMixer, Group, LoopOnce, type Mesh, type MeshStandardMaterial } from "three"
import { SWITCH_HALF_HEIGHT } from "../map/fireRoom"
import type { FixtureSpot } from "../map/fixtures"
import { applyLightField, type LightField } from "./dungeonLighting"
import { animations, model } from "./scene3d"

/**
 * Half the height of the plate of the model, whose back is at its origin
 */
const MODEL_HALF_HEIGHT = 0.5

/**
 * Height of the middle of a switch in world units
 */
const SWITCH_Y = 0.32


/**
 * A switch with a lever on a wall, which is on until it gets toggled. The model must be loaded first.
 */
export default class SwitchView
{
    readonly group = new Group()

    private readonly mixer: AnimationMixer
    private readonly toggling: AnimationAction

    /**
     * @param spot      where it is on the surface of the wall
     * @param field     light field of the level
     */
    constructor({ x, z, facing }: FixtureSpot, field: LightField)
    {
        const root = model("switch")
        let material: MeshStandardMaterial | null = null
        root.traverse(part => {
            const mesh = part as Mesh
            if (mesh.isMesh)
            {
                if (!material)
                {
                    // the light field belongs to this level
                    material = (mesh.material as MeshStandardMaterial).clone()
                    applyLightField(material, field)
                }
                mesh.material = material
            }
        })
        // after the silhouettes of a level, see MeepleCrowd.showSilhouettes()
        this.group.renderOrder = 1
        this.group.position.set(x, SWITCH_Y, z)
        this.group.rotation.y = facing
        this.group.scale.setScalar(SWITCH_HALF_HEIGHT / MODEL_HALF_HEIGHT)
        this.group.add(root)

        this.mixer = new AnimationMixer(root)
        const clip = animations("switch").find(({ name }) => name === "toggle")!
        this.toggling = this.mixer.clipAction(clip).setLoop(LoopOnce, 1)
        this.toggling.clampWhenFinished = true
    }

    /**
     * Throws the lever
     *
     * @param atOnce    doesn't show it moving, for one that got thrown before
     */
    toggle(atOnce = false): void
    {
        this.toggling.reset().play()
        if (atOnce)
        {
            this.mixer.update(this.toggling.getClip().duration)
        }
    }

    update(delta: number): void
    {
        this.mixer.update(delta)
    }
}
