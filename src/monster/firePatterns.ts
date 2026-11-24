import { rng } from "../math/random"
import { FIGURE_SCALE } from "../meeple/figureScale"

const TAU = Math.PI * 2

/**
 * Radius in world units in which fire hurts where it strikes
 */
export const FIRE_RADIUS = 0.16 * FIGURE_SCALE

/**
 * Number of strikes scattered around the target, how far from it, and the seconds over which they come down
 */
const SCATTER_COUNT = 16
const SCATTER_REACH = 0.9 * FIGURE_SCALE
const SCATTER_TIME = 1.2

/**
 * Distance the scattered strikes should keep from each other, and how often to try a spot for it
 */
const SCATTER_GAP = 1.6 * FIRE_RADIUS
const SCATTER_TRIES = 12

/**
 * Distance between the strikes of a line, how far off the caster it starts, how far behind the target it goes on, and the
 * seconds from one strike to the next
 */
const LINE_GAP = 1.75 * FIRE_RADIUS
const LINE_START = 0.3 * FIGURE_SCALE
const LINE_BEHIND = 1.2 * FIGURE_SCALE
const LINE_TIME = 0.09

/**
 * Radii of the rings in the order they strike. The strikes of the last one overlap in the middle, so nobody can just stay
 * there.
 */
const RING_RADII = [5.4, 3.1, 0.8].map(radius => radius * FIRE_RADIUS)

/**
 * Distance between the strikes of a ring, and the seconds from one ring to the next
 */
const RING_GAP = 2.4 * FIRE_RADIUS
const RING_MIN = 3
const RING_TIME = 0.6

/**
 * Where fire is to strike, and how many seconds after the first strikes can
 */
export interface FireSpot
{
    x: number
    z: number
    delay: number
}

/**
 * Who fire comes down on, and where it comes from, in world units
 */
export interface FireAim
{
    x: number
    z: number
    fromX: number
    fromZ: number
}

/**
 * Lays out strikes. It doesn't need to mind walls, see FireRain.cast().
 */
export type FirePattern = (aim: FireAim) => FireSpot[]


/**
 * Around the target in random order, with one right on it
 */
function scatter({ x, z }: FireAim): FireSpot[]
{
    const spots: FireSpot[] = [{ x, z, delay: rng.next(0, SCATTER_TIME) }]
    for (let i = 1; i < SCATTER_COUNT; i++)
    {
        let best: FireSpot | null = null
        let bestGap = -1
        for (let j = 0; j < SCATTER_TRIES && bestGap < SCATTER_GAP; j++)
        {
            const angle = rng.next(0, TAU)
            const distance = Math.sqrt(rng.next()) * SCATTER_REACH
            const spot = { x: x + Math.sin(angle) * distance, z: z + Math.cos(angle) * distance, delay: rng.next(0, SCATTER_TIME) }
            const gap = Math.min(...spots.map(other => Math.hypot(other.x - spot.x, other.z - spot.z)))
            if (gap > bestGap)
            {
                best = spot
                bestGap = gap
            }
        }
        spots.push(best!)
    }
    return spots
}

/**
 * A line from where it comes from, far away from the target, towards it and through it. One strike is right on it.
 */
function line({ x, z, fromX, fromZ }: FireAim): FireSpot[]
{
    const distance = Math.hypot(x - fromX, z - fromZ)
    const [dx, dz] = distance > 1e-6 ? [(x - fromX) / distance, (z - fromZ) / distance] : [0, 1]
    const before = Math.max(0, Math.floor((distance - LINE_START) / LINE_GAP))
    const behind = Math.floor(LINE_BEHIND / LINE_GAP)
    const spots: FireSpot[] = []
    for (let i = -before; i <= behind; i++)
    {
        spots.push({ x: x + dx * i * LINE_GAP, z: z + dz * i * LINE_GAP, delay: (i + before) * LINE_TIME })
    }
    return spots
}

/**
 * Three rings around the target, from the outermost to the innermost
 */
function rings({ x, z }: FireAim): FireSpot[]
{
    return RING_RADII.flatMap((radius, ring) => {
        const count = Math.max(RING_MIN, Math.round(TAU * radius / RING_GAP))
        const turn = rng.next(0, TAU)
        return Array.from({ length: count }, (_, i) => {
            const angle = turn + i / count * TAU
            return { x: x + Math.sin(angle) * radius, z: z + Math.cos(angle) * radius, delay: ring * RING_TIME }
        })
    })
}

/**
 * Everything fire can rain in, to add further shapes to
 */
export const FIRE_PATTERNS = { scatter, line, rings } satisfies Record<string, FirePattern>

export type FirePatternName = keyof typeof FIRE_PATTERNS

export const FIRE_PATTERN_NAMES = Object.keys(FIRE_PATTERNS) as FirePatternName[]
