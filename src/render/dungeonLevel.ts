import type { Material, Mesh } from "three"
import { findWallSegments } from "../map/dungeonLights"
import type { DungeonLevel } from "../map/generateDungeon"
import { LEVEL_PRIORITY } from "../map/marchingSquares"
import PatchWorld from "../map/PatchWorld"
import { applyLightField, createLightField, type LightField } from "./dungeonLighting"
import { createThickWalls, createThinWallCorners, createThinWalls } from "./dungeonMeshes"
import { createGround } from "./patchMeshes"

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
export function createLevelMeshes({ patches, lighting }: DungeonLevel): LevelMeshes
{
    const field = createLightField(lighting!)

    const world = new PatchWorld()
    const slots = patches.map(patch => world.add(patch))
    const ground = slots.map(slot => createGround(world, slot, LEVEL_PRIORITY))
    const walls: Mesh[] = [...slots.map(slot => createThickWalls(world, slot)), createThinWalls(world, slots), createThinWallCorners(world, slots)]
    lightMeshes(ground, field)
    lightMeshes(walls, field, true)

    return { world, meshes: [...ground, ...walls], field, segments: findWallSegments(world, slots) }
}
