import { rng } from "../math/random"
import { FIRE_ACTIVE, FIRE_FADE, FIRE_FALL, FIRE_WARN } from "../render/fireTiming"
import { FIRE_RADIUS, type FireSpot } from "./firePatterns"

/**
 * Distance fire keeps to the walls, as a share of its radius
 */
const FIRE_CLEARANCE = 0.5

/**
 * Fire that is to strike, strikes, or burns out
 */
export interface FireDrop
{
    x: number
    z: number
    radius: number
    damage: number
    /** seconds since it struck, negative before that */
    age: number
    /** varies its flames, from 0 to 1 */
    random: number
}

/**
 * What fire needs to know about the level
 */
export interface FireFloor
{
    /**
     * Returns whether there is no wall between two points
     */
    sees(x0: number, z0: number, x1: number, z1: number): boolean

    /**
     * Returns the distance to the closest wall, at least up to FIRE_RADIUS
     */
    wallDistance(x: number, z: number): number
}


/**
 * Fire coming down in a level, whoever or whatever sends it. Its spots show as outlines on the floor before it strikes.
 */
export default class FireRain
{
    readonly drops: FireDrop[] = []

    constructor(private readonly floor: FireFloor)
    {
    }

    /**
     * Has fire come down on the spots that are on open floor, on the same side of the walls as the given point. The
     * first ones strike FIRE_WARN seconds later, and each shows on the floor for about as long before it strikes.
     *
     * @param spots     where and in which order, see FIRE_PATTERNS
     * @param x         what they are laid out around
     * @param z         what they are laid out around
     * @param damage    hit points a strike takes
     */
    cast(spots: readonly FireSpot[], x: number, z: number, damage: number): void
    {
        const { floor, drops } = this
        for (const spot of spots)
        {
            if (floor.wallDistance(spot.x, spot.z) >= FIRE_CLEARANCE * FIRE_RADIUS && floor.sees(x, z, spot.x, spot.z))
            {
                drops.push({
                    x: spot.x,
                    z: spot.z,
                    radius: FIRE_RADIUS,
                    damage,
                    age: -FIRE_WARN - spot.delay,
                    random: rng.next()
                })
            }
        }
    }

    /**
     * Leaves out what hasn't started to fall yet
     */
    cancel(): void
    {
        const { drops } = this
        drops.splice(0, drops.length, ...drops.filter(({ age }) => age >= -FIRE_FALL))
    }

    update(delta: number): void
    {
        const { drops } = this
        for (let i = drops.length - 1; i >= 0; i--)
        {
            const drop = drops[i]
            drop.age += delta
            if (drop.age >= FIRE_FADE)
            {
                drops.splice(i, 1)
            }
        }
    }

    /**
     * Returns the hit points fire takes from someone at the given point right now
     */
    damageAt(px: number, pz: number): number
    {
        let most = 0
        for (const { x, z, radius, age, damage } of this.drops)
        {
            if (age >= 0 && age < FIRE_ACTIVE && damage > most && Math.hypot(px - x, pz - z) < radius && this.floor.sees(x, z, px, pz))
            {
                most = damage
            }
        }
        return most
    }
}
