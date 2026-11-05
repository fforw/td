import { assert, describe, it } from "vitest"
import { Matrix4, Vector3 } from "three"
import { generateDungeon } from "../../src/map/generateDungeon"
import { EdgeType } from "../../src/map/geometry"
import PatchWorld, { SLOT_SHIFT } from "../../src/map/PatchWorld"
import { next } from "../../src/map/QuadPatch"
import { FACE_SIZE } from "../../src/map/scale"
import {
    createThickWalls,
    createThinWalls,
    THICK_WALL_HEIGHT,
    THIN_WALL_HEIGHT,
    THIN_WALL_OVERLAP,
    THIN_WALL_THICKNESS
} from "../../src/render/dungeonMeshes"
import { SCALE } from "../../src/render/scene3d"


function level()
{
    const { patches } = generateDungeon(4711, FACE_SIZE, 2, 2)
    const world = new PatchWorld()
    const slots = patches.map(patch => world.add(patch))
    return { world, slots }
}


describe("createThickWalls", () => {

    it("gives flat tops facing up and sides standing on the ground", () => {
        const { world, slots } = level()
        const a = new Vector3(), b = new Vector3(), c = new Vector3()
        // positions are stored as 32 bit floats
        const top = Math.fround(THICK_WALL_HEIGHT)

        let tops = 0, sides = 0
        for (const slot of slots)
        {
            const position = createThickWalls(world, slot).geometry.getAttribute("position")
            for (let i = 0; i < position.count; i += 3)
            {
                a.fromBufferAttribute(position, i)
                b.fromBufferAttribute(position, i + 1)
                c.fromBufferAttribute(position, i + 2)
                const normal = b.clone().sub(a).cross(c.clone().sub(a))

                if (a.y === top && b.y === top && c.y === top)
                {
                    assert(normal.y > 0)
                    tops++
                }
                else
                {
                    assert(Math.abs(normal.y) < 1e-6)
                    assert(Math.min(a.y, b.y, c.y) === 0)
                    sides++
                }
            }
        }
        assert(tops > 0)
        assert(sides > 0)
    })
})


describe("createThinWalls", () => {

    it("draws every wall edge once, also on seams", () => {
        const { world, slots } = level()

        let edges = 0
        for (const slot of slots)
        {
            world.getPatch(slot).edgeType.forEach(type => edges += type === EdgeType.WALL.index ? 1 : 0)
        }

        const walls = slots.reduce((sum, slot) => sum + createThinWalls(world, slot).count, 0)
        assert(walls > 0)
        assert(walls === edges / 2)
    })

    it("stands on the edge and reaches a little past both of its ends", () => {
        const { world, slots } = level()
        const slot = slots[0]
        const { positions, vertex, edgeType } = world.getPatch(slot)

        let h = 0
        while (edgeType[h] !== EdgeType.WALL.index || (slot << SLOT_SHIFT | h) > world.twin(slot << SLOT_SHIFT | h))
        {
            h++
        }
        const v0 = vertex[h] * 3
        const v1 = vertex[next(h)] * 3
        const from = new Vector3(positions[v0] * SCALE, 0, positions[v0 + 1] * SCALE)
        const to = new Vector3(positions[v1] * SCALE, 0, positions[v1 + 1] * SCALE)

        const matrix = new Matrix4()
        createThinWalls(world, slot).getMatrixAt(0, matrix)

        const reach = from.distanceTo(to) / 2 + THIN_WALL_OVERLAP
        const direction = to.clone().sub(from).normalize()
        const end = new Vector3(0.5, -0.5, 0).applyMatrix4(matrix)
        const expected = from.clone().add(to).multiplyScalar(0.5).addScaledVector(direction, reach)
        assert(end.distanceTo(expected) < 1e-5)

        const center = new Vector3(0, 0, 0).applyMatrix4(matrix)
        assert(Math.abs(center.y - THIN_WALL_HEIGHT / 2) < 1e-6)
        const side = new Vector3(0, 0, 0.5).applyMatrix4(matrix).distanceTo(center)
        assert(Math.abs(side - THIN_WALL_THICKNESS / 2) < 1e-6)
    })
})
