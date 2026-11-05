import { EdgeType } from "./geometry"
import PatchWorld, { SLOT_SHIFT } from "./PatchWorld"
import { faceOf } from "./QuadPatch"
import { FaceHeap } from "./route"

/*
 * Corridors between the rooms of a dungeon level. They are one face wide and don't need any wall faces next to them:
 * wall edges keep them apart from everything they run along, like they keep rooms apart that touch. See
 * plans/discovery.md, 3.4.
 */

/**
 * Corridor between two rooms
 */
export interface Corridor
{
    /**
     * Indexes of the rooms it connects
     */
    from: number
    to: number

    /**
     * Global face ids of the corridor in the order of walking from one room to the other, without the faces of the rooms
     */
    faces: number[]

    /**
     * Global ids of the faces of the rooms that the doors at its ends lead to
     */
    fromFace: number
    toFace: number
}


/**
 * Returns the center of the given global face in map units
 */
function faceCenter(world: PatchWorld, face: number): [number, number]
{
    const position = [0, 0, 0]
    let x = 0, y = 0
    for (let i = 0; i < 4; i++)
    {
        world.position(face * 4 + i, position)
        x += position[0] / 4
        y += position[1] / 4
    }
    return [x, y]
}


/**
 * Finds a corridor from the connected rooms to the closest other room. Faces cost the distance between their centers,
 * which keeps corridors straighter than counting faces.
 *
 * @param world     world with all patches of the level
 * @param rooms     global face ids per room
 * @param connected indexes of the connected rooms
 * @param roomOf    room index by global face
 * @param blocked   faces a corridor can't use
 *
 * @return corridor or null if there is no way to any other room
 */
function findCorridor(
    world: PatchWorld,
    rooms: readonly number[][],
    connected: ReadonlySet<number>,
    roomOf: ReadonlyMap<number, number>,
    blocked: ReadonlySet<number>
): Corridor | null
{
    const reached = new Map<number, number>()
    const parents = new Map<number, number>()
    const heap = new FaceHeap()
    for (const room of connected)
    {
        for (const face of rooms[room])
        {
            reached.set(face, 0)
            heap.push(0, face)
        }
    }

    const done = new Set<number>()
    while (heap.size > 0)
    {
        const face = heap.pop()
        if (done.has(face))
        {
            continue
        }
        done.add(face)

        const room = roomOf.get(face)
        if (room !== undefined && !connected.has(room))
        {
            const path = [face]
            for (let curr = parents.get(face); curr !== undefined; curr = parents.get(curr))
            {
                path.push(curr)
            }
            path.reverse()
            return {
                from: roomOf.get(path[0])!,
                to: room,
                faces: path.slice(1, -1),
                fromFace: path[0],
                toFace: face
            }
        }

        const [x, y] = faceCenter(world, face)
        const cost = reached.get(face)!
        for (let i = 0; i < 4; i++)
        {
            const next = faceOf(world.twin(face * 4 + i))
            const nextRoom = roomOf.get(next)
            if (!done.has(next) && !blocked.has(next) && (nextRoom === undefined || !connected.has(nextRoom)))
            {
                const [nx, ny] = faceCenter(world, next)
                const nextCost = cost + Math.hypot(nx - x, ny - y)
                if (nextCost < (reached.get(next) ?? Infinity))
                {
                    reached.set(next, nextCost)
                    parents.set(next, face)
                    heap.push(nextCost, next)
                }
            }
        }
    }
    return null
}


/**
 * Connects rooms with corridors, always the closest room that isn't connected yet to the ones that are, which makes the
 * rooms and corridors a tree. Corridors don't cross and stay off the outer edge of the level.
 *
 * @param world     world with all patches of the level
 * @param rooms     global face ids per room
 * @param slots     slots of the patches of the level
 *
 * @return corridors, there is one less than rooms unless some room can't be reached
 */
export function findCorridors(world: PatchWorld, rooms: readonly number[][], slots: readonly number[]): Corridor[]
{
    const roomOf = new Map(rooms.flatMap((faces, room) => faces.map(face => [face, room] as const)))

    const blocked = new Set<number>([-1])
    for (const slot of slots)
    {
        const { twin } = world.getPatch(slot)
        // the world connects all seams of a level, so what's left has no twin in any patch
        for (let h = 0; h < twin.length; h++)
        {
            const global = (slot << SLOT_SHIFT) | h
            if (world.twin(global) < 0)
            {
                blocked.add(faceOf(global))
            }
        }
    }

    const corridors: Corridor[] = []
    const connected = new Set<number>(rooms.length > 0 ? [0] : [])
    while (connected.size < rooms.length)
    {
        const corridor = findCorridor(world, rooms, connected, roomOf, blocked)
        if (!corridor)
        {
            break
        }
        corridors.push(corridor)
        connected.add(corridor.to)
        corridor.faces.forEach(face => blocked.add(face))
    }
    return corridors
}


/**
 * Returns the half edge of the first face that leads to the second one
 */
function edgeBetween(world: PatchWorld, a: number, b: number): number
{
    for (let h = a * 4; h < a * 4 + 4; h++)
    {
        if (faceOf(world.twin(h)) === b)
        {
            return h
        }
    }
    throw new Error("Faces " + a + " and " + b + " aren't next to each other")
}


/**
 * Sets the edge types between the spaces of a level: walls between rooms and corridors wherever they touch, also where a
 * corridor runs along itself, and a door at each end of a corridor. Doors are the only way into a space.
 *
 * @param world         world with all patches of the level
 * @param rooms         global face ids per room
 * @param corridors     corridors of the level
 */
export function setLevelEdges(world: PatchWorld, rooms: readonly number[][], corridors: readonly Corridor[]): void
{
    const spaces = new Map<number, number>()
    rooms.forEach((faces, room) => faces.forEach(face => spaces.set(face, room)))
    corridors.forEach(({ faces }, corridor) => faces.forEach(face => spaces.set(face, rooms.length + corridor)))

    for (const [face, space] of spaces)
    {
        for (let h = face * 4; h < face * 4 + 4; h++)
        {
            const other = spaces.get(faceOf(world.twin(h)))
            if (other !== undefined && (other !== space || space >= rooms.length))
            {
                world.setEdgeType(h, EdgeType.WALL.index)
            }
        }
    }

    for (const { faces, fromFace, toFace } of corridors)
    {
        const path = [fromFace, ...faces, toFace]
        for (let i = 1; i < path.length; i++)
        {
            const door = i === 1 || i === path.length - 1
            world.setEdgeType(edgeBetween(world, path[i - 1], path[i]), (door ? EdgeType.DOOR : EdgeType.OPEN).index)
        }
    }
}
