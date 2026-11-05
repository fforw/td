import Castle from "../castle/Castle"
import { type CastlePlan, planCastle } from "../castle/castlePlan"
import type { PatchKind } from "../game/campaign"
import type { Face } from "./geometry"
import type HexagonPatch from "./HexagonPatch"
import { packPatch, type QuadPatch } from "./QuadPatch"
import { borderConnected } from "./route"


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
function centralFace(patch: QuadPatch, faces: Set<number>): number
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
 * Places one point of interest in the middle, for kinds without a generator of their own. It always connects to the
 * border of the patch, whether the border can be reached from outside is up to the neighboring patches.
 */
const CENTRAL: PatchGenerator = {
    place(patch)
    {
        const connected = borderConnected(patch)
        return connected.size > 0 ? [{ face: centralFace(patch, connected) }] : null
    }
}


/**
 * Nothing but terrain
 */
const TERRAIN: PatchGenerator = {}


export const PATCH_GENERATORS: Record<PatchKind, PatchGenerator> = {
    CASTLE,
    EMPTY: TERRAIN,
    DUNGEON: CENTRAL,
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
