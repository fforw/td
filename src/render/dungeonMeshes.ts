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
import { LEVEL_PRIORITY, marchingSquaresPatch } from "../map/marchingSquares"
import type PatchWorld from "../map/PatchWorld"
import { SLOT_SHIFT } from "../map/PatchWorld"
import { next, prev } from "../map/QuadPatch"
import { SCALE } from "./scene3d"

const TAU = Math.PI * 2

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

/**
 * How far the rounding of a corner reaches along the thin walls in world units, and the number of flat pieces of its curve
 */
export const THIN_WALL_ROUNDING = 0.16
export const THIN_WALL_ROUNDING_STEPS = 2

/**
 * Corners wider than this in radians are close to a straight wall and stay as they are
 */
const MAX_ROUNDED_ANGLE = Math.PI * 8 / 9

/**
 * Corners narrower than this in radians count as tight where only two thin walls meet: they get rounded on the inner side
 * and flat on the outer side.
 */
export const TIGHT_CORNER_ANGLE = TAU * 0.375

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
    }, LEVEL_PRIORITY)

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
 * Corner of a face between two thin walls, in world units
 */
export interface ThinWallCorner
{
    /**
     * Where the walls meet
     */
    x: number
    z: number

    /**
     * Other ends of the walls
     */
    ax: number
    az: number
    bx: number
    bz: number

    /**
     * Whether only these two walls meet there
     */
    tight: boolean
}


/**
 * Returns the corners of faces with sharp shapes to take care of: where more than two thin walls meet or where two of them
 * meet at a tight angle. A corner only counts if thin walls are on both of its sides, so it's never next to a door.
 *
 * @param world     world with all patches of the level
 * @param slots     slots of the patches of the level
 */
export function findThinWallCorners(world: PatchWorld, slots: readonly number[]): ThinWallCorner[]
{
    // a wall edge has one half edge starting at each of its ends, also on a seam, where patches have vertices of their own
    const wallsAt = new Map<string, number>()
    for (const slot of slots)
    {
        const { positions, vertex, edgeType } = world.getPatch(slot)
        for (let h = 0; h < edgeType.length; h++)
        {
            if (edgeType[h] === EdgeType.WALL.index)
            {
                const key = positions[vertex[h] * 3] + "," + positions[vertex[h] * 3 + 1]
                wallsAt.set(key, (wallsAt.get(key) ?? 0) + 1)
            }
        }
    }

    const corners: ThinWallCorner[] = []
    for (const slot of slots)
    {
        const { positions, vertex, edgeType } = world.getPatch(slot)
        for (let h = 0; h < edgeType.length; h++)
        {
            if (edgeType[h] !== EdgeType.WALL.index || edgeType[prev(h)] !== EdgeType.WALL.index)
            {
                continue
            }

            const v = vertex[h] * 3
            const a = vertex[next(h)] * 3
            const b = vertex[prev(h)] * 3
            const tight = wallsAt.get(positions[v] + "," + positions[v + 1]) === 2 && cornerAngle(
                positions[a] - positions[v], positions[a + 1] - positions[v + 1],
                positions[b] - positions[v], positions[b + 1] - positions[v + 1]
            ) < TIGHT_CORNER_ANGLE
            if (tight || wallsAt.get(positions[v] + "," + positions[v + 1])! > 2)
            {
                corners.push({
                    x: positions[v] * SCALE,
                    z: positions[v + 1] * SCALE,
                    ax: positions[a] * SCALE,
                    az: positions[a + 1] * SCALE,
                    bx: positions[b] * SCALE,
                    bz: positions[b + 1] * SCALE,
                    tight
                })
            }
        }
    }
    return corners
}


/**
 * Creates the thin walls of a level, one scaled cube per wall edge. They reach past their ends to run into each other,
 * except at tight corners, where createThinWallCorners() closes the outer side.
 *
 * @param world     world with all patches of the level
 * @param slots     slots of the patches of the level
 */
export function createThinWalls(world: PatchWorld, slots: readonly number[]): InstancedMesh
{
    const tight = new Set(findThinWallCorners(world, slots).filter(({ tight }) => tight).map(({ x, z }) => x + "," + z))

    const matrices: Matrix4[] = []
    const position = new Vector3()
    const rotation = new Quaternion()
    const scale = new Vector3()
    const up = new Vector3(0, 1, 0)

    for (const slot of slots)
    {
        const { positions, vertex, edgeType } = world.getPatch(slot)
        const base = slot << SLOT_SHIFT

        for (let h = 0; h < edgeType.length; h++)
        {
            // both half edges have the type, the lower global id draws the wall, also on a seam
            if (edgeType[h] !== EdgeType.WALL.index || (base | h) > world.twin(base | h))
            {
                continue
            }

            const v0 = vertex[h] * 3
            const v1 = vertex[next(h)] * 3
            const x0 = positions[v0] * SCALE, z0 = positions[v0 + 1] * SCALE
            const x1 = positions[v1] * SCALE, z1 = positions[v1 + 1] * SCALE
            const reach0 = tight.has(x0 + "," + z0) ? 0 : THIN_WALL_OVERLAP
            const reach1 = tight.has(x1 + "," + z1) ? 0 : THIN_WALL_OVERLAP

            const length = Math.hypot(x1 - x0, z1 - z0)
            const shift = (reach1 - reach0) / 2 / length
            matrices.push(new Matrix4().compose(
                position.set(
                    (x0 + x1) / 2 + (x1 - x0) * shift,
                    THIN_WALL_HEIGHT / 2,
                    (z0 + z1) / 2 + (z1 - z0) * shift
                ),
                rotation.setFromAxisAngle(up, Math.atan2(z0 - z1, x1 - x0)),
                scale.set(length + reach0 + reach1, THIN_WALL_HEIGHT, THIN_WALL_THICKNESS)
            ))
        }
    }

    const mesh = new InstancedMesh(thinWallGeometry, wallMaterial, matrices.length)
    matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix))
    return mesh
}


/**
 * Creates what takes the sharp shapes out of the corners of thin walls: the rounding on their inner sides and the flat
 * outer side of tight corners.
 *
 * @param world     world with all patches of the level
 * @param slots     slots of the patches of the level
 */
export function createThinWallCorners(world: PatchWorld, slots: readonly number[]): Mesh
{
    const triangles: number[] = []
    for (const { x, z, ax, az, bx, bz, tight } of findThinWallCorners(world, slots))
    {
        addRoundedCorner(triangles, x, z, ax, az, bx, bz)
        if (tight)
        {
            addFlatCorner(triangles, x, z, ax, az, bx, bz)
        }
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute("position", new Float32BufferAttribute(triangles, 3))
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()
    return new Mesh(geometry, wallMaterial)
}


/**
 * Returns the angle between two directions in radians
 */
function cornerAngle(ax: number, az: number, bx: number, bz: number): number
{
    return Math.acos(Math.min(1, Math.max(-1, (ax * bx + az * bz) / Math.hypot(ax, az) / Math.hypot(bx, bz))))
}


/**
 * Adds the rounding of one corner: the top and curved side of what fills the space between the two walls and a curve
 * touching both of them.
 *
 * @param triangles     receives the positions
 * @param x             corner of the walls
 * @param z             corner of the walls
 * @param ax            other end of the first wall
 * @param az            other end of the first wall
 * @param bx            other end of the second wall
 * @param bz            other end of the second wall
 */
export function addRoundedCorner(
    triangles: number[],
    x: number, z: number,
    ax: number, az: number,
    bx: number, bz: number
): void
{
    const aLength = Math.hypot(ax - x, az - z)
    const bLength = Math.hypot(bx - x, bz - z)
    const adx = (ax - x) / aLength, adz = (az - z) / aLength
    const bdx = (bx - x) / bLength, bdz = (bz - z) / bLength

    const angle = cornerAngle(adx, adz, bdx, bdz)
    const half = angle / 2
    // the rounding starts where the sides of the walls meet and has to fit on what is left of them
    if (
        angle > MAX_ROUNDED_ANGLE ||
        THIN_WALL_THICKNESS / 2 / Math.tan(half) + THIN_WALL_ROUNDING > Math.min(aLength, bLength)
    )
    {
        return
    }

    const inner = THIN_WALL_THICKNESS / 2 / Math.sin(angle)
    const cx = x + (adx + bdx) * inner
    const cz = z + (adz + bdz) * inner

    // the curve is part of a circle touching both walls at the end of the rounding
    const radius = THIN_WALL_ROUNDING * Math.tan(half)
    const middle = Math.hypot(adx + bdx, adz + bdz)
    const center = THIN_WALL_ROUNDING / Math.cos(half) / middle
    const ox = cx + (adx + bdx) * center
    const oz = cz + (adz + bdz) * center

    const fromX = cx + adx * THIN_WALL_ROUNDING - ox, fromZ = cz + adz * THIN_WALL_ROUNDING - oz
    const toX = cx + bdx * THIN_WALL_ROUNDING - ox, toZ = cz + bdz * THIN_WALL_ROUNDING - oz

    const curve: number[][] = []
    for (let i = 0; i <= THIN_WALL_ROUNDING_STEPS; i++)
    {
        const s = i / THIN_WALL_ROUNDING_STEPS
        const px = fromX + (toX - fromX) * s, pz = fromZ + (toZ - fromZ) * s
        const scale = radius / Math.hypot(px, pz)
        curve.push([ox + px * scale, oz + pz * scale])
    }

    for (let i = 0; i < THIN_WALL_ROUNDING_STEPS; i++)
    {
        addWedge(triangles, cx, cz, curve[i][0], curve[i][1], curve[i + 1][0], curve[i + 1][1])
    }
}


/**
 * Adds the flat outer side of a tight corner: walls ending at the corner leave a gap between their outer sides, which this
 * closes with a straight line.
 *
 * @param triangles     receives the positions
 * @param x             corner of the walls
 * @param z             corner of the walls
 * @param ax            other end of the first wall
 * @param az            other end of the first wall
 * @param bx            other end of the second wall
 * @param bz            other end of the second wall
 */
export function addFlatCorner(
    triangles: number[],
    x: number, z: number,
    ax: number, az: number,
    bx: number, bz: number
): void
{
    const aLength = Math.hypot(ax - x, az - z)
    const bLength = Math.hypot(bx - x, bz - z)
    const adx = (ax - x) / aLength, adz = (az - z) / aLength
    const bdx = (bx - x) / bLength, bdz = (bz - z) / bLength

    // the outer side of a wall is the one facing away from the other wall
    const side = THIN_WALL_THICKNESS / 2
    const aSide = adz * bdx - adx * bdz < 0 ? side : -side
    const bSide = bdz * adx - bdx * adz < 0 ? side : -side

    addWedge(triangles, x, z, x + adz * aSide, z - adx * aSide, x + bdz * bSide, z - bdx * bSide)
}


/**
 * Adds a three-sided piece of wall from its top and its outer side, the other two sides are against other walls
 *
 * @param triangles     receives the positions
 * @param cx            point of the top that isn't on the outer side
 * @param cz            point of the top that isn't on the outer side
 * @param x0            start of the outer side
 * @param z0            start of the outer side
 * @param x1            end of the outer side
 * @param z1            end of the outer side
 */
function addWedge(
    triangles: number[],
    cx: number, cz: number,
    x0: number, z0: number,
    x1: number, z1: number
): void
{
    // wind the top so the normal points up, its outer edge is the one for the side then
    if ((x0 - cx) * (z1 - cz) - (z0 - cz) * (x1 - cx) > 0)
    {
        [x0, z0, x1, z1] = [x1, z1, x0, z0]
    }
    triangles.push(
        cx, THIN_WALL_HEIGHT, cz, x0, THIN_WALL_HEIGHT, z0, x1, THIN_WALL_HEIGHT, z1,
        x0, 0, z0, x1, 0, z1, x1, THIN_WALL_HEIGHT, z1,
        x0, 0, z0, x1, THIN_WALL_HEIGHT, z1, x0, THIN_WALL_HEIGHT, z0
    )
}
