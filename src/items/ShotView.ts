import {
    AdditiveBlending,
    Color,
    DynamicDrawUsage,
    Euler,
    Group,
    InstancedMesh,
    Matrix4,
    MeshBasicMaterial,
    Quaternion,
    SphereGeometry,
    Vector3
} from "three"
import { type Element, ELEMENT_COLORS, ELEMENTS } from "../game/gear"
import Shots, { FALL_TIME, FLASH_TIME } from "../game/shots"
import { FIGURE_SCALE } from "../meeple/figureScale"
import type { LightField } from "../render/dungeonLighting"
import { type GearParts, instancedGear } from "./gearModels"
import { setGlowing } from "../render/glowView"

/**
 * Height over the floor things fly at, about the hand of a hero
 */
export const FLY_HEIGHT = 0.2 * FIGURE_SCALE

/**
 * Most weapons of each kind and balls of each element shown at once
 */
const MOST = 48

/**
 * Size of a ball in world units, and how far its glow reaches beyond it as a multiple of that
 */
const BALL_SIZE = 0.03 * FIGURE_SCALE
const GLOW_SIZE = 1.8

/**
 * Brightness of that glow, and of a burst at its start, against the color of the element, as the bloom adds to them
 */
const GLOW_BRIGHTNESS = 0.35
const FLASH_BRIGHTNESS = 0.6

/**
 * Size of the burst of a ball in world units when it starts and when it is gone
 */
const FLASH_START = 0.05 * FIGURE_SCALE
const FLASH_END = 0.12 * FIGURE_SCALE

/**
 * Height of a weapon lying on the floor, for it not to sink in
 */
const LYING_HEIGHT = 0.01 * FIGURE_SCALE

/**
 * Glint under a weapon on the floor, for it to be found again in the dark: its size in world units, its color, how bright
 * it gets at least, and how fast it pulses
 */
const GLINT_SIZE = 0.07 * FIGURE_SCALE
const GLINT_COLOR = new Color("#fff2c8")
const GLINT_LEAST = 0.15
const GLINT_RATE = 3

/**
 * Half turns a falling weapon does on the way down
 */
const FALL_TURNS = 1

/**
 * Share of the radius of a monster a weapon sticks out of it from its middle, and how far it tilts down
 */
const STUCK_OUT = 0.8
const STUCK_TILT = 0.4

const matrix = new Matrix4()
const position = new Vector3()
const rotation = new Quaternion()
const euler = new Euler(0, 0, 0, "YXZ")
const scale = new Vector3()
const color = new Color()


function prepare(mesh: InstancedMesh): InstancedMesh
{
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    mesh.frustumCulled = false
    mesh.count = 0
    return mesh
}


function glowMaterial(hex: string, brightness = 1): MeshBasicMaterial
{
    return new MeshBasicMaterial({ color: new Color(hex).multiplyScalar(brightness), blending: AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false })
}


interface Balls
{
    cores: InstancedMesh
    glows: InstancedMesh
    flashes: InstancedMesh
}


/**
 * Instanced weapons that got thrown and glowing balls, for the Shots of a level. The models of the weapons must be loaded
 * first.
 */
export default class ShotView
{
    readonly group = new Group()

    private readonly weapons: Record<"dagger" | "axe", GearParts & { count: number }>
    private readonly balls: Record<Element, Balls>
    private readonly glints: InstancedMesh

    constructor(field: LightField)
    {
        const weapon = (kind: "dagger" | "axe") => ({ ...instancedGear({ kind }, field, MOST), count: 0 })
        this.weapons = { dagger: weapon("dagger"), axe: weapon("axe") }
        const core = new SphereGeometry(BALL_SIZE, 12, 8)
        const glow = new SphereGeometry(BALL_SIZE * GLOW_SIZE, 12, 8)
        const flash = new SphereGeometry(1, 12, 8)
        const ballsOf = (element: Element): Balls => {
            const colors = ELEMENT_COLORS[element]
            return {
                cores: new InstancedMesh(core, new MeshBasicMaterial({ color: new Color(colors.core), toneMapped: false }), MOST),
                glows: new InstancedMesh(glow, glowMaterial(colors.glow, GLOW_BRIGHTNESS), MOST),
                flashes: new InstancedMesh(flash, glowMaterial("#ffffff"), MOST)
            }
        }
        this.balls = { fire: ballsOf("fire"), frost: ballsOf("frost"), venom: ballsOf("venom"), arcane: ballsOf("arcane") }
        this.glints = new InstancedMesh(new SphereGeometry(GLINT_SIZE, 12, 8), glowMaterial("#ffffff"), MOST * 2)
        for (const mesh of [
            this.glints,
            ...Object.values(this.weapons).flatMap(({ parts }) => parts),
            ...Object.values(this.balls).flatMap(({ cores, glows, flashes }) => [cores, glows, flashes])
        ])
        {
            this.group.add(prepare(mesh))
        }
        for (const { cores, glows, flashes } of Object.values(this.balls))
        {
            setGlowing(cores)
            setGlowing(glows)
            setGlowing(flashes)
        }
        // after the silhouettes of a level, see MeepleCrowd.showSilhouettes()
        this.group.renderOrder = 1
    }

    /**
     * Sets a weapon to the given place, pointing along its yaw and tilted by pitch from lying flat
     */
    private place(kind: "dagger" | "axe", x: number, y: number, z: number, yaw: number, pitch: number): void
    {
        const weapon = this.weapons[kind]
        if (weapon.count >= MOST)
        {
            return
        }
        // the model points up, lying it points along z, which the yaw turns
        euler.set(Math.PI / 2 + pitch, yaw, 0)
        matrix.compose(position.set(x, y, z), rotation.setFromEuler(euler), scale.setScalar(weapon.scale))
        for (const part of weapon.parts)
        {
            part.setMatrixAt(weapon.count, matrix)
        }
        weapon.count++
    }

    update({ flying, lying, stuck, flashes }: Shots, time: number): void
    {
        const { weapons, balls, glints } = this
        for (const weapon of Object.values(weapons))
        {
            weapon.count = 0
        }
        const ballCounts = new Map<Element, number>()
        for (const { kind, element, x, z, dirX, dirZ, spin } of flying)
        {
            if (kind === "dagger" || kind === "axe")
            {
                this.place(kind, x, FLY_HEIGHT, z, Math.atan2(dirX, dirZ), spin)
                continue
            }
            const of = element ?? "arcane"
            const index = ballCounts.get(of) ?? 0
            if (index < MOST)
            {
                matrix.compose(position.set(x, FLY_HEIGHT, z), rotation.identity(), scale.setScalar(1))
                balls[of].cores.setMatrixAt(index, matrix)
                balls[of].glows.setMatrixAt(index, matrix)
                ballCounts.set(of, index + 1)
            }
        }
        for (const { kind, x, z, yaw, age, height } of lying)
        {
            const share = Math.min(1, age / FALL_TIME)
            // falls faster and faster, turning over
            const y = LYING_HEIGHT + (height - LYING_HEIGHT) * (1 - share * share)
            this.place(kind, x, y, z, yaw, (1 - share) * FALL_TURNS * Math.PI)
        }
        const glintCount = Math.min(lying.length, glints.instanceMatrix.count)
        for (let i = 0; i < glintCount; i++)
        {
            const { x, z, age } = lying[i]
            const pulse = GLINT_LEAST + (1 - GLINT_LEAST) * (0.5 + 0.5 * Math.sin(time * GLINT_RATE + i)) * Math.min(1, age / FALL_TIME)
            // flat on the floor
            matrix.compose(position.set(x, 0, z), rotation.identity(), scale.set(1, 0.2, 1))
            glints.setMatrixAt(i, matrix)
            glints.setColorAt(i, color.copy(GLINT_COLOR).multiplyScalar(pulse))
        }
        glints.count = glintCount
        glints.instanceMatrix.needsUpdate = true
        if (glints.instanceColor)
        {
            glints.instanceColor.needsUpdate = true
        }
        for (const { kind, monster, side } of stuck)
        {
            const angle = monster.yaw + side
            const out = monster.kind.radius * STUCK_OUT
            const height = monster.kind.flying ? FLY_HEIGHT * 1.5 : Math.min(monster.kind.radius, FLY_HEIGHT)
            // points into the monster from where it came
            this.place(kind, monster.x + Math.sin(angle) * out, height, monster.z + Math.cos(angle) * out, angle + Math.PI, -STUCK_TILT)
        }
        for (const { parts, count } of Object.values(weapons))
        {
            for (const part of parts)
            {
                part.count = count
                part.instanceMatrix.needsUpdate = true
            }
        }

        const flashCounts = new Map<Element, number>()
        for (const { element, x, z, age } of flashes)
        {
            const index = flashCounts.get(element) ?? 0
            if (index >= MOST)
            {
                continue
            }
            const share = Math.min(1, age / FLASH_TIME)
            matrix.compose(position.set(x, FLY_HEIGHT, z), rotation.identity(), scale.setScalar(FLASH_START + (FLASH_END - FLASH_START) * share))
            const { flashes: mesh } = balls[element]
            mesh.setMatrixAt(index, matrix)
            // added light, so black is gone
            mesh.setColorAt(index, color.set(ELEMENT_COLORS[element].glow).multiplyScalar(FLASH_BRIGHTNESS * (1 - share) * (1 - share)))
            flashCounts.set(element, index + 1)
        }
        for (const element of ELEMENTS)
        {
            const { cores, glows, flashes: mesh } = balls[element]
            cores.count = glows.count = ballCounts.get(element) ?? 0
            mesh.count = flashCounts.get(element) ?? 0
            for (const each of [cores, glows, mesh])
            {
                each.instanceMatrix.needsUpdate = true
            }
            if (mesh.instanceColor)
            {
                mesh.instanceColor.needsUpdate = true
            }
        }
    }
}
