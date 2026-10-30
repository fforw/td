import { assert, describe, it } from "vitest"

import { FaceType } from "../src/geometry"
import Terrain, { classify, SEA_LEVEL } from "../src/terrain"


const never = () => 0.99


describe("terrain", function () {

    it("classifies water, ice, snow and land", function () {
        assert(classify({ height: SEA_LEVEL - 0.1, temperature: 0.5, moisture: 0.5 }, never) === FaceType.WATER)
        assert(classify({ height: SEA_LEVEL - 0.1, temperature: 0.01, moisture: 0.5 }, never) === FaceType.SNOW)
        assert(classify({ height: 0.2, temperature: 0.1, moisture: 0.5 }, never) === FaceType.SNOW)
        assert(classify({ height: SEA_LEVEL + 0.01, temperature: 0.5, moisture: 0.5 }, never) === FaceType.SAND)
        assert(classify({ height: SEA_LEVEL + 0.1, temperature: 0.5, moisture: 0.9 }, never) === FaceType.SWAMP)
        assert(classify({ height: 0.2, temperature: 0.7, moisture: 0.1 }, never) === FaceType.PRAIRIE)
        assert(classify({ height: 0.2, temperature: 0.5, moisture: 0.6 }, () => 0) === FaceType.TREE)
        assert(classify({ height: 0.2, temperature: 0.3, moisture: 0.6 }, () => 0) === FaceType.TREE2)
        assert(classify({ height: 0.2, temperature: 0.5, moisture: 0.45 }, never) === FaceType.GRASS)
    })

    it("only depends on the seed and the position", function () {
        const a = new Terrain(4711)
        const b = new Terrain(4711)
        const c = new Terrain(4712)

        let differs = false
        for (let i = 0; i < 100; i++)
        {
            const x = i * 731 - 30000
            const y = i * 457 - 20000
            assert(JSON.stringify(a.climate(x, y)) === JSON.stringify(b.climate(x, y)))
            differs ||= a.climate(x, y).height !== c.climate(x, y).height
        }
        assert(differs)
    })

    it("starts on plain land", function () {
        for (let seed = 0; seed < 20; seed++)
        {
            const terrain = new Terrain(seed)
            for (let x = -400; x <= 400; x += 100)
            {
                for (let y = -400; y <= 400; y += 100)
                {
                    const type = terrain.faceType(x, y, never)
                    assert(type !== FaceType.WATER && type !== FaceType.SNOW && type !== FaceType.ROCK)
                }
            }
        }
    })
})
