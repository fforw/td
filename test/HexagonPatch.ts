import { afterAll, assert, beforeAll, describe, it } from "vitest"

import HexagonPatch, { PATCH_SIZE } from "../src/HexagonPatch"
import { resetRandom } from "../src/util"
import type { Face, HalfEdge, Vertex } from "../src/geometry"


/**
 * Patch together with the faces it built
 */
type BuiltPatch = HexagonPatch & { faces: Face[] }


function getHalfEdges(faces: Face[]): HalfEdge[]
{
    const halfEdges: HalfEdge[] = []
    faces.forEach(face => {
        let curr = face.halfEdge
        do
        {
            halfEdges.push(curr)
            curr = curr.next
        } while (curr !== face.halfEdge)
    })
    return halfEdges
}


function getVertices(faces: Face[]): Set<Vertex>
{
    return new Set(getHalfEdges(faces).map(he => he.vertex))
}


/**
 * Checks the half edge invariants of the given faces and returns the Euler characteristic and the number of positions
 * occupied by more than one vertex object.
 */
function checkMesh(faces: Face[])
{
    const halfEdges = getHalfEdges(faces)
    const set = new Set(halfEdges)
    const vertices = getVertices(faces)

    let borderCount = 0
    halfEdges.forEach(he => {
        if (he.twin)
        {
            assert(set.has(he.twin))
            assert(he.twin.twin === he)
            assert(he.twin.vertex === he.next.vertex)
            assert(he.twin.next.vertex === he.vertex)
            assert(he.twin.edge === he.edge)
        }
        else
        {
            borderCount++
            assert(he.edge.halfEdge === he)
        }
    })

    const positions = new Map<string, number>()
    vertices.forEach(v => {
        assert(set.has(v.halfEdge))
        assert(v.halfEdge.vertex === v)

        const k = v.x + "/" + v.y
        positions.set(k, (positions.get(k) || 0) + 1)
    })

    const edgeCount = (halfEdges.length + borderCount) / 2
    return {
        euler: vertices.size - edgeCount + faces.length,
        duplicates: [...positions.values()].filter(n => n > 1).length,
        vertices
    }
}


function snapshot(faces: Face[]): string
{
    return faces.map(face => {
        const parts = []
        let curr = face.halfEdge
        do
        {
            parts.push(curr.vertex.x + "," + curr.vertex.y + (curr.twin ? "" : "|"))
            curr = curr.next
        } while (curr !== face.halfEdge)
        return parts.join(" ")
    }).join("\n")
}


function createPatch(q: number, r: number): BuiltPatch
{
    resetRandom(q * 1000 + r)
    const patch = new HexagonPatch(q, r, 40) as BuiltPatch
    patch.faces = patch.build()
    return patch
}


describe("HexagonPatch connections", function () {

    let log: typeof console.log
    beforeAll(() => {
        log = console.log
        console.log = () => {}
    })
    afterAll(() => console.log = log)

    it("connects two neighboring patches into one mesh", function () {
        const a = createPatch(0, 0)
        const b = createPatch(PATCH_SIZE, 0)

        assert(a.connect(b) > 0)

        const { euler, duplicates } = checkMesh(a.faces.concat(b.faces))
        assert(euler === 1)
        assert(duplicates === 0)
    })

    it("restores both meshes on disconnect", function () {
        const a = createPatch(0, 0)
        const b = createPatch(PATCH_SIZE, 0)
        const before = [snapshot(a.faces), snapshot(b.faces)]

        a.connect(b)
        b.disconnect(a)

        assert(a.connections.size === 0 && b.connections.size === 0)
        assert(snapshot(a.faces) === before[0])
        assert(snapshot(b.faces) === before[1])

        const checkA = checkMesh(a.faces)
        const checkB = checkMesh(b.faces)
        assert(checkA.euler === 1 && checkB.euler === 1)
        assert(checkA.duplicates === 0 && checkB.duplicates === 0)
        assert([...checkA.vertices].every(v => !checkB.vertices.has(v)))

        // and they can be connected again
        assert(a.connect(b) > 0)
        assert(checkMesh(a.faces.concat(b.faces)).euler === 1)
    })

    it("ignores patches that don't share an edge", function () {
        const a = createPatch(0, 0)
        const b = createPatch(PATCH_SIZE, PATCH_SIZE)

        assert(a.connect(b) === 0)
        assert(a.connections.size === 0)
    })

    it("keeps vertices shared by three patches merged while two are still connected", function () {
        // these three patches meet in a common corner
        const patches = [ createPatch(0, 0), createPatch(PATCH_SIZE, 0), createPatch(0, PATCH_SIZE) ]
        const [a, b, c] = patches
        const all = () => patches.reduce((faces: Face[], p) => faces.concat(p.faces), [])

        assert(a.connect(b) > 0)
        assert(b.connect(c) > 0)
        assert(c.connect(a) > 0)

        let check = checkMesh(all())
        assert(check.euler === 1 && check.duplicates === 0)

        a.disconnect(b)
        check = checkMesh(all())
        assert(check.euler === 1)

        // a and b now only share the corner vertex they both share with c
        const verticesB = getVertices(b.faces)
        const shared = [...getVertices(a.faces)].filter(v => verticesB.has(v))
        assert(shared.length === 1)
        assert(getVertices(c.faces).has(shared[0]))

        c.disconnectAll()
        check = checkMesh(all())
        assert(check.euler === 3)
        assert(checkMesh(c.faces).euler === 1)

        b.connect(a)
        c.connect(b)
        check = checkMesh(all())
        assert(check.euler === 1)

        a.connect(c)
        check = checkMesh(all())
        assert(check.euler === 1 && check.duplicates === 0)
    })
})
