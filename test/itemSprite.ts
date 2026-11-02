import { assert, describe, it } from "vitest"
import { Vector3 } from "three"

import { extrudeSprite, solidifySprite, type SpriteImage } from "../src/itemSprite"


/**
 * Sprite from rows of characters: "#" opaque, "+" half transparent, "." almost invisible, anything else transparent.
 * Every pixel's red channel holds its index.
 */
function sprite(...rows: string[]): SpriteImage
{
    const width = rows[0].length, height = rows.length
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++)
    {
        for (let x = 0; x < width; x++)
        {
            const i = y * width + x
            data[i * 4] = i
            data[i * 4 + 3] = { "#": 255, "+": 100, ".": 5 }[rows[y][x]] ?? 0
        }
    }
    return { width, height, data }
}


function alphaRows(image: SpriteImage): string[]
{
    const rows: string[] = []
    for (let y = 0; y < image.height; y++)
    {
        let row = ""
        for (let x = 0; x < image.width; x++)
        {
            const a = image.data[(y * image.width + x) * 4 + 3]
            row += a === 255 ? "#" : a === 0 ? " " : "?"
        }
        rows.push(row)
    }
    return rows
}


describe("solidifySprite", function () {

    it("makes the visible pixels opaque and drops the specks", function () {
        const image = solidifySprite(sprite(
            ". + ",
            "+##.",
            " #+ "
        ))
        assert.deepEqual(alphaRows(image), [
            "  # ",
            "### ",
            " ## "
        ])
        // colors stay as they are
        assert(image.data[2 * 4] === 2)
        assert(image.data[4 * 4] === 4)
    })

    it("keeps thin lines that never become opaque", function () {
        assert.deepEqual(alphaRows(solidifySprite(sprite(
            "+   ",
            " +  ",
            "  + "
        ))), [
            "#   ",
            " #  ",
            "  # "
        ])
    })

    it("grows the outline sideways and up and down, colored like a neighbor", function () {
        const image = solidifySprite(sprite(
            "     ",
            "     ",
            "  #  ",
            "     ",
            "     "
        ), 16, 2)
        assert.deepEqual(alphaRows(image), [
            "  #  ",
            " ### ",
            "#####",
            " ### ",
            "  #  "
        ])
        for (let i = 0; i < 25; i++)
        {
            if (image.data[i * 4 + 3])
            {
                assert(image.data[i * 4] === 12)
            }
        }
    })
})


describe("extrudeSprite", function () {

    function quads(image: SpriteImage, thickness = 0.1)
    {
        const geometry = extrudeSprite(image, thickness)
        const pos = geometry.getAttribute("position")
        const index = geometry.getIndex()!
        const result: { normal: Vector3, center: Vector3 }[] = []
        for (let i = 0; i < index.count; i += 6)
        {
            const [a, b, c, d] = [0, 1, 2, 5].map(k => new Vector3().fromBufferAttribute(pos, index.getX(i + k)))
            const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize()
            const center = a.clone().add(b).add(c).add(d).multiplyScalar(0.25)
            result.push({ normal, center })
        }
        return { geometry, quads: result }
    }

    it("closes a single pixel with outward faces", function () {
        const { geometry, quads: q } = quads(sprite("#"), 0.5)
        assert(q.length === 6)
        for (const { normal, center } of q)
        {
            assert(normal.dot(center) > 0)
        }
        geometry.computeBoundingBox()
        const { min, max } = geometry.boundingBox!
        assert(min.equals(new Vector3(-0.5, -0.5, -0.25)))
        assert(max.equals(new Vector3(0.5, 0.5, 0.25)))
    })

    it("adds a side quad for every edge between solid and transparent pixels", function () {
        const image = solidifySprite(sprite(
            "##  ",
            "### ",
            " #  "
        ))
        // 2 faces, outline of 12 pixel edges
        const { quads: q } = quads(image)
        assert(q.length === 2 + 12)

        // side quads face away from their pixel
        for (const { normal, center } of q.slice(2))
        {
            assert(normal.z === 0)
            const inside = center.clone().addScaledVector(normal, -0.01)
            const outside = center.clone().addScaledVector(normal, 0.01)
            const solid = (p: Vector3) => {
                // back to pixel coordinates, the longer side is 1 unit long
                const x = Math.floor(p.x * 4 + 2), y = Math.floor(1.5 - p.y * 4)
                return x >= 0 && y >= 0 && x < 4 && y < 3 && image.data[(y * 4 + x) * 4 + 3] === 255
            }
            assert(solid(inside))
            assert(!solid(outside))
        }
    })

    it("samples the side quad colors from the center of their pixel", function () {
        const geometry = extrudeSprite(solidifySprite(sprite(
            "  ",
            " #"
        )), 0.1)
        const uv = geometry.getAttribute("uv")
        for (let i = 8; i < uv.count; i++)
        {
            assert(uv.getX(i) === 0.75)
            assert(uv.getY(i) === 0.75)
        }
    })
})
