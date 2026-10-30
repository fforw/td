import { Vector3 } from "three"
import type Castle from "./Castle"
import { filterNeighbors, getNeighbors } from "./Castle"
import type { Face, Point } from "./geometry"
import { FaceType } from "./geometry"
import { squareFace, wallPaths } from "./plan"
import { SCALE } from "./scale"
import { connectsTo, rng } from "./util"

/*
 * Layout of the castle in world units, worked out on the faces of a patch. It doesn't depend on any 3D objects, so the
 * map worker can create it and send it along with the packed patch, see castle3d.ts for the 3D objects.
 */

const TAU = Math.PI * 2

/**
 * Minimum length of the wall piece from a gate tower to the rest of the wall
 */
const GATE_JOIN_DISTANCE = 1

/**
 * Number of steps along the road from the gate faces within which paved faces determine the road line
 */
const GATE_ROAD_DEPTH = 2

const GATE_MIN_WIDTH = 1
const GATE_MAX_WIDTH = 2.2

/**
 * A gate where a road crosses the wall
 */
export interface Gate
{
    center: Vector3
    /**
     * Unit vector along the road, pointing outwards
     */
    road: Vector3
    /**
     * Unit vector along the wall
     */
    side: Vector3
    /**
     * Width of the gate along the wall
     */
    width: number
}

/**
 * Gate as plain numbers. The direction along the wall follows from the direction of the road.
 */
export interface GatePlan
{
    x: number
    z: number
    roadX: number
    roadZ: number
    width: number
}

export interface HousePlan
{
    x: number
    z: number
    /**
     * Side length of the square house
     */
    side: number
    /**
     * Angle in the 2D plan
     */
    angle: number
    wood: boolean
    highRoof: boolean
}

export type StallModel = "stall" | "stallRed" | "stallGreen"

const STALLS: StallModel[] = ["stall", "stallRed", "stallGreen"]

export interface StallPlan
{
    x: number
    z: number
    /**
     * Rotation around the y-axis that makes the stall face the fountain
     */
    rotation: number
    model: StallModel
}

/**
 * Everything needed to build the castle, as plain data that can be sent from the worker
 */
export interface CastlePlan
{
    /**
     * Wall paths as x/z pairs
     */
    walls: number[][]
    gates: GatePlan[]
    houses: HousePlan[]
    /**
     * Position of the fountain in the center of the market
     */
    fountain: [number, number]
    stalls: StallPlan[]
}

export function toWorld(pt: Point, y = 0): Vector3
{
    return new Vector3(pt[0] * SCALE, y, pt[1] * SCALE)
}

/**
 * Returns the center line of the road through the given group of gate faces as a point on it and its direction
 * pointing outwards, or null if the road doesn't continue on both sides. The line runs through the centers of the
 * paved faces close to the gate on the inner and on the outer side, which averages out the zig-zag of the road
 * across the face grid.
 */
function roadLine(group: Face[], gateCenter: Vector3, castleCenter: Vector3): [Vector3, Vector3] | null
{
    // paved faces within a few steps of the gate
    const seen = new Set<Face>(group)
    let ring: Face[] = group
    const paved: Face[] = []
    for (let i = 0; i < GATE_ROAD_DEPTH; i++)
    {
        const next: Face[] = []
        for (const f of ring)
        {
            for (const n of filterNeighbors(f, FaceType.PAVED))
            {
                if (!seen.has(n))
                {
                    seen.add(n)
                    next.push(n)
                    paved.push(n)
                }
            }
        }
        ring = next
    }

    const inner = new Vector3()
    const outer = new Vector3()
    let innerCount = 0, outerCount = 0
    const gateDistance = gateCenter.distanceTo(castleCenter)
    for (const f of paved)
    {
        const pt = toWorld(f.centroid)
        if (pt.distanceTo(castleCenter) < gateDistance)
        {
            inner.add(pt)
            innerCount++
        }
        else
        {
            outer.add(pt)
            outerCount++
        }
    }

    if (!innerCount || !outerCount)
    {
        return null
    }
    inner.divideScalar(innerCount)
    outer.divideScalar(outerCount)
    return [inner, outer.sub(inner).normalize()]
}

/**
 * Groups adjacent GATE faces and returns one gate per group, oriented along the road running through it.
 */
function findGates(faces: Face[], centerFace: Face): Gate[]
{
    const castleCenter = toWorld(centerFace.centroid)

    const gates: Gate[] = []
    const visited = new Set<Face>()

    for (const face of faces)
    {
        if (face.type !== FaceType.GATE || visited.has(face))
        {
            continue
        }

        const group: Face[] = []
        const open = [face]
        visited.add(face)
        while (open.length)
        {
            const f = open.pop()!
            group.push(f)
            for (const n of getNeighbors(f))
            {
                if (n.type === FaceType.GATE && !visited.has(n))
                {
                    visited.add(n)
                    open.push(n)
                }
            }
        }

        const center = new Vector3()
        for (const f of group)
        {
            center.add(toWorld(f.centroid))
        }
        center.divideScalar(group.length)

        // put the gate on the center line of the road
        const line = roadLine(group, center, castleCenter)
        const road = line ? line[1] : center.clone().sub(castleCenter).normalize()
        if (line)
        {
            const [pt] = line
            const d = (center.x - pt.x) * road.x + (center.z - pt.z) * road.z
            center.copy(pt).addScaledVector(road, d)
        }
        const side = new Vector3(-road.z, 0, road.x)

        // extent of the gate faces along the wall
        let min = Infinity, max = -Infinity
        for (const f of group)
        {
            const first = f.halfEdge
            let curr = first
            do
            {
                const v = curr.vertex
                const d = (v.x * SCALE - center.x) * side.x + (v.y * SCALE - center.z) * side.z
                min = Math.min(min, d)
                max = Math.max(max, d)
                curr = curr.next
            } while (curr !== first)
        }

        const width = Math.min(GATE_MAX_WIDTH, Math.max(GATE_MIN_WIDTH, max - min))
        gates.push({ center, road, side, width })
    }
    return gates
}

/**
 * Where a wall path leaves the gate area through one of the tower lines of the gate
 */
interface WallCrossing
{
    /**
     * Index of the first path point beyond the tower line, which is also the number of path points inside the gate
     */
    index: number
    /**
     * Side of the gate (-1 or 1) on which the path leaves
     */
    sign: number
    /**
     * Position of the crossing along the road of the gate
     */
    road: number
}

/**
 * Returns where the wall path starting at the gate first crosses one of the tower lines of the gate, or null if it
 * doesn't.
 */
function wallCrossing(gate: Gate, pts: Vector3[]): WallCrossing | null
{
    const { center, road, side, width } = gate
    const half = width / 2

    for (let i = 0; i < pts.length; i++)
    {
        const dx = pts[i].x - center.x
        const dz = pts[i].z - center.z
        const s = dx * side.x + dz * side.z
        if (Math.abs(s) >= half)
        {
            const sign = Math.sign(s)
            const prev = i > 0 ? pts[i - 1] : pts[i]
            const ps = (prev.x - center.x) * side.x + (prev.z - center.z) * side.z
            const t = i > 0 ? (half - ps * sign) / (Math.abs(s) - ps * sign) : 0
            const point = prev.clone().lerp(pts[i], t)
            return {
                index: i,
                sign,
                road: (point.x - center.x) * road.x + (point.z - center.z) * road.z
            }
        }
    }
    return null
}

/**
 * The gate faces lie in the outer ring of the wall while the wall paths mostly run along the inner one. Moves the gates
 * along their roads onto the wall, to the average position at which the walls next to them reach their tower lines.
 * The wall paths then run straight from the gate towers to their first point that isn't too close to them, which
 * also straightens the wiggles the face grid causes next to the gates.
 */
function alignGatesToWalls(gates: Gate[], paths: Vector3[][]): void
{
    for (const gate of gates)
    {
        const ends: [Vector3[], boolean, WallCrossing][] = []
        for (const path of paths)
        {
            for (const atEnd of [false, true])
            {
                const pts = atEnd ? path.toReversed() : path
                if (pts[0].distanceTo(gate.center) <= GATE_MAX_WIDTH)
                {
                    const crossing = wallCrossing(gate, pts)
                    if (crossing)
                    {
                        ends.push([path, atEnd, crossing])
                    }
                }
            }
        }

        if (!ends.length)
        {
            continue
        }

        const shift = ends.reduce((sum, [, , { road }]) => sum + road, 0) / ends.length
        gate.center.addScaledVector(gate.road, shift)

        for (const [path, atEnd, { index, sign }] of ends)
        {
            const tower = gate.center.clone().addScaledVector(gate.side, sign * gate.width / 2)
            const pts = atEnd ? path.toReversed() : path

            let count = index
            while (count < pts.length - 1 && pts[count].distanceTo(tower) < GATE_JOIN_DISTANCE)
            {
                count++
            }

            if (atEnd)
            {
                path.splice(path.length - count, count, tower)
            }
            else
            {
                path.splice(0, count, tower)
            }
        }
    }
}

export function toGate(plan: GatePlan): Gate
{
    const { x, z, roadX, roadZ, width } = plan
    return {
        center: new Vector3(x, 0, z),
        road: new Vector3(roadX, 0, roadZ),
        side: new Vector3(-roadZ, 0, roadX),
        width
    }
}


/**
 * Works out the layout of the given castle. Uses the random number generator for the choices of houses and stalls.
 *
 * @param faces     faces of the patch
 * @param castle    castle built on the faces
 *
 * @return castle plan
 */
export function planCastle(faces: Face[], castle: Castle): CastlePlan
{
    const { centerFace } = castle

    const paths = wallPaths(castle).map(path => path.map(pt => toWorld(pt)))
    const gates = findGates(faces, centerFace)
    alignGatesToWalls(gates, paths)

    const houses: HousePlan[] = []
    const stalls: StallPlan[] = []
    const center = toWorld(centerFace.centroid)
    for (const face of faces)
    {
        if (face.type === FaceType.HOUSE)
        {
            const [pt, size, angle] = squareFace(face)
            houses.push({
                x: pt[0] * SCALE,
                z: pt[1] * SCALE,
                // size is the diagonal of the square
                side: size * SCALE / Math.SQRT2,
                angle,
                wood: rng.next() < 0.3,
                highRoof: rng.next() < 0.4
            })
        }
        else if (face.type === FaceType.MARKET && face !== centerFace && !connectsTo(face, centerFace) && rng.next() >= 0.7)
        {
            const model = STALLS[Math.floor(rng.next() * STALLS.length)]
            const pos = toWorld(face.centroid)
            stalls.push({ x: pos.x, z: pos.z, rotation: Math.atan2(center.x - pos.x, center.z - pos.z) + TAU / 4, model })
        }
    }

    return {
        walls: paths.map(path => path.flatMap(pt => [pt.x, pt.z])),
        gates: gates.map(({ center, road, width }) => ({ x: center.x, z: center.z, roadX: road.x, roadZ: road.z, width })),
        houses,
        fountain: [center.x, center.z],
        stalls
    }
}
