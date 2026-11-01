import { BufferGeometry, SphereGeometry } from "three"
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"

// plain geometry builders without enums or DOM access, so scripts/exportMeeple.ts can run them in Node

const TAU = Math.PI * 2

const BODY_RADIUS = 0.27
const BODY_STRETCH = 1.15
export const HEAD_RADIUS = 0.3

/**
 * Head center height for a meeple of height 0. Like in 2D, the height only moves the head up.
 */
export const HEAD_Y = 0.78


export function createBodyGeometry(): BufferGeometry
{
    const geometry = new SphereGeometry(BODY_RADIUS, 12, 8)
    // flat bottom so the egg stands on the ground
    geometry.scale(1, BODY_STRETCH, 1)
    geometry.translate(0, BODY_RADIUS * BODY_STRETCH, 0)
    return geometry
}


export function createHeadGeometry(): BufferGeometry
{
    return new SphereGeometry(HEAD_RADIUS, 14, 10)
}


export function createCurlyHair(): BufferGeometry
{
    // overlapping lumps over the top and back of the head, leaving the face free
    const lumps: BufferGeometry[] = []
    const r = HEAD_RADIUS * 1.02
    for (let ring = 0; ring < 3; ring++)
    {
        const elevation = 0.35 + ring * 0.42
        const count = [9, 7, 3][ring]
        for (let i = 0; i < count; i++)
        {
            const azimuth = (i + ring * 0.5) / count * TAU
            const front = Math.cos(azimuth)
            // skip the forehead in the lowest ring
            if (ring === 0 && front > 0.3)
            {
                continue
            }
            const lump = new SphereGeometry(HEAD_RADIUS * (ring === 2 ? 0.42 : 0.36), 7, 5)
            const ce = Math.cos(elevation)
            lump.translate(
                Math.sin(azimuth) * ce * r,
                Math.sin(elevation) * r,
                front * ce * r
            )
            lumps.push(lump)
        }
    }
    const geometry = mergeGeometries(lumps)
    lumps.forEach(l => l.dispose())
    return geometry
}


export function createShortHair(): BufferGeometry
{
    // a cap tilted back so it covers the back of the head but leaves the forehead visible
    const geometry = new SphereGeometry(HEAD_RADIUS * 1.08, 12, 6, 0, TAU, 0, Math.PI * 0.42)
    geometry.rotateX(-0.45)
    return geometry
}
