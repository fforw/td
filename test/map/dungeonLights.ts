import { assert, describe, it } from "vitest"

import {
    bakeLights,
    createLightView,
    findWallSegments,
    LIGHT_RADIUS,
    LIGHT_TEXELS,
    lightAt,
    lightDungeon,
    type LightSample,
    MAX_INFLUENCE,
    NO_WALL,
    placeLights,
    RIM_FADE_START,
    RIM_GATE_END,
    RIM_LIMIT,
    WALL_CLEARANCE
} from "../../src/map/dungeonLights"
import { generateDungeon } from "../../src/map/generateDungeon"
import { faceCount } from "../../src/map/QuadPatch"
import PatchWorld from "../../src/map/PatchWorld"
import { FACE_SIZE } from "../../src/map/scale"

const SEGMENT_SIZE = 6

function randomizer(seed: number)
{
    return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
}


/**
 * Same as lightAt() with many rays
 */
function brute(lx: number, lz: number, segments: Float64Array, px: number, pz: number): LightSample
{
    const d = Math.hypot(lx - px, lz - pz)
    const alpha = Math.asin(LIGHT_RADIUS / d), base = Math.atan2(lz - pz, lx - px)
    const reach = 1 - d * d / (MAX_INFLUENCE * MAX_INFLUENCE)
    const fade = reach * reach / (2 * LIGHT_RADIUS)
    const RAYS = 2000

    let energy = 0, x = 0, z = 0
    const step = 2 * alpha / RAYS
    for (let i = 0; i < RAYS; i++)
    {
        const angle = base - alpha + (i + 0.5) * step
        const rx = Math.cos(angle), rz = Math.sin(angle)
        let hit = false
        for (let s = 0; s < segments.length && !hit; s += SEGMENT_SIZE)
        {
            const ax = segments[s] - px, az = segments[s + 1] - pz
            const ex = segments[s + 2] - segments[s], ez = segments[s + 3] - segments[s + 1]
            const den = rx * ez - rz * ex
            const along = (ax * ez - az * ex) / den, on = (ax * rz - az * rx) / den
            hit = along > 0 && along < d && on >= 0 && on <= 1
        }
        if (!hit)
        {
            energy += step * fade
            x += rx * step * fade
            z += rz * step * fade
        }
    }
    return { energy, x, z }
}


function randomWalls(random: () => number): Float64Array
{
    const values: number[] = []
    for (let i = 0; i < 30; i++)
    {
        const x = random() * 12, z = random() * 12, angle = random() * Math.PI * 2, length = 0.5 + random() * 1.5
        values.push(x, z, x + Math.cos(angle) * length, z + Math.sin(angle) * length, 0, 0)
    }
    return new Float64Array(values)
}


function clearOfWalls(segments: Float64Array, x: number, z: number): boolean
{
    for (let s = 0; s < segments.length; s += SEGMENT_SIZE)
    {
        const ex = segments[s + 2] - segments[s], ez = segments[s + 3] - segments[s + 1]
        const t = Math.max(0, Math.min(1, ((x - segments[s]) * ex + (z - segments[s + 1]) * ez) / (ex * ex + ez * ez)))
        if (Math.hypot(segments[s] + ex * t - x, segments[s + 1] + ez * t - z) < LIGHT_RADIUS + 0.01)
        {
            return false
        }
    }
    return true
}


function connect(seed: number)
{
    const level = generateDungeon(seed, FACE_SIZE, 2, 2)
    const world = new PatchWorld()
    const slots = level.patches.map(patch => world.add(patch))
    return { level, world, slots, segments: findWallSegments(world, slots) }
}


describe("lightAt", () => {
    it("gives the same as many rays", () => {
        const random = randomizer(4711)
        const out: LightSample = { energy: 0, x: 0, z: 0 }
        let checked = 0, partial = 0
        for (let i = 0; i < 1000; i++)
        {
            const segments = randomWalls(random)
            const lx = random() * 12, lz = random() * 12, px = random() * 12, pz = random() * 12
            const d = Math.hypot(px - lx, pz - lz)
            if (d <= LIGHT_RADIUS || d >= MAX_INFLUENCE || !clearOfWalls(segments, lx, lz))
            {
                continue
            }

            lightAt(createLightView(lx, lz, segments), segments, px, pz, out)
            const rays = brute(lx, lz, segments, px, pz)
            // the rays can't tell apart much less than one of them
            const free = 2 * Math.asin(LIGHT_RADIUS / d)
            const reach = 1 - d * d / (MAX_INFLUENCE * MAX_INFLUENCE)
            const unblocked = free * reach * reach / (2 * LIGHT_RADIUS)
            assert.closeTo(out.energy, rays.energy, unblocked * 0.002)
            assert.closeTo(out.x, rays.x, unblocked * 0.002)
            assert.closeTo(out.z, rays.z, unblocked * 0.002)

            checked++
            const share = rays.energy / unblocked
            partial += share > 0.01 && share < 0.99 ? 1 : 0
        }
        assert(checked > 200)
        // the soft shadows themselves have to get tested
        assert(partial > 10)
    })

    it("ends at the reach of the light", () => {
        const segments = new Float64Array(0)
        const out: LightSample = { energy: 1, x: 1, z: 1 }
        const view = createLightView(0, 0, segments)
        lightAt(view, segments, MAX_INFLUENCE, 0, out)
        assert.equal(out.energy, 0)
        lightAt(view, segments, MAX_INFLUENCE - 1, 0, out)
        assert(out.energy > 0)
    })

    it("has no more rim at the rim limit", () => {
        const segments = new Float64Array(0)
        const out: LightSample = { energy: 0, x: 0, z: 0 }
        lightAt(createLightView(0, 0, segments), segments, RIM_LIMIT, 0, out)
        assert(Math.hypot(out.x, out.z) < RIM_FADE_START)
    })

    it("keeps its direction going inside of the light", () => {
        const segments = new Float64Array(0)
        const view = createLightView(0, 0, segments)
        const inside: LightSample = { energy: 0, x: 0, z: 0 }
        const outside: LightSample = { energy: 0, x: 0, z: 0 }
        lightAt(view, segments, LIGHT_RADIUS - 1e-6, 0, inside)
        lightAt(view, segments, LIGHT_RADIUS + 1e-6, 0, outside)
        assert.closeTo(inside.x, outside.x, 0.01)
        assert.closeTo(inside.energy, outside.energy, 0.01)
    })

    it("points to the light", () => {
        const segments = new Float64Array(0)
        const out: LightSample = { energy: 0, x: 0, z: 0 }
        lightAt(createLightView(3, 4, segments), segments, 3, 1, out)
        assert.closeTo(out.x, 0, 1e-9)
        assert(out.z > 0)
        assert.closeTo(out.z, out.energy, out.energy * 0.01)
    })
})


describe("findWallSegments", () => {
    it("has thick walls seen from the floor and thin walls with both sides", () => {
        const { segments } = connect(4711)
        let thick = 0, thin = 0
        for (let s = 0; s < segments.length; s += SEGMENT_SIZE)
        {
            if (segments[s + 4] === 0 && segments[s + 5] === 0)
            {
                thin++
            }
            else
            {
                thick++
            }
        }
        assert(thick > 100)
        assert(thin > 100)
    })
})


describe("placeLights", () => {
    it("keeps lights away from walls and from giving two rims at a point", () => {
        for (const seed of [4711, 12345])
        {
            const { level, world, segments } = connect(seed)
            const lights = placeLights(seed, world, level.rooms, segments)
            assert(lights.length >= 10)

            const views = lights.map(({ x, z }) => createLightView(x, z, segments))
            const a: LightSample = { energy: 0, x: 0, z: 0 }
            const b: LightSample = { energy: 0, x: 0, z: 0 }
            for (let i = 0; i < views.length; i++)
            {
                assert(clearOfWalls(segments, views[i].x, views[i].z))
                for (let j = i + 1; j < views.length; j++)
                {
                    const { x: ax, z: az } = views[i], { x: bx, z: bz } = views[j]
                    if (Math.hypot(ax - bx, az - bz) >= RIM_LIMIT * 2)
                    {
                        continue
                    }
                    // finer than the placement, at a level where a rim of a fifth of its strength shows
                    for (let z = Math.min(az, bz) - RIM_LIMIT; z < Math.max(az, bz) + RIM_LIMIT; z += 1 / LIGHT_TEXELS)
                    {
                        for (let x = Math.min(ax, bx) - RIM_LIMIT; x < Math.max(ax, bx) + RIM_LIMIT; x += 1 / LIGHT_TEXELS)
                        {
                            lightAt(views[i], segments, x, z, a)
                            lightAt(views[j], segments, x, z, b)
                            assert(
                                Math.hypot(a.x, a.z) < RIM_FADE_START * 1.5 ||
                                Math.hypot(b.x, b.z) < RIM_FADE_START * 1.5 ||
                                a.energy + b.energy >= RIM_GATE_END
                            )
                        }
                    }
                }
            }
        }
    })

    it("gives the same lights for the same seed", () => {
        const first = connect(4711)
        const second = connect(4711)
        assert.deepEqual(
            placeLights(4711, first.world, first.level.rooms, first.segments),
            placeLights(4711, second.world, second.level.rooms, second.segments)
        )
    })
})


describe("bakeLights", () => {
    it("adds up the lights at their texels", () => {
        const segments = new Float64Array(0)
        const bounds = { minX: 0, minZ: 0, maxX: 20, maxZ: 10 }
        const { width, height, colors, directions } = bakeLights(
            [{ x: 7, z: 5, color: [1, 0.5, 0] }, { x: 13, z: 5, color: [0, 0.5, 1] }],
            segments,
            bounds
        )
        assert.equal(width, 20 * LIGHT_TEXELS)
        assert.equal(height, 10 * LIGHT_TEXELS)
        assert.equal(colors.length, width * height * 4)
        assert.equal(directions.length, width * height * 2)

        const at = (x: number, z: number) => (Math.floor(z * LIGHT_TEXELS) * width + Math.floor(x * LIGHT_TEXELS))

        // west of the first light, where the other one doesn't reach
        const near = at(4, 5)
        assert(colors[near * 4 + 3] > 0)
        assert.closeTo(colors[near * 4], colors[near * 4 + 3], 1e-5)
        assert.closeTo(colors[near * 4 + 2], 0, 1e-5)
        assert(directions[near * 2] > 0)

        // both reach the middle from opposite sides
        const middle = at(10, 5)
        assert(colors[middle * 4] > 0 && colors[middle * 4 + 2] > 0)
        assert(Math.abs(directions[middle * 2]) < colors[middle * 4 + 3] / 2)
    })

    it("finds the closest wall for lookups near walls", () => {
        const segments = new Float64Array([
            2, 1, 2, 9, 0, 0,
            2.5, 1, 2.5, 9, 0, 0
        ])
        const { width, walls } = bakeLights([], segments, { minX: 0, minZ: 0, maxX: 10, maxZ: 10 })
        const wallAt = (x: number, z: number) => {
            const i = (Math.floor(z * LIGHT_TEXELS) * width + Math.floor(x * LIGHT_TEXELS)) * 4
            return [...walls.subarray(i, i + 4)]
        }

        assert.deepEqual(wallAt(1.9, 5), [2, 1, 2, 9])
        assert.deepEqual(wallAt(2.1, 5), [2, 1, 2, 9])
        assert.deepEqual(wallAt(2.4, 5), [2.5, 1, 2.5, 9])
        // has to be there for anything a lookup could mix with
        assert.deepEqual(wallAt(2 - WALL_CLEARANCE, 5), [2, 1, 2, 9])
        // past the end of the wall
        assert.deepEqual(wallAt(2, 0.9), [2, 1, 2, 9])

        assert.deepEqual(wallAt(5, 5), [NO_WALL, NO_WALL, NO_WALL, NO_WALL])
    })
})


describe("lightDungeon", () => {
    it("covers the level and has light on floors only near its lights", () => {
        const level = generateDungeon(4711, FACE_SIZE, 2, 2)
        assert(faceCount(level.patches[0]) > 0)
        const lighting = lightDungeon(4711, level)
        assert(lighting.lights.length >= 10)
        assert(lighting.colors.some(value => value > 0))

        const { minX, minZ, width, height, lights } = lighting
        for (const { x, z } of lights)
        {
            assert(x >= minX && x < minX + width / LIGHT_TEXELS)
            assert(z >= minZ && z < minZ + height / LIGHT_TEXELS)
        }
    })
})
