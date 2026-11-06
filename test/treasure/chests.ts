import Prando from "prando"
import { assert, describe, it } from "vitest"

import ChestHoard, {
    CHEST_REACH,
    type ChestSpot,
    COIN_REACH,
    coinPose,
    type CoinPose,
    MAX_COINS,
    MIN_COINS,
    type OpenedChests,
    placeChests
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

    it("puts a chest into a level even with little luck, never into the first room", () => {

        const rooms = [[0, 1], [10, 11, 12], [20, 21, 22]]
        for (let seed = 0; seed < 50; seed++)
        {
            const spots = placeChests(rooms, [], inRow, new Prando(seed))
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
            for (const { face } of placeChests([[0], [10, 11, 12, 13, 14, 15]], [inRow(9)], inRow, new Prando(seed)))
            {
                assert(face >= 11)
            }
        }
    })

    it("leaves out rooms that are taken", () => {

        for (let seed = 0; seed < 50; seed++)
        {
            const spots = placeChests([[0], [10, 11, 12], [20, 21, 22]], [], inRow, new Prando(seed), new Set([1]))
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
        assert(coins.length >= MIN_COINS && coins.length <= MAX_COINS)
        assert.deepEqual(coins, hoard().chests[0].coins)
    })

    it("has chests with different numbers of coins", () => {

        const spots = Array.from({ length: 20 }, () => SPOT)
        const { chests } = new ChestHoard(spots, 1, ({ x, z }, dx, dz) => [x + dx, z + dz], {})
        assert(new Set(chests.map(({ coins }) => coins.length)).size > 2)
    })

    it("lets coins fly out of the chest and land where they are meant to", () => {

        const chests = hoard()
        const [chest] = chests.chests
        const [coin] = chest.coins
        chests.open(chest, 10)
        const pose: CoinPose = { x: 0, y: 0, z: 0, tumble: 0, size: 0 }

        coinPose(coin, chest, 10, pose)
        assert.equal(pose.size, 0)

        coinPose(coin, chest, 10 + coin.delay + coin.flight / 3, pose)
        assert.equal(pose.size, 1)
        assert(pose.y > 0)
        assert(Math.hypot(pose.x, pose.z) < Math.hypot(coin.x, coin.z))

        coinPose(coin, chest, 10 + LONG_AFTER, pose)
        assert.closeTo(pose.x, coin.x, 1e-9)
        assert.closeTo(pose.z, coin.z, 1e-9)
        assert.closeTo(pose.y, 0, 1e-9)
        assert.closeTo(pose.tumble, 0, 1e-9)
    })

    it("picks up coins only once they have landed, and only once", () => {

        const chests = hoard()
        const [chest] = chests.chests
        const [coin] = chest.coins

        assert.equal(chests.collect(coin.x, coin.z, LONG_AFTER), 0, "closed")
        chests.open(chest, 0)
        assert.equal(chests.collect(coin.x, coin.z, coin.delay / 2), 0, "in the air")
        assert.isAtLeast(chests.collect(coin.x, coin.z, LONG_AFTER), 1)
        assert.isNotNull(coin.takenAt)
        assert.equal(chests.collect(coin.x, coin.z, LONG_AFTER), 0, "gone")
        assert.equal(chests.collect(coin.x + COIN_REACH * 100, coin.z, LONG_AFTER), 0, "too far")
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
})
