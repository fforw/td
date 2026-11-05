import { EdgeType, FaceType } from "./geometry"
import PatchWorld, { SLOT_SHIFT } from "./PatchWorld"
import { faceCount, type QuadPatch } from "./QuadPatch"

const FACE_SHIFT = SLOT_SHIFT - 2
const FACE_MASK = (1 << FACE_SHIFT) - 1

/**
 * Cost of entering a face per FaceType index, Infinity for impassable faces. Passing is separate from
 * FaceType.occupied, which is about what can be placed on a face: nothing gets built in a forest, but people walk
 * through it.
 */
export type CostTable = Float64Array

/**
 * Costs of the face types that are not 1 or impassable
 */
const TRAVEL_COSTS = new Map<FaceType, number>([
    [FaceType.SAND, 1.5],
    [FaceType.SNOW, 2],
    [FaceType.TREE, 3],
    [FaceType.TREE2, 3],
    [FaceType.FOREST_FLOOR, 3],
    [FaceType.SWAMP, 4]
])

/**
 * Costs for everyone until travellers get their own tables
 */
export const DEFAULT_COSTS: CostTable = Float64Array.from(
    FaceType.typeNames(),
    (_, index) => {
        const type = FaceType.byIndex(index)
        return TRAVEL_COSTS.get(type) ?? (type.occupied ? Infinity : 1)
    }
)

/**
 * Cost of crossing a half edge per EdgeType index, on top of the cost of the face behind it. Costs for everyone like
 * DEFAULT_COSTS, nobody can break through a destructible wall yet.
 */
export const EDGE_COSTS: CostTable = Float64Array.from(
    EdgeType.typeNames(),
    (_, index) => {
        switch (EdgeType.byIndex(index))
        {
            case EdgeType.OPEN:
                return 0
            case EdgeType.DOOR:
                return 1
            default:
                return Infinity
        }
    }
)


export interface Route
{
    /**
     * True if all goals could be reached
     */
    reachable: boolean

    /**
     * Summed costs of all faces entered and edges crossed on the way to the farthest goal. Without a way there it's the
     * cost of getting to the reachable face closest to the target patch instead.
     */
    cost: number
}


/**
 * Route with the way it takes, as global face ids from the start on: one path per goal, or a single one to where the
 * search ended up if there are no goals or no way.
 */
export interface TracedRoute extends Route
{
    paths: number[][]
}


/**
 * Min-heap of faces by cost, in two arrays to not allocate per entry
 */
class FaceHeap
{
    private costs: number[] = []
    private faces: number[] = []

    get size(): number
    {
        return this.faces.length
    }

    push(cost: number, face: number): void
    {
        const { costs, faces } = this
        let i = faces.length
        costs.push(cost)
        faces.push(face)
        while (i > 0)
        {
            const parent = (i - 1) >> 1
            if (costs[parent] <= cost)
            {
                break
            }
            costs[i] = costs[parent]
            faces[i] = faces[parent]
            i = parent
        }
        costs[i] = cost
        faces[i] = face
    }

    /**
     * Removes the cheapest face and returns it
     */
    pop(): number
    {
        const { costs, faces } = this
        const top = faces[0]
        const cost = costs.pop()!
        const face = faces.pop()!
        const count = faces.length
        let i = 0
        while (count > 0)
        {
            let child = 2 * i + 1
            if (child >= count)
            {
                break
            }
            if (child + 1 < count && costs[child + 1] < costs[child])
            {
                child++
            }
            if (cost <= costs[child])
            {
                break
            }
            costs[i] = costs[child]
            faces[i] = faces[child]
            i = child
        }
        if (count > 0)
        {
            costs[i] = cost
            faces[i] = face
        }
        return top
    }
}


/**
 * Returns the global id of the given local face in the given slot
 */
export function globalFace(slot: number, face: number): number
{
    return (slot << FACE_SHIFT) | face
}


/**
 * Returns the slot of the patch of the given global face
 */
export function slotOf(face: number): number
{
    return face >> FACE_SHIFT
}


/**
 * Returns the center of the given patch in map units
 */
function patchCenter(world: PatchWorld, slot: number): [number, number]
{
    const { positions } = world.getPatch(slot)
    const count = positions.length / 3
    let x = 0, y = 0
    for (let i = 0; i < positions.length; i += 3)
    {
        x += positions[i]
        y += positions[i + 1]
    }
    return [x / count, y / count]
}


/**
 * Finds the way from a face to all goals of a target patch. The search runs without a heuristic, since it has to reach
 * several goals and no single estimate stays below the true cost of all of them.
 *
 * @param world     connected patches
 * @param start     global id of the start face, entering it costs nothing
 * @param target    slot of the target patch
 * @param goals     local faces in the target patch to reach. Without goals, reaching any face of the patch is enough
 * @param through   slots of the patches the route may use, besides the target patch
 * @param costs     cost table
 * @param enter     called the first time the search gets to a patch, can connect more patches to the world and returns
 *                  the slots of those the route may use now
 *
 * @return route
 */
export function findRoute(
    world: PatchWorld,
    start: number,
    target: number,
    goals: readonly number[],
    through: readonly number[],
    costs: CostTable = DEFAULT_COSTS,
    enter?: (slot: number) => readonly number[]
): TracedRoute
{
    const allowed = new Set(through).add(target)
    const open = new Set(goals.map(face => globalFace(target, face)))
    const anyFace = goals.length === 0

    const reached = new Map<number, number>([[start, 0]])
    const parents = new Map<number, number>()
    const trace = (face: number) => {
        const path = [face]
        for (let curr = parents.get(face); curr !== undefined; curr = parents.get(curr))
        {
            path.push(curr)
        }
        return path.reverse()
    }
    const heap = new FaceHeap()
    heap.push(0, start)
    const done = new Set<number>()
    const entered = new Set<number>()

    const [targetX, targetY] = patchCenter(world, target)
    const position = [0, 0, 0]
    let closest = Infinity
    let closestCost = 0
    let closestFace = start

    while (heap.size > 0)
    {
        const face = heap.pop()
        if (done.has(face))
        {
            continue
        }
        done.add(face)

        const slot = slotOf(face)
        if (enter && !entered.has(slot))
        {
            entered.add(slot)
            enter(slot).forEach(other => allowed.add(other))
        }
        const cost = reached.get(face)!

        // faces finish in order of their cost, so the last goal is the farthest one
        if (anyFace ? face >> FACE_SHIFT === target : open.delete(face) && open.size === 0)
        {
            return {
                reachable: true,
                cost,
                paths: anyFace ? [trace(face)] : goals.map(goal => trace(globalFace(target, goal)))
            }
        }

        world.position(face * 4, position)
        const distance = Math.hypot(position[0] - targetX, position[1] - targetY)
        if (distance < closest)
        {
            closest = distance
            closestCost = cost
            closestFace = face
        }

        for (let i = 0; i < 4; i++)
        {
            const h = face * 4 + i
            const twin = world.twin(h)
            if (twin < 0)
            {
                continue
            }
            const next = twin >> 2
            if (done.has(next) || !allowed.has(next >> FACE_SHIFT))
            {
                continue
            }
            const nextCost = cost + EDGE_COSTS[world.edgeType(h)] + costs[world.faceType(next)]
            if (nextCost < (reached.get(next) ?? Infinity))
            {
                reached.set(next, nextCost)
                parents.set(next, face)
                heap.push(nextCost, next)
            }
        }
    }
    return { reachable: false, cost: closestCost, paths: [trace(closestFace)] }
}


/**
 * Packs a path of global face ids for another thread, where slots mean something else: runs of the hexagon position
 * of a patch, the number of faces and their local ids.
 */
export function packPath(world: PatchWorld, path: readonly number[]): Int32Array<ArrayBuffer>
{
    const packed: number[] = []
    let slot = -1
    let countAt = -1
    for (const face of path)
    {
        if (face >> FACE_SHIFT !== slot)
        {
            slot = face >> FACE_SHIFT
            const { q, r } = world.getPatch(slot)
            packed.push(q, r, 0)
            countAt = packed.length - 1
        }
        packed.push(face & FACE_MASK)
        packed[countAt]++
    }
    return Int32Array.from(packed)
}


/**
 * Returns the global face ids of a path packed by packPath()
 */
export function unpackPath(world: PatchWorld, packed: Int32Array): number[]
{
    const path: number[] = []
    for (let i = 0; i < packed.length;)
    {
        const slot = world.findSlot(packed[i], packed[i + 1])
        const count = packed[i + 2]
        i += 3
        for (let end = i + count; i < end; i++)
        {
            path.push(globalFace(slot, packed[i]))
        }
    }
    return path
}


/**
 * Returns the local faces of a patch that connect to its border within the patch and can be entered. Edges that can't
 * be crossed count like faces that can't be entered, also on the border itself.
 */
export function borderConnected(patch: QuadPatch, costs: CostTable = DEFAULT_COSTS): Set<number>
{
    const crossable = (h: number) => EDGE_COSTS[patch.edgeType[h]] !== Infinity

    const connected = new Set<number>()
    const stack: number[] = []
    const count = faceCount(patch)
    for (let face = 0; face < count; face++)
    {
        if (costs[patch.faceType[face]] !== Infinity)
        {
            for (let i = 0; i < 4; i++)
            {
                const h = face * 4 + i
                if (patch.twin[h] < 0 && crossable(h) && !connected.has(face))
                {
                    connected.add(face)
                    stack.push(face)
                }
            }
        }
    }
    while (stack.length > 0)
    {
        const face = stack.pop()!
        for (let i = 0; i < 4; i++)
        {
            const h = face * 4 + i
            const twin = patch.twin[h]
            if (twin >= 0 && crossable(h))
            {
                const next = twin >> 2
                if (!connected.has(next) && costs[patch.faceType[next]] !== Infinity)
                {
                    connected.add(next)
                    stack.push(next)
                }
            }
        }
    }
    return connected
}
