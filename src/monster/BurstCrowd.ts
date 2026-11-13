import { BoxGeometry, Color, DynamicDrawUsage, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from "three"
import { applyLightField, type LightField } from "../render/dungeonLighting"
import { type Particle, sizeShare } from "./bursts"

/**
 * Most particles shown at a time, those beyond are left out
 */
const CAPACITY = 1024

const matrix = new Matrix4()
const position = new Vector3()
const axis = new Vector3()
const rotation = new Quaternion()
const scale = new Vector3()


/**
 * Instanced particles of bursting monsters, lit by the light field of the level
 */
export default class BurstCrowd
{
    readonly mesh: InstancedMesh

    private readonly colors = new Map<string, Color>()

    /**
     * @param field     light field of the level
     */
    constructor(field: LightField)
    {
        const material = new MeshStandardMaterial({ roughness: 0.8 })
        applyLightField(material, field)
        const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), material, CAPACITY)
        mesh.instanceMatrix.setUsage(DynamicDrawUsage)
        mesh.setColorAt(0, material.color)
        mesh.instanceColor!.setUsage(DynamicDrawUsage)
        mesh.frustumCulled = false
        mesh.count = 0
        this.mesh = mesh
    }

    /**
     * Shows the given particles
     */
    update(particles: readonly Particle[]): void
    {
        const { mesh } = this
        const count = Math.min(particles.length, CAPACITY)
        for (let i = 0; i < count; i++)
        {
            const particle = particles[i]
            rotation.setFromAxisAngle(axis.set(particle.ax, particle.ay, particle.az), particle.turn)
            matrix.compose(position.set(particle.x, particle.y, particle.z), rotation, scale.setScalar(particle.size * sizeShare(particle)))
            mesh.setMatrixAt(i, matrix)
            mesh.setColorAt(i, this.color(particle.color))
        }
        mesh.count = count
        mesh.instanceMatrix.needsUpdate = true
        mesh.instanceColor!.needsUpdate = true
    }

    private color(css: string): Color
    {
        let color = this.colors.get(css)
        if (!color)
        {
            color = new Color(css)
            this.colors.set(css, color)
        }
        return color
    }
}
