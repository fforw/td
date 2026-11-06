import { Color, DynamicDrawUsage, Group, InstancedMesh, Matrix4, type Mesh, type MeshStandardMaterial, Quaternion, Vector3 } from "three"
import { createSilhouetteMaterial, MEEPLE_SCALE, NO_SILHOUETTE, SILHOUETTE_FILL, SILHOUETTE_RIM } from "../meeple/Meeple3D"
import { applyLightField, type LightField } from "../render/dungeonLighting"
import { template } from "../render/scene3d"
import { type Cuboid, hopShare, LUNGE_WINDUP } from "./cuboids"

/**
 * How much taller a cuboid gets in the air, and how much flatter just before a lunge
 */
const HOP_STRETCH = 0.2
const WINDUP_SQUASH = 0.4

/**
 * How much a cuboid wobbles all the time, and how fast
 */
const WOBBLE = 0.02
const WOBBLE_SPEED = 3

const PLAIN = new Color(1, 1, 1)
const FLASH = new Color(5, 5, 5)

/**
 * Color of a cuboid after someone where a wall hides it, those not going after anyone yet are a surprise
 */
const SILHOUETTE = new Color("#f0705a")

const UP = new Vector3(0, 1, 0)
const matrix = new Matrix4()
const position = new Vector3()
const rotation = new Quaternion()
const scale = new Vector3()


/**
 * Instanced 3D acid cuboids, drawn with the silhouettes of a MeepleCrowd which shows them. The model must be loaded first.
 */
export default class CuboidCrowd
{
    readonly group = new Group()

    private readonly body: InstancedMesh
    private readonly silhouette: InstancedMesh
    private readonly fill: InstancedMesh

    /**
     * @param capacity  most cuboids there can be
     * @param field     light field of the level
     */
    constructor(capacity: number, field: LightField)
    {
        let source!: Mesh
        template("acidCuboid").traverse(obj => {
            if ((obj as Mesh).isMesh)
            {
                source = obj as Mesh
            }
        })
        // the light field belongs to this level
        const material = (source.material as MeshStandardMaterial).clone()
        applyLightField(material, field)

        const body = new InstancedMesh(source.geometry, material, capacity)
        body.instanceMatrix.setUsage(DynamicDrawUsage)
        body.setColorAt(0, PLAIN)

        const silhouette = new InstancedMesh(source.geometry, createSilhouetteMaterial(1, SILHOUETTE_RIM), capacity)
        const fill = new InstancedMesh(source.geometry, createSilhouetteMaterial(SILHOUETTE_FILL, 0), capacity)
        silhouette.setColorAt(0, NO_SILHOUETTE)
        fill.instanceColor = silhouette.instanceColor
        silhouette.instanceMatrix = fill.instanceMatrix = body.instanceMatrix
        // all rims and fills of a level before anything that can be in front of them, see MeepleCrowd.showSilhouettes()
        silhouette.renderOrder = -2
        fill.renderOrder = -1
        this.group.renderOrder = 1
        for (const mesh of [body, silhouette, fill])
        {
            mesh.frustumCulled = false
            mesh.count = 0
            this.group.add(mesh)
        }
        this.body = body
        this.silhouette = silhouette
        this.fill = fill
    }

    /**
     * Shows the given cuboids
     *
     * @param cuboids   cuboids to show
     * @param time      time in seconds
     */
    update(cuboids: readonly Cuboid[], time: number): void
    {
        const { body, silhouette, fill } = this
        cuboids.forEach((cuboid, i) => {
            const { kind, x, z, yaw, windup, hopHeight, flash, chase } = cuboid
            const arc = Math.sin(hopShare(cuboid) * Math.PI)
            const stretch = 1 + WOBBLE * Math.sin(time * WOBBLE_SPEED + yaw)
                + arc * HOP_STRETCH
                - (windup > 0 ? (1 - windup / LUNGE_WINDUP) * WINDUP_SQUASH : 0)
            // keeps about the volume it has
            const width = kind.scale * MEEPLE_SCALE / Math.sqrt(stretch)

            rotation.setFromAxisAngle(UP, yaw)
            matrix.compose(position.set(x, arc * hopHeight, z), rotation, scale.set(width, stretch * kind.scale * MEEPLE_SCALE, width))
            body.setMatrixAt(i, matrix)
            body.setColorAt(i, flash > 0 ? FLASH : PLAIN)
            silhouette.setColorAt(i, chase > 0 ? SILHOUETTE : NO_SILHOUETTE)
        })
        body.count = silhouette.count = fill.count = cuboids.length
        body.instanceMatrix.needsUpdate = true
        body.instanceColor!.needsUpdate = true
        silhouette.instanceColor!.needsUpdate = true
    }
}
