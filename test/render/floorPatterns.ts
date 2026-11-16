import { existsSync } from "node:fs"
import { assert, describe, it } from "vitest"
import { generateDungeon } from "../../src/map/generateDungeon"
import PatchWorld from "../../src/map/PatchWorld"
import { FACE_SIZE } from "../../src/map/scale"
import {
    choosePatterns,
    createPatternGeometries,
    floodRoom,
    FLOOR_PATTERNS,
    layOutRoom,
    PATTERN_SHARE
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

    it("creates a geometry per pattern with two triangles per face", () => {
        const chosen = choosePatterns(rooms, 17)
        const geometries = createPatternGeometries(world, rooms, 17)
        const faces = rooms.filter((_, room) => chosen[room] >= 0).reduce((sum, room) => sum + room.length, 0)
        const used = new Set(chosen.filter(pattern => pattern >= 0))
        assert.deepEqual([...geometries.keys()].sort((a, b) => a - b), [...used].sort((a, b) => a - b))
        const counts = [...geometries.values()].map(geometry => geometry.getAttribute("position").count)
        assert.equal(counts.reduce((sum, count) => sum + count, 0), faces * 6)
    })
})
