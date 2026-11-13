import type Prando from "prando"
import { rng } from "../math/random"
import type { BurstSphere } from "./bursts"
import { CHASE_TIME, HERO_RADIUS, type Monster, type MonsterKind, MonsterPack, type Prey } from "./monsters"

const TAU = Math.PI * 2

/**
 * How long a lunge takes to get going, in seconds, for those close to see it coming
 */
export const LUNGE_WINDUP = 0.25

/**
 * How far a lunge goes as a multiple of a hop, how long it takes as a multiple of a hop, how high it goes in world units,
 * and the seconds until the next one
 */
export const LUNGE_LENGTH = 1.5
const LUNGE_TIME = 0.6
const LUNGE_HEIGHT = 0.22
export const LUNGE_WAIT = 3

/**
 * Seconds between looking around for a cuboid with nobody to go after
 */
const LOOK_TIME = 0.25

/**
 * How likely a cuboid with nobody to go after hops somewhere when it looks around, and how far as a share of a hop
 */
const WANDER_CHANCE = 0.1
const WANDER_LENGTH = 0.5

/**
 * Share of the rooms with cuboids in them, as levels have a lot of rooms
 */
const ROOMS_TAKEN = 0.3

/**
 * How close a cuboid comes to who it goes after, as a share of the distance where they touch, so that they stay in touch without
 * one hiding the other
 */
const CLOSE_IN = 0.9

/**
 * How far and how long a cuboid hops away when hit or blocked, in world units and seconds
 */
const RECOIL_LENGTH = 0.3
const RECOIL_TIME = 0.25

/**
 * How far cuboids coming out of a big one get, in world units, and how many there are at most and at least
 */
const SPLIT_LENGTH = 0.4
const SPLIT_TIME = 0.3
export const MIN_SPLIT = 2
export const MAX_SPLIT = 7

/**
 * Width in radians of the fan the cuboids coming out of a big one hop in, which goes away from whoever struck it, as they
 * carry on with the blow and don't land on them
 */
export const SPLIT_SPREAD = 2.4


/**
 * Kind of cuboid, with a radius of half the width of the model at the meeple scale of 0.3
 */
export interface CuboidKind extends MonsterKind
{
    /** hit points it takes from someone it touches */
    damage: number
    /** how far a hop goes in world units */
    hopLength: number
    /** seconds a hop takes */
    hopTime: number
    /** how high a hop goes in world units */
    hopHeight: number
    /** a shield stops it */
    blockable: boolean
    /** comes down as small ones instead of just dying */
    splits: boolean
    lunges: boolean
}

/**
 * Volume of a cuboid of any size
 */
const CUBOID_BURST: readonly BurstSphere[] = [{ x: 0, y: 0.48, z: 0, rx: 0.48, ry: 0.48, rz: 0.48, colors: ["#24c550"] }]

export const BIG_CUBOID: CuboidKind = {
    scale: 1,
    radius: 0.144,
    hp: 8,
    big: true,
    flying: false,
    // all of it only when smitten, as it breaks up into small ones otherwise
    burst: CUBOID_BURST,
    damage: 3,
    hopLength: 0.38,
    hopTime: 0.5,
    hopHeight: 0.1,
    blockable: false,
    splits: true,
    lunges: true
}

export const SMALL_CUBOID: CuboidKind = {
    scale: 0.5,
    radius: 0.072,
    hp: 2,
    big: false,
    flying: false,
    burst: CUBOID_BURST,
    damage: 1,
    hopLength: 0.3,
    hopTime: 0.32,
    hopHeight: 0.06,
    blockable: true,
    splits: false,
    lunges: false
}


/**
 * Returns the share of the volume of a cuboid each small one it breaks up into takes along, an eighth for a big one
 */
export function splitShare(kind: CuboidKind): number
{
    return (SMALL_CUBOID.scale / kind.scale) ** 3
}


export interface Cuboid extends Monster
{
    kind: CuboidKind

    /** how fast the current hop goes in world units per second */
    hopX: number
    hopZ: number
    /** seconds the current hop takes and has left, 0 left between hops */
    hopTime: number
    hopLeft: number
    /** height the current hop goes to in world units */
    hopHeight: number
    /** the current hop is one away from something */
    recoiling: boolean

    /** seconds left until the lunge goes off, 0 without one coming */
    windup: number
    /** where the lunge goes */
    lungeX: number
    lungeZ: number
    /** seconds until it can lunge again */
    lungeWait: number

    /** seconds until it looks around again */
    lookWait: number
}


/**
 * Returns who goes where in a level: one big cuboid or a few small ones in some of the rooms, but not the one the heroes come in by
 *
 * @param rooms     faces of each room of the level
 * @param entrance  index of the room the heroes come in by
 * @param random    random numbers, for the same level to always have the same cuboids
 */
export function placeCuboids(rooms: readonly (readonly number[])[], entrance: number, random: Prando): { face: number, kind: CuboidKind }[]
{
    return rooms.filter((_, index) => index !== entrance).filter(() => random.next() < ROOMS_TAKEN).flatMap(room => {
        const big = random.next() < 0.5
        return Array.from({ length: big ? 1 : random.nextInt(1, 3) }, () => ({
            face: room[random.nextInt(0, room.length - 1)],
            kind: big ? BIG_CUBOID : SMALL_CUBOID
        }))
    })
}

/**
 * Returns how many cuboids can come out of the ones given, for a level to know how many to prepare for
 */
export function mostCuboids(kinds: readonly CuboidKind[]): number
{
    return kinds.reduce((sum, { splits }) => sum + (splits ? MAX_SPLIT : 1), 0)
}


/**
 * Returns how much of a hop is done, 0 between hops
 */
export function hopShare({ hopTime, hopLeft }: Cuboid): number
{
    return hopLeft > 0 ? 1 - hopLeft / hopTime : 0
}


/**
 * The acid cuboids of a level
 */
export default class CuboidPack extends MonsterPack<Cuboid>
{
    add(kind: CuboidKind, face: number, x: number, z: number): Cuboid
    {
        const cuboid: Cuboid = {
            kind,
            hp: kind.hp,
            face,
            x,
            z,
            yaw: rng.next() * TAU,
            hopX: 0,
            hopZ: 0,
            hopTime: 0,
            hopLeft: 0,
            hopHeight: 0,
            recoiling: false,
            windup: 0,
            lungeX: 0,
            lungeZ: 0,
            lungeWait: 0,
            chase: 0,
            goalX: 0,
            goalZ: 0,
            lookWait: rng.next() * LOOK_TIME,
            flash: 0
        }
        this.members.push(cuboid)
        return cuboid
    }

    update(delta: number, heroes: readonly Prey[]): void
    {
        for (const cuboid of this.members)
        {
            cuboid.flash = Math.max(0, cuboid.flash - delta)
            cuboid.lungeWait = Math.max(0, cuboid.lungeWait - delta)
            cuboid.chase = Math.max(0, cuboid.chase - delta)

            if (cuboid.windup > 0)
            {
                cuboid.windup -= delta
                if (cuboid.windup <= 0)
                {
                    const { hopLength, hopTime } = cuboid.kind
                    cuboid.windup = 0
                    cuboid.lungeWait = LUNGE_WAIT
                    this.hop(cuboid, cuboid.lungeX, cuboid.lungeZ, hopLength * LUNGE_LENGTH, hopTime * LUNGE_TIME, LUNGE_HEIGHT)
                }
            }
            else if (cuboid.hopLeft > 0)
            {
                const step = Math.min(delta, cuboid.hopLeft)
                this.floor.move(cuboid, cuboid.hopX * step, cuboid.hopZ * step)
                cuboid.hopLeft -= step
                cuboid.recoiling &&= cuboid.hopLeft > 0
            }
            else
            {
                this.decide(cuboid, delta, heroes)
            }
        }
    }

    /**
     * Touching hurts, and a shield sends small ones back
     */
    touch(hero: Prey, open: boolean): number
    {
        let damage = 0
        for (const cuboid of this.members)
        {
            const { kind, x, z } = cuboid
            const dx = x - hero.x, dz = z - hero.z
            const distance = Math.hypot(dx, dz)
            if (distance >= kind.radius + HERO_RADIUS || !this.floor.sees(hero.x, hero.z, x, z))
            {
                continue
            }
            if (kind.blockable && hero.blocking && dx * Math.sin(hero.facing) + dz * Math.cos(hero.facing) > 0)
            {
                if (!cuboid.recoiling)
                {
                    this.recoil(cuboid, dx, dz, distance)
                }
            }
            else if (open)
            {
                damage = Math.max(damage, kind.damage)
            }
        }
        return damage
    }

    protected struck(cuboid: Cuboid, dx: number, dz: number, distance: number): void
    {
        cuboid.windup = 0
        this.recoil(cuboid, dx, dz, distance)
    }

    /**
     * @param away  direction of the blow as a meeple facing, which the cuboids coming out of a big one carry on in
     *
     * @return share of the volume of a big one that doesn't go into the small ones
     */
    protected kill(cuboid: Cuboid, away: number, smite: boolean): number
    {
        if (cuboid.kind.splits && !smite)
        {
            const { face, x, z, chase, goalX, goalZ } = cuboid
            const count = rng.nextInt(MIN_SPLIT, MAX_SPLIT)
            const gap = SPLIT_SPREAD / count
            const start = away - SPLIT_SPREAD / 2 + gap * rng.next(0.25, 0.75)
            for (let i = 0; i < count; i++)
            {
                const small = this.add(SMALL_CUBOID, face, x, z)
                const angle = start + i * gap
                this.hop(small, Math.sin(angle), Math.cos(angle), SPLIT_LENGTH, SPLIT_TIME, SMALL_CUBOID.hopHeight * 2)
                small.chase = chase
                small.goalX = goalX
                small.goalZ = goalZ
            }
            return 1 - count * splitShare(cuboid.kind)
        }
        return 1
    }

    /**
     * Sets a cuboid off in a direction, of length 1
     */
    private hop(cuboid: Cuboid, dirX: number, dirZ: number, length: number, time: number, height: number): void
    {
        cuboid.hopX = dirX * length / time
        cuboid.hopZ = dirZ * length / time
        cuboid.hopTime = cuboid.hopLeft = time
        cuboid.hopHeight = height
    }

    private recoil(cuboid: Cuboid, dx: number, dz: number, distance: number): void
    {
        // from right on top of something any way out will do
        const angle = distance > 0 ? 0 : rng.next() * TAU
        const dirX = distance > 0 ? dx / distance : Math.sin(angle), dirZ = distance > 0 ? dz / distance : Math.cos(angle)
        this.hop(cuboid, dirX, dirZ, RECOIL_LENGTH, RECOIL_TIME, cuboid.kind.hopHeight)
        cuboid.recoiling = true
    }

    /**
     * Has a cuboid between hops decide on the next one
     */
    private decide(cuboid: Cuboid, delta: number, heroes: readonly Prey[]): void
    {
        cuboid.lookWait -= delta
        if (cuboid.chase === 0 && cuboid.lookWait > 0)
        {
            return
        }
        cuboid.lookWait = LOOK_TIME

        const { kind, x, z } = cuboid
        const prey = this.closestSeen(cuboid, heroes)
        if (prey)
        {
            cuboid.chase = CHASE_TIME
            cuboid.goalX = prey.x
            cuboid.goalZ = prey.z
        }
        if (cuboid.chase > 0)
        {
            const dx = cuboid.goalX - x, dz = cuboid.goalZ - z
            const distance = Math.hypot(dx, dz)
            const touching = kind.radius + HERO_RADIUS
            if (prey && kind.lunges && cuboid.lungeWait === 0 && distance > touching && distance <= kind.hopLength * LUNGE_LENGTH + touching)
            {
                cuboid.windup = LUNGE_WINDUP
                cuboid.lungeX = dx / distance
                cuboid.lungeZ = dz / distance
            }
            else if (distance > touching * CLOSE_IN)
            {
                this.hop(cuboid, dx / distance, dz / distance, Math.min(kind.hopLength, distance - touching * CLOSE_IN), kind.hopTime, kind.hopHeight)
            }
        }
        else if (rng.next() < WANDER_CHANCE)
        {
            const angle = rng.next() * TAU
            this.hop(cuboid, Math.sin(angle), Math.cos(angle), kind.hopLength * WANDER_LENGTH, kind.hopTime, kind.hopHeight)
        }
    }
}
