import type { PatchKind } from "../game/campaign"
import { type QuadPatch } from "./QuadPatch"
import { borderConnected } from "./route"


/**
 * What a patch kind ended up as and the local faces an explorer has to reach on it
 */
export interface PatchContent
{
    kind: PatchKind
    pois: number[]
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
 * Places the points of interest of a patch. They always connect to the border of the patch, a patch without room for
 * them becomes NONE. Whether the border can be reached from outside is up to the neighboring patches.
 *
 * Kinds without a generator of their own get one point of interest in the middle until they have one.
 *
 * @param patch         packed patch
 * @param kind          kind the patch is meant to be
 * @param castleFace    local face of the center of the castle, for kind CASTLE
 *
 * @return content of the patch
 */
export function placePois(patch: QuadPatch, kind: PatchKind, castleFace = -1): PatchContent
{
    switch (kind)
    {
        case "CASTLE":
            return { kind, pois: [castleFace] }
        case "EMPTY":
        case "NONE":
            return { kind, pois: [] }
    }

    const connected = borderConnected(patch)
    if (connected.size === 0)
    {
        return { kind: "NONE", pois: [] }
    }
    return { kind, pois: [centralFace(patch, connected)] }
}
