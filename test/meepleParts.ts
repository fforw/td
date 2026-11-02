import { assert, describe, it } from "vitest"
import { Vector3 } from "three"

import { bodySurface } from "../src/meepleParts"


function surface(height: number, angle: number): { point: Vector3, normal: Vector3 }
{
    const point = new Vector3(), normal = new Vector3()
    bodySurface(height, angle, point, normal)
    return { point, normal }
}


describe("bodySurface", function () {

    it("goes from the bottom to the top", function () {
        const bottom = surface(0, 0)
        const top = surface(1, 0)
        assert(bottom.point.length() < 1e-9)
        assert(Math.abs(top.point.x) < 1e-9 && Math.abs(top.point.z) < 1e-9 && top.point.y > 0.5)
        assert(bottom.normal.y < -0.999)
        assert(top.normal.y > 0.999)
    })

    it("turns from the front toward the meeple's right", function () {
        const front = surface(0.5, 0)
        const right = surface(0.5, Math.PI / 2)
        assert(front.normal.distanceTo(new Vector3(0, 0, 1)) < 1e-9)
        assert(right.normal.distanceTo(new Vector3(-1, 0, 0)) < 1e-9)
        assert(front.point.z > 0 && Math.abs(front.point.x) < 1e-9)
        assert(right.point.x < 0 && Math.abs(right.point.z) < 1e-9)
        assert(Math.abs(front.point.y - right.point.y) < 1e-9)
    })

    it("returns normals perpendicular to the surface", function () {
        const d = 1e-6
        for (const [height, angle] of [[0.2, 0.3], [0.45, 0.9], [0.8, -2], [0.6, 3]])
        {
            const { point, normal } = surface(height, angle)
            assert(Math.abs(normal.length() - 1) < 1e-9)
            for (const [dh, da] of [[d, 0], [0, d]])
            {
                const along = surface(height + dh, angle + da).point.sub(point).normalize()
                assert(Math.abs(along.dot(normal)) < 1e-4)
            }
        }
    })
})
