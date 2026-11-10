import { assert, describe, it } from "vitest"
import { Matrix4, Vector3 } from "three"
import { generateDungeon } from "../../src/map/generateDungeon"
import { EdgeType } from "../../src/map/geometry"
import PatchWorld, { SLOT_SHIFT } from "../../src/map/PatchWorld"
import { next, prev } from "../../src/map/QuadPatch"
import { FACE_SIZE } from "../../src/map/scale"
import {
    addFlatCorner,
    addRoundedCorner,
    createThickWalls,
    createThinWallCorners,
    createThinWalls,
    findSingleThinWalls,
    findThinWallCorners,
    smoothNormals,
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

    it("shades curved sides as one surface and keeps tops flat", () => {
        const { world, slots } = level()
        const face = new Vector3(), normal = new Vector3()
        let bent = 0
        for (const slot of slots)
        {
            const { geometry } = createThickWalls(world, slot)
            const position = geometry.getAttribute("position"), normals = geometry.getAttribute("normal")
            for (let i = 0; i < position.count; i += 3)
            {
                const [a, b, c] = [0, 1, 2].map(j => new Vector3().fromBufferAttribute(position, i + j))
                face.subVectors(b, a).cross(c.clone().sub(a)).normalize()
                for (let j = 0; j < 3; j++)
                {
                    normal.fromBufferAttribute(normals, i + j)
                    assert.closeTo(normal.length(), 1, 1e-6)
                    assert(normal.dot(face) > 0.3, "leans less than the smoothing allows")
                    if (face.y > 0.5)
                    {
                        assert.closeTo(normal.y, 1, 1e-6)
                    }
                    else
                    {
                        assert(Math.abs(normal.y) < 1e-6)
                        bent += normal.dot(face) < 0.999 ? 1 : 0
                    }
                }
            }
        }
        assert(bent > 0)
    })
})

describe("smoothNormals", () => {

    /**
     * Two upright squares meeting in the edge along the y axis, the second turned by the given angle
     */
    function fold(angle: number): number[]
    {
        const x = Math.cos(angle), z = Math.sin(angle)
        return [
            -1, 0, 0, 0, 0, 0, 0, 1, 0, -1, 0, 0, 0, 1, 0, -1, 1, 0,
            0, 0, 0, x, 0, z, x, 1, z, 0, 0, 0, x, 1, z, 0, 1, 0
        ]
    }

    it("shares the normal across a shallow edge", () => {
        const normals = smoothNormals(fold(Math.PI / 6), Math.PI / 3)
        // the corner at the origin in both squares
        const first = normals.slice(3, 6), second = normals.slice(18, 21)
        assert.deepEqual(first.map(n => n.toFixed(9)), second.map(n => n.toFixed(9)))
        // half way between both
        assert.closeTo(Math.atan2(-first[0], first[2]), Math.PI / 12, 1e-9)
        // the far edges keep their own
        assert.deepEqual(normals.slice(0, 3).map(n => +n.toFixed(9)), [0, 0, 1])
    })

    it("keeps a sharp edge", () => {
        const normals = smoothNormals(fold(Math.PI / 2), Math.PI / 3)
        assert.deepEqual(normals.slice(3, 6).map(n => +n.toFixed(9)), [0, 0, 1])
        assert.deepEqual(normals.slice(18, 21).map(n => +n.toFixed(9)), [-1, 0, 0])
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

        const joined = createThinWalls(world, slots, false).count
        const single = createThinWalls(world, slots, true).count
        assert(joined > 0)
        assert(single > 0)
        assert(joined + single === edges / 2)
    })

    it("puts walls that meet no other wall into the single ones", () => {
        const { world, slots } = level()
        const singles = findSingleThinWalls(world, slots)
        assert(singles.size > 0)

        // walls by their ends, and the ends of each wall
        const wallsAt = new Map<string, number>()
        const endsOf = new Map<number, string[]>()
        for (const slot of slots)
        {
            const { positions, vertex, edgeType } = world.getPatch(slot)
            const base = slot << SLOT_SHIFT
            edgeType.forEach((type, h) => {
                if (type === EdgeType.WALL.index && (base | h) < world.twin(base | h))
                {
                    const keys = [vertex[h] * 3, vertex[next(h)] * 3].map(v => positions[v] + "," + positions[v + 1])
                    keys.forEach(key => wallsAt.set(key, (wallsAt.get(key) ?? 0) + 1))
                    endsOf.set(base | h, keys)
                }
            })
        }

        for (const [wall, keys] of endsOf)
        {
            assert(singles.has(wall) === keys.every(key => wallsAt.get(key) === 1))
        }
    })

    it("stands on its edge and reaches past its ends, except at tight corners", () => {
        const { world, slots } = level()
        const tight = new Set(findThinWallCorners(world, slots).filter(({ tight }) => tight).map(({ x, z }) => x + "," + z))
        assert(tight.size > 0)

        const singles = findSingleThinWalls(world, slots)
        const meshes = [createThinWalls(world, slots, false), createThinWalls(world, slots, true)]
        const indices = [0, 0]
        const matrix = new Matrix4()
        let ending = 0, reaching = 0
        for (const slot of slots)
        {
            const { positions, vertex, edgeType } = world.getPatch(slot)
            const base = slot << SLOT_SHIFT
            edgeType.forEach((type, h) => {
                if (type !== EdgeType.WALL.index || (base | h) > world.twin(base | h))
                {
                    return
                }
                const v0 = vertex[h] * 3
                const v1 = vertex[next(h)] * 3
                const from = new Vector3(positions[v0] * SCALE, 0, positions[v0 + 1] * SCALE)
                const to = new Vector3(positions[v1] * SCALE, 0, positions[v1 + 1] * SCALE)
                const direction = to.clone().sub(from).normalize()

                const reach = (point: Vector3) => {
                    const ends = tight.has(point.x + "," + point.z)
                    ends ? ending++ : reaching++
                    return ends ? 0 : THIN_WALL_OVERLAP
                }

                const single = singles.has(base | h) ? 1 : 0
                meshes[single].getMatrixAt(indices[single]++, matrix)
                const end = new Vector3(0.5, -0.5, 0).applyMatrix4(matrix)
                const start = new Vector3(-0.5, -0.5, 0).applyMatrix4(matrix)
                assert(end.distanceTo(to.clone().addScaledVector(direction, reach(to))) < 1e-5)
                assert(start.distanceTo(from.clone().addScaledVector(direction, -reach(from))) < 1e-5)

                const center = new Vector3(0, 0, 0).applyMatrix4(matrix)
                assert(Math.abs(center.y - THIN_WALL_HEIGHT / 2) < 1e-6)
                const side = new Vector3(0, 0, 0.5).applyMatrix4(matrix).distanceTo(center)
                assert(Math.abs(side - THIN_WALL_THICKNESS / 2) < 1e-6)
            })
        }
        assert(ending > 0)
        assert(reaching > 0)
    })
})


describe("addFlatCorner", () => {

    it("closes the outer side of the walls with a line straight across the corner", () => {
        for (const degrees of [30, 60, 90, 120])
        {
            for (const flip of [1, -1])
            {
                const angle = degrees * Math.PI / 180
                const dx = Math.cos(angle), dz = Math.sin(angle) * flip
                const triangles: number[] = []
                addFlatCorner(triangles, [], 0, 0, 1, 0, dx, dz)

                const [cx, , cz, x0, , z0, x1, , z1] = triangles
                assert(cx === 0 && cz === 0)

                // both ends of the line are half a thickness behind the walls, opposite of the other wall
                const side = THIN_WALL_THICKNESS / 2
                const ends = [[x0, z0], [x1, z1]]
                const behindFirst = ends.find(([x, z]) => Math.abs(x) < 1e-9 && Math.abs(z + side * flip) < 1e-9)
                const behindSecond = ends.find(([x, z]) => Math.abs(x * dx + z * dz) < 1e-9 && x < 0)
                assert(behindFirst)
                assert(behindSecond)
                assert(Math.abs(Math.hypot(...behindSecond!) - side) < 1e-9)

                // it runs at a right angle to the middle of the corner
                const middleX = 1 + dx, middleZ = dz
                assert(Math.abs((x1 - x0) * middleX + (z1 - z0) * middleZ) < 1e-9)
            }
        }
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
            addRoundedCorner(triangles, [], 0, 0, 1, 0, dx, dz)
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
        addRoundedCorner(triangles, [], 0, 0, 1, 0, dx, dz)

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
        addRoundedCorner(triangles, [], 0, 0, 1, 0, Math.cos(wide), Math.sin(wide))
        addRoundedCorner(triangles, [], 0, 0, 0.05, 0, 0, 0.05)
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
        assert(position.count === (expected * THIN_WALL_ROUNDING_STEPS + tight) * 9)
    })

    it("shades rounded corners as the circle, ending as the sides of the walls", () => {
        const angle = Math.PI / 3
        const dx = Math.cos(angle), dz = Math.sin(angle)
        const triangles: number[] = [], normals: number[] = []
        addRoundedCorner(triangles, normals, 0, 0, 1, 0, dx, dz)
        assert(normals.length === triangles.length)

        // without the sign of a zero
        const key = (x: number, z: number) => [x, z].map(n => (Math.round(n * 1e9) + 0) / 1e9).join(",")
        const sides = new Set<string>()
        for (let i = 0; i < triangles.length; i += 3)
        {
            const [nx, ny, nz] = normals.slice(i, i + 3)
            assert.closeTo(Math.hypot(nx, ny, nz), 1, 1e-9)
            if (ny === 0)
            {
                sides.add(key(nx, nz))
            }
        }
        // the walls run along x and at 60 degrees, the inner sides face into the corner
        assert(sides.has(key(0, 1)))
        assert(sides.has(key(dz, -dx)))
        assert(sides.size === THIN_WALL_ROUNDING_STEPS + 1)
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
