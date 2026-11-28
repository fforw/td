import { type Color, type DataTexture, type Group, type MeshBasicMaterial, type MeshStandardMaterial, MeshToonMaterial, type Object3D, ShaderChunk, SkinnedMesh } from "three"
import {
    createGradientMap,
    createOutlineMaterial,
    createSilhouetteMaterial,
    NO_SILHOUETTE,
    OUTLINE,
    SILHOUETTE_FILL,
    SILHOUETTE_RIM
} from "../meeple/Meeple3D"
import { applyLightField, applyRimLight, type LightField } from "../render/dungeonLighting"
import { model, type ModelName } from "../render/scene3d"
import { FIGURE_ORDER, FLASH, PLAIN, SILHOUETTE } from "./MonsterCrowd"

/**
 * Toon bands of metal: darker than those of the meeples, and only the side right towards a light gets bright
 */
const METAL_BANDS = [35, 35, 35, 35, 35, 75, 75, 75, 170, 170]

/**
 * Least cosine between the normal and the half way vector of the light and the view where metal shows a highlight. The
 * closer to 1, the smaller the highlight.
 */
const METAL_SHINE = 0.94

/**
 * Brightness of the highlight on metal against the light that makes it
 */
const METAL_HIGHLIGHT = 2.5

let gradientMap: DataTexture | null = null
let metalGradientMap: DataTexture | null = null

/**
 * Returns a toon material in place of a material of a model, with what it shows of it. Metal gets darker bands and a small
 * hard highlight in place of its reflections.
 */
function toonMaterial(source: MeshStandardMaterial): MeshToonMaterial
{
    const metal = source.metalness > 0
    gradientMap ??= createGradientMap()
    metalGradientMap ??= createGradientMap(METAL_BANDS)
    const { name, color, map, emissive, emissiveMap, emissiveIntensity, transparent, opacity, alphaTest, side } = source
    const material = new MeshToonMaterial({
        name, color, map, emissive, emissiveMap, emissiveIntensity, transparent, opacity, alphaTest, side,
        gradientMap: metal ? metalGradientMap : gradientMap
    })
    material.userData.metal = metal
    return material
}

/**
 * Adds the highlight of metal to a toon material, after its light field is applied
 */
function applyHighlight(material: MeshToonMaterial): void
{
    const lit = material.onBeforeCompile
    material.onBeforeCompile = (shader, renderer) => {
        lit.call(material, shader, renderer)
        shader.fragmentShader = shader.fragmentShader.replace(
            "#include <lights_toon_pars_fragment>",
            ShaderChunk.lights_toon_pars_fragment.replace(
                "reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );",
                /* glsl */`reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
                float shine = dot(geometryNormal, normalize(directLight.direction + geometryViewDir));
                reflectedLight.directSpecular += step(${METAL_SHINE.toFixed(3)}, shine) * directLight.color * ${METAL_HIGHLIGHT.toFixed(3)};`
            )
        )
    }
    const key = material.customProgramCacheKey()
    material.customProgramCacheKey = () => key + "-metal"
}


/**
 * A copy of a rigged monster model with materials of its own, for the flash and the light field, and silhouettes
 */
export interface SkinnedFigure
{
    root: Object3D
    /** lit materials with their own colors, and their meshes */
    bodies: { material: MeshToonMaterial, color: Color, mesh: SkinnedMesh }[]
    /** the dark outline around it, a rim where it stands in the dark */
    outline: MeshBasicMaterial
    rim: MeshBasicMaterial
    fill: MeshBasicMaterial
}


/**
 * Returns a copy of a rigged model, drawn with toon shading and outlines like the meeples, and with the silhouettes of a MeepleCrowd which shows them. The model must be loaded
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
    const outline = createOutlineMaterial()
    applyRimLight(outline, field, OUTLINE)
    const bodies: SkinnedFigure["bodies"] = []

    // glTF makes one mesh per material
    const meshes: SkinnedMesh[] = []
    root.traverse(obj => (obj as SkinnedMesh).isSkinnedMesh && meshes.push(obj as SkinnedMesh))
    for (const mesh of meshes)
    {
        // the flash and the light field belong to this figure
        const material = toonMaterial(mesh.material as MeshStandardMaterial)
        const color = colors[material.name]
        if (color)
        {
            material.color.copy(color)
        }
        applyLightField(material, field)
        if (material.userData.metal)
        {
            applyHighlight(material)
        }
        bodies.push({ material, color: material.color.clone(), mesh })
        mesh.material = material
        mesh.frustumCulled = false

        const hull = new SkinnedMesh(mesh.geometry, outline)
        hull.bind(mesh.skeleton, mesh.bindMatrix)
        hull.frustumCulled = false
        mesh.add(hull)

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
    return { root, bodies, outline, rim, fill }
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
