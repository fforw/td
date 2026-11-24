import { FIGURE_SCALE } from "../meeple/figureScale"

/**
 * Radius of a sigil in world units
 */
export const SIGIL_RADIUS = 0.45 * FIGURE_SCALE

/**
 * Distance a sigil should keep to the walls, as a share of its radius, so not much of it goes to waste under them
 */
export const SIGIL_CLEARANCE = 0.75

/**
 * How far from a hero the middle of their sigil may be at most, as a share of its radius, so they always stand well in it
 */
export const SIGIL_REACH = 0.8

/**
 * Spots to try around a hero: rings up to SIGIL_REACH, and directions on each
 */
const RINGS = 8
const DIRECTIONS = 16

/**
 * How much clearance, in units of the distance from the hero, it must gain to move further off where there is not enough
 */
const SHIFT_COST = 0.1

/**
 * A sigil on the floor
 */
export interface SigilState
{
    x: number
    z: number
    radius: number
    damage: number
    /** seconds since it was cast */
    age: number
    /** seconds since the wizard was put off before it was done, null if not */
    broken: number | null
    /** varies its hue, from 0 to 1 */
    hue: number
}

/**
 * What placing a sigil needs to know about the level
 */
export interface SigilFloor
{
    /**
     * Returns whether there is no wall between two points
     */
    sees(x0: number, z0: number, x1: number, z1: number): boolean

    /**
     * Returns the distance to the closest wall, at least up to SIGIL_RADIUS
     */
    wallDistance(x: number, z: number): number
}


/**
 * Returns where to put a sigil for a hero: as close to them as it can get with enough distance to the walls, or where there
 * is no such spot, about as far from the walls as possible. They are always within it, and on the same side of the walls.
 */
export function placeSigil(floor: SigilFloor, x: number, z: number, radius: number): [x: number, z: number]
{
    const wanted = SIGIL_CLEARANCE * radius
    let best: [number, number] = [x, z]
    let bestScore = floor.wallDistance(x, z)
    if (bestScore >= wanted)
    {
        return best
    }
    for (let ring = 1; ring <= RINGS; ring++)
    {
        const shift = ring / RINGS * SIGIL_REACH * radius
        let clearest = -Infinity
        let spot = best
        for (let i = 0; i < DIRECTIONS; i++)
        {
            const angle = i / DIRECTIONS * Math.PI * 2
            const sx = x + Math.sin(angle) * shift, sz = z + Math.cos(angle) * shift
            const clearance = floor.wallDistance(sx, sz)
            if (clearance > clearest && floor.sees(x, z, sx, sz))
            {
                clearest = clearance
                spot = [sx, sz]
            }
        }
        if (clearest >= wanted)
        {
            return spot
        }
        const score = clearest - SHIFT_COST * shift
        if (score > bestScore)
        {
            best = spot
            bestScore = score
        }
    }
    return best
}
