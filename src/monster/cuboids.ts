import type Prando from "prando"
import type { FloorSpot } from "../map/dungeonWays"
import { rng } from "../math/random"

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
 * Seconds after doing damage to someone in which no cuboid can do so again
 */
export const HURT_WAIT = 1

/**
 * Room a hero takes up in world units
 */
export const HERO_RADIUS = 0.09

/**
 * How far a cuboid notices a hero in world units, for how many seconds it goes on after losing sight of them, and the seconds
 * between looking around when it has nobody to go after
 */
export const NOTICE_DISTANCE = 3
export const CHASE_TIME = 3
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
 * How many seconds a cuboid that got hit shows it
 */
const FLASH_TIME = 0.12


export interface CuboidKind
{
    /** size of the model as a multiple of how it was made */
    scale: number
    /** half its width in world units, half the width of the model at the meeple scale of 0.3 */
    radius: number
    hp: number
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

export const BIG_CUBOID: CuboidKind = {
    scale: 1,
    radius: 0.144,
    hp: 8,
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
    damage: 1,
    hopLength: 0.3,
    hopTime: 0.32,
    hopHeight: 0.06,
    blockable: true,
    splits: false,
    lunges: false
}


export interface Cuboid extends FloorSpot
{
    kind: CuboidKind
    hp: number
    /** which way the model is turned, in radians */
    yaw: number

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

    /** seconds it goes on going after someone, 0 with nobody to go after */
    chase: number
    /** where it last saw them */
    goalX: number
    goalZ: number
    /** seconds until it looks around again */
    lookWait: number

    /** seconds left of showing a hit */
    flash: number
}

/**
 * Hero as cuboids see them, with the position in world units
 */
export interface CuboidPrey
{
    x: number
    z: number
    /** where they look, as a meeple facing */
    facing: number
    blocking: boolean
    /** can't be hurt right now, e.g. while dashing */
    dodging: boolean
    /** seconds until cuboids can hurt them again */
    hurtWait: number
}

/**
 * What cuboids need to know about the level
 */
export interface CuboidFloor
{
    /**
     * Moves a cuboid by the given distance in world units, as far as the walls let it
     */
    move(cuboid: Cuboid, dx: number, dz: number): void

    /**
     * Returns whether there is no wall between two points
     */
    sees(x0: number, z0: number, x1: number, z1: number): boolean
}


/**
 * Returns who goes where in a level: one big cuboid or a few small ones in some of the rooms, but not the first, which the heroes
 * come in by
 *
 * @param rooms     faces of each room of the level
 * @param random    random numbers, for the same level to always have the same cuboids
 */
export function placeCuboids(rooms: readonly (readonly number[])[], random: Prando): { face: number, kind: CuboidKind }[]
{
    return rooms.slice(1).filter(() => random.next() < ROOMS_TAKEN).flatMap(room => {
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
 * The acid cuboids of a level. Plain state without the scene, which shows them and tells what the walls allow.
 */
export default class CuboidPack
{
    readonly cuboids: Cuboid[] = []

    constructor(private readonly floor: CuboidFloor)
    {
    }

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
        this.cuboids.push(cuboid)
        return cuboid
    }

    /**
     * Moves on by a frame
     *
     * @param delta     seconds since the last call
     * @param heroes    everyone in the level
     */
    update(delta: number, heroes: readonly CuboidPrey[]): void
    {
        for (const cuboid of this.cuboids)
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
        this.keepApart()
    }

    /**
     * Has what touches a hero hurt them, unless they got hurt just before or their shield stops it. It doesn't matter if what
     * touches them now is what did it before, so someone staying in touch gets hurt over and over.
     *
     * @param hero      hero to look at
     * @param delta     seconds since the last call
     *
     * @return hit points the hero loses now
     */
    hurt(hero: CuboidPrey, delta: number): number
    {
        hero.hurtWait = Math.max(0, hero.hurtWait - delta)
        let damage = 0
        for (const cuboid of this.cuboids)
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
            else if (hero.hurtWait === 0 && !hero.dodging)
            {
                damage = Math.max(damage, kind.damage)
            }
        }
        if (damage > 0)
        {
            hero.hurtWait = HURT_WAIT
        }
        return damage
    }

    /**
     * Has a sword go through all cuboids within its arc
     *
     * @param x         where the one with the sword is, in world units
     * @param z         where the one with the sword is, in world units
     * @param facing    where they look, as a meeple facing
     * @param reach     how far the arc goes in world units
     * @param width     width of the arc in radians
     * @param damage    hit points it takes
     *
     * @return number of cuboids hit
     */
    strike(x: number, z: number, facing: number, reach: number, width: number, damage: number): number
    {
        let hits = 0
        for (const cuboid of [...this.cuboids])
        {
            const dx = cuboid.x - x, dz = cuboid.z - z
            const distance = Math.hypot(dx, dz)
            const turn = Math.atan2(dx, dz) - facing
            const inArc = Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) <= width / 2
            // right on top of the hero, the direction means little
            const within = distance < cuboid.kind.radius + HERO_RADIUS || inArc && distance <= reach + cuboid.kind.radius
            if (within && this.floor.sees(x, z, cuboid.x, cuboid.z))
            {
                hits++
                cuboid.hp -= damage
                if (cuboid.hp <= 0)
                {
                    // right on top of the hero, they go where the blow goes
                    const away = distance > 1e-6 ? Math.atan2(dx, dz) : facing
                    this.kill(cuboid, away)
                }
                else
                {
                    cuboid.flash = FLASH_TIME
                    cuboid.windup = 0
                    this.recoil(cuboid, dx, dz, distance)
                    cuboid.chase = CHASE_TIME
                    cuboid.goalX = x
                    cuboid.goalZ = z
                }
            }
        }
        return hits
    }

    /**
     * Returns whether any cuboid can see a hero right now, whether it has got around to noticing them or not
     */
    sees(hero: CuboidPrey): boolean
    {
        return this.cuboids.some(cuboid => this.closestSeen(cuboid, [hero]) !== null)
    }

    /**
     * @param away  direction of the blow as a meeple facing, which the cuboids coming out of a big one carry on in
     */
    private kill(cuboid: Cuboid, away: number): void
    {
        this.cuboids.splice(this.cuboids.indexOf(cuboid), 1)
        if (cuboid.kind.splits)
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
        }
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
    private decide(cuboid: Cuboid, delta: number, heroes: readonly CuboidPrey[]): void
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

    private closestSeen({ x, z }: Cuboid, heroes: readonly CuboidPrey[]): CuboidPrey | null
    {
        let closest: CuboidPrey | null = null
        let shortest = NOTICE_DISTANCE
        for (const hero of heroes)
        {
            const distance = Math.hypot(hero.x - x, hero.z - z)
            if (distance < shortest && this.floor.sees(x, z, hero.x, hero.z))
            {
                closest = hero
                shortest = distance
            }
        }
        return closest
    }

    /**
     * Pushes cuboids out of each other, which would otherwise all end up in one spot on their way to the same hero
     */
    private keepApart(): void
    {
        const { cuboids, floor } = this
        for (let i = 0; i < cuboids.length; i++)
        {
            const a = cuboids[i]
            for (let j = i + 1; j < cuboids.length; j++)
            {
                const b = cuboids[j]
                const dx = b.x - a.x, dz = b.z - a.z
                const room = a.kind.radius + b.kind.radius
                const distance = Math.hypot(dx, dz)
                if (distance > 0 && distance < room)
                {
                    const push = (room - distance) / 2 / distance
                    floor.move(a, -dx * push, -dz * push)
                    floor.move(b, dx * push, dz * push)
                }
            }
        }
    }
}
