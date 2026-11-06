import { Group, type Mesh, type MeshStandardMaterial } from "three"
import { EXIT_HALF_SIZE } from "../map/dungeonRoles"
import type { FixtureSpot } from "../map/fixtures"
import { applyLightField, type LightField } from "./dungeonLighting"
import { model } from "./scene3d"

/**
 * Half the width and depth of the model
 */
const MODEL_HALF_SIZE = 0.5


/**
 * Returns stairs for the given exits of a level. The model must be loaded first.
 *
 * @param exits     where they stand
 * @param field     light field of the level
 */
export function createExitMeshes(exits: readonly FixtureSpot[], field: LightField): Group
{
    const group = new Group()
    // after the silhouettes of a level, see MeepleCrowd.showSilhouettes()
    group.renderOrder = 1
    let material: MeshStandardMaterial | null = null
    for (const { x, z, facing } of exits)
    {
        const stairs = model("stairs")
        stairs.traverse(part => {
            const mesh = part as Mesh
            if (mesh.isMesh)
            {
                if (!material)
                {
                    // the light field belongs to this level
                    material = (mesh.material as MeshStandardMaterial).clone()
                    applyLightField(material, field)
                }
                mesh.material = material
            }
        })
        stairs.position.set(x, 0, z)
        stairs.rotation.y = facing
        stairs.scale.setScalar(EXIT_HALF_SIZE / MODEL_HALF_SIZE)
        group.add(stairs)
    }
    return group
}
