import Prando from "prando"

import { FIRE_RADIUS } from "../monster/firePatterns"
import { faceCenter, SEGMENT_SIZE } from "./dungeonLights"
import { findRoomRoles } from "./dungeonRoles"
import { createFloorWalls, type FloorWalls, seesAcross, wallDistance } from "./dungeonWays"
import type { FixtureSpot } from "./fixtures"
import { EdgeType } from "./geometry"
import type { DungeonLevel } from "./generateDungeon"
import type PatchWorld from "./PatchWorld"
import { faceOf, next, prev } from "./QuadPatch"
import { SCALE } from "./scale"

/**
 * Added to the seed of a level for picking its fire room, to not get the same numbers as anything else
 */
const FIRE_ROOM_SEED = 0x3f17

/**
 * Distance between the fire lines along a way through the room, and between the strikes of a line
 */
const LINE_SPACING = 0.75
const STRIKE_GAP = 1.75 * FIRE_RADIUS

/**
 * How far off the doors and the switch fire stays, for heroes to be safe there
 */
const SAFE_DISTANCE = 0.65

/**
 * How close an earlier line has to cross a way for it to not need another one there
 */
const CROSSED_DISTANCE = 0.4

/**
 * Least number of lines between the doors of the main path that make a fire room, how many it better has in all, and the most
 * strikes one has
 */
const MIN_LINES = 2
const GOOD_LINES = 3
const MAX_STRIKES = 160

/**
 * How far a line reaches to either side of the way it crosses at most
 */
const LINE_REACH = 6

/**
 * Half of the width and of the height of the switch in world units
 */
export const SWITCH_HALF_WIDTH = 0.072
export const SWITCH_HALF_HEIGHT = 0.12

/**
 * How close to a switch in world units a hero has to be to use it
 */
export const SWITCH_REACH = 0.5

/**
 * Where along the walls from the exit door a switch can be, in world units
 */
const SWITCH_FROM = 0.25
const SWITCH_TO = 1.2
const SWITCH_STEP = 0.1

/**
 * How far the wall may be off the plane of the switch
 */
const SWITCH_FLATNESS = 0.02

/**
 * Half the thickness of the walls without an inside, see THIN_WALL_THICKNESS
 */
const THIN_WALL_HALF = 0.03

/**
 * How much the front of a switch has to look to where the view is from, for it to be seen well
 */
const SEEN_FACING = 0.25

const a = [0, 0, 0]
const b = [0, 0, 0]

type Point = [number, number]

/**
 * A line of fire across a way through a room. The strikes are in order, from one wall to the other.
 */
export interface FireLine
{
    /** where it crosses the way */
    x: number
    z: number
    strikes: { x: number, z: number }[]
}

/**
 * A room on the main path with fire coming down in lines, until someone gets across it to the switch
 */
export interface FireRoom
{
    room: number
    /** middles of the doors, the one towards the entrance of the level first, the one towards its exit second */
    doors: Point[]
    lines: FireLine[]
    /** on the wall next to the second door, its position is on the surface of the wall */
    lever: FixtureSpot
}

interface Door
{
    half: number
    x: number
    z: number
}


function ends(world: PatchWorld, half: number): [number, number, number, number]
{
    world.position(half, a)
    world.position(next(half), b)
    return [a[0] * SCALE, a[1] * SCALE, b[0] * SCALE, b[1] * SCALE]
}


/**
 * Returns the doors of a room
 */
function findDoors(world: PatchWorld, room: ReadonlySet<number>): Door[]
{
    const doors: Door[] = []
    for (const face of room)
    {
        for (let half = face * 4; half < face * 4 + 4; half++)
        {
            if (world.edgeType(half) === EdgeType.DOOR.index)
            {
                const [x0, z0, x1, z1] = ends(world, half)
                doors.push({ half, x: (x0 + x1) / 2, z: (z0 + z1) / 2 })
            }
        }
    }
    return doors
}


/**
 * Returns the ways to go through from one door to all of the faces of a room, as the face each one is reached from
 */
function spread(world: PatchWorld, room: ReadonlySet<number>, from: number): Map<number, number>
{
    const reached = new Map([[from, -1]])
    for (const face of reached.keys())
    {
        for (let half = face * 4; half < face * 4 + 4; half++)
        {
            const other = faceOf(world.twin(half))
            if (room.has(other) && !reached.has(other))
            {
                reached.set(other, face)
            }
        }
    }
    return reached
}


/**
 * Returns the corners of the way from one door of a room to another, which cuts corners like heroes do
 */
function wayBetween(world: PatchWorld, walls: FloorWalls, room: ReadonlySet<number>, from: Door, to: Door): Point[]
{
    const reached = spread(world, room, faceOf(to.half))
    const points: Point[] = [[from.x, from.z]]
    for (let face = faceOf(from.half); face >= 0; face = reached.get(face) ?? -1)
    {
        points.push(faceCenter(world, face))
    }
    points.push([to.x, to.z])

    const way = [points[0]]
    for (let i = 0; i < points.length - 1;)
    {
        let j = points.length - 1
        while (j > i + 1 && !seesAcross(walls, ...points[i], ...points[j]))
        {
            j--
        }
        way.push(points[j])
        i = j
    }
    return way
}


function contains(world: PatchWorld, face: number, x: number, z: number): boolean
{
    let left = 0, right = 0
    for (let half = face * 4; half < face * 4 + 4; half++)
    {
        const [x0, z0, x1, z1] = ends(world, half)
        if ((x1 - x0) * (z - z0) - (z1 - z0) * (x - x0) < 0)
        {
            right++
        }
        else
        {
            left++
        }
    }
    return left === 0 || right === 0
}


/**
 * Returns the lines of fire that cross a way, from its start on
 */
function linesAcross(way: readonly Point[], open: (x: number, z: number) => boolean, crossed: (x: number, z: number) => boolean): FireLine[]
{
    const lines: FireLine[] = []
    const length = way.slice(1).reduce((sum, [x, z], i) => sum + Math.hypot(x - way[i][0], z - way[i][1]), 0)
    const count = Math.floor((length - 2 * SAFE_DISTANCE) / LINE_SPACING) + 1
    const first = (length - (count - 1) * LINE_SPACING) / 2

    let walked = 0
    for (let i = 1, line = 0; i < way.length; i++)
    {
        const [x0, z0] = way[i - 1]
        const [x1, z1] = way[i]
        const part = Math.hypot(x1 - x0, z1 - z0)
        const dx = (x1 - x0) / part, dz = (z1 - z0) / part
        for (; line < count && first + line * LINE_SPACING < walked + part; line++)
        {
            const along = first + line * LINE_SPACING - walked
            const x = x0 + dx * along, z = z0 + dz * along
            if (!open(x, z) || crossed(x, z))
            {
                continue
            }
            const strikes = [{ x, z }]
            for (const side of [1, -1])
            {
                for (let off = STRIKE_GAP; off <= LINE_REACH; off += STRIKE_GAP)
                {
                    const strike = { x: x - dz * side * off, z: z + dx * side * off }
                    if (!open(strike.x, strike.z))
                    {
                        break
                    }
                    if (side > 0)
                    {
                        strikes.push(strike)
                    }
                    else
                    {
                        strikes.unshift(strike)
                    }
                }
            }
            lines.push({ x, z, strikes })
        }
        walked += part
    }
    return lines
}


/**
 * Returns the closest wall to a point, as the point on its surface and the direction out of it, null without one
 */
function surfaceAt({ segments, cells }: FloorWalls, x: number, z: number): { x: number, z: number, nx: number, nz: number } | null
{
    let closest = Infinity
    let found: { x: number, z: number, nx: number, nz: number } | null = null
    for (const s of new Set([...cells.values()].flat()))
    {
        const x0 = segments[s], z0 = segments[s + 1]
        const ex = segments[s + 2] - x0, ez = segments[s + 3] - z0
        const length = Math.hypot(ex, ez)
        const t = Math.max(0, Math.min(1, ((x - x0) * ex + (z - z0) * ez) / (length * length)))
        const distance = Math.hypot(x - x0 - t * ex, z - z0 - t * ez)
        if (distance < closest && distance < 1)
        {
            closest = distance
            const side = (x - x0) * -ez + (z - z0) * ex < 0 ? -1 : 1
            const nx = -ez / length * side, nz = ex / length * side
            const half = segments[s + 4] === 0 && segments[s + 5] === 0 ? THIN_WALL_HALF : 0
            found = { x: x0 + t * ex + nx * half, z: z0 + t * ez + nz * half, nx, nz }
        }
    }
    return found
}


/**
 * Returns where on the wall next to a door a switch fits, if possible where it is seen well, otherwise as close to the door as
 * can be. Null if it doesn't fit.
 */
function placeLever(world: PatchWorld, walls: FloorWalls, room: ReadonlySet<number>, door: Door): FixtureSpot | null
{
    const inRoom = (half: number) => world.twin(half) >= 0 && room.has(faceOf(world.twin(half)))
    const [doorX0, doorZ0, doorX1, doorZ1] = ends(world, door.half)
    const doorHalf = Math.hypot(doorX1 - doorX0, doorZ1 - doorZ0) / 2
    let best: FixtureSpot | null = null
    let bestScore = Infinity

    for (const turn of [next, prev])
    {
        let half = door.half
        for (let walked = 0; walked < SWITCH_TO;)
        {
            half = turn(half)
            while (inRoom(half))
            {
                half = turn(world.twin(half))
            }
            if (world.edgeType(half) === EdgeType.DOOR.index)
            {
                break
            }
            const [x0, z0, x1, z1] = ends(world, half)
            const length = Math.hypot(x1 - x0, z1 - z0)
            const [midX, midZ] = faceCenter(world, faceOf(half))
            for (let along = SWITCH_STEP / 2; along < length; along += SWITCH_STEP)
            {
                const t = (turn === next ? along : length - along) / length
                const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t
                const inward = 0.2 / Math.hypot(midX - x, midZ - z)
                const surface = surfaceAt(walls, x + (midX - x) * inward, z + (midZ - z) * inward)
                const off = Math.hypot(x - door.x, z - door.z)
                if (!surface || walked + along < SWITCH_FROM || off > doorHalf + SWITCH_TO || !isFlat(walls, surface))
                {
                    continue
                }
                const facing = Math.atan2(surface.nx, surface.nz)
                // the view is always from the same side
                const score = off + (surface.nz < SEEN_FACING ? 10 : 0)
                if (score < bestScore)
                {
                    bestScore = score
                    best = { face: faceOf(half), x: surface.x, z: surface.z, facing }
                }
            }
            walked += length
        }
    }
    return best
}


/**
 * Returns whether a wall goes on to both sides of a spot on it for a switch to fit there, with nothing in front
 */
function isFlat(walls: FloorWalls, { x, z, nx, nz }: { x: number, z: number, nx: number, nz: number }): boolean
{
    return [-1, 1].every(side => {
        const sx = x + nz * SWITCH_HALF_WIDTH * 1.4 * side, sz = z - nx * SWITCH_HALF_WIDTH * 1.4 * side
        const surface = surfaceAt(walls, sx + nx * 0.1, sz + nz * 0.1)
        return surface !== null && Math.hypot(surface.x - sx, surface.z - sz) < SWITCH_FLATNESS && surface.nx * nx + surface.nz * nz > 0.95
    })
}


/**
 * Returns the walls close to the given room only
 */
function wallsAround(world: PatchWorld, room: ReadonlySet<number>, segments: Float64Array): FloorWalls
{
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
    for (const face of room)
    {
        const [x, z] = faceCenter(world, face)
        minX = Math.min(minX, x - 2)
        minZ = Math.min(minZ, z - 2)
        maxX = Math.max(maxX, x + 2)
        maxZ = Math.max(maxZ, z + 2)
    }
    const near: number[] = []
    for (let s = 0; s < segments.length; s += SEGMENT_SIZE)
    {
        const x = segments[s], z = segments[s + 1]
        if (x > minX && x < maxX && z > minZ && z < maxZ)
        {
            near.push(...segments.subarray(s, s + SEGMENT_SIZE))
        }
    }
    return createFloorWalls(new Float64Array(near), FIRE_RADIUS)
}


/**
 * Returns the fire room of a level: one that heroes have to go through on their way from the entrance to the main exit. Null
 * if there is none that is suitable.
 *
 * @param level     the level
 * @param world     world with all patches of the level
 * @param segments  walls of the level
 * @param seed      seed of the level
 * @param taken     rooms to leave out
 */
export function findFireRoom(
    { rooms, corridors }: Pick<DungeonLevel, "rooms" | "corridors">,
    world: PatchWorld,
    segments: Float64Array,
    seed: number,
    taken: ReadonlySet<number> = new Set()
): FireRoom | null
{
    const { mainPath } = findRoomRoles(rooms, corridors)
    const found: FireRoom[] = []
    for (let i = 1; i < mainPath.length - 1; i++)
    {
        const room = mainPath[i]
        const onwards = corridors.find(({ from, to }) => from === mainPath[i - 1] && to === room)
        const back = corridors.find(({ from, to }) => from === room && to === mainPath[i + 1])
        if (!taken.has(room) && onwards && back)
        {
            const planned = planRoom(world, segments, room, new Set(rooms[room]),
                [back.fromFace, back.faces[0] ?? back.toFace],
                [onwards.toFace, onwards.faces[onwards.faces.length - 1] ?? onwards.fromFace])
            if (planned)
            {
                found.push(planned)
            }
        }
    }
    const rank = ({ lever, lines }: FireRoom) => (lines.length >= GOOD_LINES ? 2 : 0) + (Math.cos(lever.facing) >= SEEN_FACING ? 1 : 0)
    const best = Math.max(...found.map(rank))
    const choice = found.filter(room => rank(room) === best)
    return choice.length > 0 ? choice[new Prando(seed + FIRE_ROOM_SEED).nextInt(0, choice.length - 1)] : null
}


/**
 * @param wayIn     face of the room and the one on the other side of the door heroes come in by
 * @param wayOut    face of the room and the one on the other side of the door they leave by
 */
function planRoom(
    world: PatchWorld, segments: Float64Array, room: number, faces: ReadonlySet<number>,
    wayIn: readonly [number, number], wayOut: readonly [number, number]
): FireRoom | null
{
    const doors = findDoors(world, faces)
    const doorOf = ([inside, outside]: readonly [number, number]) =>
        doors.find(({ half }) => faceOf(half) === inside && faceOf(world.twin(half)) === outside)
    const entry = doorOf(wayIn)
    const exit = doorOf(wayOut)
    // without a door of its own, the way on branches off the corridor and leaves out the room
    if (!entry || !exit || entry === exit)
    {
        return null
    }
    const walls = wallsAround(world, faces, segments)
    const lever = placeLever(world, walls, faces, exit)
    if (!lever)
    {
        return null
    }

    const safe = [...doors, lever]
    const open = (x: number, z: number) =>
        safe.every(spot => Math.hypot(spot.x - x, spot.z - z) >= SAFE_DISTANCE) &&
        wallDistance(walls, x, z) >= FIRE_RADIUS / 2 &&
        [...faces].some(face => contains(world, face, x, z))
    const lines: FireLine[] = []
    const crossed = (x: number, z: number) =>
        lines.some(({ strikes }) => strikes.some(strike => Math.hypot(strike.x - x, strike.z - z) < CROSSED_DISTANCE))
    const count = () => lines.reduce((sum, { strikes }) => sum + strikes.length, 0)

    const others = doors.filter(door => door !== entry && door !== exit)
    const pairs = [
        [entry, exit],
        ...others.map(door => [entry, door]),
        ...others.map(door => [door, exit]),
        ...others.flatMap((door, i) => others.slice(i + 1).map(other => [door, other]))
    ]
    for (const [from, to] of pairs)
    {
        for (const line of linesAcross(wayBetween(world, walls, faces, from, to), open, from === entry && to === exit ? () => false : crossed))
        {
            if (count() + line.strikes.length <= MAX_STRIKES)
            {
                lines.push(line)
            }
        }
        if (lines.length < MIN_LINES)
        {
            return null
        }
    }
    return { room, doors: [entry, exit, ...others].map(({ x, z }) => [x, z]), lines, lever }
}
