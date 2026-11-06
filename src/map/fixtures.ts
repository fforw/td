import type Prando from "prando"

import { SEGMENT_SIZE } from "./dungeonLights"

/**
 * Least distance in world units of a fixture to a way in or out of a room, for it not to stand in the way
 */
const OPENING_DISTANCE = 1.5

/**
 * How far from a wall in world units a fixture may start to still move there
 */
const WALL_REACH = 1

/**
 * Where a fixture stands on the floor of a level, see plans/discovery.md, 3.2
 */
export interface FixtureSpot
{
    /** global id of the face */
    face: number
    x: number
    z: number
    /** direction its front looks at, like the facing of a meeple */
    facing: number
}


function middleOf(centers: readonly (readonly number[])[]): [number, number]
{
    return [
        centers.reduce((sum, [x]) => sum + x, 0) / centers.length,
        centers.reduce((sum, [, z]) => sum + z, 0) / centers.length
    ]
}


function distanceTo(openings: readonly (readonly number[])[], x: number, z: number): number
{
    return Math.min(...openings.map(([ox, oz]) => Math.hypot(ox - x, oz - z)))
}


/**
 * Returns a spot in the outer part of a room, looking toward its middle, null if the whole room is too close to the openings
 *
 * @param room      faces of the room
 * @param openings  centers of the faces to stay away from
 * @param centerOf  returns the center of a face in world units
 * @param random    random numbers
 */
export function outerSpot(
    room: readonly number[],
    openings: readonly (readonly number[])[],
    centerOf: (face: number) => readonly number[],
    random: Prando
): FixtureSpot | null
{
    const centers = room.map(centerOf)
    const [midX, midZ] = middleOf(centers)

    const clear = room.map((face, i) => ({ face, x: centers[i][0], z: centers[i][1] }))
        .filter(({ x, z }) => distanceTo(openings, x, z) >= OPENING_DISTANCE)
        .map(spot => ({ ...spot, out: Math.hypot(spot.x - midX, spot.z - midZ) }))
        .sort((a, b) => b.out - a.out || a.face - b.face)
    if (clear.length === 0)
    {
        return null
    }
    const { face, x, z } = clear[random.nextInt(0, (clear.length - 1) >> 1)]
    return { face, x, z, facing: Math.atan2(midX - x, midZ - z) }
}


/**
 * Returns the spot of a room that is furthest from the openings, for what has to be there even if no spot is good
 *
 * @param room      faces of the room
 * @param openings  centers of the faces to stay away from
 * @param centerOf  returns the center of a face in world units
 */
export function clearestSpot(
    room: readonly number[],
    openings: readonly (readonly number[])[],
    centerOf: (face: number) => readonly number[]
): FixtureSpot
{
    const centers = room.map(centerOf)
    const [midX, midZ] = middleOf(centers)
    const distances = centers.map(([x, z]) => distanceTo(openings, x, z))
    const best = distances.indexOf(Math.max(...distances))
    const [x, z] = centers[best]
    return { face: room[best], x, z, facing: Math.atan2(midX - x, midZ - z) }
}


/**
 * Moves a fixture back against the closest wall, if there is one near enough, with its front looking away from the wall.
 *
 * @param spot      where the fixture stands, gets changed
 * @param segments  walls of the level
 * @param halfDepth half of the depth of the fixture
 */
export function setAgainstWall(spot: FixtureSpot, segments: Float64Array, halfDepth: number): void
{
    const { x, z } = spot
    let closest = WALL_REACH
    for (let s = 0; s < segments.length; s += SEGMENT_SIZE)
    {
        const x0 = segments[s], z0 = segments[s + 1]
        const ex = segments[s + 2] - x0, ez = segments[s + 3] - z0
        const length = Math.hypot(ex, ez)
        const t = Math.max(0, Math.min(1, ((x - x0) * ex + (z - z0) * ez) / (length * length)))
        const distance = Math.hypot(x - (x0 + t * ex), z - (z0 + t * ez))
        if (distance < closest)
        {
            closest = distance
            // straight out of the wall, on the side the fixture is on
            const across = ((x - x0) * -ez + (z - z0) * ex) / length
            const side = across < 0 ? -1 : 1
            const nx = -ez / length * side, nz = ex / length * side
            const back = Math.abs(across) - halfDepth
            spot.x = x - nx * back
            spot.z = z - nz * back
            spot.facing = Math.atan2(nx, nz)
        }
    }
}


/**
 * Returns a segment array with the sides of the given fixtures, to walk around them
 */
export function fixtureSegments(spots: readonly FixtureSpot[], halfWidth: number, halfDepth: number): Float64Array
{
    const segments = new Float64Array(spots.length * 4 * SEGMENT_SIZE)
    spots.forEach(({ x, z, facing }, index) => {
        const sin = Math.sin(facing), cos = Math.cos(facing)
        const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([side, front]) => [
            x + side * halfWidth * cos + front * halfDepth * sin,
            z - side * halfWidth * sin + front * halfDepth * cos
        ])
        corners.forEach(([x0, z0], i) => {
            const [x1, z1] = corners[(i + 1) % 4]
            segments.set([x0, z0, x1, z1, 0, 0], (index * 4 + i) * SEGMENT_SIZE)
        })
    })
    return segments
}
