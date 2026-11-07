import { Color, DynamicDrawUsage, Group, InstancedMesh, type Matrix4, type Mesh, type MeshStandardMaterial } from "three"
import { createSilhouetteMaterial, NO_SILHOUETTE, SILHOUETTE_FILL, SILHOUETTE_RIM } from "../meeple/Meeple3D"
import { applyLightField, type LightField } from "../render/dungeonLighting"
import { type ModelName, template } from "../render/scene3d"

/**
 * Factors on the colors of a monster, and while it shows a hit
 */
export const PLAIN = new Color(1, 1, 1)
export const FLASH = new Color(5, 5, 5)

/**
 * Color of a monster after someone where a wall hides it, those not going after anyone yet are a surprise
 */
export const SILHOUETTE = new Color("#f0705a")


/**
 * Instanced 3D monsters of one model, with every mesh of the model drawn for each, and drawn with the silhouettes of a
 * MeepleCrowd which shows them. The model must be loaded first, and its meshes must not be moved within it.
 */
export default class MonsterCrowd
{
    readonly group = new Group()

    /** lit meshes in the order of the model, all with the same instance matrices and colors */
    readonly bodies: InstancedMesh[] = []

    private readonly silhouettes: InstancedMesh[] = []

    /**
     * @param model     model to show
     * @param capacity  most monsters there can be
     * @param field     light field of the level
     */
    constructor(model: ModelName, capacity: number, field: LightField)
    {
        const { bodies, silhouettes } = this
        template(model).traverse(obj => {
            const source = obj as Mesh
            if (!source.isMesh)
            {
                return
            }
            // the light field belongs to this level
            const material = (source.material as MeshStandardMaterial).clone()
            applyLightField(material, field)
            const body = new InstancedMesh(source.geometry, material, capacity)
            const silhouette = new InstancedMesh(source.geometry, createSilhouetteMaterial(1, SILHOUETTE_RIM), capacity)
            const fill = new InstancedMesh(source.geometry, createSilhouetteMaterial(SILHOUETTE_FILL, 0), capacity)
            if (bodies.length === 0)
            {
                body.instanceMatrix.setUsage(DynamicDrawUsage)
                body.setColorAt(0, NO_SILHOUETTE)
                silhouette.setColorAt(0, NO_SILHOUETTE)
            }
            else
            {
                body.instanceMatrix = bodies[0].instanceMatrix
                body.instanceColor = bodies[0].instanceColor
                silhouette.instanceColor = silhouettes[0].instanceColor
            }
            fill.instanceColor = silhouette.instanceColor
            silhouette.instanceMatrix = fill.instanceMatrix = body.instanceMatrix
            // all rims and fills of a level before anything that can be in front of them, see MeepleCrowd.showSilhouettes()
            silhouette.renderOrder = -2
            fill.renderOrder = -1
            for (const mesh of [body, silhouette, fill])
            {
                mesh.frustumCulled = false
                mesh.count = 0
                this.group.add(mesh)
            }
            bodies.push(body)
            silhouettes.push(silhouette, fill)
        })
        this.group.renderOrder = 1
    }

    /**
     * Places a monster
     *
     * @param index         number of the monster
     * @param matrix        where it is
     * @param color         factor on its colors
     * @param silhouette    color behind walls
     */
    set(index: number, matrix: Matrix4, color: Color, silhouette: Color): void
    {
        this.bodies[0].setMatrixAt(index, matrix)
        this.bodies[0].setColorAt(index, color)
        this.silhouettes[0].setColorAt(index, silhouette)
    }

    /**
     * Shows the given number of monsters, as set before
     */
    show(count: number): void
    {
        for (const mesh of [...this.bodies, ...this.silhouettes])
        {
            mesh.count = count
        }
        this.bodies[0].instanceMatrix.needsUpdate = true
        this.bodies[0].instanceColor!.needsUpdate = true
        this.silhouettes[0].instanceColor!.needsUpdate = true
    }
}
