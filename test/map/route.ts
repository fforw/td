import { assert, describe, it } from "vitest"

import type { PatchKind } from "../../src/game/campaign"
import Castle from "../../src/castle/Castle"
import { planCastle } from "../../src/castle/castlePlan"
import HexagonPatch, { PATCH_SIZE } from "../../src/map/HexagonPatch"
import { EdgeType, FaceType } from "../../src/map/geometry"
import PatchWorld, { LOCAL_MASK, SLOT_SHIFT } from "../../src/map/PatchWorld"
import { generatePatch } from "../../src/map/generatePatch"
import { applyGenerator, PATCH_GENERATORS } from "../../src/map/patchGenerators"
import { faceCount, packPatch, transferables, type QuadPatch } from "../../src/map/QuadPatch"
import {
    borderConnected,
    DEFAULT_COSTS,
    EDGE_COSTS,
    findRoute,
    globalFace,
    packPath,
    unpackPath
} from "../../src/map/route"
import { FACE_SIZE } from "../../src/map/scale"
import Terrain from "../../src/map/terrain"
import { patchSeed, resetRandom, rng } from "../../src/math/random"


const { GRASS, WATER, SWAMP, TREE, TREE2, FOREST_FLOOR, SAND, SNOW, WALL, HOUSE, ROCK, GATE } = FaceType


/**
 * Builds a hexagon patch of nothing but the given face type
 */
function plainFaces(q: number, r: number, type: FaceType)
{
    resetRandom(patchSeed(4711, q, r))
    const patch = new HexagonPatch(q * PATCH_SIZE, r * PATCH_SIZE, FACE_SIZE)
    const faces = patch.build()
    faces.forEach(face => face.type = type)
    return { patch, faces }
}


function plainPatch(q: number, r: number, type: FaceType): QuadPatch
{
    const { patch, faces } = plainFaces(q, r, type)
    return packPatch(patch, faces)
}


/**
 * Runs the generator of the given kind on a patch of nothing but the given face type
 */
function plainGenerated(kind: PatchKind, type: FaceType)
{
    const { patch, faces } = plainFaces(0, 0, type)
    return applyGenerator(kind, patch, faces)
}


/**
 * Returns the faces next to the given local face inside its patch
 */
function neighbors(patch: QuadPatch, face: number): number[]
{
    const out: number[] = []
    for (let i = 0; i < 4; i++)
    {
        const twin = patch.twin[face * 4 + i]
        if (twin >= 0)
        {
            out.push(twin >> 2)
        }
    }
    return out
}


/**
 * Returns a face without any border half edge
 */
function innerFace(patch: QuadPatch): number
{
    const count = faceCount(patch)
    for (let face = 0; face < count; face++)
    {
        if (neighbors(patch, face).length === 4)
        {
            return face
        }
    }
    throw new Error("No inner face")
}


describe("Costs", () => {

    it("has a constant cost per face type", () => {

        assert(DEFAULT_COSTS[GRASS.index] === 1)
        assert(DEFAULT_COSTS[GATE.index] === 1)
        assert(DEFAULT_COSTS[SAND.index] === 1.5)
        assert(DEFAULT_COSTS[SNOW.index] === 2)
        assert(DEFAULT_COSTS[TREE.index] === 3)
        assert(DEFAULT_COSTS[TREE2.index] === 3)
        assert(DEFAULT_COSTS[FOREST_FLOOR.index] === 3)
        assert(DEFAULT_COSTS[SWAMP.index] === 4)
    })

    it("can't enter water, rock or buildings", () => {

        for (const type of [WATER, ROCK, WALL, HOUSE])
        {
            assert(DEFAULT_COSTS[type.index] === Infinity)
        }
    })
})


describe("Route", () => {

    it("sums up the costs of all faces entered, but not the start", () => {

        const patch = plainPatch(0, 0, WATER)
        const start = innerFace(patch)
        const [swamp] = neighbors(patch, start)
        const sand = neighbors(patch, swamp).find(face => face !== start)!
        patch.faceType[start] = SNOW.index
        patch.faceType[swamp] = SWAMP.index
        patch.faceType[sand] = SAND.index

        const world = new PatchWorld()
        const slot = world.add(patch)
        const route = findRoute(world, globalFace(slot, start), slot, [sand], [slot])
        assert(route.reachable)
        assert(route.cost === 5.5)
        assert.deepEqual(route.paths, [[start, swamp, sand].map(face => globalFace(slot, face))])
    })

    it("needs all goals and costs as much as the farthest one", () => {

        const patch = plainPatch(0, 0, WATER)
        const start = innerFace(patch)
        const [near] = neighbors(patch, start)
        const far = neighbors(patch, near).find(face => face !== start)!
        patch.faceType[start] = GRASS.index
        patch.faceType[near] = GRASS.index
        patch.faceType[far] = GRASS.index

        const world = new PatchWorld()
        const slot = world.add(patch)
        const from = globalFace(slot, start)
        const route = findRoute(world, from, slot, [far, near], [slot])
        assert(route.reachable)
        assert(route.cost === 2)
        assert(route.paths.length === 2)

        patch.faceType[far] = WATER.index
        assert(!findRoute(world, from, slot, [far, near], [slot]).reachable)
    })

    it("crosses seams, but only through the patches it may use", () => {

        const world = new PatchWorld()
        const a = world.add(plainPatch(0, 0, GRASS))
        const b = world.add(plainPatch(1, 0, GRASS))
        const c = world.add(plainPatch(2, 0, GRASS))
        const start = globalFace(a, innerFace(world.getPatch(a)))

        const route = findRoute(world, start, c, [], [a, b])
        assert(route.reachable)
        assert(route.cost > 0)
        assert(!findRoute(world, start, c, [], [a]).reachable)
    })

    it("reaches a patch without goals by entering any face", () => {

        const world = new PatchWorld()
        const a = world.add(plainPatch(0, 0, GRASS))
        const b = world.add(plainPatch(1, 0, GRASS))
        const start = globalFace(a, innerFace(world.getPatch(a)))

        const direct = findRoute(world, start, b, [], [a])
        const middle = findRoute(world, start, b, [innerFace(world.getPatch(b))], [a])
        assert(direct.reachable && middle.reachable)
        assert(direct.cost <= middle.cost)
    })

    it("costs what it takes to get as close as possible if there is no way", () => {

        const world = new PatchWorld()
        const a = world.add(plainPatch(0, 0, GRASS))
        const b = world.add(plainPatch(1, 0, WATER))
        const start = globalFace(a, innerFace(world.getPatch(a)))

        const route = findRoute(world, start, b, [], [a])
        assert(!route.reachable)
        assert(route.cost > 0)
        assert(route.cost < Infinity)
    })
})


/**
 * Patch of water with two faces of grass next to each other and the global half edge from one to the other
 */
function twoFaces()
{
    const patch = plainPatch(0, 0, WATER)
    const from = innerFace(patch)
    const to = neighbors(patch, from)[0]
    patch.faceType[from] = GRASS.index
    patch.faceType[to] = GRASS.index

    const world = new PatchWorld()
    const slot = world.add(patch)
    const h = [0, 1, 2, 3].map(i => from * 4 + i).find(h => patch.twin[h] >> 2 === to)!
    return { patch, world, slot, from, to, edge: (slot << SLOT_SHIFT) | h }
}


/**
 * Connects two patches of grass and returns a global half edge of the first one that crosses the seam
 */
function seamEdge()
{
    const world = new PatchWorld()
    const a = world.add(plainPatch(0, 0, GRASS))
    const b = world.add(plainPatch(1, 0, GRASS))
    const { twin } = world.getPatch(a)
    const h = twin.findIndex((_, i) => twin[i] < 0 && world.twin((a << SLOT_SHIFT) | i) >= 0)
    return { world, a, b, edge: (a << SLOT_SHIFT) | h }
}


describe("Edge types", () => {

    it("start out open", () => {

        const patch = plainPatch(0, 0, GRASS)
        assert(patch.edgeType.length === patch.vertex.length)
        assert(patch.edgeType.every(type => type === EdgeType.OPEN.index))
        assert(EdgeType.OPEN.index === 0)
    })

    it("are transferred with the patch", () => {

        const patch = plainPatch(0, 0, GRASS)
        assert(transferables(patch).includes(patch.edgeType.buffer))
    })

    it("know their names", () => {

        assert.deepEqual(EdgeType.typeNames(), ["OPEN", "WALL", "DESTRUCTIBLE", "DOOR"])
        assert(EdgeType.byIndex(EdgeType.DOOR.index) === EdgeType.DOOR)
    })

    it("cost nothing if open, something for a door and can't be crossed otherwise", () => {

        assert(EDGE_COSTS[EdgeType.OPEN.index] === 0)
        assert(EDGE_COSTS[EdgeType.DOOR.index] === 1)
        assert(EDGE_COSTS[EdgeType.WALL.index] === Infinity)
        assert(EDGE_COSTS[EdgeType.DESTRUCTIBLE.index] === Infinity)
    })

    it("change both sides of an edge", () => {

        const { world, edge } = twoFaces()
        world.setEdgeType(edge, EdgeType.WALL.index)
        assert(world.edgeType(edge) === EdgeType.WALL.index)
        assert(world.edgeType(world.twin(edge)) === EdgeType.WALL.index)
    })

    it("change both sides of a seam", () => {

        const { world, edge } = seamEdge()
        world.setEdgeType(edge, EdgeType.WALL.index)
        assert(world.edgeType(edge) === EdgeType.WALL.index)
        assert(world.edgeType(world.twin(edge)) === EdgeType.WALL.index)
    })

    it("only change the own side of an unconnected border", () => {

        const world = new PatchWorld()
        const a = world.add(plainPatch(0, 0, GRASS))
        const { twin } = world.getPatch(a)
        const edge = (a << SLOT_SHIFT) | twin.findIndex(t => t < 0)
        assert(world.twin(edge) === -1)

        world.setEdgeType(edge, EdgeType.WALL.index)
        assert(world.edgeType(edge) === EdgeType.WALL.index)
    })

    it("block a route through a wall", () => {

        const { world, slot, from, to, edge } = twoFaces()
        const start = globalFace(slot, from)
        assert(findRoute(world, start, slot, [to], [slot]).cost === 1)

        world.setEdgeType(edge, EdgeType.WALL.index)
        assert(!findRoute(world, start, slot, [to], [slot]).reachable)
    })

    it("block a route across a seam from both sides", () => {

        const { world, a, b, edge } = seamEdge()
        const local = (h: number) => (h & LOCAL_MASK) >> 2
        const faceA = local(edge)
        const faceB = local(world.twin(edge))

        // the two faces next to the seam are all that's left to walk on
        world.getPatch(a).faceType.fill(WATER.index)
        world.getPatch(b).faceType.fill(WATER.index)
        world.getPatch(a).faceType[faceA] = GRASS.index
        world.getPatch(b).faceType[faceB] = GRASS.index

        const startA = globalFace(a, faceA)
        const startB = globalFace(b, faceB)
        assert(findRoute(world, startA, b, [faceB], [a]).cost === 1)
        assert(findRoute(world, startB, a, [faceA], [b]).cost === 1)

        world.setEdgeType(edge, EdgeType.WALL.index)
        assert(!findRoute(world, startA, b, [faceB], [a]).reachable)
        assert(!findRoute(world, startB, a, [faceA], [b]).reachable)
    })

    it("add the cost of a door to the route", () => {

        const { world, slot, from, to, edge } = twoFaces()
        world.setEdgeType(edge, EdgeType.DOOR.index)
        const route = findRoute(world, globalFace(slot, from), slot, [to], [slot])
        assert(route.reachable)
        assert(route.cost === 2)
    })

    it("can be one-way", () => {

        const { world, slot, from, to, edge } = twoFaces()
        world.setEdgeType(edge, EdgeType.WALL.index, true)
        assert(world.edgeType(world.twin(edge)) === EdgeType.OPEN.index)

        assert(!findRoute(world, globalFace(slot, from), slot, [to], [slot]).reachable)
        assert(findRoute(world, globalFace(slot, to), slot, [from], [slot]).reachable)
    })

    it("cut faces off from the border", () => {

        const patch = plainPatch(0, 0, GRASS)
        const inner = innerFace(patch)
        assert(borderConnected(patch).has(inner))

        // wall in the face from both sides
        for (let h = inner * 4; h < inner * 4 + 4; h++)
        {
            patch.edgeType[h] = EdgeType.WALL.index
            patch.edgeType[patch.twin[h]] = EdgeType.WALL.index
        }
        const connected = borderConnected(patch)
        assert(!connected.has(inner))
        assert(connected.size === faceCount(patch) - 1)
    })

    it("don't let a walled border count as connection", () => {

        const patch = plainPatch(0, 0, WATER)
        const h = patch.twin.findIndex(t => t < 0)
        const face = h >> 2
        patch.faceType[face] = GRASS.index
        assert(borderConnected(patch).has(face))

        for (let i = face * 4; i < face * 4 + 4; i++)
        {
            patch.edgeType[i] = EdgeType.WALL.index
        }
        assert(!borderConnected(patch).has(face))
    })
})


describe("Paths", () => {

    it("run from the start across the seam and survive the way to another thread", () => {

        const world = new PatchWorld()
        const a = world.add(plainPatch(0, 0, GRASS))
        const b = world.add(plainPatch(1, 0, GRASS))
        const start = globalFace(a, innerFace(world.getPatch(a)))

        const { paths } = findRoute(world, start, b, [innerFace(world.getPatch(b))], [a])
        assert(paths[0][0] === start)
        assert(paths[0].some(face => face >> (SLOT_SHIFT - 2) === b))

        // the other side may have the same patches in other slots
        const other = new PatchWorld()
        const otherB = other.add(world.getPatch(b))
        const otherA = other.add(world.getPatch(a))
        const moved = unpackPath(other, packPath(world, paths[0]))
        assert(moved[0] === globalFace(otherA, innerFace(world.getPatch(a))))
        assert(moved[moved.length - 1] === globalFace(otherB, innerFace(world.getPatch(b))))
        assert(moved.length === paths[0].length)
    })

    it("lead to the closest face if there is no way", () => {

        const world = new PatchWorld()
        const a = world.add(plainPatch(0, 0, GRASS))
        const b = world.add(plainPatch(1, 0, WATER))
        const start = globalFace(a, innerFace(world.getPatch(a)))

        const { reachable, paths, cost } = findRoute(world, start, b, [], [a])
        assert(!reachable)
        assert(paths.length === 1)
        assert(paths[0].length === cost + 1)
    })
})


describe("Lazy routes", () => {

    it("lets a patch bring in more patches once the search gets there", () => {

        const world = new PatchWorld()
        const a = world.add(plainPatch(0, 0, GRASS))
        const start = globalFace(a, innerFace(world.getPatch(a)))
        const b = world.add(plainPatch(2, 0, GRASS))

        const entered: number[] = []
        const route = findRoute(world, start, b, [], [a], undefined, slot => {
            entered.push(slot)
            return slot === a ? [world.add(plainPatch(1, 0, GRASS))] : []
        })
        assert(route.reachable)
        assert(entered[0] === a)
        assert(new Set(entered).size === entered.length)
    })
})


describe("Points of interest", () => {

    it("falls back to NONE if a patch has no room for them", () => {

        const { kind, pois } = plainGenerated("DUNGEON", WATER)
        assert(kind === "NONE")
        assert.deepEqual(pois, [])
    })

    it("places them where they connect to the border", () => {

        const { patch, kind, pois } = plainGenerated("TEMPLE", GRASS)
        assert(kind === "TEMPLE")
        assert(pois.length === 1)
        assert(borderConnected(patch).has(pois[0].face))
    })

    it("avoids pockets cut off from the border", () => {

        const patch = plainPatch(0, 0, WATER)
        const pocket = innerFace(patch)
        patch.faceType[pocket] = GRASS.index
        assert(!borderConnected(patch).has(pocket))
        assert(PATCH_GENERATORS.TREASURE.place!(patch) === null)
    })

    it("has none on empty patches", () => {

        const { kind, pois } = plainGenerated("EMPTY", GRASS)
        assert(kind === "EMPTY")
        assert.deepEqual(pois, [])
    })

    it("has the castle plan as the only one of a castle", () => {

        const { patch, kind, pois } = generatePatch(0, 0, 4711, FACE_SIZE, "CASTLE")
        assert(kind === "CASTLE")
        assert(pois.length === 1)
        assert(pois[0].plan)
        assert(pois[0].face >= 0 && pois[0].face < faceCount(patch))
    })

    it("has no plans on other kinds", () => {

        const { pois } = generatePatch(0, PATCH_SIZE, 4711, FACE_SIZE, "DUNGEON")
        assert(pois.every(({ plan }) => !plan))
    })

    it("leaves the terrain alone without a generator that changes it", () => {

        const terrain = generatePatch(PATCH_SIZE, 0, 4711, FACE_SIZE, "NONE").patch.faceType
        for (const kind of ["EMPTY", "DUNGEON", "TREASURE", "TEMPLE"] as const)
        {
            assert.deepEqual(generatePatch(PATCH_SIZE, 0, 4711, FACE_SIZE, kind).patch.faceType, terrain)
        }
    })

    it("always lets the castle center reach the world around it", () => {

        for (const seed of [1, 2, 3, 4, 5, 6, 7, 8])
        {
            const terrain = new Terrain(seed)
            const world = new PatchWorld()
            let start = -1
            for (const [q, r] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]])
            {
                resetRandom(patchSeed(seed, q * PATCH_SIZE, r * PATCH_SIZE))
                const patch = new HexagonPatch(q * PATCH_SIZE, r * PATCH_SIZE, FACE_SIZE)
                const faces = patch.build()
                const random = () => rng.next()
                for (const face of faces)
                {
                    const [x, y] = face.centroid
                    face.type = terrain.faceType(x, y, random)
                }
                let center = -1
                if (q === 0 && r === 0)
                {
                    const castle = new Castle(faces)
                    planCastle(faces, castle)
                    center = faces.indexOf(castle.centerFace)
                }
                const slot = world.add(packPatch(patch, faces))
                if (center >= 0)
                {
                    start = globalFace(slot, center)
                }
            }

            const castleSlot = world.findSlot(0, 0)
            const others = [0, 1, 2, 3, 4].filter(slot => slot !== castleSlot)
            assert(others.some(slot => findRoute(world, start, slot, [], [castleSlot]).reachable), "seed " + seed)
        }
    })
})
