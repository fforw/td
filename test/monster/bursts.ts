import { assert, describe, it } from "vitest"

import { MEEPLE_SCALE } from "../../src/meeple/Meeple3D"
import { BRUTE } from "../../src/monster/brutes"
import Bursts, { DENSITY, FEWEST, particleCount, sphereVolume } from "../../src/monster/bursts"
import { BIG_CUBOID, SMALL_CUBOID } from "../../src/monster/cuboids"
import { FLYING_EYE } from "../../src/monster/eyes"
import type { MonsterKind } from "../../src/monster/monsters"

const FRAME = 1 / 60


function burst(kind: MonsterKind, yaw = 0, away = 0): Bursts
{
    const bursts = new Bursts()
    bursts.add({ kind, x: 1, z: 2, yaw, away })
    return bursts
}

function average(values: number[]): number
{
    return values.reduce((sum, value) => sum + value, 0) / values.length
}


describe("Bursts", () => {

    it("fills each sphere by its volume", () => {

        const [body, club] = BRUTE.burst
        assert(particleCount(body, 1) === Math.round(sphereVolume(body, 1) * DENSITY))
        assert(burst(BRUTE).particles.length === particleCount(body, 1) + particleCount(club, 1))
        // a smaller monster of the same shape gets fewer, but never too few
        assert(particleCount(SMALL_CUBOID.burst[0], 0.5) < particleCount(SMALL_CUBOID.burst[0], 1))
        assert(particleCount({ ...body, rx: 0.01 }, 1) === FEWEST)
    })

    it("leaves out monsters without spheres", () => {

        assert(burst(BIG_CUBOID).particles.length === 0)
    })

    it("starts the particles within the spheres, turned with the monster", () => {

        const club = BRUTE.burst[1]
        const clubColor = club.colors[0]
        const factor = BRUTE.scale * MEEPLE_SCALE
        // the club is held on the left of the model, which is where it looks with no turn
        for (const [yaw, side] of [[0, -1], [Math.PI, 1]])
        {
            const particles = burst(BRUTE, yaw).particles.filter(({ color }) => color === clubColor)
            const x = average(particles.map(({ x }) => x)) - 1
            assert(Math.sign(x) === side)
            assert(Math.abs(Math.abs(x) - Math.abs(club.x) * factor) < 0.03)
            assert(particles.every(({ y }) => y >= (club.y - club.ry) * factor && y <= (club.y + club.ry) * factor))
        }

        // eyes burst where they hover
        const eye = burst(FLYING_EYE).particles
        assert(Math.abs(average(eye.map(({ y }) => y)) - 0.3) < 0.03)
    })

    it("sends them off with the blow", () => {

        const particles = burst(BRUTE, 0, Math.PI / 2).particles
        assert(average(particles.map(({ vx }) => vx)) > 0.2)
        assert(Math.abs(average(particles.map(({ vz }) => vz))) < 0.1)
    })

    it("lets them fall to the floor and vanish", () => {

        const bursts = burst(FLYING_EYE)
        for (let i = 0; i < 60; i++)
        {
            bursts.update(FRAME)
        }
        assert(bursts.particles.length > 0)
        assert(bursts.particles.every(({ y }) => y >= 0))
        for (let i = 0; i < 120; i++)
        {
            bursts.update(FRAME)
        }
        assert(bursts.particles.length === 0)
    })
})
