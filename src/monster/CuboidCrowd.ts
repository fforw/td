import { Matrix4, Quaternion, Vector3 } from "three"
import { MEEPLE_SCALE, NO_SILHOUETTE } from "../meeple/Meeple3D"
import type { LightField } from "../render/dungeonLighting"
import { type Cuboid, hopShare, LUNGE_WINDUP } from "./cuboids"
import MonsterCrowd, { FLASH, PLAIN, SILHOUETTE } from "./MonsterCrowd"

/**
 * How much taller a cuboid gets in the air, and how much flatter just before a lunge
 */
const HOP_STRETCH = 0.2
const WINDUP_SQUASH = 0.4

/**
 * How much a cuboid wobbles all the time, and how fast
 */
const WOBBLE = 0.02
const WOBBLE_SPEED = 3

const UP = new Vector3(0, 1, 0)
const matrix = new Matrix4()
const position = new Vector3()
const rotation = new Quaternion()
const scale = new Vector3()


/**
 * Instanced 3D acid cuboids, drawn with the silhouettes of a MeepleCrowd which shows them. The model must be loaded first.
 */
export default class CuboidCrowd
{
    private readonly crowd: MonsterCrowd

    /**
     * @param capacity  most cuboids there can be
     * @param field     light field of the level
     */
    constructor(capacity: number, field: LightField)
    {
        this.crowd = new MonsterCrowd("acidCuboid", capacity, field)
    }

    get group()
    {
        return this.crowd.group
    }

    /**
     * Shows the given cuboids
     *
     * @param cuboids   cuboids to show
     * @param time      time in seconds
     */
    update(cuboids: readonly Cuboid[], time: number): void
    {
        const { crowd } = this
        cuboids.forEach((cuboid, i) => {
            const { kind, x, z, yaw, windup, hopHeight, flash, chase } = cuboid
            const arc = Math.sin(hopShare(cuboid) * Math.PI)
            const stretch = 1 + WOBBLE * Math.sin(time * WOBBLE_SPEED + yaw)
                + arc * HOP_STRETCH
                - (windup > 0 ? (1 - windup / LUNGE_WINDUP) * WINDUP_SQUASH : 0)
            // keeps about the volume it has
            const width = kind.scale * MEEPLE_SCALE / Math.sqrt(stretch)

            rotation.setFromAxisAngle(UP, yaw)
            matrix.compose(position.set(x, arc * hopHeight, z), rotation, scale.set(width, stretch * kind.scale * MEEPLE_SCALE, width))
            crowd.set(i, matrix, flash > 0 ? FLASH : PLAIN, chase > 0 ? SILHOUETTE : NO_SILHOUETTE)
        })
        crowd.show(cuboids.length)
    }
}
