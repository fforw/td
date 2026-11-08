import type { WebGLRenderer } from "three"
import { assert, describe, it } from "vitest"

import { bakeLights, type DungeonLight } from "../../src/map/dungeonLights"
import {
    createLightField,
    discoLights,
    FLICKER_MIN,
    flickerHeroLight,
    flickerLights,
    HERO_BURN_TIME,
    HERO_FLICKER_MIN,
    HERO_OFF,
    heroBurn,
    steadyLights,
    updateLightField
} from "../../src/render/dungeonLighting"

const LIGHTS: DungeonLight[] = [
    { x: 2, z: 2, color: [1, 0.5, 0], radius: 0.1, reach: 2, channel: 0 },
    { x: 8, z: 2, color: [0, 0.5, 1], radius: 0.2, reach: 3, channel: 1 }
]


function createField()
{
    const field = createLightField(bakeLights(LIGHTS, new Float64Array(0), { minX: 0, minZ: 0, maxX: 10, maxZ: 4 }))
    const data = field.uniforms.lightData.value.image.data as Float32Array
    // the rows have the empty id 0 in front
    return { field, data, place: (i: number) => [...data.subarray((i + 1) * 4, (i + 2) * 4)], light: (i: number) => [...data.subarray(3 * 4 + (i + 1) * 4, 3 * 4 + (i + 2) * 4)] }
}


describe("createLightField", () => {
    it("has the place and color of the lights by their id", () => {
        const { field, data, place, light } = createField()
        assert.equal(field.count, 2)
        assert.deepEqual([...data.subarray(0, 4)], [0, 0, 0, 0])
        assert.deepEqual(place(1).map(v => +v.toFixed(3)), [8, 2, 0.2, 3])
        assert.deepEqual(light(1), [0, 0.5, 1, 1])
    })
})


describe("updateLightField", () => {
    it("only renders the field when the lights changed, and leaves the render target alone", () => {
        const { field } = createField()
        const previous = {}
        let current: unknown = previous
        const rendered: unknown[] = []
        const renderer = {
            getRenderTarget: () => current,
            setRenderTarget: (target: unknown) => current = target,
            render: () => rendered.push(current)
        } as unknown as WebGLRenderer

        updateLightField(renderer, field)
        assert.deepEqual(rendered, [field.target])
        assert.equal(current, previous)

        updateLightField(renderer, field)
        assert.equal(rendered.length, 1)

        for (const change of [
            () => flickerLights(field, LIGHTS, 1),
            () => discoLights(field, LIGHTS, 1),
            () => steadyLights(field, LIGHTS)
        ])
        {
            const before = rendered.length
            change()
            updateLightField(renderer, field)
            updateLightField(renderer, field)
            assert.equal(rendered.length, before + 1)
        }
    })
})


describe("flickerHeroLight", () => {
    it("stays within its strength and keeps changing", () => {
        const { field } = createField()
        const seen = new Set<number>()
        for (let time = 0; time < 20; time += 0.07)
        {
            flickerHeroLight(field, time)
            const strength = field.uniforms.heroStrength.value
            assert(strength >= HERO_FLICKER_MIN - 1e-6 && strength <= 1 + 1e-6)
            seen.add(strength)
        }
        assert(seen.size > 100)
    })

    it("scales its strength by what is left of the light", () => {
        const { field } = createField()
        flickerHeroLight(field, 3)
        const full = field.uniforms.heroStrength.value
        flickerHeroLight(field, 3, 0.25)
        assert.closeTo(field.uniforms.heroStrength.value, full * 0.25, 1e-9)
    })
})


describe("heroBurn", () => {
    it("fades by the same factor every second from full strength to off", () => {
        assert.equal(heroBurn(0), 1)
        assert.closeTo(heroBurn(HERO_BURN_TIME / 2), Math.sqrt(HERO_OFF), 1e-9)
        assert.closeTo(heroBurn(10) / heroBurn(0), heroBurn(40) / heroBurn(30), 1e-9)
        assert.closeTo(heroBurn(HERO_BURN_TIME - 1e-6), HERO_OFF, 1e-6)
        assert.equal(heroBurn(HERO_BURN_TIME), 0)
        assert.equal(heroBurn(HERO_BURN_TIME * 2), 0)
    })
})


describe("flickerLights", () => {
    it("stays within its strength, with every light on its own", () => {
        const { field, light } = createField()
        const seen = new Set<number>()
        let apart = 0
        for (let time = 0; time < 20; time += 0.07)
        {
            flickerLights(field, LIGHTS, time)
            const [r, g, b, strength] = light(1), other = light(0)[3]
            assert(strength >= FLICKER_MIN - 1e-6 && strength <= 1 + 1e-6)
            assert.closeTo(r, 0, 1e-6)
            assert.closeTo(g, 0.5 * strength, 1e-6)
            assert.closeTo(b, strength, 1e-6)
            seen.add(strength)
            apart += Math.abs(strength - other) > 0.01 ? 1 : 0
        }
        assert(seen.size > 100)
        assert(apart > 100)
    })

    it("puts lights back to full strength when they stop", () => {
        const { field, light } = createField()
        flickerLights(field, LIGHTS, 3)
        steadyLights(field, LIGHTS)
        assert.deepEqual(light(0), [1, 0.5, 0, 1])
        assert.deepEqual(light(1), [0, 0.5, 1, 1])
    })
})


describe("discoLights", () => {
    const closeTo = (actual: number[], expected: number[]) => expected.forEach((value, i) => assert.closeTo(actual[i], value, 1e-5))

    it("flashes once per second, every other flash in the opposite color", () => {
        const { field, light } = createField()

        discoLights(field, LIGHTS, 0.5)
        closeTo(light(0), [1, 0.5, 0, 1])
        discoLights(field, LIGHTS, 1.5)
        closeTo(light(0), [0, 0.5, 1, 1])
        discoLights(field, LIGHTS, 2.5)
        closeTo(light(0), [1, 0.5, 0, 1])
    })

    it("goes off between flashes in the shape of a sine", () => {
        const { field, light } = createField()
        for (const time of [0, 1, 2, 3])
        {
            discoLights(field, LIGHTS, time)
            assert.closeTo(light(0)[3], 0, 1e-6)
            closeTo(light(0).slice(0, 3), [0, 0, 0])
        }

        discoLights(field, LIGHTS, 0.25)
        assert.closeTo(light(0)[3], 0.5, 1e-6)
    })

    it("gives back the own colors when it stops", () => {
        const { field, light } = createField()
        discoLights(field, LIGHTS, 1.5)
        steadyLights(field, LIGHTS)
        assert.deepEqual(light(0), [1, 0.5, 0, 1])
    })
})
