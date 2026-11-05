import { patchSeed, rng, withSeed } from "../math/random"
import { wallGround } from "./dungeonWalls"
import type { DungeonLevel } from "./generateDungeon"
import { EdgeType } from "./geometry"
import PatchWorld, { LOCAL_MASK, SLOT_SHIFT } from "./PatchWorld"
import { next } from "./QuadPatch"
import { SCALE } from "./scale"

const TAU = Math.PI * 2

/*
 * Lights of a dungeon level, baked into a light field over the plan of the level. Nothing is sampled: a point on the floor
 * gets the angle under which it sees a light, which is what is left of the light after taking away the angles of the walls
 * in front of it. That gives exact soft shadows. Lights are below the top of the walls, so a wall between a light and the
 * floor always blocks the way and the shadows on the floor are right in 2D.
 */

/**
 * Radius of the biggest light in world units, which sets the size of the soft shadows and the bright center. Walls have to stay
 * clear of it.
 */
export const LIGHT_RADIUS = 0.3

/**
 * How far the biggest light reaches in world units. A changed wall affects the lights within this distance, and the shadows of
 * these can change up to twice as far from the wall.
 */
export const MAX_INFLUENCE = 5

/**
 * How far the smallest light reaches in world units. The radius of a light goes with its reach.
 */
export const MIN_INFLUENCE = 2

/**
 * Reach of the light of a room as a multiple of the distance from its middle to its furthest face
 */
const ROOM_REACH = 2

/**
 * How much smaller to try a light that gives meeples two rims or doesn't fit
 */
const LIGHT_SHRINK = 0.8

/**
 * Own light of a point where the rim of a meeple starts to show and where it is fully there. The energy goes down with
 * distance, so the rim fades out at RIM_LIMIT.
 */
export const RIM_FADE_START = 0.025
export const RIM_FADE_END = 0.06

/**
 * Light of all lights at a point where the rim starts to go away and where it is gone. There is no need for a rim where the
 * light is strong enough to show on the meeple.
 */
export const RIM_GATE_START = 0.16
export const RIM_GATE_END = 0.45

/**
 * How far the biggest light gets a rim out of a meeple in world units. See rimLimit() for other lights.
 */
export const RIM_LIMIT = 4.2

/**
 * Resolution of the light field in texels per world unit
 */
export const LIGHT_TEXELS = 8

/**
 * How far from a wall a lookup in the light field has to be in world units so that all texels it mixes are on its side
 */
export const WALL_CLEARANCE = Math.SQRT2 / LIGHT_TEXELS

/**
 * Coordinates of the wall of a texel without any wall close to it, far enough to never push a lookup
 */
export const NO_WALL = 1e6

/**
 * Number of sectors around a light to find the walls of a point quickly
 */
const LIGHT_SECTORS = 128

/**
 * Values per wall segment in a segment array: start x and z, end x and z, x and z of the side a thick wall is seen from, which
 * is 0, 0 for thin walls seen from both sides
 */
const SEGMENT_SIZE = 6

const LIGHT_SALT = 0x11ab7

const LIGHT_COLORS: [number, number, number][] = [
    [1.0, 0.55, 0.18],
    [0.2, 0.55, 1.0],
    [1.0, 0.2, 0.55],
    [0.25, 0.9, 0.6],
    [0.65, 0.35, 1.0],
]


/**
 * Light of a dungeon level in world units
 */
export interface DungeonLight
{
    x: number
    z: number
    color: [number, number, number]

    /**
     * Radius of the light in world units
     */
    radius: number

    /**
     * How far the light reaches in world units
     */
    reach: number
}


/**
 * Baked light of a dungeon level
 */
export interface LevelLighting
{
    lights: DungeonLight[]

    /**
     * World position of the corner of the light field
     */
    minX: number
    minZ: number

    /**
     * Size of the light field in texels
     */
    width: number
    height: number

    /**
     * Per texel the light color times energy of all lights and the energy of all lights
     */
    colors: Float32Array

    /**
     * Per texel the sum of the directions of the seen parts of the lights in x and z. For a single light, its length is the
     * energy of the light unless that is very close.
     */
    directions: Float32Array

    /**
     * Per texel the start and end in x and z of the wall closest to it, for lookups to stay on their side of it, or NO_WALL
     * if none is within reach of a lookup at the texel. The field itself can't have an edge as sharp as a thin wall.
     */
    walls: Float32Array
}


/**
 * A light with the walls that can get between it and the points it reaches
 */
export interface LightView
{
    x: number
    z: number
    radius: number
    reach: number

    /**
     * How far the light gets a rim out of a meeple in world units
     */
    rimLimit: number

    /**
     * Offsets into the segment array by the sector a point is in, seen from the light
     */
    sectors: number[][]
}


function segmentDistance(segments: Float64Array, s: number, x: number, z: number): number
{
    const ex = segments[s + 2] - segments[s], ez = segments[s + 3] - segments[s + 1]
    const t = Math.max(0, Math.min(1, ((x - segments[s]) * ex + (z - segments[s + 1]) * ez) / (ex * ex + ez * ez)))
    return Math.hypot(segments[s] + ex * t - x, segments[s + 1] + ez * t - z)
}


function sectorOf(angle: number): number
{
    return Math.floor((angle / TAU + 1) * LIGHT_SECTORS) % LIGHT_SECTORS
}


/**
 * Returns the walls of a level in world units
 *
 * @param world     world with all patches of the level
 * @param slots     slots of the patches of the level
 *
 * @return segment array
 */
export function findWallSegments(world: PatchWorld, slots: readonly number[]): Float64Array
{
    const values: number[] = []
    for (const slot of slots)
    {
        for (const [x0, z0, x1, z1] of wallGround(world, slot).outline)
        {
            values.push(x0 * SCALE, z0 * SCALE, x1 * SCALE, z1 * SCALE, z0 - z1, x1 - x0)
        }

        const { positions, vertex, edgeType } = world.getPatch(slot)
        const base = slot << SLOT_SHIFT
        for (let h = 0; h < edgeType.length; h++)
        {
            // like with the meshes, the lower global id stands for both half edges
            if (edgeType[h] === EdgeType.WALL.index && (base | h) < world.twin(base | h))
            {
                const v0 = vertex[h] * 3, v1 = vertex[next(h)] * 3
                values.push(
                    positions[v0] * SCALE, positions[v0 + 1] * SCALE,
                    positions[v1] * SCALE, positions[v1 + 1] * SCALE,
                    0, 0
                )
            }
        }
    }
    return new Float64Array(values)
}


/**
 * Returns how far a light with the given reach gets a rim out of a meeple. Without walls, the own light of a point at distance
 * d is (1 - d² / reach²)² / d, whatever the radius of the light is. Lights this far from each other added up can't have rims at
 * the same point, closer lights need walls between them.
 *
 * @param reach     how far the light reaches
 */
export function rimLimit(reach: number): number
{
    let low = 0, high = reach
    for (let i = 0; i < 30; i++)
    {
        const d = (low + high) / 2
        const fade = 1 - d * d / (reach * reach)
        if (fade * fade / d > RIM_FADE_START)
        {
            low = d
        }
        else
        {
            high = d
        }
    }
    return high
}


/**
 * Prepares a light for lightAt(). A wall at distance d from the light can only be in the way of a point if the angles of the
 * two seen from the light are less than asin(radius / d) apart.
 *
 * @param x         position of the light
 * @param z         position of the light
 * @param segments  segment array
 * @param radius    radius of the light
 * @param reach     how far the light reaches
 */
export function createLightView(
    x: number,
    z: number,
    segments: Float64Array,
    radius = LIGHT_RADIUS,
    reach = MAX_INFLUENCE
): LightView
{
    const sectors: number[][] = Array.from({ length: LIGHT_SECTORS }, () => [])
    for (let s = 0; s < segments.length; s += SEGMENT_SIZE)
    {
        const distance = segmentDistance(segments, s, x, z)
        const nx = segments[s + 4], nz = segments[s + 5]
        // the far side of a thick wall is never in front of its near side
        if (distance > reach || (x - segments[s]) * nx + (z - segments[s + 1]) * nz < 0)
        {
            continue
        }

        const ax = segments[s] - x, az = segments[s + 1] - z, bx = segments[s + 2] - x, bz = segments[s + 3] - z
        const start = Math.atan2(az, ax)
        const span = Math.atan2(ax * bz - az * bx, ax * bx + az * bz)
        const widen = distance > radius ? Math.asin(radius / distance) : Math.PI
        const from = Math.min(start, start + span) - widen, to = Math.max(start, start + span) + widen
        const count = Math.min(LIGHT_SECTORS, Math.ceil((to - from) / TAU * LIGHT_SECTORS) + 1)
        const first = sectorOf(((from % TAU) + TAU) % TAU)
        for (let i = 0; i < count; i++)
        {
            sectors[(first + i) % LIGHT_SECTORS].push(s)
        }
    }
    return { x, z, radius, reach, rimLimit: rimLimit(reach), sectors }
}


/**
 * What a point gets from a light
 */
export interface LightSample
{
    /**
     * Seen angle of the light relative to its size, faded out toward its reach
     */
    energy: number

    /**
     * Sum of the directions of the seen parts of the light, with the same scale
     */
    x: number
    z: number
}


// angles blocked by walls, sorted by their start
const blockedFrom: number[] = []
const blockedTo: number[] = []

/**
 * Finds out what the given point gets from the light. Walls must not reach into the light.
 *
 * @param view      light
 * @param segments  segment array the light was prepared with
 * @param px        position of the point
 * @param pz        position of the point
 * @param out       receives the result
 */
export function lightAt(view: LightView, segments: Float64Array, px: number, pz: number, out: LightSample): void
{
    const { radius, reach } = view
    const dx = view.x - px, dz = view.z - pz
    const d = Math.hypot(dx, dz)
    const left = 1 - d * d / (reach * reach)
    if (left <= 0)
    {
        out.energy = out.x = out.z = 0
        return
    }
    const fade = left * left / (2 * radius)

    if (d <= radius)
    {
        // from all around, with the direction going on to nothing in the center
        out.energy = Math.PI * fade
        out.x = dx * 2 / radius * fade
        out.z = dz * 2 / radius * fade
        return
    }

    const alpha = Math.asin(radius / d)
    const ux = dx / d, uz = dz / d

    let count = 0
    for (const s of view.sectors[sectorOf(Math.atan2(-dz, -dx))])
    {
        const ax = segments[s] - px, az = segments[s + 1] - pz, bx = segments[s + 2] - px, bz = segments[s + 3] - pz

        // angles relative to the direction of the light
        const start = Math.atan2(ux * az - uz * ax, ux * ax + uz * az)
        const span = Math.atan2(ax * bz - az * bx, ax * bx + az * bz)
        const from = Math.min(start, start + span), to = Math.max(start, start + span)

        for (let shift = -TAU; shift <= TAU; shift += TAU)
        {
            const lo = Math.max(from + shift, -alpha), hi = Math.min(to + shift, alpha)
            if (lo >= hi)
            {
                continue
            }

            // it only blocks the light if it is closer than the light
            const middle = (lo + hi) / 2, cos = Math.cos(middle), sin = Math.sin(middle)
            const rx = cos * ux - sin * uz, rz = sin * ux + cos * uz
            const ex = bx - ax, ez = bz - az
            const den = rx * ez - rz * ex
            const hit = den === 0 ? -1 : (ax * ez - az * ex) / den
            if (hit > 0 && hit < d)
            {
                let i = count++
                while (i > 0 && blockedFrom[i - 1] > lo)
                {
                    blockedFrom[i] = blockedFrom[i - 1]
                    blockedTo[i] = blockedTo[i - 1]
                    i--
                }
                blockedFrom[i] = lo
                blockedTo[i] = hi
            }
        }
    }

    let angle = 0, along = 0, across = 0
    let at = -alpha
    for (let i = 0; i <= count; i++)
    {
        const end = i < count ? blockedFrom[i] : alpha
        if (end > at)
        {
            angle += end - at
            along += Math.sin(end) - Math.sin(at)
            across += Math.cos(at) - Math.cos(end)
        }
        if (i < count && blockedTo[i] > at)
        {
            at = blockedTo[i]
        }
    }

    out.energy = angle * fade
    out.x = (along * ux - across * uz) * fade
    out.z = (along * uz + across * ux) * fade
}


const sampleA: LightSample = { energy: 0, x: 0, z: 0 }
const sampleB: LightSample = { energy: 0, x: 0, z: 0 }

/**
 * Returns whether there is a point where a meeple would get a rim from both lights
 */
export function rimsOverlap(a: LightView, b: LightView, segments: Float64Array): boolean
{
    const minX = Math.max(a.x - a.rimLimit, b.x - b.rimLimit), maxX = Math.min(a.x + a.rimLimit, b.x + b.rimLimit)
    const minZ = Math.max(a.z - a.rimLimit, b.z - b.rimLimit), maxZ = Math.min(a.z + a.rimLimit, b.z + b.rimLimit)
    for (let z = minZ; z < maxZ; z += 1 / LIGHT_TEXELS)
    {
        for (let x = minX; x < maxX; x += 1 / LIGHT_TEXELS)
        {
            lightAt(a, segments, x, z, sampleA)
            if (Math.hypot(sampleA.x, sampleA.z) >= RIM_FADE_START)
            {
                lightAt(b, segments, x, z, sampleB)
                if (Math.hypot(sampleB.x, sampleB.z) >= RIM_FADE_START && sampleA.energy + sampleB.energy < RIM_GATE_END)
                {
                    return true
                }
            }
        }
    }
    return false
}


/**
 * Returns the center of the given global face in world units
 */
export function faceCenter(world: PatchWorld, face: number): [number, number]
{
    const { positions, vertex } = world.getPatch(face >> (SLOT_SHIFT - 2))
    const local = face & (LOCAL_MASK >> 2)
    let x = 0, z = 0
    for (let h = local * 4; h < local * 4 + 4; h++)
    {
        x += positions[vertex[h] * 3]
        z += positions[vertex[h] * 3 + 1]
    }
    return [x / 4 * SCALE, z / 4 * SCALE]
}


/**
 * Places up to one light in the middle of each room, the biggest rooms first. Big rooms get big lights. The light of a room
 * gets smaller until it no longer gives meeples two rims at the same point, and the room stays dark if even the smallest light
 * does. Doors count as open.
 *
 * @param seed      seed of the level
 * @param world     world with all patches of the level
 * @param rooms     global face ids per room
 * @param segments  segment array
 */
export function placeLights(
    seed: number,
    world: PatchWorld,
    rooms: readonly number[][],
    segments: Float64Array
): DungeonLight[]
{
    return withSeed(patchSeed(seed ^ LIGHT_SALT, 0, 0), () => {
        const lights: DungeonLight[] = []
        const views: LightView[] = []

        for (const room of [...rooms].sort((a, b) => b.length - a.length))
        {
            const centers = room.map(face => faceCenter(world, face))
            const midX = centers.reduce((sum, [x]) => sum + x, 0) / centers.length
            const midZ = centers.reduce((sum, [, z]) => sum + z, 0) / centers.length

            centers.sort((a, b) => Math.hypot(a[0] - midX, a[1] - midZ) - Math.hypot(b[0] - midX, b[1] - midZ))
            const [lastX, lastZ] = centers[centers.length - 1]
            const roomReach = Math.hypot(lastX - midX, lastZ - midZ) * ROOM_REACH

            for (
                let reach = Math.max(MIN_INFLUENCE, Math.min(MAX_INFLUENCE, roomReach));
                reach >= MIN_INFLUENCE;
                reach *= LIGHT_SHRINK
            )
            {
                const radius = LIGHT_RADIUS * reach / MAX_INFLUENCE
                const center = centers.find(([x, z]) => {
                    for (let s = 0; s < segments.length; s += SEGMENT_SIZE)
                    {
                        if (segmentDistance(segments, s, x, z) <= radius)
                        {
                            return false
                        }
                    }
                    return true
                })
                if (!center)
                {
                    continue
                }

                const [x, z] = center
                const view = createLightView(x, z, segments, radius, reach)
                if (views.some(other =>
                    Math.hypot(other.x - x, other.z - z) < other.rimLimit + view.rimLimit && rimsOverlap(other, view, segments)))
                {
                    continue
                }
                views.push(view)
                lights.push({ x, z, color: LIGHT_COLORS[rng.nextInt(0, LIGHT_COLORS.length - 1)], radius, reach })
                break
            }
        }
        return lights
    })
}


/**
 * Finds the closest wall of every texel that has one within reach of a lookup at the texel
 *
 * @param segments  segment array
 * @param minX      world position of the corner of the light field
 * @param minZ      world position of the corner of the light field
 * @param width     size of the light field in texels
 * @param height    size of the light field in texels
 *
 * @return start and end in x and z per texel
 */
function bakeWalls(segments: Float64Array, minX: number, minZ: number, width: number, height: number): Float32Array
{
    // a lookup needs the wall if it is too close to it, from anywhere in its texel
    const reach = WALL_CLEARANCE + Math.SQRT1_2 / LIGHT_TEXELS

    const walls = new Float32Array(width * height * 4).fill(NO_WALL)
    const closest = new Float64Array(width * height).fill(reach)

    for (let s = 0; s < segments.length; s += SEGMENT_SIZE)
    {
        const fromX = Math.max(0, Math.floor((Math.min(segments[s], segments[s + 2]) - reach - minX) * LIGHT_TEXELS))
        const toX = Math.min(width, Math.ceil((Math.max(segments[s], segments[s + 2]) + reach - minX) * LIGHT_TEXELS))
        const fromZ = Math.max(0, Math.floor((Math.min(segments[s + 1], segments[s + 3]) - reach - minZ) * LIGHT_TEXELS))
        const toZ = Math.min(height, Math.ceil((Math.max(segments[s + 1], segments[s + 3]) + reach - minZ) * LIGHT_TEXELS))

        for (let tz = fromZ; tz < toZ; tz++)
        {
            for (let tx = fromX; tx < toX; tx++)
            {
                const distance = segmentDistance(segments, s, minX + (tx + 0.5) / LIGHT_TEXELS, minZ + (tz + 0.5) / LIGHT_TEXELS)
                const i = tz * width + tx
                if (distance < closest[i])
                {
                    closest[i] = distance
                    walls[i * 4] = segments[s]
                    walls[i * 4 + 1] = segments[s + 1]
                    walls[i * 4 + 2] = segments[s + 2]
                    walls[i * 4 + 3] = segments[s + 3]
                }
            }
        }
    }
    return walls
}


const sample: LightSample = { energy: 0, x: 0, z: 0 }

/**
 * Bakes the given lights into a light field for the given level
 *
 * @param lights    lights
 * @param segments  segment array
 * @param bounds    world coordinates of the area of the level
 */
export function bakeLights(
    lights: DungeonLight[],
    segments: Float64Array,
    { minX, minZ, maxX, maxZ }: { minX: number, minZ: number, maxX: number, maxZ: number }
): LevelLighting
{
    const width = Math.ceil((maxX - minX) * LIGHT_TEXELS)
    const height = Math.ceil((maxZ - minZ) * LIGHT_TEXELS)
    const colors = new Float32Array(width * height * 4)
    const directions = new Float32Array(width * height * 2)

    for (const { x, z, color, radius, reach } of lights)
    {
        const view = createLightView(x, z, segments, radius, reach)
        const fromX = Math.max(0, Math.floor((x - reach - minX) * LIGHT_TEXELS))
        const toX = Math.min(width, Math.ceil((x + reach - minX) * LIGHT_TEXELS))
        const fromZ = Math.max(0, Math.floor((z - reach - minZ) * LIGHT_TEXELS))
        const toZ = Math.min(height, Math.ceil((z + reach - minZ) * LIGHT_TEXELS))

        for (let tz = fromZ; tz < toZ; tz++)
        {
            for (let tx = fromX; tx < toX; tx++)
            {
                lightAt(view, segments, minX + (tx + 0.5) / LIGHT_TEXELS, minZ + (tz + 0.5) / LIGHT_TEXELS, sample)
                if (sample.energy > 0)
                {
                    const i = tz * width + tx
                    colors[i * 4] += sample.energy * color[0]
                    colors[i * 4 + 1] += sample.energy * color[1]
                    colors[i * 4 + 2] += sample.energy * color[2]
                    colors[i * 4 + 3] += sample.energy
                    directions[i * 2] += sample.x
                    directions[i * 2 + 1] += sample.z
                }
            }
        }
    }
    return { lights, minX, minZ, width, height, colors, directions, walls: bakeWalls(segments, minX, minZ, width, height) }
}


/**
 * Finds how far a moving light sees in all directions, which is quick enough to do whenever it moves. Direction i has the
 * angle (i + 0.5) / out.length of a full turn.
 *
 * @param segments  segment array
 * @param x         position of the light
 * @param z         position of the light
 * @param reach     distance for directions without a wall
 * @param out       receives the distances
 */
export function castWallDistances(segments: Float64Array, x: number, z: number, reach: number, out: Float32Array): void
{
    const count = out.length
    out.fill(reach)
    for (let s = 0; s < segments.length; s += SEGMENT_SIZE)
    {
        // the far side of a thick wall is never in front of its near side
        if (segmentDistance(segments, s, x, z) >= reach ||
            (x - segments[s]) * segments[s + 4] + (z - segments[s + 1]) * segments[s + 5] < 0)
        {
            continue
        }

        const ax = segments[s] - x, az = segments[s + 1] - z, bx = segments[s + 2] - x, bz = segments[s + 3] - z
        const ex = bx - ax, ez = bz - az
        const start = Math.atan2(az, ax)
        const span = Math.atan2(ax * bz - az * bx, ax * bx + az * bz)
        const first = Math.floor(Math.min(start, start + span) / TAU * count)
        const last = Math.ceil(Math.max(start, start + span) / TAU * count)

        for (let i = first; i <= last; i++)
        {
            const angle = (i + 0.5) / count * TAU
            const rx = Math.cos(angle), rz = Math.sin(angle)
            const den = rx * ez - rz * ex
            const along = (ax * ez - az * ex) / den, on = (ax * rz - az * rx) / den
            const direction = (i + count) % count
            if (along > 0 && on >= 0 && on <= 1 && along < out[direction])
            {
                out[direction] = along
            }
        }
    }
}


/**
 * Places the lights of a level and bakes them
 *
 * @param seed      seed of the level
 * @param level     generated level
 */
export function lightDungeon(seed: number, { patches, rooms }: DungeonLevel): LevelLighting
{
    const world = new PatchWorld()
    const slots = patches.map(patch => world.add(patch))
    const segments = findWallSegments(world, slots)

    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
    for (const { positions } of patches)
    {
        for (let i = 0; i < positions.length; i += 3)
        {
            minX = Math.min(minX, positions[i] * SCALE)
            maxX = Math.max(maxX, positions[i] * SCALE)
            minZ = Math.min(minZ, positions[i + 1] * SCALE)
            maxZ = Math.max(maxZ, positions[i + 1] * SCALE)
        }
    }
    return bakeLights(placeLights(seed, world, rooms, segments), segments, { minX, minZ, maxX, maxZ })
}
