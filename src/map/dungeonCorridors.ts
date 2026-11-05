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
 * Finds corridors from sources to target rooms, always to the closest one. It's one search that keeps running from one
 * corridor to the next, instead of covering all that is connected so far again for every corridor, which would take
 * minutes on large levels. Most of what it knows stays right when a corridor gets added. Sources only make ways shorter,
 * and removeFaces() repairs the ways that led through the faces of a corridor. Other rooms are in the way. Faces cost the
 * distance between their centers, which keeps corridors straighter than counting faces.
 */
class CorridorSearch
{
    /**
     * Cost of the best known way per global face and the face it comes from, which sources don't have
     */
    private readonly costs = new Map<number, number>()
    private readonly parents = new Map<number, number>()

    /**
     * Cost a face had when its neighbors last got to know about it
     */
    private readonly expanded = new Map<number, number>()

    private readonly centers = new Map<number, [number, number]>()
    private readonly heap = new FaceHeap()

    /**
     * @param world     world with all patches of the level
     * @param targets   indexes of the rooms to get to, removing one stops the search from going there
     * @param roomOf    room index by global face
     * @param blocked   faces a corridor can't use, removeFaces() has to be called for new ones
     */
    constructor(
        private readonly world: PatchWorld,
        private readonly targets: ReadonlySet<number>,
        private readonly roomOf: ReadonlyMap<number, number>,
        private readonly blocked: ReadonlySet<number>
    )
    {
    }


    /**
     * Adds global faces to start from
     */
    addSources(faces: readonly number[]): void
    {
        for (const face of faces)
        {
            this.costs.set(face, 0)
            this.parents.delete(face)
            this.expanded.delete(face)
            this.heap.push(0, face)
        }
    }


    /**
     * Forgets the ways that lead through the given faces, which only takes what is behind them. The faces around those
     * then get to find new ways.
     */
    removeFaces(faces: readonly number[]): void
    {
        const { costs, parents, expanded, heap } = this

        const cleared = new Set(faces)
        for (const face of cleared)
        {
            for (const next of this.neighbors(face))
            {
                if (parents.get(next) === face)
                {
                    cleared.add(next)
                }
            }
        }

        for (const face of cleared)
        {
            costs.delete(face)
            parents.delete(face)
            expanded.delete(face)
        }

        for (const face of cleared)
        {
            for (const next of this.neighbors(face))
            {
                const cost = costs.get(next)
                if (cost !== undefined)
                {
                    expanded.delete(next)
                    heap.push(cost, next)
                }
            }
        }
    }


    /**
     * Returns the next corridor to the closest target room or null if there is no way to any of them
     */
    next(): Corridor | null
    {
        const { costs, parents, expanded, heap, targets, roomOf, blocked } = this

        while (heap.size > 0)
        {
            const face = heap.pop()
            const cost = costs.get(face)
            if (cost === undefined || expanded.get(face) === cost)
            {
                continue
            }

            const room = roomOf.get(face)
            if (room !== undefined && targets.has(room))
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
            expanded.set(face, cost)

            const [x, y] = this.center(face)
            for (const next of this.neighbors(face))
            {
                const nextRoom = roomOf.get(next)
                if (!blocked.has(next) && (nextRoom === undefined || targets.has(nextRoom)))
                {
                    const [nx, ny] = this.center(next)
                    const nextCost = cost + Math.hypot(nx - x, ny - y)
                    if (nextCost < (costs.get(next) ?? Infinity))
                    {
                        costs.set(next, nextCost)
                        parents.set(next, face)
                        heap.push(nextCost, next)
                    }
                }
            }
        }
        return null
    }


    private center(face: number): [number, number]
    {
        let center = this.centers.get(face)
        if (!center)
        {
            center = faceCenter(this.world, face)
            this.centers.set(face, center)
        }
        return center
    }


    private neighbors(face: number): number[]
    {
        const { world } = this
        const faces: number[] = []
        for (let h = face * 4; h < face * 4 + 4; h++)
        {
            const twin = world.twin(h)
            if (twin >= 0)
            {
                faces.push(faceOf(twin))
            }
        }
        return faces
    }
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
    const targets = new Set(rooms.keys())
    targets.delete(0)
    const search = new CorridorSearch(world, targets, roomOf, blocked)
    search.addSources(rooms[0] ?? [])

    while (targets.size > 0)
    {
        const corridor = search.next()
        if (!corridor)
        {
            break
        }
        corridors.push(corridor)
        targets.delete(corridor.to)
        corridor.faces.forEach(face => blocked.add(face))

        search.removeFaces(corridor.faces)
        search.addSources(rooms[corridor.to])
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
