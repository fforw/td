import {
    Box3,
    Color,
    CylinderGeometry,
    Group,
    InstancedMesh,
    type Material,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    type Object3D,
    SphereGeometry,
    Vector3
} from "three"
import { type Element, ELEMENT_COLORS, type Gear, type GearKind } from "../game/gear"
import { FIGURE_SCALE } from "../meeple/figureScale"
import { applyLightField, type LightField } from "../render/dungeonLighting"
import { template } from "../render/scene3d"

/**
 * Length of every piece of gear in world units, whatever its model is
 */
export const GEAR_LENGTH = 0.2 * FIGURE_SCALE

const WOOD = "#5a3a22"
const DARK_WOOD = "#2e1c10"
const PAPER = "#e6d9b4"

/**
 * Wand and scroll as made here, in model units like the dagger, with the length along y from 0 up
 */
const WAND_LENGTH = 0.5
const WAND_RADIUS = 0.018
const TIP_RADIUS = 0.04
const SCROLL_LENGTH = 0.36
const SCROLL_RADIUS = 0.06
const ROD_RADIUS = 0.025
const ROD_OVER = 0.05
const SEAL_RADIUS = 0.03


/**
 * Returns the material for the glowing part of a wand or scroll, which shows its element
 */
function glowMaterial(element: Element): MeshBasicMaterial
{
    return new MeshBasicMaterial({ color: new Color(ELEMENT_COLORS[element].glow), toneMapped: false })
}


function part(geometry: CylinderGeometry | SphereGeometry, material: Material, y: number): Mesh
{
    const mesh = new Mesh(geometry, material)
    mesh.position.y = y
    return mesh
}


function createWand(element: Element): Object3D
{
    const wand = new Group()
    wand.add(
        part(new CylinderGeometry(WAND_RADIUS * 0.7, WAND_RADIUS, WAND_LENGTH, 8), new MeshStandardMaterial({ color: WOOD, roughness: 0.6 }), WAND_LENGTH / 2),
        part(new SphereGeometry(TIP_RADIUS, 12, 8), glowMaterial(element), WAND_LENGTH + TIP_RADIUS * 0.5)
    )
    return wand
}


function createScroll(element: Element): Object3D
{
    const scroll = new Group()
    const seal = part(new CylinderGeometry(SEAL_RADIUS, SEAL_RADIUS, 0.012, 12), glowMaterial(element), SCROLL_LENGTH / 2)
    seal.rotation.z = Math.PI / 2
    seal.position.x = SCROLL_RADIUS
    scroll.add(
        part(new CylinderGeometry(SCROLL_RADIUS, SCROLL_RADIUS, SCROLL_LENGTH, 16), new MeshStandardMaterial({ color: PAPER, roughness: 0.9 }), SCROLL_LENGTH / 2),
        part(new CylinderGeometry(ROD_RADIUS, ROD_RADIUS, SCROLL_LENGTH + ROD_OVER * 2, 8), new MeshStandardMaterial({ color: DARK_WOOD, roughness: 0.5 }), SCROLL_LENGTH / 2),
        seal
    )
    return scroll
}


/**
 * Returns the model of a piece of gear, pointing up along y. Daggers and axes need their models loaded.
 */
export function gearModel({ kind, element }: Pick<Gear, "kind" | "element">): Object3D
{
    switch (kind)
    {
        case "dagger":
            return template("dagger")
        case "axe":
            return template("axe")
        case "wand":
            return createWand(element ?? "arcane")
        case "scroll":
            return createScroll(element ?? "arcane")
    }
}


/**
 * Returns the key that tells apart pieces that look different
 */
export function lookKey({ kind, element }: Pick<Gear, "kind" | "element">): string
{
    return element ? kind + "-" + element : kind
}


/**
 * Instanced meshes for one piece of gear, one for each part of its model, around the middle of the whole model so that it
 * can turn in the air
 */
export interface GearParts
{
    parts: InstancedMesh[]
    /** size against the model, to be GEAR_LENGTH long */
    scale: number
}


/**
 * Returns instanced meshes for a piece of gear, lit by the light field of the level but for the glowing parts
 *
 * @param most  number of instances there can be
 */
export function instancedGear(piece: Pick<Gear, "kind" | "element">, field: LightField, most: number): GearParts
{
    const model = gearModel(piece)
    model.updateMatrixWorld(true)
    const box = new Box3().setFromObject(model)
    const middle = box.getCenter(new Vector3())
    const parts: InstancedMesh[] = []
    model.traverse(object => {
        const mesh = object as Mesh
        if (mesh.isMesh)
        {
            let material = mesh.material as Material
            if (!(material as MeshBasicMaterial).isMeshBasicMaterial)
            {
                material = material.clone()
                applyLightField(material, field)
            }
            const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld).translate(-middle.x, -middle.y, -middle.z)
            parts.push(new InstancedMesh(geometry, material, most))
        }
    })
    return { parts, scale: GEAR_LENGTH / (box.max.y - box.min.y) }
}
