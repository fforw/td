import { type Color, type Group, type MeshBasicMaterial, type MeshStandardMaterial, type Object3D, SkinnedMesh } from "three"
import { createSilhouetteMaterial, NO_SILHOUETTE, SILHOUETTE_FILL, SILHOUETTE_RIM } from "../meeple/Meeple3D"
import { applyLightField, type LightField } from "../render/dungeonLighting"
import { model, type ModelName } from "../render/scene3d"
import { FIGURE_ORDER, FLASH, PLAIN, SILHOUETTE } from "./MonsterCrowd"

/**
 * A copy of a rigged monster model with materials of its own, for the flash and the light field, and silhouettes
 */
export interface SkinnedFigure
{
    root: Object3D
    /** lit materials with their own colors, and their meshes */
    bodies: { material: MeshStandardMaterial, color: Color, mesh: SkinnedMesh }[]
    rim: MeshBasicMaterial
    fill: MeshBasicMaterial
}


/**
 * Returns a copy of a rigged model, drawn with the silhouettes of a MeepleCrowd which shows them. The model must be loaded
 * first.
 *
 * @param name      model
 * @param field     light field
 * @param colors    colors for materials of the model by their names, in place of the colors they have there, as in
 *                  { Robe: blue }. A texture on such a material is tinted with the color, so it should be light.
 */
export function skinnedFigure(name: ModelName, field: LightField, colors: Readonly<Record<string, Color>> = {}): SkinnedFigure
{
    const root = model(name)
    // three draws by the order of the nearest group, and glTF brings groups of its own, which would draw the figure with
    // the walls. Then it would hide the meeples like a wall does and get no silhouette behind walls itself.
    root.traverse(obj => (obj as Group).isGroup && (obj.renderOrder = FIGURE_ORDER))
    const rim = createSilhouetteMaterial(1, SILHOUETTE_RIM)
    const fill = createSilhouetteMaterial(SILHOUETTE_FILL, 0)
    const bodies: SkinnedFigure["bodies"] = []

    // glTF makes one mesh per material
    const meshes: SkinnedMesh[] = []
    root.traverse(obj => (obj as SkinnedMesh).isSkinnedMesh && meshes.push(obj as SkinnedMesh))
    for (const mesh of meshes)
    {
        // the flash and the light field belong to this figure
        const material = (mesh.material as MeshStandardMaterial).clone()
        const color = colors[material.name]
        if (color)
        {
            material.color.copy(color)
        }
        applyLightField(material, field)
        bodies.push({ material, color: material.color.clone(), mesh })
        mesh.material = material
        mesh.frustumCulled = false

        // all rims before all fills, see MeepleCrowd.showSilhouettes()
        for (const [shape, order] of [[rim, -2], [fill, -1]] as const)
        {
            const silhouette = new SkinnedMesh(mesh.geometry, shape)
            silhouette.bind(mesh.skeleton, mesh.bindMatrix)
            silhouette.renderOrder = order
            silhouette.frustumCulled = false
            mesh.add(silhouette)
        }
    }
    return { root, bodies, rim, fill }
}

/**
 * Shows a hit on a figure, and its silhouette while it goes after someone
 */
export function tintFigure({ bodies, rim, fill }: SkinnedFigure, flash: number, chase: number): void
{
    const color = flash > 0 ? FLASH : PLAIN
    for (const body of bodies)
    {
        body.material.color.copy(body.color).multiply(color)
    }
    const silhouette = chase > 0 ? SILHOUETTE : NO_SILHOUETTE
    rim.color.copy(silhouette)
    fill.color.copy(silhouette).multiplyScalar(SILHOUETTE_FILL)
}
