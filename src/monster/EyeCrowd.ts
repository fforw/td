import {
    AdditiveBlending,
    Color,
    DynamicDrawUsage,
    type Group,
    InstancedBufferAttribute,
    InstancedMesh,
    Matrix4,
    MeshBasicMaterial,
    Quaternion,
    SphereGeometry,
    Vector3
} from "three"
import { MEEPLE_SCALE, NO_SILHOUETTE } from "../meeple/Meeple3D"
import type { LightField } from "../render/dungeonLighting"
import { type Bolt, type Eye, type Spark, SPARK_TIME } from "./eyes"
import MonsterCrowd, { FLASH, PLAIN, SILHOUETTE } from "./MonsterCrowd"

/**
 * Height in world units eyes and their bolts hover at, and how far and fast eyes bob up and down
 */
export const HOVER_HEIGHT = 0.3
const BOB = 0.025
const BOB_SPEED = 2.5

/**
 * Shift of the texture coordinates of the iris for the lower eye of the texture, which shows an eye is about to fire, and
 * how much brighter it glows meanwhile
 */
const WARNING_SHIFT = 0.5
const WARNING_GLOW = 1.5

/**
 * Most bolts and sparks per eye at a time
 */
const BOLTS_PER_EYE = 3
const SPARKS_PER_EYE = 6

/**
 * Size of a bolt in world units, how much longer it is than wide, and how far its glow reaches beyond it as a multiple of
 * its size
 */
const BOLT_SIZE = 0.03
const BOLT_STRETCH = 2.5
const GLOW_SIZE = 2.2

/**
 * Size of a spark in world units when it starts and when it is gone
 */
const SPARK_START = 0.04
const SPARK_END = 0.14

const BOLT_COLOR = new Color("#ffe0a0")
const GLOW_COLOR = new Color("#ff6a1a")

const UP = new Vector3(0, 1, 0)
const matrix = new Matrix4()
const position = new Vector3()
const rotation = new Quaternion()
const scale = new Vector3()
const color = new Color()


function createGlowMaterial(color = new Color(1, 1, 1)): MeshBasicMaterial
{
    return new MeshBasicMaterial({ color, blending: AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false })
}

function createInstances(capacity: number, size: number, material: MeshBasicMaterial): InstancedMesh
{
    const mesh = new InstancedMesh(new SphereGeometry(size, 12, 8), material, capacity)
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    mesh.frustumCulled = false
    mesh.count = 0
    return mesh
}


/**
 * Instanced 3D flying eyes and their bolts, drawn with the silhouettes of a MeepleCrowd which shows them. The model must be
 * loaded first.
 */
export default class EyeCrowd
{
    private readonly crowd: MonsterCrowd
    /** per eye the shift of the texture coordinates of the iris */
    private readonly irisShift: InstancedBufferAttribute
    private readonly bolts: InstancedMesh
    private readonly glows: InstancedMesh
    private readonly sparks: InstancedMesh

    /**
     * @param capacity  most eyes there can be
     * @param field     light field of the level
     */
    constructor(capacity: number, field: LightField)
    {
        const crowd = new MonsterCrowd("flyingEye", capacity, field)
        const iris = crowd.bodies.find(({ material }) => (material as MeshBasicMaterial).name === "Iris")!
        // the template keeps its geometry
        iris.geometry = iris.geometry.clone()
        const irisShift = new InstancedBufferAttribute(new Float32Array(capacity), 1)
        irisShift.setUsage(DynamicDrawUsage)
        iris.geometry.setAttribute("irisShift", irisShift)

        const material = iris.material as MeshBasicMaterial
        const lit = material.onBeforeCompile
        material.onBeforeCompile = (shader, renderer) => {
            lit(shader, renderer)
            shader.vertexShader = shader.vertexShader
                .replace("#include <common>", "#include <common>\nattribute float irisShift;\nvarying float vIrisShift;")
                .replace("#include <uv_vertex>", "#include <uv_vertex>\nvMapUv.y += irisShift;\nvIrisShift = irisShift;")
            shader.fragmentShader = shader.fragmentShader
                .replace("#include <common>", "#include <common>\nvarying float vIrisShift;")
                .replace(
                    "#include <emissivemap_fragment>",
                    `#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * step(0.25, vIrisShift) * ${WARNING_GLOW.toFixed(2)};`
                )
        }
        material.customProgramCacheKey = () => "light-field-iris"

        this.bolts = createInstances(capacity * BOLTS_PER_EYE, BOLT_SIZE, new MeshBasicMaterial({ color: BOLT_COLOR, toneMapped: false }))
        this.glows = createInstances(capacity * BOLTS_PER_EYE, BOLT_SIZE * GLOW_SIZE, createGlowMaterial(GLOW_COLOR))
        this.sparks = createInstances(capacity * SPARKS_PER_EYE, 1, createGlowMaterial())
        this.sparks.setColorAt(0, GLOW_COLOR)
        crowd.group.add(this.bolts, this.glows, this.sparks)
        this.crowd = crowd
        this.irisShift = irisShift
    }

    get group(): Group
    {
        return this.crowd.group
    }

    /**
     * Shows the given eyes and what they fired
     *
     * @param time      time in seconds
     */
    update(eyes: readonly Eye[], bolts: readonly Bolt[], sparks: readonly Spark[], time: number): void
    {
        const { crowd, irisShift } = this
        eyes.forEach((eye, i) => {
            const { kind, x, z, yaw, flash, chase, warning } = eye
            const size = kind.scale * MEEPLE_SCALE
            rotation.setFromAxisAngle(UP, yaw)
            matrix.compose(position.set(x, HOVER_HEIGHT + BOB * Math.sin(time * BOB_SPEED + yaw * 3), z), rotation, scale.setScalar(size))
            crowd.set(i, matrix, flash > 0 ? FLASH : PLAIN, chase > 0 ? SILHOUETTE : NO_SILHOUETTE)
            irisShift.setX(i, warning > 0 ? WARNING_SHIFT : 0)
        })
        crowd.show(eyes.length)
        irisShift.needsUpdate = true

        const boltCount = Math.min(bolts.length, this.bolts.instanceMatrix.count)
        for (let i = 0; i < boltCount; i++)
        {
            const { x, z, dirX, dirZ } = bolts[i]
            rotation.setFromAxisAngle(UP, Math.atan2(dirX, dirZ))
            matrix.compose(position.set(x, HOVER_HEIGHT, z), rotation, scale.set(1, 1, BOLT_STRETCH))
            this.bolts.setMatrixAt(i, matrix)
            this.glows.setMatrixAt(i, matrix)
        }
        this.bolts.count = this.glows.count = boltCount
        this.bolts.instanceMatrix.needsUpdate = this.glows.instanceMatrix.needsUpdate = true

        const sparkCount = Math.min(sparks.length, this.sparks.instanceMatrix.count)
        rotation.identity()
        for (let i = 0; i < sparkCount; i++)
        {
            const { x, z, age } = sparks[i]
            const share = Math.min(1, age / SPARK_TIME)
            matrix.compose(position.set(x, HOVER_HEIGHT, z), rotation, scale.setScalar(SPARK_START + (SPARK_END - SPARK_START) * share))
            this.sparks.setMatrixAt(i, matrix)
            // added light, so black is gone
            this.sparks.setColorAt(i, color.copy(GLOW_COLOR).multiplyScalar((1 - share) * (1 - share)))
        }
        this.sparks.count = sparkCount
        this.sparks.instanceMatrix.needsUpdate = true
        this.sparks.instanceColor!.needsUpdate = true
    }
}
