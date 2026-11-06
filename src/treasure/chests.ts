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
 * How close to a coin in world units a hero has to get to pick it up
 */
export const COIN_REACH = 0.15

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
 * Seconds a picked up coin takes to be gone
 */
export const TAKE_TIME = 0.25

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
 * Share of the flight a coin spends on the way to the floor, the rest being the bounce, and how high it bounces
 */
const FIRST_ARC = 0.75
const BOUNCE_HEIGHT = 0.05

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

export interface Coin
{
    id: number
    /** where it lands */
    x: number
    z: number
    /** seconds after the opening of the chest it starts to fly, and how long for */
    delay: number
    flight: number
    /** direction it lies in, and how many half turns it does in the air */
    yaw: number
    turns: number
    /** when it got picked up, null if not yet */
    takenAt: number | null
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
    /** radians it turned, from lying flat */
    tumble: number
    /** size, as a share of its own */
    size: number
}


/**
 * Returns where the chests of a level stand: in some of the rooms other than the first, which is the way in, in the outer part
 * of the room looking toward its middle.
 *
 * @param rooms     faces of each room of the level
 * @param openings  centers of the faces to stay away from
 * @param centerOf  returns the center of a face in world units
 * @param random    random numbers, for the same level to always have the same chests
 * @param taken     rooms to leave out, with something else in them or out of reach
 */
export function placeChests(
    rooms: readonly (readonly number[])[],
    openings: readonly (readonly number[])[],
    centerOf: (face: number) => readonly number[],
    random: Prando,
    taken: ReadonlySet<number> = new Set()
): ChestSpot[]
{
    const free = rooms.map((_, index) => index).filter(index => index > 0 && !taken.has(index))
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
 * Sets a pose to where a coin is at the given time. Coins of chests not opened yet are still at the chest.
 */
export function coinPose({ x: landX, z: landZ, delay, flight, turns, takenAt }: Coin, { x, z, openedAt }: Chest, time: number, pose: CoinPose): void
{
    const share = Math.max(0, Math.min(1, (time - (openedAt ?? time) - delay) / flight))
    pose.x = x + (landX - x) * share
    pose.z = z + (landZ - z) * share
    pose.tumble = (1 - share) * turns * Math.PI
    pose.size = share > 0 ? 1 : 0
    if (share < FIRST_ARC)
    {
        const arc = share / FIRST_ARC
        pose.y = SPILL_HEIGHT * (1 - arc) + FLIGHT_HEIGHT * 4 * arc * (1 - arc)
    }
    else
    {
        const arc = (share - FIRST_ARC) / (1 - FIRST_ARC)
        pose.y = BOUNCE_HEIGHT * 4 * arc * (1 - arc)
    }
    if (takenAt !== null)
    {
        const taken = Math.min(1, (time - takenAt) / TAKE_TIME)
        pose.y += taken * 0.2
        pose.size = 1 - taken
    }
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
                    takenAt: null
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
     * Pops a chest open, which spills its coins
     */
    open(chest: Chest, time: number): void
    {
        chest.openedAt = time
        this.opened[chest.index] = chest.coins.map(({ id }) => id)
    }

    /**
     * Picks up what has landed around a point
     *
     * @returns the number of coins picked up
     */
    collect(x: number, z: number, time: number): number
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
}
