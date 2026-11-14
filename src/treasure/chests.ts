import Prando from "prando"

import { type FixtureSpot, outerSpot } from "../map/fixtures"

const TAU = Math.PI * 2

/**
 * Half of the width and of the depth of a chest in world units
 */
export const CHEST_HALF_WIDTH = 0.16
export const CHEST_HALF_DEPTH = 0.16

/**
 * How close to a chest in world units a hero has to be to open it, from its middle
 */
export const CHEST_REACH = 0.5

/**
 * How close to a coin in world units a hero has to get for it to come to them
 */
export const COIN_REACH = 0.3

/**
 * Gold a coin is worth
 */
export const COIN_VALUE = 10

/**
 * Coins in a chest
 */
export const MIN_COINS = 6
export const MAX_COINS = 14

/**
 * Seconds a lid takes to pop open
 */
export const LID_TIME = 0.3

/**
 * Seconds a picked up coin takes to get to the hero
 */
export const TAKE_TIME = 0.3

/**
 * Height in world units of the middle of the bubble a coin floats in, once it is out of the chest
 */
export const HOVER_HEIGHT = 0.17

/**
 * Height in world units a coin goes to on a hero, about their middle
 */
const TAKEN_HEIGHT = 0.2

/**
 * How far in world units a floating coin bobs up and down, and how fast, in radians per second
 */
const BOB = 0.012
const BOB_RATE = 2.2

/**
 * How fast a floating coin turns around, in radians per second
 */
const SPIN_RATE = 0.8

/**
 * Share of the way to the hero at which a coin starts to shrink away
 */
const SHRINK_FROM = 0.7

/**
 * Share of the rooms other than the first with a chest. There is at least one in any level with a room to spare.
 */
const ROOMS_TAKEN = 0.15

/**
 * How high the chest lets go of the coins and how high they fly, in world units
 */
const SPILL_HEIGHT = 0.1
const FLIGHT_HEIGHT = 0.3

/**
 * Seconds until the first coin comes out and between coins
 */
const SPILL_START = LID_TIME * 0.5
const SPILL_INTERVAL = 0.035

/**
 * Seconds a coin is in the air
 */
const MIN_FLIGHT = 0.5
const MAX_FLIGHT = 0.75

/**
 * How far a coin wants to get in world units, and how far off the front of the chest it may go, in radians to each side
 */
const MIN_SPILL = 0.15
const MAX_SPILL = 0.65
const SPILL_ANGLE = 1.4

/**
 * Where a coin goes in front of a chest, in world units. Sets it down where the walls leave room, which is where a hero can
 * get to, and returns where that is.
 */
export type CoinLanding = (chest: ChestSpot, dx: number, dz: number) => [number, number]

/**
 * For each opened chest of a level by its index, which of its coins are still on the floor. Plain JSON, for the saves. Chests
 * not in there are closed.
 */
export type OpenedChests = Record<number, number[]>

/**
 * Where a chest stands
 */
export type ChestSpot = FixtureSpot

/**
 * A coin in a chest, which flies out when it opens, floats in a bubble and goes to whoever picks it up
 */
export interface Coin
{
    id: number
    /** where it lands */
    x: number
    z: number
    /** seconds after the opening of the chest it starts to fly, and how long for */
    delay: number
    flight: number
    /** direction it faces, and how many half turns it does in the air */
    yaw: number
    turns: number
    /** when it got picked up, null if not yet */
    takenAt: number | null
    /** id of the hero who picked it up, null if nobody did */
    takenBy: number | null
    /** got to the hero who picked it up */
    arrived: boolean
}

export interface Chest extends ChestSpot
{
    index: number
    /** when it got opened, null if it is closed */
    openedAt: number | null
    coins: Coin[]
}

/**
 * Where a coin is at some time
 */
export interface CoinPose
{
    x: number
    /** height above the floor */
    y: number
    z: number
    /** radians it turned forward, from standing up */
    tumble: number
    /** radians it turned around the up axis */
    spin: number
    /** size, as a share of its own, for it and its bubble */
    size: number
}


/**
 * Returns where the chests of a level stand: in some of the rooms that aren't taken, in the outer part of the room looking
 * toward its middle.
 *
 * @param rooms     faces of each room of the level
 * @param openings  centers of the faces to stay away from
 * @param centerOf  returns the center of a face in world units
 * @param random    random numbers, for the same level to always have the same chests
 * @param taken     rooms to leave out, like the way in, those with something else in them and those out of reach
 */
export function placeChests(
    rooms: readonly (readonly number[])[],
    openings: readonly (readonly number[])[],
    centerOf: (face: number) => readonly number[],
    random: Prando,
    taken: ReadonlySet<number> = new Set()
): ChestSpot[]
{
    const free = rooms.map((_, index) => index).filter(index => !taken.has(index))
    const sure = free.length > 0 ? free[random.nextInt(0, free.length - 1)] : -1
    return free.flatMap(index => {
        if (index !== sure && random.next() >= ROOMS_TAKEN)
        {
            return []
        }
        const spot = outerSpot(rooms[index], openings, centerOf, random)
        return spot ? [spot] : []
    })
}


/**
 * Sets a pose to where a coin is at the given time: it flies out of the chest in its bubble, floats where it landed, and
 * once picked up goes to the hero. Coins of chests not opened yet are still at the chest.
 *
 * @param hero  where the hero who picked it up is, it stays where it was without
 */
export function coinPose(coin: Coin, chest: Chest, time: number, pose: CoinPose, hero?: { x: number, z: number }): void
{
    const { takenAt } = coin
    floatingPose(coin, chest, takenAt === null ? time : Math.min(time, takenAt), pose)
    if (takenAt !== null && hero)
    {
        const share = Math.min(1, Math.max(0, time - takenAt) / TAKE_TIME)
        // speeds up toward the hero
        const pull = share * share
        pose.x += (hero.x - pose.x) * pull
        pose.z += (hero.z - pose.z) * pull
        pose.y += (TAKEN_HEIGHT - pose.y) * pull
        pose.spin += share * Math.PI
        pose.size *= share < SHRINK_FROM ? 1 : 1 - (share - SHRINK_FROM) / (1 - SHRINK_FROM)
    }
}


function floatingPose({ id, x: landX, z: landZ, delay, flight, yaw, turns }: Coin, { x, z, openedAt }: Chest, time: number, pose: CoinPose): void
{
    const since = time - (openedAt ?? time) - delay
    const share = Math.max(0, Math.min(1, since / flight))
    pose.x = x + (landX - x) * share
    pose.z = z + (landZ - z) * share
    pose.tumble = (1 - share) * turns * Math.PI
    // grows as it comes out of the chest
    pose.size = Math.min(1, share * 4)
    pose.spin = yaw + Math.max(0, since) * SPIN_RATE
    // eases in at the end, so the bob goes on from the flight without a jump
    const bob = BOB * Math.sin(Math.max(0, since - flight) * BOB_RATE + id) * share
    pose.y = SPILL_HEIGHT * (1 - share) + HOVER_HEIGHT * share + FLIGHT_HEIGHT * 4 * share * (1 - share) + bob
}


/**
 * The chests of a level with their coins. Plain state without the scene, which shows them and tells where coins can land.
 */
export default class ChestHoard
{
    readonly chests: Chest[]

    /**
     * @param spots     where the chests stand
     * @param seed      seed of the level
     * @param land      where the coins go
     * @param opened    what happened to the chests before, gets changed along with them
     */
    constructor(spots: readonly ChestSpot[], seed: number, land: CoinLanding, private readonly opened: OpenedChests)
    {
        const random = new Prando(seed)
        this.chests = spots.map((spot, index) => {
            const left = opened[index]
            const chest: Chest = {
                ...spot,
                index,
                // a long time ago, for all there is to be settled
                openedAt: left ? -Infinity : null,
                coins: []
            }
            const count = random.nextInt(MIN_COINS, MAX_COINS)
            for (let id = 0; id < count; id++)
            {
                const angle = spot.facing + random.next(-SPILL_ANGLE, SPILL_ANGLE)
                const reach = random.next(MIN_SPILL, MAX_SPILL)
                const [x, z] = land(spot, Math.sin(angle) * reach, Math.cos(angle) * reach)
                const coin: Coin = {
                    id,
                    x,
                    z,
                    delay: SPILL_START + id * SPILL_INTERVAL,
                    flight: random.next(MIN_FLIGHT, MAX_FLIGHT),
                    yaw: random.next(0, TAU),
                    turns: random.nextInt(2, 4) * 2,
                    takenAt: null,
                    takenBy: null,
                    arrived: false
                }
                if (!left || left.includes(id))
                {
                    chest.coins.push(coin)
                }
            }
            return chest
        })
    }

    /**
     * Returns the closed chest closest to a point within reach, if any
     */
    closedNear(x: number, z: number): Chest | null
    {
        let closest: Chest | null = null
        let shortest = CHEST_REACH
        for (const chest of this.chests)
        {
            const distance = Math.hypot(chest.x - x, chest.z - z)
            if (chest.openedAt === null && distance <= shortest)
            {
                closest = chest
                shortest = distance
            }
        }
        return closest
    }

    /**
     * Returns whether there is nothing left to get, with all chests open and all coins picked up
     */
    get empty(): boolean
    {
        return this.chests.every(({ openedAt, coins }) => openedAt !== null && coins.every(({ takenAt }) => takenAt !== null))
    }

    /**
     * Pops a chest open, which spills its coins
     */
    open(chest: Chest, time: number): void
    {
        chest.openedAt = time
        this.opened[chest.index] = chest.coins.map(({ id }) => id)
    }

    /**
     * Picks up what has landed around a hero, which then goes to them
     *
     * @param hero  id of the hero
     * @returns the number of coins picked up
     */
    collect(x: number, z: number, time: number, hero = 0): number
    {
        let taken = 0
        for (const chest of this.chests)
        {
            if (chest.openedAt === null)
            {
                continue
            }
            let changed = false
            for (const coin of chest.coins)
            {
                if (
                    coin.takenAt === null &&
                    time >= chest.openedAt + coin.delay + coin.flight &&
                    Math.hypot(coin.x - x, coin.z - z) <= COIN_REACH
                )
                {
                    coin.takenAt = time
                    coin.takenBy = hero
                    taken++
                    changed = true
                }
            }
            if (changed)
            {
                this.opened[chest.index] = chest.coins.filter(({ takenAt }) => takenAt === null).map(({ id }) => id)
            }
        }
        return taken
    }

    /**
     * Returns the coins that got to the heroes who picked them up since the last time
     */
    arrive(time: number): Coin[]
    {
        const arrived: Coin[] = []
        for (const { coins } of this.chests)
        {
            for (const coin of coins)
            {
                if (!coin.arrived && coin.takenAt !== null && time >= coin.takenAt + TAKE_TIME)
                {
                    coin.arrived = true
                    arrived.push(coin)
                }
            }
        }
        return arrived
    }
}

