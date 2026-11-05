import {
    BoxGeometry,
    BufferGeometry,
    Float32BufferAttribute,
    InstancedMesh,
    Matrix4,
    Mesh,
    MeshStandardMaterial,
    Quaternion,
    Vector3
} from "three"
import { EdgeType, FaceType } from "../map/geometry"
import { marchingSquaresPatch } from "../map/marchingSquares"
import type PatchWorld from "../map/PatchWorld"
import { SLOT_SHIFT } from "../map/PatchWorld"
import { next } from "../map/QuadPatch"
import { SCALE } from "./scene3d"

/*
 * Meshes of the walls of a dungeon level: thick walls raised from the wall ground and thin walls on the wall edges.
 */

/**
 * Height of the thick walls in world units
 */
export const THICK_WALL_HEIGHT = 0.6

/**
 * Size of the thin walls in world units. They stay a little lower than the thick walls because they end inside of them,
 * and tops at the same height would flicker.
 */
export const THIN_WALL_HEIGHT = 0.58
export const THIN_WALL_THICKNESS = 0.06

/**
 * How far a thin wall reaches past both ends of its edge in world units, so walls meeting at a vertex run into each other
 */
export const THIN_WALL_OVERLAP = THIN_WALL_THICKNESS / 2

const wallMaterial = new MeshStandardMaterial({ color: "#6e6c72", roughness: 1 })
const thinWallGeometry = new BoxGeometry(1, 1, 1)


/**
 * Creates the thick walls of the packed patch in the given slot of the world: the wall ground raised to wall height, with
 * sides along its outline. The sides between patches are inside of the wall and never get seen.
 */
export function createThickWalls(world: PatchWorld, slot: number): Mesh
{
    const positions: number[] = []

    // half edges of the top triangles that have no twin yet, which leaves the outline
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
        positions.push(
            x0 * SCALE, THICK_WALL_HEIGHT, z0 * SCALE,
            x1 * SCALE, THICK_WALL_HEIGHT, z1 * SCALE,
            x2 * SCALE, THICK_WALL_HEIGHT, z2 * SCALE
        )
        addEdge(x0, z0, x1, z1)
        addEdge(x1, z1, x2, z2)
        addEdge(x2, z2, x0, z0)
    })

    for (const [x0, z0, x1, z1] of outline.values())
    {
        const ax = x0 * SCALE, az = z0 * SCALE, bx = x1 * SCALE, bz = z1 * SCALE
        positions.push(
            ax, 0, az, bx, 0, bz, bx, THICK_WALL_HEIGHT, bz,
            ax, 0, az, bx, THICK_WALL_HEIGHT, bz, ax, THICK_WALL_HEIGHT, az
        )
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3))
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()
    return new Mesh(geometry, wallMaterial)
}


/**
 * Creates the thin walls of the packed patch in the given slot of the world, one scaled cube per wall edge
 */
export function createThinWalls(world: PatchWorld, slot: number): InstancedMesh
{
    const { positions, vertex, edgeType } = world.getPatch(slot)
    const base = slot << SLOT_SHIFT

    const matrices: Matrix4[] = []
    const position = new Vector3()
    const rotation = new Quaternion()
    const scale = new Vector3()
    const up = new Vector3(0, 1, 0)

    for (let h = 0; h < edgeType.length; h++)
    {
        // both half edges have the type, the lower global id draws the wall, also on a seam
        if (edgeType[h] !== EdgeType.WALL.index || (base | h) > world.twin(base | h))
        {
            continue
        }

        const v0 = vertex[h] * 3
        const v1 = vertex[next(h)] * 3
        const dx = (positions[v1] - positions[v0]) * SCALE
        const dz = (positions[v1 + 1] - positions[v0 + 1]) * SCALE

        matrices.push(new Matrix4().compose(
            position.set(
                (positions[v0] + positions[v1]) / 2 * SCALE,
                THIN_WALL_HEIGHT / 2,
                (positions[v0 + 1] + positions[v1 + 1]) / 2 * SCALE
            ),
            rotation.setFromAxisAngle(up, Math.atan2(-dz, dx)),
            scale.set(Math.hypot(dx, dz) + THIN_WALL_OVERLAP * 2, THIN_WALL_HEIGHT, THIN_WALL_THICKNESS)
        ))
    }

    const mesh = new InstancedMesh(thinWallGeometry, wallMaterial, matrices.length)
    matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix))
    return mesh
}
