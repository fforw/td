import { assert, describe, it } from "vitest"

import {
    bakeLights,
    castWallDistances,
    createLightView,
    findWallSegments,
    levelBounds,
    LIGHT_CHANNELS,
    LIGHT_RADIUS,
    LIGHT_TEXELS,
    lightAt,
    lightDungeon,
    type LightSample,
    lightShare,
    MAX_INFLUENCE,
    MAX_LIGHTS,
    MIN_INFLUENCE,
    RIM_CHECK_STEP,
    NO_WALL,
    placeLights,
    RIM_FADE_START,
    RIM_GATE_END,
    RIM_LIMIT,
    rimLimit,
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


function clearOfWalls(segments: Float64Array, x: number, z: number, radius = LIGHT_RADIUS): boolean
{
    for (let s = 0; s < segments.length; s += SEGMENT_SIZE)
    {
        const ex = segments[s + 2] - segments[s], ez = segments[s + 3] - segments[s + 1]
        const t = Math.max(0, Math.min(1, ((x - segments[s]) * ex + (z - segments[s + 1]) * ez) / (ex * ex + ez * ez)))
        if (Math.hypot(segments[s] + ex * t - x, segments[s + 1] + ez * t - z) < radius)
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
    return { level, world, slots, segments: findWallSegments(world, slots), bounds: levelBounds(level.patches) }
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

    it("ends at the reach of a smaller light, with the same light further out whatever its radius", () => {
        const segments = new Float64Array(0)
        const out: LightSample = { energy: 1, x: 1, z: 1 }
        lightAt(createLightView(0, 0, segments, 0.1, 3), segments, 3, 0, out)
        assert.equal(out.energy, 0)

        const small: LightSample = { energy: 0, x: 0, z: 0 }
        const big: LightSample = { energy: 0, x: 0, z: 0 }
        lightAt(createLightView(0, 0, segments, 0.1, 3), segments, 2, 0, small)
        lightAt(createLightView(0, 0, segments, 0.3, 3), segments, 2, 0, big)
        assert.closeTo(small.x, big.x, 1e-9)
        assert.closeTo(small.energy, big.energy, big.energy * 0.01)
    })

    it("has a sharper shadow with a smaller radius", () => {
        // a wall from z = 0 to the north, halfway to the light, and a point behind its end
        const segments = new Float64Array([2, 0, 2, 5, 0, 0])
        const share = (radius: number, z: number) => {
            const out: LightSample = { energy: 0, x: 0, z: 0 }
            lightAt(createLightView(0, 0, segments, radius, MAX_INFLUENCE), segments, 4, z, out)
            const free: LightSample = { energy: 0, x: 0, z: 0 }
            lightAt(createLightView(0, 0, new Float64Array(0), radius, MAX_INFLUENCE), new Float64Array(0), 4, z, free)
            return out.energy / free.energy
        }
        // inside of the soft shadow of the big light and outside of the one of the small light
        assert(share(0.3, -0.1) > 0.1 && share(0.3, -0.1) < 0.9)
        assert.equal(share(0.05, -0.1), 1)
    })

    it("has no more rim at the rim limit of any light", () => {
        const segments = new Float64Array(0)
        const out: LightSample = { energy: 0, x: 0, z: 0 }
        assert(rimLimit(MAX_INFLUENCE) <= RIM_LIMIT)
        for (const reach of [MIN_INFLUENCE, 3, MAX_INFLUENCE])
        {
            const limit = rimLimit(reach)
            const view = createLightView(0, 0, segments, 0.1, reach)
            lightAt(view, segments, limit + 0.01, 0, out)
            assert(Math.hypot(out.x, out.z) < RIM_FADE_START)
            lightAt(view, segments, limit - 0.01, 0, out)
            assert(Math.hypot(out.x, out.z) > RIM_FADE_START)
        }
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


describe("lightShare", () => {
    it("goes from all of the light in the open to nothing behind a wall", () => {
        const open = new Float64Array(0)
        const wall = new Float64Array([2, -3, 2, 3, 0, 0])
        const out: LightSample = { energy: 0, x: 0, z: 0 }
        for (const [px, pz] of [[0.1, 0], [1.5, 0], [0, 4]])
        {
            const view = createLightView(0, 0, open)
            lightAt(view, open, px, pz, out)
            assert.closeTo(lightShare(view, px, pz, out.energy), 1, 1e-9)
        }

        const view = createLightView(0, 0, wall)
        lightAt(view, wall, 3, 0, out)
        assert.equal(lightShare(view, 3, 0, out.energy), 0)
        assert.equal(lightShare(view, MAX_INFLUENCE, 0, 0), 0)
    })

    it("gives the energy and direction of lightAt() in the open, the way the shader works them out", () => {
        const segments = new Float64Array(0)
        const out: LightSample = { energy: 0, x: 0, z: 0 }
        const radius = 0.2, reach = 3
        const view = createLightView(1, 2, segments, radius, reach)
        for (const [px, pz] of [[1.05, 2], [1.1, 2.1], [1, 2.3], [2, 3], [0, 0.5], [3.5, 2]])
        {
            lightAt(view, segments, px, pz, out)
            const tx = 1 - px, tz = 2 - pz
            const d = Math.hypot(tx, tz)
            const left = 1 - d * d / (reach * reach)
            const fade = left * left / (2 * radius)
            const near = d > radius ? radius / d : d / radius
            assert.closeTo((d > radius ? 2 * Math.asin(radius / d) : Math.PI) * fade, out.energy, 1e-9)
            assert.closeTo(tx / d * 2 * near * fade, out.x, 1e-9)
            assert.closeTo(tz / d * 2 * near * fade, out.z, 1e-9)
        }
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
            const { level, world, segments, bounds } = connect(seed)
            const lights = placeLights(seed, world, level.rooms, segments, bounds)
            assert(lights.length >= 10)
            assert(lights.length <= MAX_LIGHTS)

            // lights of different sizes, and all of them within the limits
            assert(new Set(lights.map(({ reach }) => reach)).size > 1)
            for (const { radius, reach } of lights)
            {
                assert(reach >= MIN_INFLUENCE && reach <= MAX_INFLUENCE)
                assert(radius > 0 && radius <= LIGHT_RADIUS)
            }

            const views = lights.map(({ x, z, radius, reach }) => createLightView(x, z, segments, radius, reach))
            const a: LightSample = { energy: 0, x: 0, z: 0 }
            const b: LightSample = { energy: 0, x: 0, z: 0 }
            // counted, as asserting all the points takes too long
            let overlaps = 0
            for (let i = 0; i < views.length; i++)
            {
                assert(clearOfWalls(segments, views[i].x, views[i].z, views[i].radius))
                for (let j = i + 1; j < views.length; j++)
                {
                    const { x: ax, z: az } = views[i], { x: bx, z: bz } = views[j]
                    if (Math.hypot(ax - bx, az - bz) >= RIM_LIMIT * 2)
                    {
                        continue
                    }
                    // as fine as the placement, at a level where a rim of a fifth of its strength shows
                    for (let z = Math.min(az, bz) - RIM_LIMIT; z < Math.max(az, bz) + RIM_LIMIT; z += RIM_CHECK_STEP)
                    {
                        for (let x = Math.min(ax, bx) - RIM_LIMIT; x < Math.max(ax, bx) + RIM_LIMIT; x += RIM_CHECK_STEP)
                        {
                            lightAt(views[i], segments, x, z, a)
                            lightAt(views[j], segments, x, z, b)
                            overlaps += Math.hypot(a.x, a.z) < RIM_FADE_START * 1.5 ||
                                Math.hypot(b.x, b.z) < RIM_FADE_START * 1.5 ||
                                a.energy + b.energy >= RIM_GATE_END ? 0 : 1
                        }
                    }
                }
            }
            assert.equal(overlaps, 0)
        }
    })

    it("gives the same lights for the same seed", () => {
        const first = connect(4711)
        const second = connect(4711)
        assert.deepEqual(
            placeLights(4711, first.world, first.level.rooms, first.segments, first.bounds),
            placeLights(4711, second.world, second.level.rooms, second.segments, second.bounds)
        )
    })
})


describe("bakeLights", () => {
    it("keeps the share of each light in its channel", () => {
        // a wall between the east light and the texels west of it
        const segments = new Float64Array([9, 3, 9, 7, 0, 0])
        const { width, height, visibility, lightIds } = bakeLights(
            [
                { x: 7, z: 5, color: [1, 0.5, 0], radius: LIGHT_RADIUS, reach: MAX_INFLUENCE, channel: 0 },
                { x: 13, z: 5, color: [0, 0.5, 1], radius: LIGHT_RADIUS, reach: MAX_INFLUENCE, channel: 2 }
            ],
            segments,
            { minX: 0, minZ: 0, maxX: 20, maxZ: 10 }
        )
        assert.equal(width, 20 * LIGHT_TEXELS)
        assert.equal(height, 10 * LIGHT_TEXELS)
        assert.equal(visibility.length, width * height * LIGHT_CHANNELS)
        assert.equal(lightIds.length, width * height * LIGHT_CHANNELS)

        const at = (x: number, z: number) => (Math.floor(z * LIGHT_TEXELS) * width + Math.floor(x * LIGHT_TEXELS)) * LIGHT_CHANNELS

        // in the open, near the first light and with the second one out of reach
        const near = at(5, 5)
        assert.equal(visibility[near], 255)
        assert.equal(lightIds[near], 1)
        assert.equal(visibility[near + 2], 0)
        assert.equal(lightIds[near + 2], 0)

        // the second light right behind the wall from it
        const behind = at(8.5, 5)
        assert.equal(visibility[behind], 255)
        assert.equal(lightIds[behind], 1)
        assert.equal(visibility[behind + 2], 0)

        // only the second light
        const east = at(16, 5)
        assert.equal(visibility[east], 0)
        assert.equal(visibility[east + 2], 255)
        assert.equal(lightIds[east + 2], 2)

        // nothing in other channels
        assert.equal(visibility[near + 1] + visibility[near + 3], 0)
        assert.equal(lightIds[near + 1] + lightIds[near + 3], 0)
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


describe("castWallDistances", () => {
    it("finds the same as going through all walls per direction", () => {
        const random = randomizer(4711)
        const out = new Float32Array(256)
        let hits = 0
        for (let i = 0; i < 50; i++)
        {
            const segments = randomWalls(random)
            const x = random() * 12, z = random() * 12
            castWallDistances(segments, x, z, 4, out)

            for (let d = 0; d < out.length; d++)
            {
                const angle = (d + 0.5) / out.length * Math.PI * 2
                const rx = Math.cos(angle), rz = Math.sin(angle)
                let closest = 4
                for (let s = 0; s < segments.length; s += SEGMENT_SIZE)
                {
                    const ax = segments[s] - x, az = segments[s + 1] - z
                    const ex = segments[s + 2] - segments[s], ez = segments[s + 3] - segments[s + 1]
                    const den = rx * ez - rz * ex
                    const along = (ax * ez - az * ex) / den, on = (ax * rz - az * rx) / den
                    if (along > 0 && on >= 0 && on <= 1)
                    {
                        closest = Math.min(closest, along)
                    }
                }
                assert.closeTo(out[d], closest, 1e-5)
                hits += closest < 4 ? 1 : 0
            }
        }
        assert(hits > 1000)
    })

    it("sees past the far side of a thick wall", () => {
        // a wall to the east, seen from its east side only
        const segments = new Float64Array([2, -1, 2, 1, 1, 0])
        const out = new Float32Array(64)
        castWallDistances(segments, 0, 0, 4, out)
        assert.equal(out[0], 4)
        castWallDistances(segments, 3, 0, 4, out)
        assert.closeTo(out[32], 1, 0.01)
    })
})


describe("lightDungeon", () => {
    it("covers the level and has light on floors only near its lights", () => {
        const level = generateDungeon(4711, FACE_SIZE, 2, 2)
        assert(faceCount(level.patches[0]) > 0)
        const lighting = lightDungeon(4711, level)
        assert(lighting.lights.length >= 10)
        assert(lighting.visibility.some(value => value > 0))

        const { minX, minZ, width, height, lights } = lighting
        for (const { x, z } of lights)
        {
            assert(x >= minX && x < minX + width / LIGHT_TEXELS)
            assert(z >= minZ && z < minZ + height / LIGHT_TEXELS)
        }
    })

    it("never has two lights in one channel at a texel", () => {
        for (const seed of [4711, 12345])
        {
            const { segments } = connect(seed)
            const { lights, minX, minZ, width, height, visibility, lightIds } = lightDungeon(seed, generateDungeon(seed, FACE_SIZE, 2, 2))
            const out: LightSample = { energy: 0, x: 0, z: 0 }
            const owners = new Int16Array(width * height * LIGHT_CHANNELS).fill(-1)
            // counted, as asserting all the texels takes too long
            let shared = 0, wrong = 0
            lights.forEach(({ x, z, radius, reach, channel }, index) => {
                const view = createLightView(x, z, segments, radius, reach)
                const fromX = Math.max(0, Math.floor((x - reach - minX) * LIGHT_TEXELS))
                const toX = Math.min(width, Math.ceil((x + reach - minX) * LIGHT_TEXELS))
                const fromZ = Math.max(0, Math.floor((z - reach - minZ) * LIGHT_TEXELS))
                const toZ = Math.min(height, Math.ceil((z + reach - minZ) * LIGHT_TEXELS))
                for (let tz = fromZ; tz < toZ; tz++)
                {
                    for (let tx = fromX; tx < toX; tx++)
                    {
                        const px = minX + (tx + 0.5) / LIGHT_TEXELS, pz = minZ + (tz + 0.5) / LIGHT_TEXELS
                        lightAt(view, segments, px, pz, out)
                        if (Math.round(lightShare(view, px, pz, out.energy) * 255) > 0)
                        {
                            const i = (tz * width + tx) * LIGHT_CHANNELS + channel
                            shared += owners[i] === -1 ? 0 : 1
                            owners[i] = index
                        }
                    }
                }
            })
            for (let i = 0; i < owners.length; i++)
            {
                wrong += lightIds[i] === owners[i] + 1 && visibility[i] > 0 === owners[i] >= 0 ? 0 : 1
            }
            assert.equal(shared, 0)
            assert.equal(wrong, 0)
            assert(new Set(lights.map(({ channel }) => channel)).size >= 2)
        }
    })
})
