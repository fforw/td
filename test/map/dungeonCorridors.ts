import { assert, describe, it } from "vitest"

import { generateDungeon } from "../../src/map/generateDungeon"
import { EdgeType } from "../../src/map/geometry"
import PatchWorld, { SLOT_SHIFT } from "../../src/map/PatchWorld"
import { faceOf } from "../../src/map/QuadPatch"
import { findRoute, slotOf } from "../../src/map/route"
import { FACE_SIZE } from "../../src/map/scale"


const SEEDS = [1, 2, 3, 4711, 12345]

const LOCAL_FACE = (1 << (SLOT_SHIFT - 2)) - 1


function level(seed: number, width = 2, height = 2)
{
    const { patches, rooms, corridors } = generateDungeon(seed, FACE_SIZE, width, height)
    const world = new PatchWorld()
    const slots = patches.map(patch => world.add(patch))
    return { world, slots, roomFaces: rooms, corridors }
}


function adjacent(world: PatchWorld, a: number, b: number): boolean
{
    return [0, 1, 2, 3].some(i => faceOf(world.twin(a * 4 + i)) === b)
}


describe("Corridors", () => {

    it("connects all rooms as a tree", () => {

        for (const seed of SEEDS)
        {
            const { roomFaces, corridors } = level(seed)
            assert(corridors.length === roomFaces.length - 1, String(seed))

            const connected = new Set([0])
            for (const { from, to } of corridors)
            {
                assert(connected.has(from))
                assert(!connected.has(to))
                connected.add(to)
            }
        }
    })

    it("walks from face to face between its rooms", () => {

        for (const seed of SEEDS)
        {
            const { world, roomFaces, corridors } = level(seed)
            for (const { from, to, faces, fromFace, toFace } of corridors)
            {
                assert(roomFaces[from].includes(fromFace))
                assert(roomFaces[to].includes(toFace))

                const path = [fromFace, ...faces, toFace]
                path.slice(1).forEach((face, i) => assert(adjacent(world, path[i], face)))
            }
        }
    })

    it("stays out of rooms and other corridors", () => {

        for (const seed of SEEDS)
        {
            const { roomFaces, corridors } = level(seed)
            const faces = [...roomFaces.flat(), ...corridors.flatMap(corridor => corridor.faces)]
            assert(new Set(faces).size === faces.length)
        }
    })

    it("stays off the outer edge of the level", () => {

        const { world, corridors } = level(4711)
        for (const face of corridors.flatMap(({ faces }) => faces))
        {
            for (let i = 0; i < 4; i++)
            {
                assert(world.twin(face * 4 + i) >= 0)
            }
        }
    })

    it("crosses seams", () => {

        const crossing = SEEDS.flatMap(seed => level(seed).corridors).filter(
            ({ faces, fromFace, toFace }) => new Set([fromFace, ...faces, toFace].map(slotOf)).size > 1
        )
        assert(crossing.length > 0)
    })

    it("separates everything with walls except for a door at each end", () => {

        for (const seed of SEEDS)
        {
            const { world, roomFaces, corridors } = level(seed)
            const spaces = new Map<number, number>()
            roomFaces.forEach((faces, room) => faces.forEach(face => spaces.set(face, room)))
            corridors.forEach(({ faces }, i) => faces.forEach(face => spaces.set(face, roomFaces.length + i)))

            let doors = 0
            for (const [face, space] of spaces)
            {
                for (let i = 0; i < 4; i++)
                {
                    const h = face * 4 + i
                    const type = EdgeType.byIndex(world.edgeType(h))
                    const other = spaces.get(faceOf(world.twin(h)))
                    if (type === EdgeType.DOOR)
                    {
                        doors++
                    }
                    if (other !== undefined && other !== space)
                    {
                        assert(type === EdgeType.WALL || type === EdgeType.DOOR)
                    }
                    assert(world.edgeType(world.twin(h)) === world.edgeType(h))
                }
            }
            // a door has two half edges, both on faces of the level
            assert(doors === corridors.length * 2 * 2, seed + ": " + doors)
        }
    })

    it("only opens a corridor to the faces before and after it", () => {

        for (const seed of SEEDS)
        {
            const { world, corridors } = level(seed)
            const floor = new Set(corridors.flatMap(({ faces }) => faces))
            for (const { faces } of corridors)
            {
                faces.forEach((face, index) => {
                    for (let i = 0; i < 4; i++)
                    {
                        const h = face * 4 + i
                        const other = faceOf(world.twin(h))
                        if (other === faces[index - 1] || other === faces[index + 1])
                        {
                            assert(world.edgeType(h) === EdgeType.OPEN.index)
                        }
                        else if (floor.has(other))
                        {
                            assert(world.edgeType(h) === EdgeType.WALL.index)
                        }
                    }
                })
            }
        }
    })

    it("lets routes reach all rooms", () => {

        for (const seed of SEEDS)
        {
            const { world, slots, roomFaces } = level(seed)
            const start = roomFaces[0][0]
            for (const [target] of roomFaces.slice(1))
            {
                assert(findRoute(world, start, slotOf(target), [target & LOCAL_FACE], slots).reachable)
            }
        }
    })

    it("has no way between rooms but through its doors", () => {

        for (const seed of SEEDS)
        {
            const { world, slots, roomFaces } = level(seed)
            for (const slot of slots)
            {
                const { edgeType } = world.getPatch(slot)
                edgeType.forEach((type, h) => {
                    if (type === EdgeType.DOOR.index)
                    {
                        edgeType[h] = EdgeType.WALL.index
                    }
                })
            }

            const start = roomFaces[0][0]
            for (const [target] of roomFaces.slice(1))
            {
                assert(!findRoute(world, start, slotOf(target), [target & LOCAL_FACE], slots).reachable)
            }
        }
    })

    it("connects the rooms of levels of other sizes", () => {

        for (const [width, height] of [[1, 1], [3, 1], [3, 2]])
        {
            const { roomFaces, corridors } = level(4711, width, height)
            assert(corridors.length === roomFaces.length - 1)
        }
    })
})
