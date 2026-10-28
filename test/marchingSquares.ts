import { assert, describe, it } from "vitest"

import HexagonPatch from "../src/HexagonPatch"
import marchingSquares, { GROUND_PRIORITY } from "../src/marchingSquares"
import { resetRandom, rng } from "../src/util"
import type { Face } from "../src/geometry"


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
        const road = faces[Math.floor(faces.length / 2)]
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
