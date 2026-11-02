import { assert, describe, it } from "vitest"

import HexagonPatch, { PATCH_SIZE } from "../../src/map/HexagonPatch"
import marchingSquares, { GROUND_PRIORITY, marchingSquaresPatch } from "../../src/map/marchingSquares"
import PatchWorld from "../../src/map/PatchWorld"
import { packPatch } from "../../src/map/QuadPatch"
import { resetRandom, rng } from "../../src/core/util"
import type { Face } from "../../src/core/geometry"


function faceArea(face: Face): number
{
    let area = 0
    const first = face.halfEdge
    let curr = first
    do
    {
        const a = curr.vertex
        const b = curr.next.vertex
        area += a.x * b.y - b.x * a.y
        curr = curr.next
    } while (curr !== first)
    return Math.abs(area) / 2
}


function triangleArea(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): number
{
    return Math.abs((x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)) / 2
}


describe("marchingSquares", function () {

    for (const typeCount of [1, 2, 3, GROUND_PRIORITY.length])
    {
        it("covers the faces without gaps or overlaps with " + typeCount + " ground types", function () {
            resetRandom(4711 + typeCount)
            const faces = new HexagonPatch(0, 0, 40).build()
            for (const face of faces)
            {
                face.type = GROUND_PRIORITY[Math.floor(rng.next() * typeCount)]
            }

            let expected = 0
            for (const face of faces)
            {
                expected += faceArea(face)
            }

            let actual = 0
            let degenerate = 0
            marchingSquares(faces, (type, x0, y0, x1, y1, x2, y2) => {
                assert(GROUND_PRIORITY.includes(type))
                const area = triangleArea(x0, y0, x1, y1, x2, y2)
                if (area < 1e-9)
                {
                    degenerate++
                }
                actual += area
            })

            assert(degenerate === 0)
            assert(Math.abs(actual - expected) < expected * 1e-9)
        })
    }

    it("keeps a single face visible inside a background", function () {
        resetRandom(1)
        const faces = new HexagonPatch(0, 0, 40).build()
        for (const face of faces)
        {
            face.type = GROUND_PRIORITY[0]
        }
        // a face inside the patch, faces on the border keep their type out to the open edges
        const road = faces.find(face => {
            let curr = face.halfEdge
            do
            {
                if (!curr.twin)
                {
                    return false
                }
                curr = curr.next
            } while (curr !== face.halfEdge)
            return true
        })!
        const roadType = GROUND_PRIORITY[GROUND_PRIORITY.length - 1]
        road.type = roadType

        let area = 0
        marchingSquares(faces, (type, x0, y0, x1, y1, x2, y2) => {
            if (type === roadType)
            {
                area += triangleArea(x0, y0, x1, y1, x2, y2)
            }
        })

        // a lone face becomes the small diamond around its centroid, an eighth of the face
        const ratio = area / faceArea(road)
        assert(Math.abs(ratio - 0.125) < 1e-9)
    })
})


describe("marchingSquaresPatch", function () {

    function createPatch(q: number, r: number)
    {
        resetRandom(4711 + q)
        const patch = new HexagonPatch(q, r, 40)
        const faces = patch.build()
        for (const face of faces)
        {
            face.type = GROUND_PRIORITY[Math.floor(rng.next() * 4)]
        }
        return { patch, faces, packed: packPatch(patch, faces) }
    }

    function collect(fn: (cb: (...args: unknown[]) => void) => void): string[]
    {
        const triangles: string[] = []
        fn((type, ...coords) => triangles.push((type as { name: string }).name + " " + coords.join()))
        return triangles
    }

    it("creates the same ground as the object structure for a single patch", function () {
        const { faces, packed } = createPatch(0, 0)
        const world = new PatchWorld()
        const slot = world.add(packed)

        const expected = collect(cb => marchingSquares(faces, cb))
        const actual = collect(cb => marchingSquaresPatch(world, slot, cb))
        assert(expected.length > 0)
        assert(actual.join("\n") === expected.join("\n"))
    })

    it("creates the same ground across seams as the object structure", function () {
        const a = createPatch(0, 0)
        const b = createPatch(PATCH_SIZE, 0)

        const world = new PatchWorld()
        const slotA = world.add(a.packed)
        const unconnected = collect(cb => marchingSquaresPatch(world, slotA, cb))
        const slotB = world.add(b.packed)

        assert(a.patch.connect(b.patch) > 0)
        const expected = collect(cb => marchingSquares(a.faces.concat(b.faces), cb))
        const actual = collect(cb => {
            marchingSquaresPatch(world, slotA, cb)
            marchingSquaresPatch(world, slotB, cb)
        })
        assert(actual.join("\n") === expected.join("\n"))

        // the neighbor changes the ground along the seam
        world.remove(slotB)
        const alone = collect(cb => marchingSquaresPatch(world, slotA, cb))
        assert(alone.join("\n") === unconnected.join("\n"))
        assert(alone.join("\n") !== actual.slice(0, alone.length).join("\n"))
    })
})
