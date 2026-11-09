import { type AnimationClip, InstancedMesh, Matrix4, type Mesh, type MeshStandardMaterial, type Object3D } from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { clone } from "three/addons/utils/SkeletonUtils.js"
import { FaceType } from "../map/geometry"

/*
 * Map scale, models and ground colors shared by the 3D views
 */

export { FACE_SIZE, SCALE } from "../map/scale"

const MEDIA = import.meta.env.BASE_URL + "media/"

/**
 * Most pixels to render per CSS pixel. Weak devices often have sharp screens, where this is what costs the most.
 */
const MAX_PIXEL_RATIO = 1.5

/**
 * Returns the pixel ratio to render with
 */
export function pixelRatio(): number
{
    return Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO)
}


export const MODELS = {
    wall: "castle/wall.glb",
    tower: "castle/tower-square.glb",
    towerRoof: "castle/tower-square-top-roof.glb",
    gateway: "castle/wall-doorway.glb",
    gateTower: "castle/tower-hexagon-base.glb",
    gateTowerRoof: "castle/tower-hexagon-roof.glb",
    tavern: "castle/tavern.glb",

    houseBlock: "town/wallBlock.glb",
    houseWoodBlock: "town/wallWoodBlock.glb",
    roof: "town/roofPoint.glb",
    roofHigh: "town/roofHighPoint.glb",
    fountain: "town/fountainRound.glb",
    stall: "town/stall.glb",
    stallRed: "town/stallRed.glb",
    stallGreen: "town/stallGreen.glb",

    tree: "nature/tree_default.glb",
    treeOak: "nature/tree_oak.glb",
    pine: "nature/tree_pineRoundA.glb",
    pine2: "nature/tree_pineRoundC.glb",
    rock: "nature/rock_largeA.glb",
    rock2: "nature/rock_largeC.glb",
    rock3: "nature/rock_tallA.glb",

    hairCurly: "meeple/curly.glb",
    hairLong: "meeple/long.glb",
    hairSidePart: "meeple/side-part.glb",

    acidCuboid: "monster/acid-cuboid.glb",
    flyingEye: "monster/flying-eye.glb",
    chest: "treasure/chest.glb",
    coin: "treasure/coin.glb",
    stairs: "dungeon/stairs.glb",
}

export type ModelName = keyof typeof MODELS

/**
 * Ground colors for the face types. The 2D colors are made for a black background and are too dark for a lit scene.
 */
export const GROUND_COLORS = new Map<FaceType, string>([
    [FaceType.DIRT, "#8a6a3e"],
    [FaceType.PAVED, "#9a968c"],
    [FaceType.GRASS, "#5c9e3c"],
    [FaceType.SAND, "#d8c98a"],
    [FaceType.WATER, "#3a6ea5"],
    [FaceType.ROCK, "#6f8f4a"],
    [FaceType.FOREST_FLOOR, "#4a5a2a"],
    [FaceType.TREE, "#5c9e3c"],
    [FaceType.TREE2, "#4f8f36"],
    [FaceType.WALL, "#618336"],
    [FaceType.GATE, "#9a968c"],
    [FaceType.MARKET, "#b5ae9c"],
    [FaceType.PLOT, "#a68a5c"],
    [FaceType.HOUSE, "#8a7a5e"],
    [FaceType.TAVERN, "#8a7a5e"],
    [FaceType.SNOW, "#e9eef2"],
    [FaceType.PRAIRIE, "#c2ae62"],
    [FaceType.SWAMP, "#56633a"],
])

const templates = new Map<ModelName, Object3D>()

/** animation clips per model, as exported from the Blender actions */
const clips = new Map<ModelName, AnimationClip[]>()

/**
 * Loads the given models, all by default
 */
export function loadModels(names = Object.keys(MODELS) as ModelName[]): Promise<void>
{
    const loader = new GLTFLoader()
    return Promise.all(
        names.map(
            name => loader.loadAsync(MEDIA + MODELS[name]).then(gltf => {
                gltf.scene.traverse(obj => {
                    const mesh = obj as Mesh
                    if (mesh.isMesh)
                    {
                        const materials = [mesh.material].flat()

                        // transparent surfaces like the fountain water would shadow themselves, causing flickering
                        // shadow acne
                        mesh.castShadow = !materials.some(m => m.transparent)
                        mesh.receiveShadow = true

                        // the Fantasy Town and Nature kits export fully metallic materials which render black
                        // without an environment map
                        for (const material of materials)
                        {
                            (material as MeshStandardMaterial).metalness = 0
                        }
                    }
                })
                templates.set(name, gltf.scene)
                clips.set(name, gltf.animations)
            })
        )
    ).then(() => undefined)
}

/**
 * Returns the loaded template of the given model, which must not be changed
 */
export function template(name: ModelName): Object3D
{
    return templates.get(name)!
}

/**
 * Returns a copy of the given model. Skinned meshes in it get their own skeleton, so it can be animated apart from the
 * other copies.
 */
export function model(name: ModelName): Object3D
{
    return clone(template(name))
}

/**
 * Returns the animation clips of the given model, which play on its copies with an AnimationMixer per copy
 */
export function animations(name: ModelName): readonly AnimationClip[]
{
    return clips.get(name)!
}


/**
 * Creates instanced meshes for all meshes of the given model, with one instance per matrix. They share geometry and
 * materials with the template, so disposing them only frees the instance data.
 *
 * @param name          model
 * @param matrices      transformation per instance
 *
 * @return one instanced mesh per mesh of the model
 */
export function instanceModel(name: ModelName, matrices: Matrix4[]): InstancedMesh[]
{
    const root = template(name)
    root.updateMatrixWorld(true)

    const instances: InstancedMesh[] = []
    const matrix = new Matrix4()
    root.traverse(obj => {
        const mesh = obj as Mesh
        if (mesh.isMesh)
        {
            const instanced = new InstancedMesh(mesh.geometry, mesh.material, matrices.length)
            instanced.castShadow = mesh.castShadow
            instanced.receiveShadow = mesh.receiveShadow
            for (let i = 0; i < matrices.length; i++)
            {
                instanced.setMatrixAt(i, matrix.multiplyMatrices(matrices[i], mesh.matrixWorld))
            }
            instanced.computeBoundingSphere()
            instances.push(instanced)
        }
    })
    return instances
}
