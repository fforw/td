import Castle from "../castle/Castle"
import { type CastlePlan, planCastle } from "../castle/castlePlan"
import type { PatchKind } from "../game/campaign"
import { type Face, FaceType } from "./geometry"
import type HexagonPatch from "./HexagonPatch"
import { packPatch, type QuadPatch } from "./QuadPatch"
import { type BorderPart, borderParts, DEFAULT_COSTS, EDGE_COSTS } from "./route"


/**
 * Something on a patch an explorer has to reach
 */
export interface PointOfInterest
{
    /**
     * Local face to reach
     */
    face: number

    /**
     * Plan of what got built there, if any
     */
    plan?: CastlePlan

    /**
     * Half edge of the face that the way into a sub-level opens to, if there is one
     */
    entrance?: number
}


/**
 * Finished patch with what it ended up as, which is EMPTY if it had no room for what it was meant to be
 */
export interface GeneratedPatch
{
    patch: QuadPatch
    kind: PatchKind
    pois: PointOfInterest[]
}


/**
 * Turns a patch with its terrain into a patch of some kind, in up to two steps. Both get to return points of interest.
 * Faces have to stay as they are if a generator finds no room, since other requests for the patch might ask for EMPTY
 * right away.
 */
export interface PatchGenerator
{
    /**
     * Runs on the face objects before packing, the only chance to change the face types
     */
    build?(faces: Face[]): PointOfInterest[]

    /**
     * Runs on the packed patch, returns null if there is no room for the points of interest of the patch
     */
    place?(patch: QuadPatch): PointOfInterest[] | null
}


/**
 * Returns the face closest to the center of the patch out of the given faces
 */
function centralFace(patch: QuadPatch, faces: readonly number[]): number
{
    const { positions, vertex } = patch
    const count = positions.length / 3
    let centerX = 0, centerY = 0
    for (let i = 0; i < positions.length; i += 3)
    {
        centerX += positions[i] / count
        centerY += positions[i + 1] / count
    }

    let best = -1
    let bestDistance = Infinity
    for (const face of faces)
    {
        let x = 0, y = 0
        for (let i = 0; i < 4; i++)
        {
            const v = vertex[face * 4 + i] * 3
            x += positions[v] / 4
            y += positions[v + 1] / 4
        }
        const distance = Math.hypot(x - centerX, y - centerY)
        if (distance < bestDistance)
        {
            best = face
            bestDistance = distance
        }
    }
    return best
}


/**
 * Share of the largest part of a patch a part needs to have room for points of interest. Measured on generated worlds:
 * without it, a few patches choose a spit of 4 faces with two sides over 271 faces with one.
 */
const MIN_PART_SHARE = 0.1


/**
 * Returns the part for points of interest that has the most ways to get there: the one with the most sides, the larger
 * one of those, out of the parts that are not tiny next to the others. Routes come from all sides, and all points of
 * interest have to be in the same part, or no route gets to all of them.
 */
export function bestPart(parts: readonly BorderPart[]): BorderPart | null
{
    const largest = Math.max(0, ...parts.map(({ faces }) => faces.length))

    let best: BorderPart | null = null
    for (const part of parts)
    {
        const size = part.faces.length
        if (size >= largest * MIN_PART_SHARE && (
            !best || part.sides > best.sides || (part.sides === best.sides && size > best.faces.length)
        ))
        {
            best = part
        }
    }
    return best
}


/**
 * Builds a castle around the face closest to the world origin, its plan is the only point of interest
 */
const CASTLE: PatchGenerator = {
    build(faces)
    {
        const castle = new Castle(faces)
        const plan = planCastle(faces, castle)
        return [{ face: faces.indexOf(castle.centerFace), plan }]
    }
}


/**
 * Places one point of interest in the middle of the best part, for kinds without a generator of their own. It always
 * connects to the border of the patch, whether the border can be reached from outside is up to the neighboring patches.
 */
const CENTRAL: PatchGenerator = {
    place(patch)
    {
        const part = bestPart(borderParts(patch))
        return part && [{ face: centralFace(patch, part.faces) }]
    }
}


/**
 * Returns the half edge of a face in a border part that leads to the neighbor cheapest to enter. A border edge is only
 * the choice of a face that has no way to go within the patch, since what's behind it is up to the neighboring patch.
 */
function entranceEdge(patch: QuadPatch, face: number): number
{
    const { twin, edgeType, faceType } = patch
    let best = face * 4
    let bestCost = Infinity
    for (let h = face * 4; h < face * 4 + 4; h++)
    {
        const behind = twin[h] < 0 ? Number.MAX_VALUE : DEFAULT_COSTS[faceType[twin[h] >> 2]]
        const cost = EDGE_COSTS[edgeType[h]] + behind
        if (cost < bestCost)
        {
            best = h
            bestCost = cost
        }
    }
    return best
}


/**
 * Places the way into a dungeon in the middle of the best part. Only faces with nothing on them have room for it, the
 * level behind it is generated when it is first needed.
 */
const DUNGEON: PatchGenerator = {
    place(patch)
    {
        const free = bestPart(borderParts(patch))?.faces.filter(
            face => !FaceType.byIndex(patch.faceType[face]).occupied
        )
        if (!free?.length)
        {
            return null
        }
        const face = centralFace(patch, free)
        return [{ face, entrance: entranceEdge(patch, face) }]
    }
}


/**
 * Nothing but terrain
 */
const TERRAIN: PatchGenerator = {}


export const PATCH_GENERATORS: Record<PatchKind, PatchGenerator> = {
    CASTLE,
    EMPTY: TERRAIN,
    DUNGEON,
    TREASURE: CENTRAL,
    TEMPLE: CENTRAL
}


/**
 * Runs the generator of the given kind on a patch with its terrain and packs the patch.
 *
 * @param kind      kind the patch is meant to be
 * @param patch     hexagon patch
 * @param faces     quad faces the patch built
 *
 * @return finished patch
 */
export function applyGenerator(kind: PatchKind, patch: HexagonPatch, faces: Face[]): GeneratedPatch
{
    const generator = PATCH_GENERATORS[kind]
    const built = generator.build?.(faces) ?? []
    const packed = packPatch(patch, faces)
    const placed = generator.place ? generator.place(packed) : []
    return placed
        ? { patch: packed, kind, pois: [...built, ...placed] }
        : { patch: packed, kind: "EMPTY", pois: [] }
}
