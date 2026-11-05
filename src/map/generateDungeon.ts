import { patchSeed, resetRandom } from "../math/random"
import { type Corridor, findCorridors, setLevelEdges } from "./dungeonCorridors"
import { findRegions, pickRooms } from "./dungeonRooms"
import { FaceType } from "./geometry"
import HexagonPatch, { PATCH_SIZE } from "./HexagonPatch"
import PatchWorld, { LOCAL_MASK, SLOT_SHIFT } from "./PatchWorld"
import { faceCount, packPatch, type QuadPatch } from "./QuadPatch"


/**
 * Default size of a dungeon in patches
 */
export const DUNGEON_WIDTH = 2
export const DUNGEON_HEIGHT = 2

/**
 * Share of the faces of a dungeon that should be the floor of rooms
 */
const PICKED_FLOOR_SHARE = 0.4

const LEVEL_SALT = 0x1e7e


/**
 * Returns the seed of a level behind an entrance. It doesn't depend on the entrance face or the kind of the patch, so
 * the level stays the same if those change.
 *
 * @param parentSeed    seed of the level the entrance is in, the world seed for the overworld
 * @param q             grid position of the patch of the entrance
 * @param r             grid position of the patch of the entrance
 * @param index         tells apart several entrances on one patch
 */
export function levelSeed(parentSeed: number, q: number, r: number, index = 0): number
{
    return patchSeed(parentSeed ^ LEVEL_SALT ^ index, q, r)
}


/**
 * Generated dungeon level
 */
export interface DungeonLevel
{
    /**
     * Packed patches, row by row. Any two patches next to each other in a row or column share a seam.
     */
    patches: QuadPatch[]

    /**
     * Global face ids per region that could be a room, for a PatchWorld with the patches added in order
     */
    regions: number[][]

    /**
     * Global face ids per room
     */
    rooms: number[][]

    /**
     * Corridors between the rooms, their room indexes are positions in rooms
     */
    corridors: Corridor[]
}


/**
 * Generates a dungeon level. All faces start out as NONE, so only what the dungeon sets gets drawn, which so far is the
 * floor of its rooms and corridors. The same seed and size always give the same level.
 *
 * @param seed      seed of the level
 * @param size      hexagon size in map units
 * @param width     number of patches in q-direction
 * @param height    number of patches in r-direction
 *
 * @return generated level
 */
export function generateDungeon(seed: number, size: number, width: number, height: number): DungeonLevel
{
    const patches: QuadPatch[] = []
    for (let r = 0; r < height; r++)
    {
        for (let q = 0; q < width; q++)
        {
            resetRandom(patchSeed(seed, q * PATCH_SIZE, r * PATCH_SIZE))
            const patch = new HexagonPatch(q * PATCH_SIZE, r * PATCH_SIZE, size)
            const faces = patch.build()
            faces.forEach(face => face.type = FaceType.NONE)
            patches.push(packPatch(patch, faces))
        }
    }

    const world = new PatchWorld()
    const slots = patches.map(patch => world.add(patch))
    const regions = findRegions(world, slots)
    const faceTotal = patches.reduce((sum, patch) => sum + faceCount(patch), 0)
    const rooms = pickRooms(regions, faceTotal * PICKED_FLOOR_SHARE).map(index => regions[index])
    const corridors = findCorridors(world, rooms, slots)
    setLevelEdges(world, rooms, corridors)

    for (const face of [...rooms.flat(), ...corridors.flatMap(({ faces }) => faces)])
    {
        patches[face >> (SLOT_SHIFT - 2)].faceType[face & (LOCAL_MASK >> 2)] = FaceType.PAVED.index
    }
    return { patches, regions, rooms, corridors }
}
