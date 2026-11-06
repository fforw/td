import { patchSeed, resetRandom, withSeed } from "../math/random"
import { type Corridor, findCorridors, setLevelEdges } from "./dungeonCorridors"
import type { LevelLighting } from "./dungeonLights"
import { findRegions, growRooms, pickRooms } from "./dungeonRooms"
import { FaceType } from "./geometry"
import HexagonPatch, { PATCH_SIZE } from "./HexagonPatch"
import PatchWorld, { LOCAL_MASK, SLOT_SHIFT } from "./PatchWorld"
import { faceCount, faceOf, next, packPatch, prev, type QuadPatch } from "./QuadPatch"


/**
 * Default size of a dungeon in patches
 */
export const DUNGEON_WIDTH = 2
export const DUNGEON_HEIGHT = 2

/**
 * Share of the faces of a dungeon that should be the floor of rooms when they are picked, which takes nearly all regions
 */
const PICKED_FLOOR_SHARE = 0.4

/**
 * What a dungeon looks like, which can differ per dungeon without changing how it gets generated
 */
export interface DungeonStyle
{
    /**
     * Share of the faces that should be the floor of rooms after growing them, at least the 40% rooms start out with:
     * from rooms apart in a lot of wall to a warren with little but wall edges between them.
     */
    floorShare: number

    /**
     * Number of rooms per patch that get connected first, each by a corridor winding through the wall between all the
     * other rooms. 0 leaves only short connections between neighbors, 1 gives a few very long corridors and 5 many of
     * medium length. It's no use going further: the rooms get closer together, and once there are about 80 of them per
     * level, which is all of them, it's back to short connections.
     */
    labyrinth: number
}


export const DEFAULT_DUNGEON_STYLE: DungeonStyle = {
    floorShare: 0.6,
    labyrinth: 2.5
}

const LEVEL_SALT = 0x1e7e
const ROOM_SALT = 0x4004


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
     * Global face ids per room, which grew out of the largest regions
     */
    rooms: number[][]

    /**
     * Corridors between the rooms, their room indexes are positions in rooms
     */
    corridors: Corridor[]

    /**
     * Baked light of the level, if it was asked for
     */
    lighting?: LevelLighting
}


/**
 * Generates a dungeon level. All faces start out as NONE, so only what the dungeon sets gets drawn: the floor of its rooms
 * and corridors and the thick walls around it, which are the faces next to the floor. Where floor touches floor, wall
 * edges separate it. The same seed and size always give the same level.
 *
 * @param seed      seed of the level
 * @param size      hexagon size in map units
 * @param width     number of patches in q-direction
 * @param height    number of patches in r-direction
 * @param style     what the level looks like, the default for what is left out
 *
 * @return generated level
 */
export function generateDungeon(
    seed: number,
    size: number,
    width: number,
    height: number,
    style: Partial<DungeonStyle> = {}
): DungeonLevel
{
    const { floorShare, labyrinth } = { ...DEFAULT_DUNGEON_STYLE, ...style }

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
    const picked = pickRooms(regions, faceTotal * PICKED_FLOOR_SHARE).map(index => regions[index])
    const corridors = findCorridors(world, picked, slots, Math.round(width * height * labyrinth))

    // corridors come first, growing rooms would eat the way for them and leave nothing but doors between rooms
    const corridorFaces = corridors.flatMap(({ faces }) => faces)
    const rooms = withSeed(
        patchSeed(seed ^ ROOM_SALT, 0, 0),
        () => growRooms(world, picked, faceTotal * floorShare, new Set(corridorFaces))
    )
    setLevelEdges(world, rooms, corridors)

    const floor = [...rooms.flat(), ...corridorFaces]
    const setFaceType = (face: number, type: FaceType) => {
        patches[face >> (SLOT_SHIFT - 2)].faceType[face & (LOCAL_MASK >> 2)] = type.index
    }
    floor.forEach(face => setFaceType(face, FaceType.PAVED))

    // also around the corners, the ground of the floor reaches into faces that only touch it there and would leave holes in the walls
    const setWall = (h: number) => {
        const other = faceOf(h)
        if (world.faceType(other) === FaceType.NONE.index)
        {
            setFaceType(other, FaceType.WALL)
        }
    }
    for (const face of floor)
    {
        for (let start = face * 4; start < face * 4 + 4; start++)
        {
            // around the corner the half edge starts at. Floor has no outer edge of the level, but what is around it can have one,
            // so without getting back around it goes the other way as well.
            let h = start
            do
            {
                setWall(h)
                const twin = world.twin(h)
                h = twin < 0 ? -1 : next(twin)
            } while (h >= 0 && h !== start)

            if (h < 0)
            {
                for (let twin = world.twin(prev(start)); twin >= 0; twin = world.twin(prev(twin)))
                {
                    setWall(twin)
                }
            }
        }
    }
    return { patches, regions, rooms, corridors }
}
