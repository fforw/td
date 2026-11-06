import { assert, describe, it } from "vitest"

import { bakeLights, type DungeonLight, FLICKER_MIN } from "../../src/map/dungeonLights"
import { createLightField, flickerLights, steadyLights } from "../../src/render/dungeonLighting"

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


describe("flickerLights", () => {
    it("stays within the strength the placement allows for, with every light on its own", () => {
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
