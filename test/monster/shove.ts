import { assert, describe, it } from "vitest"

import { DASH_SPEED, RUN_SPEED } from "../../src/game/heroControl"
import Monsters, { HERO_RADIUS, type MonsterFloor, type Prey } from "../../src/monster/monsters"
import { type Body, BOUNCE, bump, fadeShove, SHOVE_TIME } from "../../src/monster/shove"
import SoldierPack, { SOLDIER } from "../../src/monster/soldiers"

const FRAME = 1 / 60

function body(x: number, z: number, vx: number, vz: number, mass = 1, radius = 0.1): Body
{
    return { x, z, vx, vz, shoveX: 0, shoveZ: 0, radius, mass }
}

function momentum(...bodies: Body[]): [number, number]
{
    return [bodies.reduce((sum, b) => sum + b.vx * b.mass, 0), bodies.reduce((sum, b) => sum + b.vz * b.mass, 0)]
}

function openFloor(): MonsterFloor
{
    return {
        move(monster, dx, dz)
        {
            monster.x += dx
            monster.z += dz
        },
        sees: () => true
    }
}

function prey(x: number, z: number, vx: number): Prey
{
    return { x, z, facing: Math.PI / 2, blocking: false, dodging: false, hurtWait: 0, vx, vz: 0, shoveX: 0, shoveZ: 0 }
}

describe("Bumping", () => {

    it("leaves those apart alone", () => {

        const a = body(0, 0, 1, 0), b = body(0.25, 0, -1, 0)
        assert(bump(a, b) === null)
        assert(a.x === 0 && b.x === 0.25 && a.vx === 1 && b.vx === -1)
    })

    it("keeps the momentum of both", () => {

        const a = body(0, 0, 2, 0.5, 1), b = body(0.15, 0.05, -0.3, 0, 3)
        const [px, pz] = momentum(a, b)
        assert.isAbove(bump(a, b)!, 0)
        const [qx, qz] = momentum(a, b)
        assert.closeTo(qx, px, 1e-9)
        assert.closeTo(qz, pz, 1e-9)
    })

    it("has them fly apart with a share of the speed they met with", () => {

        const a = body(0, 0, 2, 0), b = body(0.15, 0, 0, 0)
        bump(a, b)
        assert.closeTo(b.vx - a.vx, 2 * BOUNCE, 1e-9)
        assert.closeTo(b.shoveX, 1 + BOUNCE, 1e-9)
        assert.closeTo(a.shoveX, -1 - BOUNCE, 1e-9)
    })

    it("moves them out of each other, the lighter one more", () => {

        const a = body(0, 0, 0, 0, 1), b = body(0.1, 0, 0, 0, 3)
        bump(a, b)
        assert.closeTo(b.x - a.x, 0.2, 1e-9)
        assert.closeTo(-a.x, 0.075, 1e-9)
        assert.closeTo(b.x - 0.1, 0.025, 1e-9)
    })

    it("doesn't shove those going apart already", () => {

        const a = body(0, 0, -1, 0), b = body(0.15, 0, 1, 0)
        assert(bump(a, b) === 0)
        assert(a.vx === -1 && b.vx === 1 && a.shoveX === 0 && b.shoveX === 0)
    })

    it("shoves the light more than the heavy", () => {

        const light = body(0.15, 0, 0, 0, 0.5), heavy = body(0.15, 0, 0, 0, 3)
        bump(body(0, 0, 2, 0), light)
        bump(body(0, 0, 2, 0), heavy)
        assert.isAbove(light.shoveX, heavy.shoveX * 2)
    })

    it("dies down", () => {

        const shoved = { shoveX: 1, shoveZ: 0 }
        fadeShove(shoved, SHOVE_TIME)
        assert.closeTo(shoved.shoveX, Math.exp(-1), 1e-9)
        fadeShove(shoved, SHOVE_TIME * 10)
        assert(shoved.shoveX === 0)
    })

    it("has a hero dashing into a soldier shove it further than one running into it", () => {

        const shoved = (speed: number) =>
        {
            const soldiers = new SoldierPack(openFloor())
            const soldier = soldiers.add(SOLDIER, 0, SOLDIER.radius + HERO_RADIUS - 0.005, 0)
            const hero = prey(0, 0, speed)
            const bumped = new Monsters([soldiers], openFloor()).update(FRAME, [hero])
            assert(bumped.has(hero))
            assert.isBelow(hero.shoveX, 0)
            return soldier.shoveX
        }
        const running = shoved(RUN_SPEED * 0.5), dashing = shoved(RUN_SPEED * DASH_SPEED * 0.5)
        assert.isAbove(running, 0)
        assert.isAbove(dashing, running * 3)
    })

    it("tells only of heroes that ran into a monster", () => {

        const soldiers = new SoldierPack(openFloor())
        soldiers.add(SOLDIER, 0, SOLDIER.radius + HERO_RADIUS - 0.005, 0)
        const leaving = prey(0, 0, -1), far = prey(5, 5, 1)
        const bumped = new Monsters([soldiers], openFloor()).update(FRAME, [leaving, far])
        assert(bumped.size === 0)
    })
})
