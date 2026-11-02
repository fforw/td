import { BufferGeometry, SphereGeometry, type Vector3 } from "three"

// plain geometry builders without enums or DOM access, so scripts/exportMeeple.ts can run them in Node

const BODY_RADIUS = 0.27
const BODY_STRETCH = 1.15
export const HEAD_RADIUS = 0.3

/**
 * Head center height of the exported meeple, which the hair models are placed around. Like in 2D, the height of a
 * meeple only moves its head up or down.
 */
export const HEAD_Y = 0.78

const HEAD_COLUMNS = 14
const HEAD_ROWS = 10


export function createBodyGeometry(): BufferGeometry
{
    const geometry = new SphereGeometry(BODY_RADIUS, 12, 8)
    // flat bottom so the egg stands on the ground
    geometry.scale(1, BODY_STRETCH, 1)
    geometry.translate(0, BODY_RADIUS * BODY_STRETCH, 0)
    return geometry
}


/**
 * Sets a point on the surface of the body and the surface normal there, for a meeple facing +z.
 *
 * @param height height on the body from 0 at the bottom to 1 at the top
 * @param angle  angle in radians around the vertical, from the front toward the meeple's right, which is -x
 * @param point  receives the point
 * @param normal receives the normal
 */
export function bodySurface(height: number, angle: number, point: Vector3, normal: Vector3): void
{
    const sinLat = height * 2 - 1
    const cosLat = Math.sqrt(1 - sinLat * sinLat)
    const x = -Math.sin(angle) * cosLat
    const z = Math.cos(angle) * cosLat
    point.set(x * BODY_RADIUS, (sinLat + 1) * BODY_RADIUS * BODY_STRETCH, z * BODY_RADIUS)
    normal.set(x, sinLat / BODY_STRETCH, z).normalize()
}


export function createHeadGeometry(): BufferGeometry
{
    return new SphereGeometry(HEAD_RADIUS, HEAD_COLUMNS, HEAD_ROWS)
}


/**
 * Rows of short hair per head column, counted from the top in half quads, from the column in the middle of the face
 * around to the one at the back. Both sides of the head mirror this.
 */
const HAIRLINE = [3, 3, 3.5, 5.5, 6, 6, 6, 6]

/**
 * Head column in the middle of the face. SphereGeometry starts its columns at -x and goes toward +z.
 */
const FACE_COLUMN = 3


/**
 * Hair painted onto the head: a copy of the head faces above a stepped hairline, drawn in front of the head with a
 * polygon offset.
 */
export function createShortHair(): BufferGeometry
{
    const geometry = createHeadGeometry()
    const row = HEAD_COLUMNS + 1
    const indices: number[] = []
    for (let ix = 0; ix < HEAD_COLUMNS; ix++)
    {
        // signed number of columns from the face column, -6 to 7
        const k = ((ix - FACE_COLUMN) % HEAD_COLUMNS + HEAD_COLUMNS + HEAD_COLUMNS / 2) % HEAD_COLUMNS - HEAD_COLUMNS / 2
        const depth = HAIRLINE[Math.abs(k)]
        for (let iy = 0; iy < depth; iy++)
        {
            const a = iy * row + ix + 1
            const b = iy * row + ix
            const c = (iy + 1) * row + ix
            const d = (iy + 1) * row + ix + 1
            if (iy + 1 > depth)
            {
                // half a quad: the upper triangle, its lower corner on the side away from the face, so the hairline
                // runs down toward the back on both sides
                indices.push(a, b, k < 0 ? c : d)
            }
            else if (iy === 0)
            {
                // a and b are both the pole, like SphereGeometry only keep the lower triangle
                indices.push(b, c, d)
            }
            else
            {
                indices.push(a, b, d, b, c, d)
            }
        }
    }
    geometry.setIndex(indices)
    return geometry
}
