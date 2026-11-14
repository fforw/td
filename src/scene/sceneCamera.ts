import { Vector3 } from "three"

import type { ActorRole, ShotName } from "./script"

/**
 * A camera position relative to the two main actors of a scene. It keeps the 180-degree rule: the camera stays on one
 * side of the line between them, on a half circle around the middle of the two, so whoever is left on the screen stays
 * left.
 */
export interface Shot
{
    /** degrees around the middle of the actors, from the direction of a (0) to that of b (180) */
    angle: number
    /** world units beyond half the gap between the actors, away from the middle */
    back: number
    /** height of the camera above the floor */
    height: number
    /** where along the way from a (0) to b (1) the camera looks */
    look: number
    /** height it looks at */
    lookHeight: number
}

/**
 * Closest the angle of a shot gets to the line of action, in degrees. On it, one actor would hide the other.
 */
export const MIN_ANGLE = 5

/**
 * Shots of a scene. Meeples are about 0.25 tall to the middle of the head.
 */
export const SHOTS: Record<ShotName, Shot> = {
    // both from the side, a bit from above
    two: { angle: 90, back: 1.1, height: 0.55, look: 0.5, lookHeight: 0.18 },
    // from behind a, looking at b
    overA: { angle: 18, back: 0.45, height: 0.32, look: 0.8, lookHeight: 0.22 },
    // from behind b, looking at a
    overB: { angle: 162, back: 0.45, height: 0.32, look: 0.2, lookHeight: 0.22 }
}

const along = new Vector3()
const across = new Vector3()


/**
 * Places a camera for a shot of the two main actors
 *
 * @param a         where actor a stands
 * @param b         where actor b stands
 * @param left      which of them is on the left of the screen
 * @param shot      the shot
 * @param position  gets the camera position
 * @param target    gets the point the camera looks at
 */
export function placeShot(a: Vector3, b: Vector3, left: ActorRole, shot: Shot, position: Vector3, target: Vector3): void
{
    along.set(a.x - b.x, 0, a.z - b.z)
    const half = along.length() / 2
    if (half > 0)
    {
        along.divideScalar(half * 2)
    }
    else
    {
        along.set(1, 0, 0)
    }
    // looking from the camera on this side toward the middle, a is on the left. For b on the left, the other side.
    const sign = left === "a" ? 1 : -1
    across.set(along.z * sign, 0, -along.x * sign)

    const angle = Math.min(180 - MIN_ANGLE, Math.max(MIN_ANGLE, shot.angle)) * Math.PI / 180
    const radius = half + shot.back
    position.set(
        (a.x + b.x) / 2 + (along.x * Math.cos(angle) + across.x * Math.sin(angle)) * radius,
        shot.height,
        (a.z + b.z) / 2 + (along.z * Math.cos(angle) + across.z * Math.sin(angle)) * radius
    )
    target.set(a.x + (b.x - a.x) * shot.look, shot.lookHeight, a.z + (b.z - a.z) * shot.look)
}


/**
 * Returns a shot on the way from one to another. It goes along the half circle, so it never crosses the line of action.
 *
 * @param t     0 for from, 1 for to
 */
export function blendShots(from: Shot, to: Shot, t: number, out: Shot = { ...from }): Shot
{
    const s = t * t * (3 - 2 * t)
    out.angle = from.angle + (to.angle - from.angle) * s
    out.back = from.back + (to.back - from.back) * s
    out.height = from.height + (to.height - from.height) * s
    out.look = from.look + (to.look - from.look) * s
    out.lookHeight = from.lookHeight + (to.lookHeight - from.lookHeight) * s
    return out
}
