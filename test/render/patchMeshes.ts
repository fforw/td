import { Vector3 } from "three"
import { assert, describe, it } from "vitest"

import { generatePatch } from "../../src/map/generatePatch"
import { faceCount } from "../../src/map/QuadPatch"
import { FACE_SIZE, SCALE } from "../../src/map/scale"
import { entranceMatrix } from "../../src/render/patchMeshes"


describe("Entrance model", () => {

    const { patch } = generatePatch(0, 0, 4711, FACE_SIZE, "EMPTY")
    const { positions, vertex } = patch

    /**
     * Returns the point in the middle of the given half edges in world units
     */
    function middle(edges: number[]): Vector3
    {
        const point = new Vector3()
        for (const h of edges)
        {
            point.x += positions[vertex[h] * 3] * SCALE / edges.length
            point.z += positions[vertex[h] * 3 + 1] * SCALE / edges.length
        }
        return point
    }

    it("stands on its face and has its battlements towards the half edge", () => {

        for (let face = 0; face < faceCount(patch); face += 17)
        {
            for (let side = 0; side < 4; side++)
            {
                const h = face * 4 + side
                const matrix = entranceMatrix(patch, h)
                const center = middle([0, 1, 2, 3].map(i => face * 4 + i))
                const outwards = middle([h, face * 4 + (side + 1) % 4]).sub(center).normalize()

                // the model takes up -0.5 to 0 on its x-axis, its middle has to end up in the middle of the face
                const placed = new Vector3(-0.25, 0, 0).applyMatrix4(matrix)
                assert.closeTo(placed.distanceTo(center), 0, 1e-5)

                const battlements = new Vector3(-1, 0, 0).transformDirection(matrix)
                assert.closeTo(battlements.dot(outwards), 1, 1e-5)
            }
        }
    })
})
