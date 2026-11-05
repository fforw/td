import { FaceType } from "./geometry"
import { LEVEL_PRIORITY, marchingSquaresPatch } from "./marchingSquares"
import type PatchWorld from "./PatchWorld"

/**
 * Wall ground of a patch in 2D plan coordinates
 */
export interface WallGround
{
    /**
     * Triangles as x0, z0, x1, z1, x2, z2, wound so their normals point up when raised
     */
    triangles: number[]

    /**
     * Half edges of the triangles without a twin as [x0, z0, x1, z1]. The outside is on the side of (z0 - z1, x1 - x0).
     */
    outline: number[][]
}


/**
 * Returns the wall ground of the packed patch in the given slot of the world. The outline also runs along the seams between
 * patches, which is inside of the wall.
 */
export function wallGround(world: PatchWorld, slot: number): WallGround
{
    const triangles: number[] = []

    // half edges of the triangles that have no twin yet, which leaves the outline
    const outline = new Map<string, number[]>()
    const addEdge = (x0: number, z0: number, x1: number, z1: number) => {
        const twin = x1 + "," + z1 + "," + x0 + "," + z0
        if (!outline.delete(twin))
        {
            outline.set(x0 + "," + z0 + "," + x1 + "," + z1, [x0, z0, x1, z1])
        }
    }

    marchingSquaresPatch(world, slot, (type, x0, z0, x1, z1, x2, z2) => {
        if (type !== FaceType.WALL)
        {
            return
        }

        // wind the triangle so the normal points up
        if ((x1 - x0) * (z2 - z0) - (z1 - z0) * (x2 - x0) > 0)
        {
            [x1, z1, x2, z2] = [x2, z2, x1, z1]
        }
        triangles.push(x0, z0, x1, z1, x2, z2)
        addEdge(x0, z0, x1, z1)
        addEdge(x1, z1, x2, z2)
        addEdge(x2, z2, x0, z0)
    }, LEVEL_PRIORITY)

    return { triangles, outline: [...outline.values()] }
}
