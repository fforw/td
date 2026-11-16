import { existsSync } from "node:fs"
import { assert, describe, it } from "vitest"
import { generateDungeon } from "../../src/map/generateDungeon"
import { FaceType } from "../../src/map/geometry"
import PatchWorld from "../../src/map/PatchWorld"
import { FACE_SIZE } from "../../src/map/scale"
import {
    choosePatterns,
    createPatternGeometries,
    floodRoom,
    FLOOR_PATTERNS,
    layOutRoom,
    layOutWalls,
    PATTERN_SHARE,
    wallTriangles
} from "../../src/render/floorPatterns"


function level()
{
    const { patches, rooms } = generateDungeon(4711, FACE_SIZE, 2, 2)
    const world = new PatchWorld()
    patches.forEach(patch => world.add(patch))
    return { world, rooms }
}


/**
 * Returns twice the signed area of a face in texture space
 */
function area(uv: Int32Array): number
{
    let sum = 0
    for (let k = 0; k < 4; k++)
    {
        const n = (k + 1) & 3
        sum += uv[k * 2] * uv[n * 2 + 1] - uv[n * 2] * uv[k * 2 + 1]
    }
    return sum
}


describe("floor patterns", () => {
    const { world, rooms } = level()

    it("lays every face of a room out as a unit square of the same winding", () => {
        for (const faces of rooms)
        {
            const { uvs } = floodRoom(world, faces, faces[0])
            assert.equal(uvs.size, faces.length)
            for (const uv of uvs.values())
            {
                assert.equal(area(uv), 2)
                for (let k = 0; k < 4; k++)
                {
                    const n = (k + 1) & 3
                    assert.equal(Math.abs(uv[k * 2] - uv[n * 2]) + Math.abs(uv[k * 2 + 1] - uv[n * 2 + 1]), 1)
                }
            }
        }
    })

    it("continues the pattern over the edge a face was reached by", () => {
        const faces = rooms[0]
        const start = faces[0]
        const { uvs } = floodRoom(world, faces, start)
        const own = uvs.get(start)!
        for (let k = 0; k < 4; k++)
        {
            const twin = world.twin((start << 2) | k)
            const uv = twin >= 0 && uvs.get(twin >> 2)
            if (uv)
            {
                const kt = twin & 3, n = (kt + 1) & 3
                // the start face is next to all its neighbors in the room
                assert.deepEqual([uv[kt * 2], uv[kt * 2 + 1]], [own[((k + 1) & 3) * 2], own[((k + 1) & 3) * 2 + 1]])
                assert.deepEqual([uv[n * 2], uv[n * 2 + 1]], [own[k * 2], own[k * 2 + 1]])
            }
        }
    })

    it("matches most edges and keeps the best start", () => {
        let edges = 0, matching = 0
        for (const faces of rooms)
        {
            const best = layOutRoom(world, faces)
            assert.isAtMost(best.matching, best.edges)
            assert.isAtLeast(best.matching, floodRoom(world, faces, faces[0]).matching)
            edges += best.edges
            matching += best.matching
        }
        assert.isAbove(matching / edges, 0.9)
    })

    it("gives a share of the rooms a pattern, the same for the same seed", () => {
        const chosen = choosePatterns(rooms, 17)
        assert.deepEqual(choosePatterns(rooms, 17), chosen)
        const share = chosen.filter(pattern => pattern >= 0).length / rooms.length
        assert.approximately(share, PATTERN_SHARE, 0.15)
        assert.isTrue(chosen.every(pattern => pattern < FLOOR_PATTERNS.length))
    })

    it("has the files of all patterns", () => {
        for (const [name] of FLOOR_PATTERNS)
        {
            assert.isTrue(existsSync(`public/media/patterns/${name}.png`), name)
        }
    })

    it("continues the pattern into the wall faces next to a room", () => {
        let walls = 0
        for (const faces of rooms)
        {
            const layout = layOutRoom(world, faces)
            for (const [face, uv] of layOutWalls(world, layout))
            {
                walls++
                assert.equal(FaceType.byIndex(world.faceType(face)), FaceType.WALL)
                assert.equal(area(uv), 2)
                let reached = false
                for (let k = 0; k < 4; k++)
                {
                    const twin = world.twin((face << 2) | k)
                    const own = twin >= 0 && layout.uvs.get(twin >> 2)
                    if (!own)
                    {
                        continue
                    }
                    const kt = twin & 3, n = (kt + 1) & 3
                    const a = k * 2, b = ((k + 1) & 3) * 2
                    reached ||= uv[a] === own[n * 2] && uv[a + 1] === own[n * 2 + 1] &&
                        uv[b] === own[kt * 2] && uv[b + 1] === own[kt * 2 + 1]
                }
                assert.isTrue(reached)
            }
        }
        assert.isAbove(walls, 0)
    })

    it("gives each room the part of a wall face on its side", () => {
        const owners = new Map<number, number>()
        rooms.forEach((faces, room) => {
            const own = new Set(faces)
            for (const face of layOutWalls(world, layOutRoom(world, faces)).keys())
            {
                const corners = wallTriangles(world, face, own)
                assert.isAbove(corners.length, 0)
                for (let i = 0; i < corners.length; i += 3)
                {
                    const k = corners[i]
                    assert.isTrue(own.has(world.twin((face << 2) | k) >> 2))
                    // an edge of a face goes to one room only
                    const edge = (face << 2) | k
                    assert.isFalse(owners.has(edge))
                    owners.set(edge, room)
                }
            }
        })
        // some wall faces lie between two rooms
        const shared = new Set([...owners.keys()].map(edge => edge >> 2))
        assert.isBelow(shared.size, owners.size)
    })

    it("creates a geometry per pattern with two triangles per face and one per wall edge", () => {
        const chosen = choosePatterns(rooms, 17)
        const geometries = createPatternGeometries(world, rooms, 17)
        const faces = rooms.filter((_, room) => chosen[room] >= 0).reduce((sum, room) => {
            const own = new Set(room)
            let walls = 0
            for (const face of layOutWalls(world, layOutRoom(world, room)).keys())
            {
                walls += wallTriangles(world, face, own).length
            }
            return sum + room.length * 6 + walls
        }, 0)
        const used = new Set(chosen.filter(pattern => pattern >= 0))
        assert.deepEqual([...geometries.keys()].sort((a, b) => a - b), [...used].sort((a, b) => a - b))
        const counts = [...geometries.values()].map(geometry => geometry.getAttribute("position").count)
        assert.equal(counts.reduce((sum, count) => sum + count, 0), faces)
    })
})
