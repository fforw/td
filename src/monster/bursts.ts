import { Matrix4, Quaternion, Vector3 } from "three"
import { MEEPLE_SCALE } from "../meeple/Meeple3D"
import { rng } from "../math/random"
import type { Monster, MonsterKind } from "./monsters"

/**
 * Particles per cubic world unit of a burst sphere, and the fewest a sphere gets however small it is
 */
export const DENSITY = 10000
export const FEWEST = 8

/**
 * Edge length of a particle in world units, before the spread of sizes
 */
export const PARTICLE_SIZE = 0.03

/**
 * How fast particles fly out of the middle of their sphere, and away from the blow, in world units per second
 */
const BURST_SPEED = 0.45
const BLOW_SPEED = 0.35

/**
 * How fast particles fall in world units per second squared, how much of their speed they keep when they hit the floor, and
 * how much of it along the floor
 */
const GRAVITY = 2.5
const BOUNCE = 0.3
const SLIDE = 0.6

/**
 * Seconds a particle lasts at least and at most, and the share of that in which it shrinks away at the end
 */
const SHORTEST = 0.9
const LONGEST = 1.6
const SHRINK = 0.4

/**
 * Fastest a particle spins, in radians per second
 */
const SPIN = 12

const UP = new Vector3(0, 1, 0)
const rootMatrix = new Matrix4()
const position = new Vector3()
const rotation = new Quaternion()
const scale = new Vector3()
const point = new Vector3()
const outward = new Vector3()


/**
 * Rough part of the volume of a monster, a sphere scaled along its axes, in units of the model and turned with it. The
 * monster is made of the particles that fill it when it dies.
 */
export interface BurstSphere
{
    /** bone it goes with, measured from it, for a part that is still shown moving on after the monster died */
    bone?: string
    x: number
    y: number
    z: number
    /** radius along each axis */
    rx: number
    ry: number
    rz: number
    /** colors the particles take one of, as CSS colors */
    colors: readonly string[]
}

/**
 * Monster that just died, with what is needed to burst it
 */
export interface Death
{
    monster: Monster
    kind: MonsterKind
    x: number
    z: number
    yaw: number
    /** direction of the blow as a meeple facing */
    away: number
    /** share of its volume that bursts, the rest went on in some other way */
    share: number
    /** annihilated, it bursts whole at once */
    smite: boolean
}

export interface Particle
{
    x: number
    y: number
    z: number
    vx: number
    vy: number
    vz: number
    /** axis it spins around, of length 1, and how far it has turned */
    ax: number
    ay: number
    az: number
    spin: number
    turn: number
    size: number
    /** seconds it lasts and has lasted */
    life: number
    age: number
    color: string
}


/**
 * Returns the volume of a burst sphere in cubic world units, for a monster of the given scale
 */
export function sphereVolume({ rx, ry, rz }: BurstSphere, scale: number): number
{
    const factor = scale * MEEPLE_SCALE
    return 4 / 3 * Math.PI * rx * ry * rz * factor * factor * factor
}

/**
 * Returns how many particles fill a burst sphere, or the given share of it
 */
export function particleCount(sphere: BurstSphere, scale: number, share = 1): number
{
    return Math.max(FEWEST, Math.round(sphereVolume(sphere, scale) * share * DENSITY))
}

/**
 * Returns the size of a particle as a share of its full size, which it keeps until it shrinks away at the end
 */
export function sizeShare({ age, life }: Particle): number
{
    return Math.min(1, (life - age) / (life * SHRINK))
}


/**
 * Monsters bursting into particles that fall to the floor and vanish, for all that die without a way of their own. Plain
 * state without the scene.
 */
export default class Bursts
{
    readonly particles: Particle[] = []

    /**
     * Fills the burst spheres of a monster that died with particles, those of its body only. Spheres that go with a bone
     * are left to the view that poses it, see burst().
     */
    add({ kind, x, z, yaw, away, share }: Death): void
    {
        rootMatrix.compose(position.set(x, 0, z), rotation.setFromAxisAngle(UP, yaw), scale.setScalar(kind.scale * MEEPLE_SCALE))
        for (const sphere of kind.burst)
        {
            if (!sphere.bone)
            {
                this.burst(sphere, rootMatrix, away, share)
            }
        }
    }

    /**
     * Fills a burst sphere with particles
     *
     * @param sphere    sphere to fill
     * @param matrix    world matrix of what the sphere is measured from, the model or a bone of it
     * @param away      direction of the blow as a meeple facing
     * @param share     share of the volume that bursts
     */
    burst(sphere: BurstSphere, matrix: Matrix4, away: number, share = 1): void
    {
        const scale = Math.cbrt(Math.abs(matrix.determinant())) / MEEPLE_SCALE
        const blowX = Math.sin(away) * BLOW_SPEED, blowZ = Math.cos(away) * BLOW_SPEED
        const count = particleCount(sphere, scale, share)
        for (let i = 0; i < count; i++)
        {
            // evenly within the unit sphere, then scaled along its axes and placed with the matrix
            let ux: number, uy: number, uz: number
            do
            {
                ux = rng.next(-1, 1)
                uy = rng.next(-1, 1)
                uz = rng.next(-1, 1)
            } while (ux * ux + uy * uy + uz * uz > 1)
            point.set(sphere.x + ux * sphere.rx, sphere.y + uy * sphere.ry, sphere.z + uz * sphere.rz).applyMatrix4(matrix)
            // the outward push turns with it as well
            outward.set(ux, uy, uz).transformDirection(matrix).multiplyScalar(Math.hypot(ux, uy, uz) * BURST_SPEED)
            let ax = rng.next(-1, 1), ay = rng.next(-1, 1), az = rng.next(-1, 1)
            const length = Math.hypot(ax, ay, az) || 1
            ax /= length
            ay /= length
            az /= length
            this.particles.push({
                x: point.x,
                y: point.y,
                z: point.z,
                vx: outward.x + blowX,
                vy: outward.y + rng.next(0, BURST_SPEED),
                vz: outward.z + blowZ,
                ax,
                ay,
                az,
                spin: rng.next(-SPIN, SPIN),
                turn: rng.next(0, Math.PI * 2),
                size: PARTICLE_SIZE * rng.next(0.6, 1.3),
                life: rng.next(SHORTEST, LONGEST),
                age: 0,
                color: sphere.colors[rng.nextInt(0, sphere.colors.length - 1)]
            })
        }
    }

    /**
     * Moves on by a frame
     *
     * @param delta     seconds since the last call
     */
    update(delta: number): void
    {
        const { particles } = this
        for (let i = particles.length - 1; i >= 0; i--)
        {
            const particle = particles[i]
            particle.age += delta
            if (particle.age >= particle.life)
            {
                particles.splice(i, 1)
                continue
            }
            particle.vy -= GRAVITY * delta
            particle.x += particle.vx * delta
            particle.y += particle.vy * delta
            particle.z += particle.vz * delta
            particle.turn += particle.spin * delta
            // it lies on the floor with its lower half
            const floor = particle.size / 2 * sizeShare(particle)
            if (particle.y < floor)
            {
                particle.y = floor
                particle.vy = Math.abs(particle.vy) * BOUNCE
                particle.vx *= SLIDE
                particle.vz *= SLIDE
                particle.spin *= SLIDE
            }
        }
    }
}
