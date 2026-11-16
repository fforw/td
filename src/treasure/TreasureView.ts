import { Box3, DynamicDrawUsage, Group, InstancedMesh, type Mesh, type MeshStandardMaterial, Object3D, SphereGeometry, Vector3 } from "three"
import { FIGURE_SCALE } from "../meeple/figureScale"
import { applyLightField, createBubbleMaterial, type LightField } from "../render/dungeonLighting"
import { type ModelName, template } from "../render/scene3d"
import { type Chest, CHEST_HALF_WIDTH, coinPose, type CoinPose, LID_TIME, type Potion, POTIONS } from "./chests"

/**
 * Half the width of the chest model
 */
const CHEST_MODEL_HALF_WIDTH = 0.25

const CHEST_SCALE = CHEST_HALF_WIDTH / CHEST_MODEL_HALF_WIDTH

/**
 * Size of a coin against its model, and half the thickness and the diameter of the model
 */
const COIN_SCALE = 0.3 * FIGURE_SCALE
const COIN_MODEL_SIZE = 0.4167

/**
 * Size of a potion against its model, whose bottles are about three units high
 */
const POTION_SCALE = 0.042 * FIGURE_SCALE

const POTION_MODELS: Record<Potion, ModelName> = {
    healing: "healthPotion",
    speed: "speedPotion",
    strength: "strengthPotion"
}

/**
 * Radius of the bubble an item floats in, in world units
 */
const BUBBLE_RADIUS = 0.1 * FIGURE_SCALE

/**
 * Rotation of an open lid. Further than the model's own animation, for what comes out to be seen, and short of the wall behind.
 */
const LID_OPEN = -Math.PI * 0.55

/**
 * How far past open a lid pops, before settling
 */
const LID_OVERSHOOT = 2.5

const dummy = new Object3D()
const pose: CoinPose = { x: 0, y: 0, z: 0, tumble: 0, spin: 0, size: 0 }


/**
 * Returns the first mesh of a model, which is the outermost one. The scene of a model can have the name of its mesh.
 */
function firstMesh(root: Object3D): Mesh
{
    let found: Mesh | undefined
    root.traverse(part => {
        found ??= (part as Mesh).isMesh ? part as Mesh : undefined
    })
    return found!
}


/**
 * Instanced meshes for all of one kind of thing that comes out of chests, one for each part of its model
 */
interface Items
{
    parts: InstancedMesh[]
    scale: number
    /** instances set so far in an update */
    count: number
}


/**
 * Chests and the instanced coins and potions in them, each in a bubble. The models must be loaded first.
 */
export default class TreasureView
{
    readonly group = new Group()

    private readonly lids: Object3D[] = []
    private readonly items: Record<"coin" | Potion, Items>
    private readonly bubbles: InstancedMesh

    /**
     * @param chests    chests of the level
     * @param field     light field of the level
     */
    constructor(private readonly chests: readonly Chest[], field: LightField)
    {
        const chestRoot = firstMesh(template("chest"))

        // the light field belongs to this level
        const chestMaterial = (chestRoot.material as MeshStandardMaterial).clone()
        applyLightField(chestMaterial, field)

        for (const { x, z, facing } of chests)
        {
            const chest = chestRoot.clone()
            chest.traverse(part => {
                const mesh = part as Mesh
                if (mesh.isMesh)
                {
                    mesh.material = chestMaterial
                }
            })
            chest.position.set(x, 0, z)
            chest.rotation.set(0, facing, 0)
            chest.scale.setScalar(CHEST_SCALE)
            this.group.add(chest)
            this.lids.push(chest.getObjectByName("lid")!)
        }
        // after the silhouettes of a level, see MeepleCrowd.showSilhouettes()
        this.group.renderOrder = 1

        const all = chests.flatMap(({ coins }) => coins)
        const most = (potion?: Potion) => all.filter(coin => coin.potion === potion).length
        const source = firstMesh(template("coin"))
        const coinMaterial = (source.material as MeshStandardMaterial).clone()
        applyLightField(coinMaterial, field)
        // around its middle, to turn in the air
        const coins = new InstancedMesh(source.geometry.clone().translate(0, -COIN_MODEL_SIZE / 2, 0), coinMaterial, most())
        this.items = {
            coin: { parts: [coins], scale: COIN_SCALE, count: 0 },
            ...Object.fromEntries(POTIONS.map(potion => [potion, {
                parts: instancedParts(template(POTION_MODELS[potion]), field, most(potion)),
                scale: POTION_SCALE,
                count: 0
            }])) as Record<Potion, Items>
        }
        const bubbles = new InstancedMesh(new SphereGeometry(BUBBLE_RADIUS, 24, 16), createBubbleMaterial(field), all.length)
        for (const mesh of [...Object.values(this.items).flatMap(({ parts }) => parts), bubbles])
        {
            mesh.instanceMatrix.setUsage(DynamicDrawUsage)
            mesh.frustumCulled = false
            mesh.count = 0
            this.group.add(mesh)
        }
        this.bubbles = bubbles
    }

    /**
     * @param heroAt    returns where the hero with the given id is, for coins on the way to them
     */
    update(time: number, heroAt: (id: number) => { x: number, z: number } | undefined): void
    {
        const { chests, lids, items, bubbles } = this
        for (const kind of Object.values(items))
        {
            kind.count = 0
        }
        let count = 0
        chests.forEach((chest, index) => {
            const { openedAt } = chest
            if (openedAt === null)
            {
                return
            }
            // pops past open and falls back
            const share = Math.min(1, (time - openedAt) / LID_TIME) - 1
            lids[index].rotation.x = LID_OPEN * (1 + share * share * ((LID_OVERSHOOT + 1) * share + LID_OVERSHOOT))

            for (const coin of chest.coins)
            {
                if (coin.arrived)
                {
                    continue
                }
                coinPose(coin, chest, time, pose, coin.takenBy !== null ? heroAt(coin.takenBy) : undefined)
                if (pose.size > 0)
                {
                    const kind = items[coin.potion ?? "coin"]
                    dummy.position.set(pose.x, pose.y, pose.z)
                    dummy.rotation.set(pose.tumble, pose.spin, 0, "YXZ")
                    dummy.scale.setScalar(kind.scale * pose.size)
                    dummy.updateMatrix()
                    for (const part of kind.parts)
                    {
                        part.setMatrixAt(kind.count, dummy.matrix)
                    }
                    kind.count++
                    dummy.rotation.set(0, 0, 0)
                    dummy.scale.setScalar(pose.size)
                    dummy.updateMatrix()
                    bubbles.setMatrixAt(count++, dummy.matrix)
                }
            }
        })
        for (const { parts, count } of Object.values(items))
        {
            for (const part of parts)
            {
                part.count = count
                part.instanceMatrix.needsUpdate = true
            }
        }
        bubbles.count = count
        bubbles.instanceMatrix.needsUpdate = true
    }
}


/**
 * Returns an instanced mesh for each part of a model, around the middle of the whole model, to turn in the air
 *
 * @param most  number of instances there can be
 */
function instancedParts(model: Object3D, field: LightField, most: number): InstancedMesh[]
{
    const middle = new Box3().setFromObject(model).getCenter(new Vector3())
    const parts: InstancedMesh[] = []
    model.traverse(part => {
        const mesh = part as Mesh
        if (mesh.isMesh)
        {
            const material = (mesh.material as MeshStandardMaterial).clone()
            applyLightField(material, field)
            const geometry = mesh.geometry.clone().translate(-middle.x, -middle.y, -middle.z)
            parts.push(new InstancedMesh(geometry, material, most))
        }
    })
    return parts
}
