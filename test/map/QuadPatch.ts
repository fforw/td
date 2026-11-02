import { afterAll, assert, beforeAll, describe, it } from "vitest"

import HexagonPatch, { PATCH_SIZE } from "../../src/map/HexagonPatch"
import { FaceType, type Face, type HalfEdge } from "../../src/core/geometry"
import PatchWorld, { SLOT_SHIFT } from "../../src/map/PatchWorld"
import { faceOf, next, packPatch, prev, type QuadPatch } from "../../src/map/QuadPatch"
import { patchSeed, resetRandom } from "../../src/core/util"


const SEED = 4711

interface Built
{
    patch: HexagonPatch
    faces: Face[]
    packed: QuadPatch
    /**
     * Local index per half edge object, in the same order the packer uses
     */
    index: Map<HalfEdge, number>
}


function createPatch(q: number, r: number): Built
{
    resetRandom(patchSeed(SEED, q, r))
    const patch = new HexagonPatch(q, r, 40)
    const faces = patch.build()
    const packed = packPatch(patch, faces)

    const index = new Map<HalfEdge, number>()
    faces.forEach((face, f) => {
        let curr = face.halfEdge
        for (let i = 0; i < 4; i++)
        {
            index.set(curr, f * 4 + i)
            curr = curr.next
        }
    })
    return { patch, faces, packed, index }
}


/**
 * Checks the twin invariants of all half edges of the given slots and returns the number of half edges without twin
 */
function checkWorld(world: PatchWorld, slots: number[]): number
{
    const a = [0, 0, 0]
    const b = [0, 0, 0]
    let open = 0
    for (const slot of slots)
    {
        const count = world.getPatch(slot).vertex.length
        for (let local = 0; local < count; local++)
        {
            const h = (slot << SLOT_SHIFT) | local
            const t = world.twin(h)
            if (t < 0)
            {
                open++
                continue
            }
            assert(world.twin(t) === h)

            // twins run along the same edge in opposite directions
            world.position(t, a)
            world.position(next(h), b)
            assert(a.join() === b.join())
            world.position(next(t), a)
            world.position(h, b)
            assert(a.join() === b.join())
        }
    }
    return open
}


describe("QuadPatch", function () {

    let log: typeof console.log
    beforeAll(() => {
        log = console.log
        console.log = () => {}
    })
    afterAll(() => console.log = log)

    it("packs the same topology as the object structure", function () {
        const { faces, packed, index } = createPatch(0, 0)

        assert(packed.faceType.length === faces.length)
        assert(packed.vertex.length === faces.length * 4)

        let borderCount = 0
        index.forEach((h, he) => {
            assert(faceOf(h) === index.get(he.face.halfEdge)! >> 2)
            assert(next(h) === index.get(he.next))
            assert(prev(next(h)) === h)

            const v = packed.vertex[h] * 3
            assert(packed.positions[v] === he.vertex.x)
            assert(packed.positions[v + 1] === he.vertex.y)
            assert(Number.isInteger(he.vertex.x) && Number.isInteger(he.vertex.y))

            if (he.twin)
            {
                assert(packed.twin[h] === index.get(he.twin))
            }
            else
            {
                assert(packed.twin[h] < -1)
                borderCount++
            }
            assert(FaceType.byIndex(packed.faceType[faceOf(h)]) === he.face.type)
        })

        // two half edges per outer hexagon edge, each with its own seam index
        const seams = new Set([...packed.twin].filter(t => t < 0))
        assert(seams.size === borderCount)
        assert(borderCount === packed.border.length / 7 * 2)
    })

    it("builds the same patch for the same seed and position", function () {
        const a = createPatch(PATCH_SIZE, 0).packed
        createPatch(0, 0)
        const b = createPatch(PATCH_SIZE, 0).packed

        assert(a.positions.join() === b.positions.join())
        assert(a.twin.join() === b.twin.join())
        assert(a.faceType.join() === b.faceType.join())
    })

    it("connects patches along the same seams as the object structure", function () {
        const a = createPatch(0, 0)
        const b = createPatch(PATCH_SIZE, 0)

        const world = new PatchWorld()
        const slotA = world.add(a.packed)
        const slotB = world.add(b.packed)

        const count = a.patch.connect(b.patch)
        assert(count > 0)

        let crossing = 0
        const check = (from: Built, slotFrom: number, to: Built, slotTo: number) => from.index.forEach((h, he) => {
            if (he.twin && from.index.get(he.twin) === undefined)
            {
                assert(world.twin((slotFrom << SLOT_SHIFT) | h) === ((slotTo << SLOT_SHIFT) | to.index.get(he.twin)!))
                crossing++
            }
        })
        check(a, slotA, b, slotB)
        check(b, slotB, a, slotA)

        // two half edges per hexagon edge on each side
        assert(crossing === count * 4)

        const open = checkWorld(world, [slotA, slotB])
        assert(open === a.packed.border.length / 7 * 2 + b.packed.border.length / 7 * 2 - crossing)
    })

    it("disconnects and reconnects patches", function () {
        // these three patches meet in a common corner
        const patches = [createPatch(0, 0), createPatch(PATCH_SIZE, 0), createPatch(0, PATCH_SIZE)]
        const borderTotal = patches.reduce((n, p) => n + p.packed.border.length / 7 * 2, 0)

        const world = new PatchWorld()
        const slots = patches.map(p => world.add(p.packed))

        const connected = checkWorld(world, slots)
        assert(connected < borderTotal)
        assert(world.neighbors(slots[0]).sort().join() === [slots[1], slots[2]].sort().join())

        world.disconnect(slots[0], slots[1])
        assert(world.neighbors(slots[0]).join() === String(slots[2]))
        const partly = checkWorld(world, slots)
        assert(partly > connected)

        world.remove(slots[2])
        assert(checkWorld(world, slots.slice(0, 2)) === patches[0].packed.border.length / 7 * 2 + patches[1].packed.border.length / 7 * 2)

        // the freed slot gets reused and the patch connects to everything loaded again
        assert(world.add(patches[2].packed) === slots[2])
        assert(world.connect(slots[0], slots[1]) > 0)
        assert(checkWorld(world, slots) === connected)

        assert(world.findSlot(PATCH_SIZE, 0) === slots[1])
        assert(world.findSlot(PATCH_SIZE, PATCH_SIZE) === -1)
    })
})
