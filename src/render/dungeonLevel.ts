import type { Material, Mesh } from "three"
import { findWallSegments } from "../map/dungeonLights"
import type { DungeonLevel } from "../map/generateDungeon"
import { FaceType } from "../map/geometry"
import { LEVEL_PRIORITY } from "../map/marchingSquares"
import { createNearWalls, createWallFinder, type NearWalls } from "../map/nearWalls"
import PatchWorld from "../map/PatchWorld"
import { applyLightField, createLightField, type LightField } from "./dungeonLighting"
import {
    createDoorSills,
    createThickWallCutSides,
    createThickWallGround,
    createThickWalls,
    createThinWallCorners,
    createThinWalls,
    joinThickWallGrounds,
    WALL_INSIDE_COLOR
} from "./dungeonMeshes"
import { createFloorPatterns } from "./floorPatterns"
import { createGround } from "./patchMeshes"
import { GROUND_COLORS } from "./scene3d"
import { applyWallCut, createWallCut, type WallCut } from "./wallCut"

/**
 * Ground colors of a level. The ground under thick walls is as dark as their unlit tops, as it shows through the walls
 * that are cut. The green it has on the overworld is that of the grass around the walls of the castle.
 */
const LEVEL_GROUND_COLORS = new Map<FaceType, string>([...GROUND_COLORS, [FaceType.WALL, WALL_INSIDE_COLOR]])

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
    const { patches, lighting, rooms } = level
    const field = createLightField(lighting!)
    const cut = createWallCut()

    const world = new PatchWorld()
    const slots = patches.map(patch => world.add(patch))
    const ground = slots.map(slot => createGround(world, slot, LEVEL_PRIORITY, LEVEL_GROUND_COLORS))
    const near = createNearWalls(world, level)
    const sills = createDoorSills(world, slots)
    // the rooms are as good a seed as any, they differ from level to level
    const seed = rooms.reduce((hash, room) => (hash * 31 + room[0]) | 0, rooms.length)
    const patterns = createFloorPatterns(world, rooms, seed)
    const wallGrounds = slots.map(slot => createThickWallGround(world, slot, near))
    const inThickWall = createWallFinder(wallGrounds)
    const thickWallGround = joinThickWallGrounds(wallGrounds)
    const walls: Mesh[] = [
        createThickWalls(thickWallGround),
        createThinWalls(world, slots, false, near, inThickWall),
        createThinWalls(world, slots, true, near, inThickWall),
        createThinWallCorners(world, slots, near)
    ]
    // unlit, and without a glass side: they only show where the piece next to them is cut
    const cutSides = createThickWallCutSides(thickWallGround)
    cutSides.material = (cutSides.material as Material).clone()
    applyWallCut(cutSides.material, cut, false)
    // the see-through side of the cut, see WallCut
    const glass = walls.map(mesh => mesh.clone())
    lightMeshes(ground, field)
    lightMeshes([sills], field)
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
        meshes: [...ground, ...patterns, sills, ...walls, cutSides, ...glass],
        field,
        segments: findWallSegments(world, slots),
        cut,
        near
    }
}
