import Prando from "prando"

/**
 * How close in world units a hero has to come to a stranger to talk to them
 */
export const STRANGER_REACH = 0.6

/**
 * How far apart in world units the hero and a stranger stand in a scene
 */
export const TALK_DISTANCE = 0.8

/**
 * Fewest faces of a room that a stranger stands in, for the camera to have room around them
 */
const MIN_ROOM = 8

/**
 * Added to the seed of a level for where its stranger stands, to not change where anything else goes
 */
const STRANGER_SEED = 0x5a1e

/**
 * Where a stranger stands in a level
 */
export interface StrangerSpot
{
    /** index of the room */
    room: number
    face: number
}


/**
 * Returns where the stranger of a level stands: at the middle of a random room that isn't the one the heroes come in
 * by, a big one if there is any, null for a level without another room
 *
 * @param rooms     faces of each room of the level
 * @param entrance  index of the room the heroes come in by
 * @param center    returns the center of a face
 * @param seed      seed of the level
 */
export function placeStranger(
    rooms: readonly (readonly number[])[],
    entrance: number,
    center: (face: number) => [number, number],
    seed: number
): StrangerSpot | null
{
    const others = rooms.map((_, index) => index).filter(index => index !== entrance)
    const big = others.filter(index => rooms[index].length >= MIN_ROOM)
    const pool = big.length ? big : others
    if (!pool.length)
    {
        return null
    }
    const room = pool[new Prando(seed + STRANGER_SEED).nextInt(0, pool.length - 1)]
    const faces = rooms[room]
    const centers = faces.map(center)
    const middleX = centers.reduce((sum, [x]) => sum + x, 0) / faces.length
    const middleZ = centers.reduce((sum, [, z]) => sum + z, 0) / faces.length
    let face = faces[0], best = Infinity
    centers.forEach(([x, z], i) => {
        const distance = Math.hypot(x - middleX, z - middleZ)
        if (distance < best)
        {
            best = distance
            face = faces[i]
        }
    })
    return { room, face }
}
