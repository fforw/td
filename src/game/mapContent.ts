import { PATCH_SIZE } from "../map/HexagonPatch"
import type { MapArea } from "../map/mapRegions"
import { FACE_SIZE } from "../map/scale"
import { type Campaign, type Impression, overworld, type PatchKind, type PatchNode, patchKey } from "./campaign"
import { jobTargets } from "./heroes"
import { frontier } from "./missions"
import { NEIGHBORS } from "./patchKinds"

/**
 * Size of a patch in 2D map units, see createHexagon(). Patches sit on a grid of this size; their hexagon rows make
 * the edges jagged, so neighboring patches interlock.
 */
export const PATCH_WIDTH = Math.sqrt(3) * FACE_SIZE * PATCH_SIZE
export const PATCH_DEPTH = 1.5 * FACE_SIZE * PATCH_SIZE

/**
 * Offset of the patch centers from their grid positions. Every other hexagon row is half a hexagon further right and
 * patches have one row and column more on the negative side of the grid position.
 */
const CENTER_X = -Math.sqrt(3) * FACE_SIZE / 4
const CENTER_Y = -0.75 * FACE_SIZE

/**
 * Something on the map at a patch
 */
export type MapMarker = {
    key: string
    q: number
    r: number
} & (
    /** what's on a discovered patch, starts a mission of a hero unless one is there, which is back in the given days */
    { type: "poi", kind: PatchKind, days?: number } |
    /** explorer on the way, back in the given days */
    { type: "targeted", days: number } |
    /** unknown patch an explorer passed through */
    { type: "passed", impression: Impression }
)

/**
 * Unknown patch next to a discovered one, a possible mission of an explorer
 */
export interface ExploreTarget
{
    type: "explore"
    key: string
    q: number
    r: number
    impression?: Impression
}

/**
 * What a mission can be started from
 */
export type MissionMarker = ExploreTarget | Extract<MapMarker, { type: "poi" }>

/**
 * Arrow over the border of a discovered patch, pointing at an unknown one
 */
export interface BorderArrow
{
    target: ExploreTarget
    /** point on the border in 2D map units */
    x: number
    y: number
    /** direction in patches */
    dq: number
    dr: number
}

/**
 * What the map shows of a campaign
 */
export interface MapContent
{
    /** drawn in all detail */
    known: PatchNode[]
    /** an explorer only passed through, drawn in a coarse raster */
    rough: PatchNode[]
    markers: MapMarker[]
    targets: ExploreTarget[]
}


/**
 * Returns the center of the patch at the given grid position in 2D map units.
 */
export function patchCenter(q: number, r: number): [number, number]
{
    return [q * PATCH_WIDTH + CENTER_X, r * PATCH_DEPTH + CENTER_Y]
}


/**
 * Returns the cell of the patch at the given grid position in 2D map units.
 */
export function patchArea(q: number, r: number): MapArea
{
    const [x, y] = patchCenter(q, r)
    return { x: x - PATCH_WIDTH / 2, y: y - PATCH_DEPTH / 2, width: PATCH_WIDTH, height: PATCH_DEPTH }
}


/**
 * Returns what the map shows. It never tells the kind of a patch that isn't discovered.
 */
export function mapContent(campaign: Campaign): MapContent
{
    const { patches } = overworld(campaign)
    const nodes = Object.values(patches)
    const jobs = jobTargets(campaign)

    const targets = frontier(campaign).map((key): ExploreTarget => {
        const [q, r] = key.split("/").map(Number)
        const impression = patches[key]?.impression
        return { type: "explore", key, q, r, ...(impression ? { impression } : {}) }
    })

    const markers: MapMarker[] = []
    for (const { q, r, kind, state, impression } of nodes)
    {
        const key = patchKey(q, r)
        if (state === "targeted")
        {
            const mission = campaign.missions.find(m => m.target === key)
            markers.push({ key, q, r, type: "targeted", days: mission ? mission.endDay - campaign.day : 0 })
        }
        else if (state === "passed" && impression)
        {
            markers.push({ key, q, r, type: "passed", impression })
        }
        else if (kind !== "EMPTY" && jobs.includes(key))
        {
            const job = campaign.jobs.find(j => j.target === key)
            markers.push({ key, q, r, type: "poi", kind, ...(job ? { days: job.endDay - campaign.day } : {}) })
        }
    }

    return {
        known: nodes.filter(({ state }) => state === "discovered"),
        rough: nodes.filter(({ state, impression }) => state !== "discovered" && impression),
        markers,
        targets
    }
}


/**
 * Returns the arrow for a pointer at the given position, which needs to be on an unknown patch that can be a target or
 * close to the side a discovered patch shares with one. Diagonal arrows are only for targets touching nothing discovered
 * but a corner.
 *
 * @param content   what the map shows
 * @param x         x-position in 2D map units
 * @param y         y-position in 2D map units
 * @param band      how far from the sides of a patch the pointer counts as close, in 2D map units
 */
export function borderArrow({ known, targets }: Pick<MapContent, "known" | "targets">, x: number, y: number, band: number): BorderArrow | null
{
    const isKnown = (q: number, r: number) => known.some(node => node.q === q && node.r === r)
    const targetAt = (q: number, r: number) => targets.find(target => target.q === q && target.r === r)

    const arrow = (target: ExploreTarget, q: number, r: number, dq: number, dr: number): BorderArrow => {
        const [cx, cy] = patchCenter(q, r)
        return { target, x: cx + dq * PATCH_WIDTH / 2, y: cy + dr * PATCH_DEPTH / 2, dq, dr }
    }

    const q = Math.round((x - CENTER_X) / PATCH_WIDTH)
    const r = Math.round((y - CENTER_Y) / PATCH_DEPTH)
    const [cx, cy] = patchCenter(q, r)

    const target = targetAt(q, r)
    if (target)
    {
        // comes from the closest discovered patch, one sharing a side if there is one
        const distance = ([dq, dr]: readonly [number, number]) => {
            const [nx, ny] = patchCenter(q + dq, r + dr)
            return (dq && dr ? Infinity : 0) || Math.hypot(nx - x, ny - y)
        }
        const [dq, dr] = NEIGHBORS
            .filter(([dq, dr]) => isKnown(q + dq, r + dr))
            .sort((a, b) => distance(a) - distance(b))[0]
        return arrow(target, q + dq, r + dr, -dq, -dr)
    }
    if (!isKnown(q, r))
    {
        return null
    }

    const u = x - cx
    const v = y - cy
    const dq = u > PATCH_WIDTH / 2 - band ? 1 : u < band - PATCH_WIDTH / 2 ? -1 : 0
    const dr = v > PATCH_DEPTH / 2 - band ? 1 : v < band - PATCH_DEPTH / 2 ? -1 : 0

    // the patch across a corner only if that corner is all it shares, the arrow is about the target and not a way there
    const diagonal = dq && dr ? targetAt(q + dq, r + dr) : undefined
    const sharesSide = diagonal && (
        isKnown(diagonal.q - 1, diagonal.r) || isKnown(diagonal.q + 1, diagonal.r) ||
        isKnown(diagonal.q, diagonal.r - 1) || isKnown(diagonal.q, diagonal.r + 1)
    )
    if (diagonal && !sharesSide)
    {
        return arrow(diagonal, q, r, dq, dr)
    }
    const side = dq ? targetAt(q + dq, r) : undefined
    const row = dr ? targetAt(q, r + dr) : undefined
    if (side && (!row || PATCH_WIDTH / 2 - Math.abs(u) < PATCH_DEPTH / 2 - Math.abs(v)))
    {
        return arrow(side, q, r, dq, 0)
    }
    return row ? arrow(row, q, r, 0, dr) : null
}
