import Prando from "prando"
import { assert, describe, it } from "vitest"

import CuboidPack, {
    BIG_CUBOID,
    type Cuboid,
    type CuboidKind,
    LUNGE_LENGTH,
    LUNGE_WAIT,
    LUNGE_WINDUP,
    MAX_SPLIT,
    MIN_SPLIT,
    mostCuboids,
    placeCuboids,
    SMALL_CUBOID,
    splitShare
} from "../../src/monster/cuboids"
import Monsters, { CHASE_TIME, HERO_RADIUS, HURT_WAIT, type MonsterFloor, NOTICE_DISTANCE, type Prey } from "../../src/monster/monsters"

const FRAME = 1 / 60
const REACH = 0.55
const WIDTH = 2.2


function openFloor(sees = (_x0: number, _z0: number, _x1: number, _z1: number) => true): MonsterFloor
{
    return {
        move(monster, dx, dz)
        {
            monster.x += dx
            monster.z += dz
        },
        sees
    }
}

function pack(sees?: (x0: number, z0: number, x1: number, z1: number) => boolean): CuboidPack
{
    return new CuboidPack(openFloor(sees))
}

/**
 * Returns the hit points a hero loses now
 */
function hurt(cuboids: CuboidPack, hero: Prey, delta = FRAME): number
{
    return new Monsters([cuboids], openFloor()).hurt(hero, delta)
}

function prey(x = 0, z = 0, changes: Partial<Prey> = {}): Prey
{
    return { x, z, facing: 0, blocking: false, dodging: false, hurtWait: 0, ...changes }
}

function run(cuboids: CuboidPack, seconds: number, heroes: Prey[]): void
{
    const monsters = new Monsters([cuboids], openFloor())
    for (let t = 0; t < seconds; t += FRAME)
    {
        monsters.update(FRAME, heroes)
    }
}

/**
 * Runs frames until a big cuboid is about to lunge, which takes until it next looks around
 */
function runToWindup(cuboids: CuboidPack, big: Cuboid, heroes: Prey[]): void
{
    for (let t = 0; t < 1 && big.windup === 0; t += FRAME)
    {
        cuboids.update(FRAME, heroes)
    }
    assert(big.windup > 0)
}

/**
 * Returns the hit points a hero loses over the given time, without anything moving
 */
function hurtOver(cuboids: CuboidPack, seconds: number, hero: Prey): number
{
    let lost = 0
    for (let t = 0; t < seconds; t += FRAME)
    {
        lost += hurt(cuboids, hero)
    }
    return lost
}


describe("Acid cuboids", () => {

    it("are slower than running when big and faster when small", () => {

        const speed = ({ hopLength, hopTime }: CuboidKind) => hopLength / hopTime
        // a hero running at the walking speed of a multiplier of 1, see LevelScene
        assert(speed(BIG_CUBOID) < 0.45 * 2.5)
        assert(speed(SMALL_CUBOID) > speed(BIG_CUBOID))
        assert(SMALL_CUBOID.scale === BIG_CUBOID.scale / 2)
        assert(SMALL_CUBOID.damage < BIG_CUBOID.damage)
        assert(SMALL_CUBOID.hp < BIG_CUBOID.hp)
    })

    describe("going after heroes", () => {

        it("hop to a hero they see close by", () => {

            const cuboids = pack()
            const small = cuboids.add(SMALL_CUBOID, 0, 2, 0)
            run(cuboids, 4, [prey()])
            assert(Math.hypot(small.x, small.z) <= SMALL_CUBOID.radius + HERO_RADIUS)
        })

        it("don't notice those too far away", () => {

            const cuboids = pack()
            const small = cuboids.add(SMALL_CUBOID, 0, NOTICE_DISTANCE + 2, 0)
            run(cuboids, 1, [prey()])
            assert(small.chase === 0)
        })

        it("don't notice those behind a wall", () => {

            const cuboids = pack(() => false)
            const small = cuboids.add(SMALL_CUBOID, 0, 1, 0)
            run(cuboids, 1, [prey()])
            assert(small.chase === 0)
        })

        it("go on to where they last saw someone, then give up", () => {

            let seen = true
            const cuboids = pack(() => seen)
            const small = cuboids.add(SMALL_CUBOID, 0, 2, 0)
            run(cuboids, 0.5, [prey()])
            assert(small.chase > 0)
            const before = small.x
            seen = false
            run(cuboids, 0.5, [prey()])
            assert(small.x < before)
            run(cuboids, CHASE_TIME, [prey()])
            assert(small.chase === 0)
        })

        it("stay apart", () => {

            const cuboids = pack()
            const a = cuboids.add(SMALL_CUBOID, 0, 0, 0)
            const b = cuboids.add(SMALL_CUBOID, 0, 0.01, 0)
            run(cuboids, 0.5, [])
            assert(Math.hypot(a.x - b.x, a.z - b.z) > SMALL_CUBOID.radius)
        })
    })

    describe("lunging", () => {

        const { hopLength, radius } = BIG_CUBOID
        const start = hopLength * LUNGE_LENGTH + radius + HERO_RADIUS - 0.01

        it("goes half as far again as a hop, after a moment to see it coming", () => {

            const cuboids = pack()
            const big = cuboids.add(BIG_CUBOID, 0, start, 0)
            const hero = prey()
            runToWindup(cuboids, big, [hero])
            assert(big.x === start)

            run(cuboids, LUNGE_WINDUP, [hero])
            assert(big.windup === 0)
            assert(big.hopLeft > 0)
            assert(big.lungeWait > 0)
            run(cuboids, big.hopTime, [hero])
            assert.closeTo(start - big.x, hopLength * LUNGE_LENGTH, hopLength * 0.1)
            assert(Math.hypot(big.x, big.z) < radius + HERO_RADIUS)
        })

        it("isn't something small ones do", () => {

            const cuboids = pack()
            const small = cuboids.add(SMALL_CUBOID, 0, 0.4, 0)
            run(cuboids, 0.3, [prey()])
            assert(small.windup === 0)
        })

        it("waits for the next one", () => {

            const cuboids = pack()
            const big = cuboids.add(BIG_CUBOID, 0, start, 0)
            run(cuboids, 1, [prey()])
            assert(big.lungeWait > 0)
            big.x = start
            big.hopLeft = 0
            run(cuboids, FRAME, [prey()])
            assert(big.windup === 0)
            assert(big.lungeWait <= LUNGE_WAIT)
        })

        it("goes where the hero was when it started, so it can be dodged", () => {

            const cuboids = pack()
            const big = cuboids.add(BIG_CUBOID, 0, start, 0)
            const hero = prey()
            runToWindup(cuboids, big, [hero])
            hero.z = 2
            run(cuboids, LUNGE_WINDUP + big.hopTime, [hero])
            assert.closeTo(big.z, 0, 0.3)
        })
    })

    describe("hurting", () => {

        it("happens on touching and again after a while in touch", () => {

            const cuboids = pack()
            cuboids.add(BIG_CUBOID, 0, 0.1, 0)
            const hero = prey()
            assert(hurt(cuboids, hero) === BIG_CUBOID.damage)
            assert(hurtOver(cuboids, HURT_WAIT - FRAME * 2, hero) === 0)
            assert(hurtOver(cuboids, FRAME * 3, hero) === BIG_CUBOID.damage)
        })

        it("ignores another cuboid in the meantime", () => {

            const cuboids = pack()
            const first = cuboids.add(SMALL_CUBOID, 0, 0.1, 0)
            const hero = prey()
            assert(hurt(cuboids, hero) === SMALL_CUBOID.damage)
            first.x = 5
            cuboids.add(BIG_CUBOID, 0, 0, 0.1)
            assert(hurt(cuboids, hero) === 0)
            assert(hurtOver(cuboids, HURT_WAIT, hero) === BIG_CUBOID.damage)
        })

        it("doesn't happen while dodging, and right after it does", () => {

            const cuboids = pack()
            cuboids.add(BIG_CUBOID, 0, 0.1, 0)
            const hero = prey(0, 0, { dodging: true })
            assert(hurt(cuboids, hero) === 0)
            hero.dodging = false
            assert(hurt(cuboids, hero) === BIG_CUBOID.damage)
        })

        it("does nothing without touching", () => {

            const cuboids = pack()
            cuboids.add(BIG_CUBOID, 0, BIG_CUBOID.radius + HERO_RADIUS + 0.01, 0)
            assert(hurt(cuboids, prey()) === 0)
        })

        it("doesn't go through walls", () => {

            const cuboids = pack(() => false)
            cuboids.add(BIG_CUBOID, 0, 0.1, 0)
            assert(hurt(cuboids, prey()) === 0)
        })

        it("goes with the worst of what touches a hero", () => {

            const cuboids = pack()
            cuboids.add(SMALL_CUBOID, 0, 0.1, 0)
            cuboids.add(BIG_CUBOID, 0, -0.1, 0)
            assert(hurt(cuboids, prey()) === BIG_CUBOID.damage)
        })
    })

    describe("blocking", () => {

        // a facing of 0 looks along +z
        const blocker = () => prey(0, 0, { blocking: true })

        it("stops small ones in front, who bounce off", () => {

            const cuboids = pack()
            const small = cuboids.add(SMALL_CUBOID, 0, 0, 0.1)
            const hero = blocker()
            assert(hurt(cuboids, hero) === 0)
            assert(hero.hurtWait === 0)
            assert(small.recoiling)
            run(cuboids, 0.3, [])
            assert(small.z > 0.1)
        })

        it("doesn't help with what comes from behind", () => {

            const cuboids = pack()
            cuboids.add(SMALL_CUBOID, 0, 0, -0.1)
            assert(hurt(cuboids, blocker()) === SMALL_CUBOID.damage)
        })

        it("doesn't stop big ones", () => {

            const cuboids = pack()
            cuboids.add(BIG_CUBOID, 0, 0, 0.1)
            assert(hurt(cuboids, blocker()) === BIG_CUBOID.damage)
        })
    })

    describe("striking", () => {

        it("hits what is in the arc and nothing else", () => {

            const cuboids = pack()
            const inFront = cuboids.add(BIG_CUBOID, 0, 0, 0.4)
            const behind = cuboids.add(BIG_CUBOID, 0, 0, -0.4)
            const away = cuboids.add(BIG_CUBOID, 0, 0, 2)
            assert(cuboids.strike(0, 0, 0, REACH, WIDTH, 2) === 1)
            assert(inFront.hp === BIG_CUBOID.hp - 2)
            assert(behind.hp === BIG_CUBOID.hp)
            assert(away.hp === BIG_CUBOID.hp)
        })

        it("stops at walls", () => {

            const cuboids = pack(() => false)
            cuboids.add(BIG_CUBOID, 0, 0, 0.4)
            assert(cuboids.strike(0, 0, 0, REACH, WIDTH, 2) === 0)
        })

        it("drives back and calls off a lunge", () => {

            const cuboids = pack()
            const big = cuboids.add(BIG_CUBOID, 0, 0, 0.4)
            big.windup = LUNGE_WINDUP
            cuboids.strike(0, 0, 0, REACH, WIDTH, 2)
            assert(big.windup === 0)
            assert(big.hopZ > 0)
            assert(big.chase > 0)
        })

        it("kills small ones for good", () => {

            const cuboids = pack()
            cuboids.add(SMALL_CUBOID, 0, 0, 0.3)
            cuboids.strike(0, 0, 0, REACH, WIDTH, SMALL_CUBOID.hp)
            assert(cuboids.members.length === 0)
            // to burst, carried off in the direction of the blow
            assert(cuboids.deaths.length === 1)
            const [{ kind, x, z, away }] = cuboids.deaths
            assert(kind === SMALL_CUBOID && x === 0 && z === 0.3 && away === 0)
        })

        it("bursts what of a big one doesn't go into the small ones", () => {

            for (let i = 0; i < 50; i++)
            {
                const cuboids = pack()
                cuboids.add(BIG_CUBOID, 0, 0, 0.3)
                cuboids.strike(0, 0, 0, REACH, WIDTH, BIG_CUBOID.hp)
                assert(splitShare(BIG_CUBOID) === 1 / 8)
                assert.deepEqual(cuboids.deaths.map(({ share }) => share), [1 - cuboids.members.length / 8])
            }
        })

        it("smites big ones whole, without small ones", () => {

            const cuboids = pack()
            cuboids.add(BIG_CUBOID, 0, 0, 0.3)
            cuboids.add(SMALL_CUBOID, 1, 2, 0)
            cuboids.smite(({ face }) => face === 0)
            assert.deepEqual(cuboids.members.map(({ kind }) => kind), [SMALL_CUBOID])
            assert.deepEqual(cuboids.deaths.map(({ kind, share }) => [kind, share]), [[BIG_CUBOID, 1]])
        })

        it("breaks big ones up into 2 to 7 small ones", () => {

            const counts = new Set<number>()
            for (let i = 0; i < 300; i++)
            {
                const cuboids = pack()
                cuboids.add(BIG_CUBOID, 0, 0, 0.3)
                cuboids.strike(0, 0, 0, REACH, WIDTH, BIG_CUBOID.hp)
                counts.add(cuboids.members.length)
                assert(cuboids.members.every(({ kind }) => kind === SMALL_CUBOID))
            }
            assert.deepEqual([...counts].sort((a, b) => a - b), [2, 3, 4, 5, 6, 7])
            assert(MIN_SPLIT === 2 && MAX_SPLIT === 7)
        })

        it("has those coming out of a big one carry on away from the blow, mostly", () => {

            const cuboids = pack()
            cuboids.add(BIG_CUBOID, 0, 0, 0.3)
            cuboids.strike(0, 0, 0, REACH, WIDTH, BIG_CUBOID.hp)
            run(cuboids, 0.2, [])
            const { members: small } = cuboids
            assert.isAbove(small.reduce((sum, { z }) => sum + z, 0) / small.length, 0.4)
        })

        it("has those coming out of a big one on top of the hero go where the blow goes, mostly", () => {

            const cuboids = pack()
            cuboids.add(BIG_CUBOID, 0, 0, 0)
            cuboids.strike(0, 0, Math.PI / 2, REACH, WIDTH, BIG_CUBOID.hp)
            run(cuboids, 0.2, [])
            const { members: small } = cuboids
            assert.isAbove(small.reduce((sum, { x }) => sum + x, 0) / small.length, 0.1)
        })

        it("has those coming out of a big one spread out", () => {

            const cuboids = pack()
            cuboids.add(BIG_CUBOID, 0, 0, 0.3)
            cuboids.strike(0, 0, 0, REACH, WIDTH, BIG_CUBOID.hp)
            run(cuboids, 0.2, [])
            const { members: small } = cuboids
            for (let i = 1; i < small.length; i++)
            {
                assert(Math.hypot(small[i].x - small[0].x, small[i].z - small[0].z) > 0.01)
            }
        })
    })

    describe("seeing", () => {

        it("goes by distance and walls, whatever the cuboid is up to", () => {

            const close = pack()
            close.add(SMALL_CUBOID, 0, NOTICE_DISTANCE - 0.1, 0)
            assert(close.sees(prey()))

            const far = pack()
            far.add(SMALL_CUBOID, 0, NOTICE_DISTANCE + 0.1, 0)
            assert(!far.sees(prey()))

            const walled = pack(() => false)
            walled.add(SMALL_CUBOID, 0, 1, 0)
            assert(!walled.sees(prey()))
        })

        it("stops with the last one dead", () => {

            const cuboids = pack()
            cuboids.add(SMALL_CUBOID, 0, 0, 0.3)
            cuboids.strike(0, 0, 0, REACH, WIDTH, SMALL_CUBOID.hp)
            assert(!cuboids.sees(prey()))
        })
    })

    describe("placing", () => {

        const rooms = Array.from({ length: 50 }, (_, i) => [i * 3 + 1, i * 3 + 2, i * 3 + 3])

        it("leaves the room the heroes come in by alone", () => {

            for (let seed = 0; seed < 20; seed++)
            {
                const placed = placeCuboids(rooms, 3, new Prando(seed))
                assert(placed.length > 0)
                assert(new Set(placed.map(({ face }) => Math.ceil(face / 3))).size < rooms.length / 2)
                assert(placed.every(({ face }) => face < 10 || face > 12))
            }
        })

        it("is the same for the same seed", () => {

            assert.deepEqual(placeCuboids(rooms, 3, new Prando(7)), placeCuboids(rooms, 3, new Prando(7)))
        })

        it("knows how many there can be at most", () => {

            assert(mostCuboids([BIG_CUBOID, SMALL_CUBOID]) === MAX_SPLIT + 1)
        })
    })
})
