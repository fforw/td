import { assert, describe, it } from "vitest"

import { FaceType } from "../../src/map/geometry"
import { createManuscriptMap, type InkEdge, type MapArea, regionOf } from "../../src/map/mapRegions"
import Terrain from "../../src/map/terrain"


const { GRASS, PRAIRIE, ROCK, SAND, TREE, TREE2, WALL, WATER } = FaceType

const AREA: MapArea = { x: 0, y: 0, width: 200, height: 100 }
const STEP = 10


/**
 * Returns a terrain with the given face type function
 */
function terrainOf(faceType: (x: number, y: number) => FaceType): Pick<Terrain, "faceType">
{
    return { faceType }
}


/**
 * Returns the area enclosed by the outlines, with holes counting negative
 */
function outlineArea(loops: number[][]): number
{
    let sum = 0
    for (const loop of loops)
    {
        for (let i = 0; i < loop.length; i += 2)
        {
            const j = (i + 2) % loop.length
            sum += loop[i] * loop[j + 1] - loop[j] * loop[i + 1]
        }
    }
    return sum / 2
}


function between(edge: InkEdge, a: FaceType, b: FaceType): boolean
{
    return edge.type === a && edge.other === b || edge.type === b && edge.other === a
}


describe("regionOf", function () {

    it("merges face types of the same cost", function () {
        assert.equal(regionOf(PRAIRIE), GRASS)
        assert.equal(regionOf(TREE2), TREE)
        assert.equal(regionOf(WATER), WATER)
    })
})


describe("createManuscriptMap", function () {

    it("has one outline around a single region and no ink", function () {
        const map = createManuscriptMap(terrainOf(() => GRASS), AREA, STEP, [], 1)
        assert.deepEqual([...map.outlines.keys()], [GRASS])
        assert.equal(map.ink.length, 0)
        assert.closeTo(outlineArea(map.outlines.get(GRASS)!), 20000, 1e-6)
    })

    it("draws one region for face types of the same cost", function () {
        const map = createManuscriptMap(terrainOf(x => x < 100 ? GRASS : PRAIRIE), AREA, STEP, [], 1)
        assert.deepEqual([...map.outlines.keys()], [GRASS])
        assert.equal(map.ink.length, 0)
    })

    it("finds the boundary between raster points", function () {
        const map = createManuscriptMap(terrainOf(x => x < 104 ? GRASS : WATER), AREA, STEP, [], 1)
        assert.equal(map.ink.length, 10)
        for (const edge of map.ink)
        {
            assert.ok(between(edge, GRASS, WATER))
            assert.closeTo(edge.x0, 104, STEP / 8)
            assert.closeTo(edge.x1, 104, STEP / 8)
        }
        assert.closeTo(outlineArea(map.outlines.get(GRASS)!), 10400, 100)
        assert.closeTo(outlineArea(map.outlines.get(WATER)!), 9600, 100)
    })

    it("cuts holes into the region around an island", function () {
        const island = (x: number, y: number) => Math.hypot(x - 100, y - 50) < 30
        const map = createManuscriptMap(terrainOf((x, y) => island(x, y) ? SAND : WATER), AREA, STEP, [], 1)
        assert.equal(map.outlines.get(SAND)!.length, 1)
        assert.equal(map.outlines.get(WATER)!.length, 2)
        assert.closeTo(outlineArea(map.outlines.get(SAND)!), Math.PI * 900, 150)
        assert.closeTo(outlineArea(map.outlines.get(SAND)!) + outlineArea(map.outlines.get(WATER)!), 20000, 1e-6)
    })

    it("fills the whole area where three regions meet", function () {
        const type = (x: number, y: number) => y < 47 ? (x < 103 ? GRASS : WATER) : ROCK
        const map = createManuscriptMap(terrainOf(type), AREA, STEP, [], 1)
        let sum = 0
        map.outlines.forEach(loops => sum += outlineArea(loops))
        assert.closeTo(sum, 20000, 1e-6)
        assert.ok(map.ink.some(edge => between(edge, GRASS, WATER)))
        assert.ok(map.ink.some(edge => between(edge, GRASS, ROCK)))
        assert.ok(map.ink.some(edge => between(edge, WATER, ROCK)))
    })

    it("fills the whole area where the same regions touch on opposite corners", function () {
        const type = (x: number, y: number) => (x < 103) === (y < 47) ? GRASS : WATER
        const map = createManuscriptMap(terrainOf(type), AREA, STEP, [], 1)
        let sum = 0
        map.outlines.forEach(loops => sum += outlineArea(loops))
        assert.closeTo(sum, 20000, 1e-6)
    })

    it("places symbols apart from each other and only inside of their region", function () {
        const area = { x: 0, y: 0, width: 2000, height: 2000 }
        const map = createManuscriptMap(terrainOf(x => x < 1000 ? TREE : GRASS), area, STEP, [], 1)
        assert.ok(map.symbols.length >= 4, "symbols " + map.symbols.length)
        map.symbols.forEach((a, i) => {
            assert.equal(a.type, TREE)
            assert.ok(a.x < 1000)
            map.symbols.slice(i + 1).forEach(b => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 240))
        })
    })

    it("sorts symbols from north to south with points of interest on top", function () {
        const area = { x: 0, y: 0, width: 2000, height: 2000 }
        const castle = { x: 1000, y: 100, type: WALL }
        const { symbols } = createManuscriptMap(terrainOf(() => TREE), area, STEP, [castle], 1)
        assert.equal(symbols[symbols.length - 1], castle)
        const trees = symbols.slice(0, -1)
        trees.forEach((tree, i) => {
            assert.ok(i === 0 || trees[i - 1].y <= tree.y)
            assert.ok(Math.hypot(tree.x - castle.x, tree.y - castle.y) >= 240)
        })
    })

    it("depends on the seed only", function () {
        const area = { x: -1000, y: -1000, width: 2000, height: 2000 }
        const a = createManuscriptMap(new Terrain(4711), area, 25, [], 1)
        const b = createManuscriptMap(new Terrain(4711), area, 25, [], 1)
        const c = createManuscriptMap(new Terrain(4712), area, 25, [], 1)
        assert.deepEqual(a, b)
        assert.notDeepEqual(a.ink, c.ink)
    })
})
