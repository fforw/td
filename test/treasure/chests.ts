import Prando from "prando"
import { assert, describe, it } from "vitest"

import ChestHoard, {
    CHEST_REACH,
    type ChestSpot,
    COIN_REACH,
    coinPose,
    type CoinPose,
    HOVER_HEIGHT,
    MAX_COINS,
    MIN_COINS,
    type OpenedChests,
    placeChests,
    POTION_CHANCE,
    POTIONS,
    TAKE_TIME
} from "../../src/treasure/chests"

const SPOT: ChestSpot = { face: 0, x: 0, z: 0, facing: 0 }
const LONG_AFTER = 100

/**
 * Every face at (face, 0), in a row
 */
const inRow = (face: number): number[] => [face, 0]

function hoard(opened: OpenedChests = {}): ChestHoard
{
    return new ChestHoard([SPOT], 1, ({ x, z }, dx, dz) => [x + dx, z + dz], opened)
}


describe("placeChests", () => {

    it("puts a chest into a level even with little luck, never into a room that is taken", () => {

        const rooms = [[0, 1], [10, 11, 12], [20, 21, 22]]
        for (let seed = 0; seed < 50; seed++)
        {
            const spots = placeChests(rooms, [], inRow, new Prando(seed), new Set([0]))
            assert(spots.length >= 1)
            assert(spots.every(({ face }) => face >= 10))
        }
    })

    it("is the same for the same seed", () => {

        const rooms = [[0], [10, 11, 12], [20, 21, 22], [30, 31]]
        assert.deepEqual(placeChests(rooms, [], inRow, new Prando(7)), placeChests(rooms, [], inRow, new Prando(7)))
    })

    it("stays away from openings", () => {

        for (let seed = 0; seed < 50; seed++)
        {
            for (const { face } of placeChests([[0], [10, 11, 12, 13, 14, 15]], [inRow(9)], inRow, new Prando(seed), new Set([0])))
            {
                assert(face >= 11)
            }
        }
    })

    it("leaves out rooms that are taken", () => {

        for (let seed = 0; seed < 50; seed++)
        {
            const spots = placeChests([[0], [10, 11, 12], [20, 21, 22]], [], inRow, new Prando(seed), new Set([0, 1]))
            assert(spots.length === 1 && spots[0].face >= 20)
        }
    })

    it("looks toward the middle of the room", () => {

        const [{ x, facing }] = placeChests([[0], [10, 20]], [], inRow, new Prando(1))
        assert.closeTo(Math.sin(facing), x === 10 ? 1 : -1, 1e-9)
    })
})


describe("ChestHoard", () => {

    it("opens only closed chests within reach", () => {

        const chests = hoard()
        assert.isNull(chests.closedNear(CHEST_REACH * 1.1, 0))

        const chest = chests.closedNear(CHEST_REACH * 0.9, 0)!
        assert.equal(chest, chests.chests[0])
        chests.open(chest, 0)
        assert.isNull(chests.closedNear(0, 0))
    })

    it("has a fitting number of coins, the same every time", () => {

        const { coins } = hoard().chests[0]
        const count = coins.filter(({ potion }) => !potion).length
        assert(count >= MIN_COINS && count <= MAX_COINS)
        assert.deepEqual(coins, hoard().chests[0].coins)
    })

    it("has chests with different numbers of coins", () => {

        const spots = Array.from({ length: 20 }, () => SPOT)
        const { chests } = new ChestHoard(spots, 1, ({ x, z }, dx, dz) => [x + dx, z + dz], {})
        assert(new Set(chests.map(({ coins }) => coins.filter(({ potion }) => !potion).length)).size > 2)
    })

    it("has a potion in some chests, which comes out after the coins", () => {

        const spots = Array.from({ length: 400 }, () => SPOT)
        const { chests } = new ChestHoard(spots, 1, ({ x, z }, dx, dz) => [x + dx, z + dz], {})
        const withPotion = chests.filter(({ coins }) => coins.some(({ potion }) => potion))
        assert.closeTo(withPotion.length / chests.length, POTION_CHANCE, 0.06)
        assert.sameMembers([...new Set(withPotion.map(({ coins }) => coins.at(-1)!.potion))], [...POTIONS])
        for (const { coins } of withPotion)
        {
            const potion = coins.at(-1)!
            assert.equal(coins.filter(({ potion }) => potion).length, 1)
            assert.equal(potion.id, coins.length - 1)
            assert(coins.slice(0, -1).every(({ delay }) => delay < potion.delay))
        }
    })

    it("gets picked up like a coin, as a potion", () => {

        const spots = Array.from({ length: 40 }, () => SPOT)
        const chests = new ChestHoard(spots, 1, ({ x, z }, dx, dz) => [x + dx, z + dz], {})
        const chest = chests.chests.find(({ coins }) => coins.at(-1)!.potion)!
        const potion = chest.coins.at(-1)!
        chests.open(chest, 0)
        assert.include(chests.collect(potion.x, potion.z, LONG_AFTER), potion)
    })

    it("lets coins fly out of the chest and land where they are meant to", () => {

        const chests = hoard()
        const [chest] = chests.chests
        const [coin] = chest.coins
        chests.open(chest, 10)
        const pose: CoinPose = { x: 0, y: 0, z: 0, tumble: 0, spin: 0, size: 0 }

        coinPose(coin, chest, 10, pose)
        assert.equal(pose.size, 0)

        coinPose(coin, chest, 10 + coin.delay + coin.flight / 3, pose)
        assert.equal(pose.size, 1, "its bubble has grown")
        assert(pose.y > 0)
        assert(Math.hypot(pose.x, pose.z) < Math.hypot(coin.x, coin.z))

        coinPose(coin, chest, 10 + LONG_AFTER, pose)
        assert.closeTo(pose.x, coin.x, 1e-9)
        assert.closeTo(pose.z, coin.z, 1e-9)
        assert.closeTo(pose.y, HOVER_HEIGHT, 0.02, "floats, bobbing a little")
        assert.closeTo(pose.tumble, 0, 1e-9)
    })

    it("goes to the hero who picked it up and gets there", () => {

        const chests = hoard()
        const [chest] = chests.chests
        const [coin] = chest.coins
        chests.open(chest, 0)
        const pose: CoinPose = { x: 0, y: 0, z: 0, tumble: 0, spin: 0, size: 0 }
        const hero = { x: coin.x + COIN_REACH * 0.9, z: coin.z }
        assert.isAtLeast(chests.collect(hero.x, hero.z, LONG_AFTER, 7).length, 1)
        assert.equal(coin.takenBy, 7)

        coinPose(coin, chest, LONG_AFTER, pose, hero)
        const start = Math.hypot(pose.x - hero.x, pose.z - hero.z)
        coinPose(coin, chest, LONG_AFTER + TAKE_TIME / 2, pose, hero)
        assert.isBelow(Math.hypot(pose.x - hero.x, pose.z - hero.z), start)
        assert.deepEqual(chests.arrive(LONG_AFTER + TAKE_TIME / 2), [])

        coinPose(coin, chest, LONG_AFTER + TAKE_TIME, pose, hero)
        assert.closeTo(pose.x, hero.x, 1e-9)
        assert.closeTo(pose.size, 0, 1e-9)
        assert.include(chests.arrive(LONG_AFTER + TAKE_TIME), coin)
        assert.notInclude(chests.arrive(LONG_AFTER + TAKE_TIME * 2), coin, "only once")
    })

    it("picks up coins only once they have landed, and only once", () => {

        const chests = hoard()
        const [chest] = chests.chests
        const [coin] = chest.coins

        assert.isEmpty(chests.collect(coin.x, coin.z, LONG_AFTER), "closed")
        chests.open(chest, 0)
        assert.isEmpty(chests.collect(coin.x, coin.z, coin.delay / 2), "in the air")
        assert.include(chests.collect(coin.x, coin.z, LONG_AFTER), coin)
        assert.isNotNull(coin.takenAt)
        assert.isEmpty(chests.collect(coin.x, coin.z, LONG_AFTER), "gone")
        assert.isEmpty(chests.collect(coin.x + COIN_REACH * 100, coin.z, LONG_AFTER), "too far")
    })

    it("keeps a record of what is left, to go on from", () => {

        const opened: OpenedChests = {}
        const chests = hoard(opened)
        const [chest] = chests.chests
        assert.deepEqual(opened, {})

        chests.open(chest, 0)
        assert.deepEqual(opened[0], chest.coins.map(({ id }) => id))

        const taken = chest.coins[0]
        chests.collect(taken.x, taken.z, LONG_AFTER)
        assert.notInclude(opened[0], taken.id)
        const left = opened[0].length
        assert(left < chest.coins.length)

        const [again] = hoard(opened).chests
        assert.isNotNull(again.openedAt)
        assert.deepEqual(again.coins.map(({ id }) => id), opened[0])
        assert.equal(again.coins.length, left)
        assert.isNull(hoard(opened).closedNear(0, 0))
    })

    it("is empty once every coin of every chest is taken", () => {

        const opened: OpenedChests = {}
        const chests = hoard(opened)
        assert(!chests.empty, "closed")
        for (const chest of chests.chests)
        {
            chests.open(chest, 0)
        }
        assert(!chests.empty, "coins around")
        for (const { coins } of chests.chests)
        {
            for (const { x, z } of coins)
            {
                chests.collect(x, z, LONG_AFTER)
            }
        }
        assert(chests.empty)
        assert(hoard(opened).empty, "after a reload")
        assert(!hoard({}).empty, "after the level started anew")
    })
})
