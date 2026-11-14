import { PerspectiveCamera, Vector3 } from "three"
import { assert, describe, it } from "vitest"

import { blendShots, MIN_ANGLE, placeShot, type Shot, SHOTS } from "../../src/scene/sceneCamera"
import type { ActorRole } from "../../src/scene/script"

const position = new Vector3()
const target = new Vector3()


/**
 * Returns the horizontal screen positions of a and b, -1 to 1, as the camera of the shot sees them
 */
function screenX(a: Vector3, b: Vector3, left: ActorRole, shot: Shot): [number, number]
{
    placeShot(a, b, left, shot, position, target)
    const camera = new PerspectiveCamera(40, 16 / 9, 0.01, 100)
    camera.position.copy(position)
    camera.lookAt(target)
    camera.updateMatrixWorld()
    const head = new Vector3(0, 0.22, 0)
    return [a.clone().add(head).project(camera).x, b.clone().add(head).project(camera).x]
}

/**
 * Returns on which side of the line from a to b the point is, as the sign of the cross product
 */
function sideOf(a: Vector3, b: Vector3, point: Vector3): number
{
    return Math.sign((b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x))
}

const PAIRS: [Vector3, Vector3][] = [
    [new Vector3(0, 0, 0), new Vector3(0.8, 0, 0)],
    [new Vector3(3, 0, -2), new Vector3(2.5, 0, -1.3)],
    [new Vector3(-1, 0, 4), new Vector3(-1, 0, 3.1)]
]


describe("placeShot", () => {

    it("keeps the left actor on the left in every shot", () => {
        for (const [a, b] of PAIRS)
        {
            for (const left of ["a", "b"] as const)
            {
                for (const shot of Object.values(SHOTS))
                {
                    const [ax, bx] = screenX(a, b, left, shot)
                    assert.isTrue(left === "a" ? ax < bx : bx < ax, `${left} left at ${shot.angle}`)
                    assert.isTrue(Math.abs(ax) < 1 && Math.abs(bx) < 1, `both on screen at ${shot.angle}: ${ax}, ${bx}`)
                }
            }
        }
    })

    it("never crosses the line of action on the way between shots", () => {
        const [a, b] = PAIRS[1]
        const shot = { ...SHOTS.two }
        placeShot(a, b, "a", SHOTS.overA, position, target)
        const side = sideOf(a, b, position)
        for (let t = 0; t <= 1; t += 0.05)
        {
            placeShot(a, b, "a", blendShots(SHOTS.overA, SHOTS.overB, t, shot), position, target)
            assert.equal(sideOf(a, b, position), side)
        }
    })

    it("keeps off the line itself", () => {
        const [a, b] = PAIRS[0]
        placeShot(a, b, "a", { ...SHOTS.two, angle: -30 }, position, target)
        const off = Math.asin(Math.abs(position.z) / position.distanceTo(new Vector3(0.4, position.y, 0))) * 180 / Math.PI
        assert.closeTo(off, MIN_ANGLE, 1e-9)
    })

    it("frames over the shoulder of the actor in front", () => {
        const [a, b] = PAIRS[0]
        placeShot(a, b, "a", SHOTS.overA, position, target)
        assert.isBelow(position.distanceTo(a), position.distanceTo(b))
        placeShot(a, b, "a", SHOTS.overB, position, target)
        assert.isBelow(position.distanceTo(b), position.distanceTo(a))
    })
})
