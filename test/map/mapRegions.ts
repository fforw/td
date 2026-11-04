import { assert, describe, it } from "vitest"

import { FaceType } from "../../src/map/geometry"
import HexagonPatch, { PATCH_SIZE } from "../../src/map/HexagonPatch"
import { createManuscriptMap, generalize, inkEdges, marchRegions, placeSymbols, regionOf, regionOutlines } from "../../src/map/mapRegions"
import { packPatch, type QuadPatch } from "../../src/map/QuadPatch"
import { FACE_SIZE } from "../../src/map/scale"
import { patchSeed, resetRandom } from "../../src/math/random"


const { GRASS, PRAIRIE, HOUSE, TREE, TREE2, WALL, WATER } = FaceType


/**
 * Builds a patch of nothing but the given face type
 */
function plainPatch(q: number, r: number, type: FaceType): QuadPatch
{
    resetRandom(patchSeed(4711, q, r))
    const patch = new HexagonPatch(q * PATCH_SIZE, r * PATCH_SIZE, FACE_SIZE)
    const faces = patch.build()
    faces.forEach(face => face.type = type)
    return packPatch(patch, faces)
}


/**
 * Returns the given local face and all faces within the given number of steps from it
 */
function faceArea(patch: QuadPatch, start: number, steps: number): number[]
{
    const area = new Set([start])
    for (let i = 0; i < steps; i++)
    {
        for (const face of [...area])
        {
            for (let h = face * 4; h < face * 4 + 4; h++)
            {
                if (patch.twin[h] >= 0)
                {
                    area.add(patch.twin[h] >> 2)
                }
            }
        }
    }
    return [...area]
}


/**
 * Returns a local face far from the border of the patch
 */
function innerFace(patch: QuadPatch): number
{
    const near = new Set<number>()
    for (let h = 0; h < patch.twin.length; h++)
    {
        if (patch.twin[h] < 0)
        {
            faceArea(patch, h >> 2, 4).forEach(face => near.add(face))
        }
    }
    return patch.faceType.findIndex((_, face) => !near.has(face))
}


function count(patch: QuadPatch, type: FaceType): number
{
    return patch.faceType.filter(i => i === type.index).length
}


describe("mapRegions", function () {

    it("puts face types of the same travel cost into one region", function () {
        assert.equal(regionOf(PRAIRIE), GRASS)
        assert.equal(regionOf(TREE2), TREE)
        assert.equal(regionOf(HOUSE), GRASS)
        assert.equal(regionOf(WATER), WATER)
    })

    it("removes lone trees and clearings but keeps the given patches", function () {
        const grassland = plainPatch(0, 0, GRASS)
        const forest = plainPatch(0, 0, TREE)
        grassland.faceType[innerFace(grassland)] = TREE.index
        forest.faceType[innerFace(forest)] = GRASS.index

        assert.equal(count(generalize([grassland]).getPatch(0), TREE), 0)
        assert.equal(count(generalize([forest]).getPatch(0), GRASS), 0)
        assert.equal(count(grassland, TREE), 1)
        assert.equal(count(forest, GRASS), 1)
    })

    it("removes small areas but keeps large ones", function () {
        const pond = plainPatch(0, 0, GRASS)
        const lake = plainPatch(0, 0, GRASS)
        faceArea(pond, innerFace(pond), 1).forEach(face => pond.faceType[face] = WATER.index)
        const area = faceArea(lake, innerFace(lake), 3)
        area.forEach(face => lake.faceType[face] = WATER.index)

        assert.equal(count(generalize([pond]).getPatch(0), WATER), 0)
        assert.ok(count(generalize([lake]).getPatch(0), WATER) >= area.length / 2)
    })

    it("keeps walls and doesn't spread them", function () {
        const patch = plainPatch(0, 0, GRASS)
        const face = innerFace(patch)
        patch.faceType[face] = WALL.index

        const regions = generalize([patch]).getPatch(0).faceType
        assert.equal(regions[face], WALL.index)
        assert.equal(regions.filter(i => i === WALL.index).length, 1)
    })

    it("only inks the boundaries of regions", function () {
        const patches = [plainPatch(0, 0, GRASS), plainPatch(1, 0, GRASS)]
        const plain = inkEdges(marchRegions(generalize(patches), 2))
        assert.ok(plain.every(edge => edge.type === GRASS && edge.other === null))

        const lake = plainPatch(0, 0, GRASS)
        faceArea(lake, innerFace(lake), 3).forEach(face => lake.faceType[face] = WATER.index)
        const shore = inkEdges(marchRegions(generalize([lake]), 1)).filter(edge => edge.other !== null)
        assert.ok(shore.length > 0)
        assert.ok(shore.every(edge => (edge.type === WATER) !== (edge.other === WATER)))

        // the shore is closed, every point of it is the end of an even number of edges
        const ends = new Map<string, number>()
        for (const { x0, y0, x1, y1 } of shore)
        {
            for (const key of [x0 + "," + y0, x1 + "," + y1])
            {
                ends.set(key, (ends.get(key) ?? 0) + 1)
            }
        }
        assert.ok([...ends.values()].every(n => n % 2 === 0))
    })

    it("doesn't ink the seam between patches of the same region", function () {
        const single = inkEdges(marchRegions(generalize([plainPatch(0, 0, GRASS)]), 1))
        const pair = inkEdges(marchRegions(generalize([plainPatch(0, 0, GRASS), plainPatch(1, 0, GRASS)]), 2))
        assert.ok(pair.length < single.length * 2)
    })

    it("traces outlines with the area of the triangles", function () {
        const patch = plainPatch(0, 0, GRASS)
        faceArea(patch, innerFace(patch), 3).forEach(face => patch.faceType[face] = WATER.index)
        const triangles = marchRegions(generalize([patch]), 1)
        const outlines = regionOutlines(triangles)

        const loopArea = (loop: number[]) => {
            let area = 0
            for (let i = 0; i < loop.length; i += 2)
            {
                const j = (i + 2) % loop.length
                area += loop[i] * loop[j + 1] - loop[j] * loop[i + 1]
            }
            return area / 2
        }

        triangles.forEach((list, type) => {
            let area = 0
            for (let i = 0; i < list.length; i += 6)
            {
                area += Math.abs((list[i + 2] - list[i]) * (list[i + 5] - list[i + 1]) - (list[i + 3] - list[i + 1]) * (list[i + 4] - list[i])) / 2
            }
            const outlined = outlines.get(type)!.reduce((sum, loop) => sum + loopArea(loop), 0)
            assert.closeTo(outlined, area, 0.001)
        })

        assert.equal(outlines.get(WATER)!.length, 1)
        // land with a hole: the outer loop and the one around the lake run in opposite directions
        assert.equal(outlines.get(GRASS)!.length, 2)
        assert.ok(outlines.get(GRASS)!.some(loop => loopArea(loop) < 0))
    })

    it("places spaced symbols of the real face types", function () {
        const patch = plainPatch(0, 0, TREE2)
        const face = innerFace(patch)
        faceArea(patch, face, 8).forEach(f => patch.faceType[f] = TREE.index)

        const symbols = placeSymbols([patch], generalize([patch]), 4711)
        assert.ok(symbols.some(s => s.type === TREE))
        assert.ok(symbols.some(s => s.type === TREE2))
        for (let i = 0; i < symbols.length; i++)
        {
            for (let j = i + 1; j < symbols.length; j++)
            {
                assert.ok(Math.hypot(symbols[i].x - symbols[j].x, symbols[i].y - symbols[j].y) >= 90)
            }
        }
    })

    it("has no symbols on open land and a castle on top of the walls", function () {
        const patch = plainPatch(0, 0, GRASS)
        const { symbols } = createManuscriptMap([patch], 4711)
        assert.equal(symbols.length, 0)

        const face = innerFace(patch)
        faceArea(patch, face, 1).forEach(f => patch.faceType[f] = WALL.index)
        const castle = createManuscriptMap([patch], 4711).symbols
        assert.equal(castle.length, 1)
        assert.equal(castle[0].type, WALL)
    })
})
