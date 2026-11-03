import {
    BufferGeometry,
    Color,
    Float32BufferAttribute,
    type InstancedMesh,
    Matrix4,
    Mesh,
    MeshStandardMaterial,
    Quaternion,
    Vector3
} from "three"
import { FaceType } from "../map/geometry"
import { marchingSquaresPatch } from "../map/marchingSquares"
import type PatchWorld from "../map/PatchWorld"
import type { QuadPatch } from "../map/QuadPatch"
import { patchSeed } from "../math/random"
import { GROUND_COLORS, instanceModel, type ModelName, SCALE } from "./scene3d"

/*
 * Meshes of packed patches: the ground and the models standing on faces
 */

const TAU = Math.PI * 2

/**
 * Models per face type with the range of their random scale
 */
const FACE_MODELS = new Map<FaceType, { names: ModelName[], scale: [number, number] }>([
    [FaceType.TREE, { names: ["tree", "treeOak"], scale: [0.4, 0.6] }],
    [FaceType.TREE2, { names: ["pine", "pine2"], scale: [0.4, 0.6] }],
    [FaceType.ROCK, { names: ["rock", "rock2", "rock3"], scale: [1, 1] }],
])



/**
 * Random numbers that only depend on the patch and face, so a patch looks the same whenever it gets loaded
 */
function faceRandom(patch: QuadPatch, face: number): () => number
{
    let s = patchSeed(face, patch.q, patch.r)
    return () => {
        // mulberry32
        s = (s + 0x6d2b79f5) | 0
        let t = Math.imul(s ^ (s >>> 15), 1 | s)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}


export function createModels(patch: QuadPatch): InstancedMesh[]
{
    const { positions, vertex, faceType } = patch
    const matrices = new Map<ModelName, Matrix4[]>()

    const pos = new Vector3()
    const rotation = new Quaternion()
    const scale = new Vector3()
    const up = new Vector3(0, 1, 0)

    for (let f = 0; f < faceType.length; f++)
    {
        const models = FACE_MODELS.get(FaceType.byIndex(faceType[f]))
        if (!models)
        {
            continue
        }

        let x = 0
        let z = 0
        for (let h = f * 4; h < f * 4 + 4; h++)
        {
            x += positions[vertex[h] * 3]
            z += positions[vertex[h] * 3 + 1]
        }

        const random = faceRandom(patch, f)
        const name = models.names[Math.floor(random() * models.names.length)]
        const [min, max] = models.scale
        const s = min + random() * (max - min)

        const matrix = new Matrix4().compose(
            pos.set(x / 4 * SCALE, 0, z / 4 * SCALE),
            rotation.setFromAxisAngle(up, random() * TAU),
            scale.setScalar(s)
        )

        let list = matrices.get(name)
        if (!list)
        {
            list = []
            matrices.set(name, list)
        }
        list.push(matrix)
    }

    return [...matrices].flatMap(([name, list]) => instanceModel(name, list))
}


const groundMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 1 })

export function createGround(world: PatchWorld, slot: number): Mesh
{
    const positions: number[] = []
    const colors: number[] = []
    const color = new Color()

    marchingSquaresPatch(world, slot, (type, x0, z0, x1, z1, x2, z2) => {
        color.set(GROUND_COLORS.get(type) ?? type.color)

        // wind the triangle so the normal points up
        if ((x1 - x0) * (z2 - z0) - (z1 - z0) * (x2 - x0) < 0)
        {
            positions.push(x0 * SCALE, 0, z0 * SCALE, x1 * SCALE, 0, z1 * SCALE, x2 * SCALE, 0, z2 * SCALE)
        }
        else
        {
            positions.push(x0 * SCALE, 0, z0 * SCALE, x2 * SCALE, 0, z2 * SCALE, x1 * SCALE, 0, z1 * SCALE)
        }
        colors.push(color.r, color.g, color.b, color.r, color.g, color.b, color.r, color.g, color.b)
    })

    const geometry = new BufferGeometry()
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3))
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3))
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()

    const mesh = new Mesh(geometry, groundMaterial)
    mesh.receiveShadow = true
    return mesh
}
