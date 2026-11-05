import { rng } from "../math/random"
import PatchWorld from "./PatchWorld"
import { faceCount, faceOf, prev } from "./QuadPatch"
import { globalFace } from "./route"

/*
 * Rooms of a dungeon level, found in the mesh of its connected patches. See plans/discovery.md, 3.4.
 */

/**
 * A vertex with this many quads around it or more is irregular, the faces touching it end up in the walls
 */
const IRREGULAR_QUADS = 5

/**
 * Minimum number of faces of a region to be a room
 */
const MIN_ROOM_FACES = 8


/**
 * Returns the number of quads around the start vertex of the given global half edge, Infinity for a vertex on the outer
 * edge of the level.
 */
function quadsAround(world: PatchWorld, h: number): number
{
    let count = 0
    let curr = h
    do
    {
        count++
        curr = world.twin(prev(curr))
        if (curr < 0)
        {
            return Infinity
        }
    } while (curr !== h)
    return count
}


/**
 * Returns the connected regions of the faces that don't touch an irregular vertex or the outer edge of the level. Two
 * regions can't share an edge, but they can touch at a corner.
 *
 * @param world     world with all patches of the level
 * @param slots     slots of the patches of the level
 *
 * @return global face ids per region, in the order of their first face
 */
export function findRegions(world: PatchWorld, slots: readonly number[]): number[][]
{
    const floor = new Set<number>()
    for (const slot of slots)
    {
        const count = faceCount(world.getPatch(slot))
        for (let local = 0; local < count; local++)
        {
            const face = globalFace(slot, local)
            let regular = true
            for (let i = 0; i < 4 && regular; i++)
            {
                regular = quadsAround(world, face * 4 + i) < IRREGULAR_QUADS
            }
            if (regular)
            {
                floor.add(face)
            }
        }
    }

    const regions: number[][] = []
    for (const start of floor)
    {
        // a set keeps its entries in the order they were added, and deleting visited faces leaves the unseen ones
        if (floor.delete(start))
        {
            const region = [start]
            for (let at = 0; at < region.length; at++)
            {
                for (let i = 0; i < 4; i++)
                {
                    const other = faceOf(world.twin(region[at] * 4 + i))
                    if (floor.delete(other))
                    {
                        region.push(other)
                    }
                }
            }
            regions.push(region)
        }
    }
    return regions
}


/**
 * Picks regions to be rooms, the largest ones first since that gets a level to its floor with the fewest rooms. Rooms
 * can touch at a corner, only crossing an edge leads from one face to another.
 *
 * @param regions       regions of the level
 * @param floorFaces    number of faces the rooms should have together, it can be less if the level has no room for them
 *
 * @return indexes of the regions picked
 */
export function pickRooms(regions: readonly number[][], floorFaces: number): number[]
{
    const candidates = regions.flatMap((faces, index) => faces.length >= MIN_ROOM_FACES ? [index] : [])
    candidates.sort((a, b) => regions[b].length - regions[a].length || a - b)

    const rooms: number[] = []
    let faces = 0
    for (const index of candidates)
    {
        if (faces >= floorFaces)
        {
            break
        }
        rooms.push(index)
        faces += regions[index].length
    }
    return rooms
}


/**
 * Grows rooms into the wall, one random face next to a random room at a time. Picking the room first makes all rooms
 * grow alike, while picking from all faces next to any room would favor the large ones. Rooms stay off the outer edge of
 * the level.
 *
 * @param world         world with all patches of the level
 * @param rooms         global face ids per room
 * @param floorFaces    number of faces the rooms should have together, it can be less if the level has no room for them
 * @param blocked       faces rooms can't grow into
 *
 * @return global face ids per room with the new faces added
 */
export function growRooms(
    world: PatchWorld,
    rooms: readonly number[][],
    floorFaces: number,
    blocked: ReadonlySet<number> = new Set()
): number[][]
{
    const grown = rooms.map(faces => [...faces])
    const taken = new Set(rooms.flat())
    let count = taken.size

    const neighbors = (face: number) => [0, 1, 2, 3].flatMap(i => {
        const twin = world.twin(face * 4 + i)
        return twin < 0 ? [] : [faceOf(twin)]
    })
    const frontiers = grown.map((faces, room) => ({ room, faces: faces.flatMap(neighbors) }))

    while (count < floorFaces && frontiers.length > 0)
    {
        const at = rng.nextInt(0, frontiers.length - 1)
        const { room, faces } = frontiers[at]
        if (faces.length === 0)
        {
            frontiers.splice(at, 1)
            continue
        }

        const pick = rng.nextInt(0, faces.length - 1)
        const face = faces[pick]
        faces[pick] = faces[faces.length - 1]
        faces.pop()

        const around = neighbors(face)
        if (!taken.has(face) && !blocked.has(face) && around.length === 4)
        {
            taken.add(face)
            grown[room].push(face)
            faces.push(...around)
            count++
        }
    }
    return grown
}
