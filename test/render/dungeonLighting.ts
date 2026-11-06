import { assert, describe, it } from "vitest"

import { bakeLights, type DungeonLight } from "../../src/map/dungeonLights"
import { createLightField } from "../../src/render/dungeonLighting"

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
        const { data, place, light } = createField()
        assert.deepEqual([...data.subarray(0, 4)], [0, 0, 0, 0])
        assert.deepEqual(place(1).map(v => +v.toFixed(3)), [8, 2, 0.2, 3])
        assert.deepEqual(light(1), [0, 0.5, 1, 1])
    })
})
