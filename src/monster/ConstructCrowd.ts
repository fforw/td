import {
    AdditiveBlending,
    Color,
    DynamicDrawUsage,
    type Group,
    InstancedMesh,
    Matrix4,
    MeshBasicMaterial,
    Quaternion,
    SphereGeometry,
    Vector3
} from "three"
import { LEVEL_MEEPLE_SCALE, NO_SILHOUETTE } from "../meeple/Meeple3D"
import { FIGURE_SCALE } from "../meeple/figureScale"
import type { LightField } from "../render/dungeonLighting"
import { setGlowing } from "../render/glowView"
import type { Construct } from "./constructs"
import { HOVER_HEIGHT } from "./EyeCrowd"
import MonsterCrowd, { FLASH, PLAIN, SILHOUETTE } from "./MonsterCrowd"

/**
 * How far and fast constructs bob up and down, in world units and radians per second
 */
const BOB = 0.02 * FIGURE_SCALE
const BOB_SPEED = 1.8

/**
 * Height of the middle of the cage over the origin of the model, in model units
 */
const CORE_HEIGHT = 0.056

/**
 * Radius of the core in world units, and how far its glow reaches beyond it as a multiple of that
 */
const CORE_SIZE = 0.028 * FIGURE_SCALE
const GLOW_SIZE = 2.2

/**
 * How fast the core pulses in radians per second, and while zipping at the most, and by how much of its size
 */
const PULSE_SPEED = 3
const ZIP_PULSE_SPEED = 18
const PULSE = 0.18

/**
 * How bright the glow is at the least and at the most of a pulse, and how much brighter at the end of a zip
 */
const GLOW_LOW = 0.45
const GLOW_HIGH = 1
const ZIP_GLOW = 1.2

const CORE_COLOR = new Color("#e0fbff")
const GLOW_COLOR = new Color("#3fc8ff")

const UP = new Vector3(0, 1, 0)
const matrix = new Matrix4()
const position = new Vector3()
const rotation = new Quaternion()
const scale = new Vector3()
const color = new Color()


function createInstances(capacity: number, size: number, material: MeshBasicMaterial): InstancedMesh
{
    const mesh = new InstancedMesh(new SphereGeometry(size, 12, 8), material, capacity)
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    mesh.frustumCulled = false
    mesh.count = 0
    setGlowing(mesh)
    return mesh
}


/**
 * Instanced 3D constructs, a metal cage with a pulsing core that glows, drawn with the silhouettes of a MeepleCrowd which
 * shows them. The model must be loaded first.
 */
export default class ConstructCrowd
{
    private readonly crowd: MonsterCrowd
    private readonly cores: InstancedMesh
    private readonly glows: InstancedMesh

    /**
     * @param capacity  most constructs there can be
     * @param field     light field of the level
     */
    constructor(capacity: number, field: LightField)
    {
        const crowd = new MonsterCrowd("construct", capacity, field)
        this.cores = createInstances(capacity, CORE_SIZE, new MeshBasicMaterial({ color: CORE_COLOR, toneMapped: false }))
        this.glows = createInstances(
            capacity,
            CORE_SIZE * GLOW_SIZE,
            new MeshBasicMaterial({ blending: AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false })
        )
        this.glows.setColorAt(0, GLOW_COLOR)
        crowd.group.add(this.cores, this.glows)
        this.crowd = crowd
    }

    get group(): Group
    {
        return this.crowd.group
    }

    /**
     * Shows the given constructs
     *
     * @param time      time in seconds
     */
    update(constructs: readonly Construct[], time: number): void
    {
        const { crowd, cores, glows } = this
        constructs.forEach((construct, i) => {
            const { kind, x, z, yaw, flash, chase, zipping, zipTime, zipDuration, phase } = construct
            const size = kind.scale * LEVEL_MEEPLE_SCALE
            const y = HOVER_HEIGHT + BOB * Math.sin(time * BOB_SPEED + phase)
            rotation.setFromAxisAngle(UP, yaw)
            matrix.compose(position.set(x, y, z), rotation, scale.setScalar(size))
            crowd.set(i, matrix, flash > 0 ? FLASH : PLAIN, chase > 0 ? SILHOUETTE : NO_SILHOUETTE)

            // the core beats faster and burns brighter the further the zip gets
            const zip = zipping ? Math.min(1, zipTime / zipDuration) : 0
            const beat = 0.5 + 0.5 * Math.sin(time * (PULSE_SPEED + (ZIP_PULSE_SPEED - PULSE_SPEED) * zip) + phase)
            rotation.identity()
            matrix.compose(position.set(x, y + CORE_HEIGHT * size, z), rotation, scale.setScalar(1 + PULSE * (beat - 0.5) * 2))
            cores.setMatrixAt(i, matrix)
            glows.setMatrixAt(i, matrix)
            // added light, so black is gone
            glows.setColorAt(i, color.copy(GLOW_COLOR).multiplyScalar(GLOW_LOW + (GLOW_HIGH - GLOW_LOW) * beat + ZIP_GLOW * zip))
        })
        crowd.show(constructs.length)
        cores.count = glows.count = constructs.length
        cores.instanceMatrix.needsUpdate = glows.instanceMatrix.needsUpdate = true
        glows.instanceColor!.needsUpdate = true
    }
}
