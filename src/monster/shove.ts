/**
 * Seconds in which a shove dies down to about a third, from the feet dragging on the floor
 */
export const SHOVE_TIME = 0.15

/**
 * Share of the speed at which two bump into each other that they fly apart with, 0 has them go on together, 1 bounces them
 * off without any loss
 */
export const BOUNCE = 0.3

/**
 * Mass of a hero, which those of monsters are measured against
 */
export const HERO_MASS = 1

/**
 * Something round that gets shoved around on the floor, with world units on a 2D plane
 */
export interface Body
{
    x: number
    z: number
    /** how fast it moved in the last frame, in world units per second, both from going on its own and from shoves */
    vx: number
    vz: number
    /** speed it got from shoves, in world units per second, which dies down on its own */
    shoveX: number
    shoveZ: number
    radius: number
    mass: number
}

/**
 * Shove speed in world units per second below which it stops altogether
 */
const SHOVE_STOP = 1e-3

/**
 * Has a shove die down over the given seconds
 */
export function fadeShove(shoved: { shoveX: number, shoveZ: number }, delta: number): void
{
    const left = Math.exp(-delta / SHOVE_TIME)
    shoved.shoveX *= left
    shoved.shoveZ *= left
    if (Math.hypot(shoved.shoveX, shoved.shoveZ) < SHOVE_STOP)
    {
        shoved.shoveX = 0
        shoved.shoveZ = 0
    }
}

/**
 * Has two bodies that overlap bump into each other: they move out of each other, the lighter one more, and if they come
 * closer, they trade momentum along the line between them, so that the momentum of both together stays the same. The faster
 * they meet, the harder they shove each other, which goes into their shove speeds.
 *
 * @return whether they touched
 */
export function bump(a: Body, b: Body): boolean
{
    let nx = b.x - a.x, nz = b.z - a.z
    const distance = Math.hypot(nx, nz)
    const depth = a.radius + b.radius - distance
    if (depth <= 0)
    {
        return false
    }
    if (distance > 1e-9)
    {
        nx /= distance
        nz /= distance
    }
    else
    {
        // right on top of each other, any way apart will do
        nx = 0
        nz = 1
    }
    const inverseA = 1 / a.mass, inverseB = 1 / b.mass
    const inverse = inverseA + inverseB

    a.x -= nx * depth * inverseA / inverse
    a.z -= nz * depth * inverseA / inverse
    b.x += nx * depth * inverseB / inverse
    b.z += nz * depth * inverseB / inverse

    const closing = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz
    if (closing < 0)
    {
        const impulse = -(1 + BOUNCE) * closing / inverse
        push(a, -nx * impulse * inverseA, -nz * impulse * inverseA)
        push(b, nx * impulse * inverseB, nz * impulse * inverseB)
    }
    return true
}

function push(body: Body, dvx: number, dvz: number): void
{
    body.vx += dvx
    body.vz += dvz
    body.shoveX += dvx
    body.shoveZ += dvz
}
