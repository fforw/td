import { assert, describe, it } from "vitest"
import { Matrix4, Vector3 } from "three"
import { generateDungeon } from "../../src/map/generateDungeon"
import { EdgeType } from "../../src/map/geometry"
import PatchWorld, { SLOT_SHIFT } from "../../src/map/PatchWorld"
import { next, prev } from "../../src/map/QuadPatch"
import { FACE_SIZE } from "../../src/map/scale"
import {
    addRoundedCorner,
    createThickWalls,
    createThinWallCorners,
    createThinWalls,
    findThinWallCorners,
    THICK_WALL_HEIGHT,
    THIN_WALL_HEIGHT,
    THIN_WALL_OVERLAP,
    THIN_WALL_ROUNDING,
    THIN_WALL_ROUNDING_STEPS,
    THIN_WALL_THICKNESS,
    TIGHT_CORNER_ANGLE
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


describe("addRoundedCorner", () => {

    /**
     * Distance of a point from the line through the origin in the given direction
     */
    const fromWall = (x: number, z: number, dx: number, dz: number) => Math.abs(x * dz - z * dx)

    it("starts from the sides of the walls at any angle", () => {
        for (const degrees of [30, 60, 90, 120, 150])
        {
            const angle = degrees * Math.PI / 180
            const dx = Math.cos(angle), dz = Math.sin(angle)
            const triangles: number[] = []
            addRoundedCorner(triangles, 0, 0, 1, 0, dx, dz)
            assert(triangles.length > 0)

            const side = THIN_WALL_THICKNESS / 2
            const [cx, , cz] = triangles
            assert(Math.abs(fromWall(cx, cz, 1, 0) - side) < 1e-9)
            assert(Math.abs(fromWall(cx, cz, dx, dz) - side) < 1e-9)
        }
    })

    it("ends its curve on the sides of the walls, as far along them as it should reach", () => {
        const angle = Math.PI / 3
        const dx = Math.cos(angle), dz = Math.sin(angle)
        const triangles: number[] = []
        addRoundedCorner(triangles, 0, 0, 1, 0, dx, dz)

        const [cx, , cz] = triangles
        const points: number[][] = []
        for (let i = 0; i < triangles.length; i += 3)
        {
            if (triangles[i + 1] === 0)
            {
                points.push([triangles[i], triangles[i + 2]])
            }
        }
        const side = THIN_WALL_THICKNESS / 2
        const onFirst = points.filter(([x, z]) => Math.abs(fromWall(x, z, 1, 0) - side) < 1e-9)
        const onSecond = points.filter(([x, z]) => Math.abs(fromWall(x, z, dx, dz) - side) < 1e-9)
        assert(onFirst.some(([x, z]) => Math.abs(Math.hypot(x - cx, z - cz) - THIN_WALL_ROUNDING) < 1e-9))
        assert(onSecond.some(([x, z]) => Math.abs(Math.hypot(x - cx, z - cz) - THIN_WALL_ROUNDING) < 1e-9))
    })

    it("leaves corners close to a straight wall and walls too short for it", () => {
        const triangles: number[] = []
        const wide = 170 * Math.PI / 180
        addRoundedCorner(triangles, 0, 0, 1, 0, Math.cos(wide), Math.sin(wide))
        addRoundedCorner(triangles, 0, 0, 0.05, 0, 0, 0.05)
        assert(triangles.length === 0)
    })
})


describe("createThinWallCorners", () => {

    it("rounds corners where more than two thin walls meet or two meet at a tight angle", () => {
        const { world, slots } = level()

        const walls = new Map<string, number>()
        const key = (positions: ArrayLike<number>, v: number) => positions[v] + "," + positions[v + 1]
        for (const slot of slots)
        {
            const { positions, vertex, edgeType } = world.getPatch(slot)
            edgeType.forEach((type, h) => {
                if (type === EdgeType.WALL.index)
                {
                    const k = key(positions, vertex[h] * 3)
                    walls.set(k, (walls.get(k) ?? 0) + 1)
                }
            })
        }

        let expected = 0, tight = 0
        for (const slot of slots)
        {
            const { positions, vertex, edgeType } = world.getPatch(slot)
            edgeType.forEach((type, h) => {
                if (type !== EdgeType.WALL.index || edgeType[prev(h)] !== EdgeType.WALL.index)
                {
                    return
                }
                const [v, a, b] = [vertex[h], vertex[next(h)], vertex[prev(h)]].map(index => index * 3)
                const ax = positions[a] - positions[v], az = positions[a + 1] - positions[v + 1]
                const bx = positions[b] - positions[v], bz = positions[b + 1] - positions[v + 1]
                const angle = Math.acos((ax * bx + az * bz) / Math.hypot(ax, az) / Math.hypot(bx, bz))

                if (walls.get(key(positions, v))! > 2 || angle < TIGHT_CORNER_ANGLE)
                {
                    expected++
                    tight += walls.get(key(positions, v)) === 2 ? 1 : 0
                }
            })
        }
        assert(tight > 0)
        assert(expected > tight)
        assert(findThinWallCorners(world, slots).length === expected)

        const position = createThinWallCorners(world, slots).geometry.getAttribute("position")
        assert(position.count === expected * THIN_WALL_ROUNDING_STEPS * 9)
    })

    it("gives tops facing up and sides facing away from the corner", () => {
        const { world, slots } = level()
        const position = createThinWallCorners(world, slots).geometry.getAttribute("position")
        const top = Math.fround(THIN_WALL_HEIGHT)

        // three triangles per piece: the top and two for the side
        const a = new Vector3(), b = new Vector3(), c = new Vector3()
        assert(position.count % 9 === 0)
        for (let i = 0; i < position.count; i += 9)
        {
            a.fromBufferAttribute(position, i)
            b.fromBufferAttribute(position, i + 1)
            c.fromBufferAttribute(position, i + 2)
            assert(a.y === top && b.y === top && c.y === top)
            assert(b.clone().sub(a).cross(c.clone().sub(a)).y > 0)

            // the side starts from the outer edge of the top and faces away from the corner of the top
            const side0 = new Vector3().fromBufferAttribute(position, i + 3)
            const side1 = new Vector3().fromBufferAttribute(position, i + 4)
            const side2 = new Vector3().fromBufferAttribute(position, i + 5)
            const normal = side1.clone().sub(side0).cross(side2.clone().sub(side0))
            assert(normal.dot(side0.clone().sub(a)) > 0)
        }
    })
})
