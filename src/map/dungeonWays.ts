import { faceCenter } from "./dungeonLights"
import type { DungeonLevel } from "./generateDungeon"
import type PatchWorld from "./PatchWorld"
import { LOCAL_MASK } from "./PatchWorld"
import { faceOf } from "./QuadPatch"
import { DEFAULT_COSTS, EDGE_COSTS, findRoute, slotOf } from "./route"


/**
 * Returns the face of a level someone comes in at: the one closest to the middle of its largest room, which is the first
 * to get a light.
 */
export function entranceFace(world: PatchWorld, { rooms }: Pick<DungeonLevel, "rooms">): number
{
    const centers = rooms[0].map(face => faceCenter(world, face))
    const midX = centers.reduce((sum, [x]) => sum + x, 0) / centers.length
    const midZ = centers.reduce((sum, [, z]) => sum + z, 0) / centers.length
    const distances = centers.map(([x, z]) => Math.hypot(x - midX, z - midZ))
    return rooms[0][distances.indexOf(Math.min(...distances))]
}


/**
 * Returns the faces of the shortest way between two faces of a level, null if there is none
 *
 * @param world     world with all patches of the level
 * @param slots     slots of the patches of the level
 * @param from      global id of the face to start on
 * @param to        global id of the face to get to
 */
export function findFaces(world: PatchWorld, slots: readonly number[], from: number, to: number): number[] | null
{
    const { reachable, paths } = findRoute(world, from, slotOf(to), [to & (LOCAL_MASK >> 2)], slots)
    return reachable ? paths[0] : null
}


/**
 * Returns the face next to the given one that lies most in the given direction and can be walked to, if any.
 *
 * @param world     world with all patches of the level
 * @param face      global id of the face
 * @param x         direction in world units
 * @param z         direction in world units
 */
export function nextFace(world: PatchWorld, face: number, x: number, z: number): number | null
{
    const [cx, cz] = faceCenter(world, face)
    const length = Math.hypot(x, z)
    let best: number | null = null
    // at least closer to the direction than to a right angle of it
    let bestShare = Math.SQRT1_2
    for (let h = face * 4; h < face * 4 + 4; h++)
    {
        const twin = world.twin(h)
        if (twin < 0)
        {
            continue
        }
        const other = faceOf(twin)
        if (EDGE_COSTS[world.edgeType(h)] + DEFAULT_COSTS[world.faceType(other)] < Infinity)
        {
            const [ox, oz] = faceCenter(world, other)
            const share = ((ox - cx) * x + (oz - cz) * z) / (Math.hypot(ox - cx, oz - cz) * length)
            if (share > bestShare)
            {
                best = other
                bestShare = share
            }
        }
    }
    return best
}
