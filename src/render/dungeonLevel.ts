import type { Material, Mesh } from "three"
import { findWallSegments } from "../map/dungeonLights"
import type { DungeonLevel } from "../map/generateDungeon"
import { FaceType } from "../map/geometry"
import { LEVEL_PRIORITY } from "../map/marchingSquares"
import { createNearWalls, type NearWalls } from "../map/nearWalls"
import PatchWorld from "../map/PatchWorld"
import { applyLightField, createLightField, type LightField } from "./dungeonLighting"
import { createThickWalls, createThinWallCorners, createThinWalls } from "./dungeonMeshes"
import { createGround } from "./patchMeshes"
import { GROUND_COLORS } from "./scene3d"
import { applyWallCut, createWallCut, type WallCut } from "./wallCut"

/**
 * Ground colors of a level. The ground under thick walls is as dark as their unlit tops, as it shows through the walls
 * that are cut. The green it has on the overworld is that of the grass around the walls of the castle.
 */
const LEVEL_GROUND_COLORS = new Map<FaceType, string>([...GROUND_COLORS, [FaceType.WALL, "#08080a"]])

/**
 * What it takes to show a lit dungeon level
 */
export interface LevelMeshes
{
    world: PatchWorld
    meshes: Mesh[]
    field: LightField
    /**
     * Walls in world units, for moveHeroLight()
     */
    segments: Float64Array
    /**
     * Makes the walls in front of the open spaces see-through, see updateWallCut()
     */
    cut: WallCut
    /**
     * Tells the spaces of the level, for telling the cut which ones to open
     */
    near: NearWalls
}


/**
 * Gives the meshes copies of their materials that get lit by the field
 */
function lightMeshes(meshes: Mesh[], field: LightField, flatTops = false): void
{
    const lit = new Map<Material, Material>()
    for (const mesh of meshes)
    {
        const material = mesh.material as Material
        if (!lit.has(material))
        {
            const copy = material.clone()
            applyLightField(copy, field, flatTops)
            lit.set(material, copy)
        }
        mesh.material = lit.get(material)!
    }
}


/**
 * Creates the floor and walls of a level that was generated with its lights
 */
export function createLevelMeshes(level: DungeonLevel): LevelMeshes
{
    const { patches, lighting } = level
    const field = createLightField(lighting!)
    const cut = createWallCut()

    const world = new PatchWorld()
    const slots = patches.map(patch => world.add(patch))
    const ground = slots.map(slot => createGround(world, slot, LEVEL_PRIORITY, LEVEL_GROUND_COLORS))
    const near = createNearWalls(world, slots, level)
    const walls: Mesh[] = [
        ...slots.map(slot => createThickWalls(world, slot, near)),
        createThinWalls(world, slots, false, near),
        createThinWalls(world, slots, true, near),
        createThinWallCorners(world, slots, near)
    ]
    // the see-through side of the cut, see WallCut
    const glass = walls.map(mesh => mesh.clone())
    lightMeshes(ground, field)
    lightMeshes(walls, field, true)
    lightMeshes(glass, field, true)
    for (const [meshes, isGlass] of [[walls, false], [glass, true]] as const)
    {
        for (const material of new Set(meshes.map(mesh => mesh.material as Material)))
        {
            applyWallCut(material, cut, isGlass)
        }
    }

    return {
        world,
        meshes: [...ground, ...walls, ...glass],
        field,
        segments: findWallSegments(world, slots),
        cut,
        near
    }
}
