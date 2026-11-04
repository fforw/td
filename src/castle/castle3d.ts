import { BufferGeometry, Float32BufferAttribute, Group, Mesh, type Object3D, Vector3 } from "three"
import type { CastlePlan, GatePlan, HousePlan, TavernPlan } from "./castlePlan"
import { model, template } from "../render/scene3d"

/*
 * 3D objects of a castle plan
 */

const TAU = Math.PI * 2

const WALL_HEIGHT = 0.6
const WALL_THICKNESS = 0.4
const TOWER_SIZE = 0.66

/**
 * Size of the tavern model in its own units
 */
const TAVERN_MODEL_WIDTH = 4.25
const TAVERN_MODEL_HEIGHT = 4.19

/**
 * Minimum change of direction for a wall corner to get a tower
 */
const TOWER_MIN_TURN = 0.4

/**
 * Minimum distance between towers in world units
 */
const TOWER_MIN_DISTANCE = 2.5

/**
 * Minimum change of direction for a wall corner without a tower to get a column filling the gap on the outer side
 */
const COLUMN_MIN_TURN = 0.25

/**
 * Number of sides of the wall columns
 */
const COLUMN_SIDES = 10

/**
 * Diameter of the wall columns relative to the wall thickness
 */
const COLUMN_SIZE = 2 / 3

/**
 * Profile of the wall columns in wall model units as [radius, height, u, v]. It follows the cross-section of the wall
 * model up to the walkway and ends in a stone cut flat at the height of the battlements. The texture coordinates are
 * the ones the wall model uses at the same height.
 */
const COLUMN_PROFILE: [number, number, number, number][][] = [
    // foot
    [[0.5, 0, 0.844, 0.975], [0.5, 0.28, 0.844, 0.932], [0.465, 0.45, 0.844, 0.906]],
    // wall face
    [[0.465, 0.45, 0.781, 0.875], [0.465, 1.01, 0.781, 0.875]],
    // walkway lip and flat top
    [
        [0.465, 1.01, 0.844, 0.821], [0.5, 1.11, 0.844, 0.806], [0.5, 1.25, 0.844, 0.783],
        [0.44, 1.31, 0.844, 0.775], [0, 1.31, 0.844, 0.775]
    ],
]

const GATE_HEIGHT = WALL_HEIGHT * 1.15

/**
 * Thickness of the gateway arch, measured along the road
 */
const GATE_THICKNESS = 0.85

/**
 * Depth of the area around a gate in which walls are cut away, measured along the road
 */
const GATE_CLEARANCE = 2

const MARKET_FOUNTAIN_SCALE = 0.2
const MARKET_STALL_SCALE = 0.2

/**
 * Height of the fountain above the ground, high enough to stay above debug grid lines
 */
const FOUNTAIN_LIFT = 0.01

/**
 * Converts an angle in the 2D plan to a rotation around the 3D y-axis. Plan y maps to world z, which mirrors the
 * rotation direction.
 */
function toRotationY(angle: number): number
{
    return -angle
}

/**
 * A gate where a road crosses the wall
 */
interface Gate
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


function createHouse(plan: HousePlan): Object3D
{
    const { x, z, side, angle, wood, highRoof } = plan
    const height = side

    const house = new Group()

    const block = model(wood ? "houseWoodBlock" : "houseBlock")
    block.scale.set(side, height, side)
    house.add(block)

    const roof = model(highRoof ? "roofHigh" : "roof")
    roof.scale.set(side, side, side)
    roof.position.y = height
    house.add(roof)

    house.position.set(x, 0, z)
    house.rotation.y = toRotationY(angle)
    return house
}

function createTavern({ x, z, side, angle }: TavernPlan): Object3D
{
    const tavern = model("tavern")
    tavern.scale.setScalar(side / TAVERN_MODEL_WIDTH)
    tavern.position.set(x, 0, z)
    tavern.rotation.y = toRotationY(angle)
    return tavern
}

/**
 * Height of the tavern of the given plan
 */
export function tavernHeight({ side }: TavernPlan): number
{
    return side * TAVERN_MODEL_HEIGHT / TAVERN_MODEL_WIDTH
}

function createTower(pt: Vector3, gate: boolean): Object3D
{
    const tower = new Group()

    const height = gate ? WALL_HEIGHT * 1.6 : WALL_HEIGHT * 1.35
    const base = model(gate ? "gateTower" : "tower")
    base.scale.set(TOWER_SIZE, height / 1.31, TOWER_SIZE)
    tower.add(base)

    const roof = model(gate ? "gateTowerRoof" : "towerRoof")
    roof.scale.setScalar(TOWER_SIZE)
    roof.position.y = height
    tower.add(roof)

    tower.position.copy(pt)
    return tower
}

/**
 * Returns the change of direction at p1 when going from p0 over p1 to p2, in the range -PI to PI.
 */
function turnAngle(p0: Vector3, p1: Vector3, p2: Vector3): number
{
    const a0 = Math.atan2(p1.z - p0.z, p1.x - p0.x)
    const a1 = Math.atan2(p2.z - p1.z, p2.x - p1.x)
    let d = a1 - a0
    if (d > Math.PI)
    {
        d -= TAU
    }
    else if (d < -Math.PI)
    {
        d += TAU
    }
    return d
}

function isInGate(pt: Vector3, gate: Gate, margin = 0): boolean
{
    const dx = pt.x - gate.center.x
    const dz = pt.z - gate.center.z
    return (
        Math.abs(dx * gate.road.x + dz * gate.road.z) <= GATE_CLEARANCE / 2 + margin &&
        Math.abs(dx * gate.side.x + dz * gate.side.z) <= gate.width / 2 + margin
    )
}

/**
 * Returns the parameter interval in which the segment from p0 to p1 runs through the clearance area of the gate, or
 * null if it doesn't (Liang-Barsky clipping in the local coordinates of the gate).
 */
function clipToGate(p0: Vector3, p1: Vector3, gate: Gate): [number, number] | null
{
    const { center, road, side, width } = gate

    const x0 = p0.x - center.x, z0 = p0.z - center.z
    const dx = p1.x - p0.x, dz = p1.z - p0.z

    let tIn = 0, tOut = 1

    const axes: [Vector3, number][] = [[road, GATE_CLEARANCE / 2], [side, width / 2]]
    for (const [axis, half] of axes)
    {
        const u0 = x0 * axis.x + z0 * axis.z
        const du = dx * axis.x + dz * axis.z

        if (Math.abs(du) < 1e-9)
        {
            if (Math.abs(u0) > half)
            {
                return null
            }
            continue
        }

        let t0 = (-half - u0) / du
        let t1 = (half - u0) / du
        if (t0 > t1)
        {
            [t0, t1] = [t1, t0]
        }
        tIn = Math.max(tIn, t0)
        tOut = Math.min(tOut, t1)
        if (tIn >= tOut)
        {
            return null
        }
    }
    return [tIn, tOut]
}

function createGate(gate: Gate): Group
{
    const group = new Group()

    // the doorway model is half a unit thick on its negative x-side, has its battlements on that side and runs along
    // its local z-axis. Turn it around so that the battlements face outwards.
    const gateway = model("gateway")
    const sx = GATE_THICKNESS / 0.5
    gateway.scale.set(sx, GATE_HEIGHT / 1.31, gate.width)
    gateway.rotation.y = Math.PI
    gateway.position.x = -0.25 * sx
    group.add(gateway)

    for (const z of [-gate.width / 2, gate.width / 2])
    {
        group.add(createTower(new Vector3(0, 0, z), true))
    }

    group.position.copy(gate.center)
    // local x along the road
    group.rotation.y = Math.atan2(-gate.road.z, gate.road.x)
    return group
}

function addWallPiece(group: Group, p0: Vector3, p1: Vector3): void
{
    const dx = p1.x - p0.x
    const dz = p1.z - p0.z
    const length = Math.sqrt(dx * dx + dz * dz)
    if (length < 0.05)
    {
        return
    }

    // the wall model runs along its local z-axis
    const wall = model("wall")
    wall.scale.set(WALL_THICKNESS, WALL_HEIGHT / 1.31, length)
    wall.position.set((p0.x + p1.x) / 2, 0, (p0.z + p1.z) / 2)
    wall.rotation.y = Math.atan2(dx, dz)
    group.add(wall)
}

let columnGeometry: BufferGeometry | null = null

/**
 * Lathes the column profile into a faceted geometry in wall model units, sharing the texture of the wall model
 */
function getColumnGeometry(): BufferGeometry
{
    if (columnGeometry)
    {
        return columnGeometry
    }

    const positions: number[] = []
    const uvs: number[] = []

    for (const part of COLUMN_PROFILE)
    {
        for (let i = 1; i < part.length; i++)
        {
            const [r0, y0, u0, v0] = part[i - 1]
            const [r1, y1, u1, v1] = part[i]
            for (let j = 0; j < COLUMN_SIDES; j++)
            {
                const a0 = j * TAU / COLUMN_SIDES
                const a1 = (j + 1) * TAU / COLUMN_SIDES
                const c0 = Math.cos(a0), s0 = Math.sin(a0)
                const c1 = Math.cos(a1), s1 = Math.sin(a1)

                // two counter-clockwise triangles when seen from the outside
                positions.push(
                    r0 * c0, y0, r0 * s0, r1 * c0, y1, r1 * s0, r0 * c1, y0, r0 * s1,
                    r0 * c1, y0, r0 * s1, r1 * c0, y1, r1 * s0, r1 * c1, y1, r1 * s1
                )
                uvs.push(u0, v0, u1, v1, u0, v0, u0, v0, u1, v1, u1, v1)
            }
        }
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3))
    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2))
    geometry.computeVertexNormals()
    columnGeometry = geometry
    return geometry
}

/**
 * Creates a small column at the wall corner pt that covers the gap the two wall pieces leave on the outer side. The
 * column stands between the outer corners of the two wall pieces.
 */
function createColumn(prev: Vector3, pt: Vector3, next: Vector3): Object3D
{
    const d0 = pt.clone().sub(prev).normalize()
    const d1 = next.clone().sub(pt).normalize()

    // the normals point to the left of the wall direction, the gap opens on the side the wall turns away from
    const turn = d0.x * d1.z - d0.z * d1.x
    const offset = (turn > 0 ? -WALL_THICKNESS : WALL_THICKNESS) / 4
    const n0 = new Vector3(-d0.z, 0, d0.x)
    const n1 = new Vector3(-d1.z, 0, d1.x)

    const wallMesh = template("wall").getObjectByProperty("isMesh", true) as Mesh
    const column = new Mesh(getColumnGeometry(), wallMesh.material)
    column.castShadow = true
    column.receiveShadow = true
    column.scale.set(WALL_THICKNESS * COLUMN_SIZE, WALL_HEIGHT / 1.31, WALL_THICKNESS * COLUMN_SIZE)
    column.position.copy(pt).addScaledVector(n0.add(n1), offset)
    return column
}

/**
 * Adds a column at the joint pt between two wall pieces if they are long enough to have a direction and the wall turns
 * enough there
 */
function addJointColumn(group: Group, prev: Vector3, pt: Vector3, next: Vector3): void
{
    if (
        prev.distanceTo(pt) >= 0.05 &&
        pt.distanceTo(next) >= 0.05 &&
        Math.abs(turnAngle(prev, pt, next)) >= COLUMN_MIN_TURN
    )
    {
        group.add(createColumn(prev, pt, next))
    }
}

/**
 * Part of a wall segment as start and end parameter and the gates that cut off the start and the end, if any
 */
type WallInterval = [number, number, Gate | null, Gate | null]

function nearestGateTower(gate: Gate, pt: Vector3): Vector3
{
    const { center, side, width } = gate
    const d = (pt.x - center.x) * side.x + (pt.z - center.z) * side.z
    return center.clone().addScaledVector(side, d < 0 ? -width / 2 : width / 2)
}

function createWall(pts: Vector3[], gates: Gate[]): Group
{
    const group = new Group()

    for (let i = 1; i < pts.length; i++)
    {
        const p0 = pts[i - 1]
        const p1 = pts[i]

        // cut the parts of the segment running through gates, remembering which gate cut which end
        let intervals: WallInterval[] = [[0, 1, null, null]]
        for (const gate of gates)
        {
            const clip = clipToGate(p0, p1, gate)
            if (clip)
            {
                const [tIn, tOut] = clip
                intervals = intervals.flatMap(([a, b, gateA, gateB]): WallInterval[] => [
                    b > tIn ? [a, tIn, gateA, gate] : [a, b, gateA, gateB],
                    a < tOut ? [tOut, b, gate, gateB] : [a, b, gateA, gateB]
                ]).filter(([a, b]) => b > a)
            }
        }

        for (const [a, b, gateA, gateB] of intervals)
        {
            const start = p0.clone().lerp(p1, a)
            const end = p0.clone().lerp(p1, b)
            addWallPiece(group, start, end)

            // connect ends cut by a gate to the nearest gate tower, with a column if the connection bends the wall
            if (gateA)
            {
                const tower = nearestGateTower(gateA, start)
                addWallPiece(group, tower, start)
                addJointColumn(group, tower, start, end)
            }
            if (gateB)
            {
                const tower = nearestGateTower(gateB, end)
                addWallPiece(group, end, tower)
                addJointColumn(group, start, end, tower)
            }
        }
    }

    const insideGate = (pt: Vector3) => gates.some(gate => isInGate(pt, gate, TOWER_SIZE / 2))

    // the first and last point of the path are next to the gates, which have their own towers. If the path didn't
    // end at a gate, we close it with a tower
    const last = pts.length - 1
    for (const pt of [pts[0], pts[last]])
    {
        if (!insideGate(pt))
        {
            group.add(createTower(pt, true))
        }
    }

    // towers at the sharper corners of the wall, if they're not too close to the previous tower or the end gate
    let prevTower = pts[0]
    for (let i = 1; i < last; i++)
    {
        const pt = pts[i]
        const turn = Math.abs(turnAngle(pts[i - 1], pt, pts[i + 1]))
        if (
            turn >= TOWER_MIN_TURN &&
            pt.distanceTo(prevTower) >= TOWER_MIN_DISTANCE &&
            pt.distanceTo(pts[last]) >= TOWER_MIN_DISTANCE &&
            !insideGate(pt)
        )
        {
            group.add(createTower(pt, false))
            prevTower = pt
        }
        else if (!gates.some(gate => isInGate(pt, gate)))
        {
            addJointColumn(group, pts[i - 1], pt, pts[i + 1])
        }
    }

    return group
}

/**
 * Creates the houses, market, walls and gates of the given castle plan
 */
export function createCastle(plan: CastlePlan): Group
{
    const group = new Group()

    plan.houses.forEach((house, index) => {
        const obj = createHouse(house)
        // lets clicks find out which house of the plan they hit
        obj.userData.house = index
        group.add(obj)
    })

    if (plan.tavern)
    {
        const tavern = createTavern(plan.tavern)
        tavern.userData.tavern = true
        group.add(tavern)
    }

    const fountain = model("fountain")
    fountain.scale.setScalar(MARKET_FOUNTAIN_SCALE)
    // the pool floor of the fountain is at the model's base
    fountain.position.set(plan.fountain[0], FOUNTAIN_LIFT, plan.fountain[1])
    group.add(fountain)

    for (const { x, z, rotation, model: name } of plan.stalls)
    {
        const stall = model(name)
        stall.scale.setScalar(MARKET_STALL_SCALE)
        stall.position.set(x, 0, z)
        stall.rotation.y = rotation
        group.add(stall)
    }

    const gates = plan.gates.map(toGate)
    for (const gate of gates)
    {
        group.add(createGate(gate))
    }

    for (const flat of plan.walls)
    {
        const pts: Vector3[] = []
        for (let i = 0; i < flat.length; i += 2)
        {
            pts.push(new Vector3(flat[i], 0, flat[i + 1]))
        }
        group.add(createWall(pts, gates))
    }
    return group
}
