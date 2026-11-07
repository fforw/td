import { EdgeType, FaceType } from "./geometry"
import { PATCH_SIZE } from "./HexagonPatch"
import PatchWorld, { SLOT_SHIFT } from "./PatchWorld"
import { BORDER_NQ, BORDER_NR, BORDER_STRIDE, faceCount, type QuadPatch } from "./QuadPatch"

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
export class FaceHeap
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
 * Finds the way from a face to all goals of a target patch. All goals are within the circle around the target patch, so
 * the distance to that circle is an estimate that stays below the true cost of each of them. Goals get the estimate 0,
 * so they still finish in the order of their cost.
 *
 * @param world     connected patches
 * @param start     global id of the start face, entering it costs nothing
 * @param target    slot of the target patch
 * @param goals     local faces in the target patch to reach. Without goals, reaching any face of the patch is enough
 * @param through   slots of the patches the route may use, besides the target patch
 * @param costs     cost table
 * @param enter     called the first time the search gets to a patch, can connect more patches to the world and returns
 *                  the slots of those the route may use now
 * @param step      longest distance between the centers of two faces next to each other in map units, or more. With it,
 *                  the search heads for the target patch first, as no step can get closer to it by more than that, which
 *                  keeps the routes the cheapest. The face size will do, the steps are about 0.7 of it at most.
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
    enter?: (slot: number) => readonly number[],
    step?: number
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

    // the least it takes to get from a face to the circle around the target patch, at the cheapest cost per face
    let estimate = (_face: number) => 0
    if (step)
    {
        const { positions } = world.getPatch(target)
        let targetRadius = 0
        for (let i = 0; i < positions.length; i += 3)
        {
            targetRadius = Math.max(targetRadius, Math.hypot(positions[i] - targetX, positions[i + 1] - targetY))
        }
        const cheapest = Math.min(...costs)
        estimate = face => {
            let x = 0, y = 0
            for (let h = face * 4; h < face * 4 + 4; h++)
            {
                world.position(h, position)
                x += position[0] / 4
                y += position[1] / 4
            }
            return Math.max(0, Math.hypot(x - targetX, y - targetY) - targetRadius) / step * cheapest
        }
    }
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

        // goals finish in order of their cost, so the last one is the farthest one
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
                heap.push(nextCost + estimate(next), next)
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
 * How far portals between the faces of a path stay away from their corners, as a share of their length. It keeps the
 * way from grazing what stands next to it.
 */
const PORTAL_MARGIN = 0.25


/**
 * Point in map units
 */
type Point = readonly [number, number]


function faceCenter(world: PatchWorld, face: number): Point
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


function cross(ax: number, ay: number, bx: number, by: number): number
{
    return ax * by - ay * bx
}


/**
 * Returns the shared edge of two neighboring faces, as seen going from the first to the second one: its left and right
 * end moved inward by the margin.
 */
function portal(world: PatchWorld, from: number, to: number, margin: number): [Point, Point]
{
    const [fromX, fromY] = faceCenter(world, from)
    const [toX, toY] = faceCenter(world, to)
    for (let i = 0; i < 4; i++)
    {
        const h = from * 4 + i
        if (world.twin(h) >> 2 === to && EDGE_COSTS[world.edgeType(h)] !== Infinity)
        {
            const a = [0, 0, 0]
            const b = [0, 0, 0]
            world.position(h, a)
            world.position(from * 4 + (i + 1) % 4, b)

            const dirX = toX - fromX
            const dirY = toY - fromY
            const [leftX, leftY, rightX, rightY] = cross(dirX, dirY, a[0] - fromX, a[1] - fromY) > cross(dirX, dirY, b[0] - fromX, b[1] - fromY)
                ? [a[0], a[1], b[0], b[1]]
                : [b[0], b[1], a[0], a[1]]
            const dx = rightX - leftX
            const dy = rightY - leftY
            return [
                [leftX + dx * margin, leftY + dy * margin],
                [rightX - dx * margin, rightY - dy * margin]
            ]
        }
    }
    throw new Error("No way from face " + from + " to " + to)
}


/**
 * Returns the shortest way through the faces of a path, from the middle of the first to the middle of the last one. It
 * pulls the path taut like a string inside its faces with the funnel algorithm, so it cuts the stairs a path over a grid
 * of faces is made of without ever leaving those faces.
 *
 * @param world     connected patches
 * @param faces     global ids of the faces on the path
 * @param margin    how far to stay away from the corners of the faces, as a share of the edges between them
 *
 * @return x and y in map units for each point of the way
 */
export function tautPath(world: PatchWorld, faces: readonly number[], margin = PORTAL_MARGIN): number[]
{
    if (faces.length === 0)
    {
        return []
    }
    const end = faceCenter(world, faces[faces.length - 1])
    const portals: [Point, Point][] = []
    for (let i = 0; i + 1 < faces.length; i++)
    {
        portals.push(portal(world, faces[i], faces[i + 1], margin))
    }
    portals.push([end, end])

    let apex = faceCenter(world, faces[0])
    const way = [apex[0], apex[1]]
    let left = apex, right = apex
    let leftIndex = 0, rightIndex = 0

    // how the given point lies to a side of the funnel, positive for left of it
    const side = (edge: Point, point: Point) => cross(edge[0] - apex[0], edge[1] - apex[1], point[0] - apex[0], point[1] - apex[1])

    for (let i = 0; i < portals.length; i++)
    {
        const [nextLeft, nextRight] = portals[i]

        if (side(right, nextRight) >= 0)
        {
            if (apex === right || side(left, nextRight) < 0)
            {
                right = nextRight
                rightIndex = i
            }
            else
            {
                // the right side crossed the left one, so the way bends around the corner on the left
                way.push(left[0], left[1])
                apex = right = left
                i = rightIndex = leftIndex
                continue
            }
        }

        if (side(left, nextLeft) <= 0)
        {
            if (apex === left || side(right, nextLeft) > 0)
            {
                left = nextLeft
                leftIndex = i
            }
            else
            {
                way.push(right[0], right[1])
                apex = left = right
                i = leftIndex = rightIndex
            }
        }
    }
    way.push(end[0], end[1])
    return way
}


/**
 * Returns a way that ends the given distance before the end of the given way, or just its start if it isn't that long.
 *
 * @param way       x and y in map units for each point
 * @param distance  distance in map units
 */
export function stopShort(way: readonly number[], distance: number): number[]
{
    let left = distance
    for (let i = way.length - 2; i >= 2; i -= 2)
    {
        const dx = way[i] - way[i - 2]
        const dy = way[i + 1] - way[i - 1]
        const length = Math.hypot(dx, dy)
        if (length > left)
        {
            const t = left / length
            return [...way.slice(0, i), way[i] - dx * t, way[i + 1] - dy * t]
        }
        left -= length
    }
    return way.slice(0, 2)
}



/**
 * Faces of a patch that are connected to each other and to the border of the patch
 */
export interface BorderPart
{
    /**
     * Local faces of the part
     */
    faces: number[]

    /**
     * Number of neighbor patches the part has a border with
     */
    sides: number
}


/**
 * Returns the parts of a patch that connect to its border and can be entered. Edges that can't be crossed count like
 * faces that can't be entered, also on the border itself. What's behind the border is up to the neighboring patches.
 *
 * @param patch     packed patch
 * @param costs     cost table
 *
 * @return separate parts, a face that one-way edges connect to several of them is only in the first one
 */
export function borderParts(patch: QuadPatch, costs: CostTable = DEFAULT_COSTS): BorderPart[]
{
    const { border, twin, edgeType, faceType } = patch
    const crossable = (h: number) => EDGE_COSTS[edgeType[h]] !== Infinity
    const enterable = (face: number) => costs[faceType[face]] !== Infinity

    // the patch a border half edge leads to, patches are blocks of hexagons around their center
    const sideOf = (h: number) => {
        const off = ((-2 - twin[h]) >> 1) * BORDER_STRIDE
        const toPatch = (hexagon: number) => Math.floor((hexagon + PATCH_SIZE / 2) / PATCH_SIZE)
        return toPatch(border[off + BORDER_NQ]) + "/" + toPatch(border[off + BORDER_NR])
    }

    const parts: BorderPart[] = []
    const seen = new Set<number>()
    const count = faceCount(patch)
    for (let start = 0; start < count; start++)
    {
        let onBorder = false
        for (let h = start * 4; h < start * 4 + 4; h++)
        {
            onBorder ||= twin[h] < 0 && crossable(h)
        }
        if (!onBorder || seen.has(start) || !enterable(start))
        {
            continue
        }

        const faces: number[] = []
        const sides = new Set<string>()
        const stack = [start]
        seen.add(start)
        while (stack.length > 0)
        {
            const face = stack.pop()!
            faces.push(face)
            for (let h = face * 4; h < face * 4 + 4; h++)
            {
                if (crossable(h))
                {
                    if (twin[h] < 0)
                    {
                        sides.add(sideOf(h))
                    }
                    else
                    {
                        const next = twin[h] >> 2
                        if (!seen.has(next) && enterable(next))
                        {
                            seen.add(next)
                            stack.push(next)
                        }
                    }
                }
            }
        }
        parts.push({ faces, sides: sides.size })
    }
    return parts
}
