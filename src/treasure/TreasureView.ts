import { DynamicDrawUsage, Group, InstancedMesh, Matrix4, type Mesh, type MeshStandardMaterial, Object3D, SphereGeometry } from "three"
import { applyLightField, createBubbleMaterial, type LightField } from "../render/dungeonLighting"
import { template } from "../render/scene3d"
import { type Chest, CHEST_HALF_WIDTH, coinPose, type CoinPose, LID_TIME } from "./chests"

/**
 * Half the width of the chest model
 */
const CHEST_MODEL_HALF_WIDTH = 0.25

const CHEST_SCALE = CHEST_HALF_WIDTH / CHEST_MODEL_HALF_WIDTH

/**
 * Size of a coin against its model, and half the thickness and the diameter of the model
 */
const COIN_SCALE = 0.3
const COIN_MODEL_SIZE = 0.4167

/**
 * Radius of the bubble an item floats in, in world units
 */
const BUBBLE_RADIUS = 0.1

/**
 * Rotation of an open lid. Further than the model's own animation, for what comes out to be seen, and short of the wall behind.
 */
const LID_OPEN = -Math.PI * 0.55

/**
 * How far past open a lid pops, before settling
 */
const LID_OVERSHOOT = 2.5

const dummy = new Object3D()
const matrix = new Matrix4()
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
 * Chests and instanced coins of a level, each coin in a bubble. The models must be loaded first.
 */
export default class TreasureView
{
    readonly group = new Group()

    private readonly lids: Object3D[] = []
    private readonly coins: InstancedMesh
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

        const source = firstMesh(template("coin"))
        const coinMaterial = (source.material as MeshStandardMaterial).clone()
        applyLightField(coinMaterial, field)
        // around its middle, to turn in the air
        const geometry = source.geometry.clone().translate(0, -COIN_MODEL_SIZE / 2, 0)
        const most = chests.reduce((sum, { coins }) => sum + coins.length, 0)
        const coins = new InstancedMesh(geometry, coinMaterial, most)
        const bubbles = new InstancedMesh(new SphereGeometry(BUBBLE_RADIUS, 24, 16), createBubbleMaterial(field), most)
        for (const mesh of [coins, bubbles])
        {
            mesh.instanceMatrix.setUsage(DynamicDrawUsage)
            mesh.frustumCulled = false
            mesh.count = 0
            this.group.add(mesh)
        }
        this.coins = coins
        this.bubbles = bubbles
    }

    /**
     * @param heroAt    returns where the hero with the given id is, for coins on the way to them
     */
    update(time: number, heroAt: (id: number) => { x: number, z: number } | undefined): void
    {
        const { chests, lids, coins, bubbles } = this
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
                    dummy.position.set(pose.x, pose.y, pose.z)
                    dummy.rotation.set(pose.tumble, pose.spin, 0, "YXZ")
                    dummy.scale.setScalar(COIN_SCALE * pose.size)
                    dummy.updateMatrix()
                    coins.setMatrixAt(count, matrix.copy(dummy.matrix))
                    dummy.rotation.set(0, 0, 0)
                    dummy.scale.setScalar(pose.size)
                    dummy.updateMatrix()
                    bubbles.setMatrixAt(count++, matrix.copy(dummy.matrix))
                }
            }
        })
        coins.count = bubbles.count = count
        coins.instanceMatrix.needsUpdate = bubbles.instanceMatrix.needsUpdate = true
    }
}

