import type Prando from "prando"
import { rng } from "../math/random"
import { CHASE_TIME, HERO_RADIUS, type Monster, type MonsterKind, MonsterPack, NOTICE_DISTANCE, type Prey } from "./monsters"

const TAU = Math.PI * 2

/**
 * Seconds between looking around
 */
const LOOK_TIME = 0.25

/**
 * How far from a hero an eye wants to be, in world units, the closest it settles for, and how much shorter the way there
 * has to be for a spot closer to them
 */
const PERCH_DISTANCES = [1.3, 1.8, 2.3]
export const MIN_PERCH = 1
const PERCH_ANGLES = 16
const WAY_COST = 0.6

/**
 * How fast an eye gets going and stops, as a share of the difference per second, and how close to a spot it slows down,
 * in world units
 */
const ACCELERATION = 5
const SLOW_DOWN = 0.3

/**
 * How likely an eye with nobody to go after floats somewhere when it looks around, and how far at most in world units
 */
const WANDER_CHANCE = 0.05
const WANDER_LENGTH = 0.6

/**
 * Least and most seconds between shots, while an eye sees someone
 */
export const FIRE_WAIT_MIN = 1.2
export const FIRE_WAIT_MAX = 3.5

/**
 * Seconds an eye shows that it is about to fire
 */
export const WARN_TIME = 0.5

/**
 * Speed of a bolt in world units per second, how far it goes, and half its width
 */
export const BOLT_SPEED = 6
export const BOLT_RANGE = NOTICE_DISTANCE + 2
const BOLT_RADIUS = 0.02

/**
 * Most radians between where a hero looks and where a bolt comes from for the shield to stop it
 */
export const BLOCK_ANGLE = Math.PI * 0.42

/**
 * Speed in world units per second an eye gets knocked back with
 */
const RECOIL_SPEED = 3

/**
 * How fast an eye turns, in radians per second
 */
const TURN_RATE = 6

/**
 * Seconds a spark of a bolt that went out lasts
 */
export const SPARK_TIME = 0.3

/**
 * Share of the rooms with eyes in them
 */
const ROOMS_TAKEN = 0.1

/**
 * Share of the rooms with eyes that have two
 */
const PAIRS = 0.25


export interface EyeKind extends MonsterKind
{
    /** hit points a bolt takes */
    damage: number
    /** fastest it flies in world units per second */
    speed: number
}

export const FLYING_EYE: EyeKind = {
    scale: 1,
    radius: 0.075,
    hp: 4,
    big: false,
    flying: true,
    damage: 1,
    speed: 0.9
}


export interface Eye extends Monster
{
    kind: EyeKind
    /** how fast it flies in world units per second */
    vx: number
    vz: number
    /** where it flies to */
    destX: number
    destZ: number
    /** has somewhere to fly to */
    going: boolean
    /** seconds until it looks around again */
    lookWait: number
    /** who it saw when it last looked around, null for nobody */
    target: Prey | null
    /** seconds until it starts on the next shot while it sees someone */
    fireWait: number
    /** seconds left until it fires, 0 while it doesn't show it is about to */
    warning: number
}

export interface Bolt
{
    x: number
    z: number
    /** where it was the frame before, so it can't fly past anyone */
    lastX: number
    lastZ: number
    /** where it goes, of length 1 */
    dirX: number
    dirZ: number
    /** seconds until it goes out */
    left: number
    damage: number
}

/**
 * Where something went out with a puff of fire
 */
export interface Spark
{
    x: number
    z: number
    /** seconds since */
    age: number
}


/**
 * Returns who goes where in a level: one eye in a few rooms, sometimes two, but not the one the heroes come in by
 *
 * @param rooms     faces of each room of the level
 * @param entrance  index of the room the heroes come in by
 * @param random    random numbers, for the same level to always have the same eyes
 */
export function placeEyes(rooms: readonly (readonly number[])[], entrance: number, random: Prando): { face: number, kind: EyeKind }[]
{
    return rooms.filter((_, index) => index !== entrance).filter(() => random.next() < ROOMS_TAKEN).flatMap(room =>
        Array.from({ length: random.next() < PAIRS ? 2 : 1 }, () => ({
            face: room[random.nextInt(0, room.length - 1)],
            kind: FLYING_EYE
        }))
    )
}

/**
 * Returns the shortest distance between a point and a line segment
 */
function segmentDistance(x: number, z: number, x0: number, z0: number, x1: number, z1: number): number
{
    const dx = x1 - x0, dz = z1 - z0
    const length = dx * dx + dz * dz
    const t = length > 0 ? Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / length)) : 0
    return Math.hypot(x - x0 - dx * t, z - z0 - dz * t)
}

function fireWait(): number
{
    return rng.next(FIRE_WAIT_MIN, FIRE_WAIT_MAX)
}


/**
 * The flying eyes of a level, which keep away from heroes and shoot fire bolts at them
 */
export default class EyePack extends MonsterPack<Eye>
{
    readonly bolts: Bolt[] = []
    readonly sparks: Spark[] = []

    add(kind: EyeKind, face: number, x: number, z: number): Eye
    {
        const eye: Eye = {
            kind,
            hp: kind.hp,
            face,
            x,
            z,
            yaw: rng.next() * TAU,
            flash: 0,
            chase: 0,
            goalX: 0,
            goalZ: 0,
            vx: 0,
            vz: 0,
            destX: x,
            destZ: z,
            going: false,
            lookWait: rng.next() * LOOK_TIME,
            target: null,
            fireWait: fireWait(),
            warning: 0
        }
        this.members.push(eye)
        return eye
    }

    update(delta: number, heroes: readonly Prey[]): void
    {
        this.updateShots(delta)
        for (const eye of this.members)
        {
            eye.flash = Math.max(0, eye.flash - delta)
            eye.chase = Math.max(0, eye.chase - delta)
            eye.lookWait -= delta
            if (eye.lookWait <= 0)
            {
                eye.lookWait = LOOK_TIME
                this.decide(eye, heroes)
            }
            this.aim(eye, delta)
            this.fly(eye, delta)
        }
    }

    /**
     * Bolts hit what they come across, unless the hero is dodging. A shield in about the right direction stops them.
     */
    touch(hero: Prey, open: boolean): number
    {
        let damage = 0
        const { bolts } = this
        for (let i = bolts.length - 1; i >= 0; i--)
        {
            const bolt = bolts[i]
            if (hero.dodging || segmentDistance(hero.x, hero.z, bolt.lastX, bolt.lastZ, bolt.x, bolt.z) >= HERO_RADIUS + BOLT_RADIUS)
            {
                continue
            }
            bolts.splice(i, 1)
            this.sparks.push({ x: bolt.x, z: bolt.z, age: 0 })
            const blocked = hero.blocking && -(bolt.dirX * Math.sin(hero.facing) + bolt.dirZ * Math.cos(hero.facing)) >= Math.cos(BLOCK_ANGLE)
            if (!blocked && open)
            {
                damage = Math.max(damage, bolt.damage)
            }
        }
        return damage
    }

    protected struck(eye: Eye, dx: number, dz: number, distance: number): void
    {
        // a blow puts it off its shot
        eye.warning = 0
        eye.fireWait = fireWait()
        if (distance > 0)
        {
            eye.vx = dx / distance * RECOIL_SPEED
            eye.vz = dz / distance * RECOIL_SPEED
        }
    }

    protected kill(eye: Eye): void
    {
        this.sparks.push({ x: eye.x, z: eye.z, age: 0 })
    }

    private updateShots(delta: number): void
    {
        const { bolts, sparks, floor } = this
        for (let i = sparks.length - 1; i >= 0; i--)
        {
            sparks[i].age += delta
            if (sparks[i].age >= SPARK_TIME)
            {
                sparks.splice(i, 1)
            }
        }
        for (let i = bolts.length - 1; i >= 0; i--)
        {
            const bolt = bolts[i]
            const x = bolt.x + bolt.dirX * BOLT_SPEED * delta, z = bolt.z + bolt.dirZ * BOLT_SPEED * delta
            bolt.left -= delta
            if (!floor.sees(bolt.x, bolt.z, x, z) || bolt.left <= 0)
            {
                bolts.splice(i, 1)
                sparks.push({ x: bolt.x, z: bolt.z, age: 0 })
                continue
            }
            bolt.lastX = bolt.x
            bolt.lastZ = bolt.z
            bolt.x = x
            bolt.z = z
        }
    }

    /**
     * Has an eye look around and decide where to go
     */
    private decide(eye: Eye, heroes: readonly Prey[]): void
    {
        const prey = this.closestSeen(eye, heroes)
        eye.target = prey
        if (prey)
        {
            eye.chase = CHASE_TIME
            eye.goalX = prey.x
            eye.goalZ = prey.z
            if (!eye.going || !this.goodPerch(eye.destX, eye.destZ, prey))
            {
                this.perch(eye, prey)
            }
        }
        else if (eye.chase > 0)
        {
            // where it last saw them, but no closer than it would perch
            const dx = eye.x - eye.goalX, dz = eye.z - eye.goalZ
            const distance = Math.hypot(dx, dz)
            const stay = Math.min(MIN_PERCH, distance)
            eye.destX = eye.goalX + (distance > 0 ? dx / distance * stay : 0)
            eye.destZ = eye.goalZ + (distance > 0 ? dz / distance * stay : 0)
            eye.going = true
        }
        else if (!eye.going && rng.next() < WANDER_CHANCE)
        {
            const angle = rng.next() * TAU, length = rng.next() * WANDER_LENGTH
            const x = eye.x + Math.sin(angle) * length, z = eye.z + Math.cos(angle) * length
            if (this.floor.sees(eye.x, eye.z, x, z))
            {
                eye.destX = x
                eye.destZ = z
                eye.going = true
            }
        }
    }

    /**
     * Returns whether a spot is one to shoot at a hero from
     */
    private goodPerch(x: number, z: number, hero: Prey): boolean
    {
        const distance = Math.hypot(x - hero.x, z - hero.z)
        return distance >= MIN_PERCH && distance < NOTICE_DISTANCE && this.floor.sees(x, z, hero.x, hero.z)
    }

    /**
     * Has an eye go to a spot from where it sees a hero, as far away from them as can be without a long way there. It stays
     * where it is if there is none.
     */
    private perch(eye: Eye, hero: Prey): void
    {
        const { floor } = this
        const start = rng.next() * TAU
        let best = -Infinity
        eye.going = false
        for (const distance of PERCH_DISTANCES)
        {
            for (let i = 0; i < PERCH_ANGLES; i++)
            {
                const angle = start + i * TAU / PERCH_ANGLES
                const x = hero.x + Math.sin(angle) * distance, z = hero.z + Math.cos(angle) * distance
                const way = Math.hypot(x - eye.x, z - eye.z)
                const score = distance - way * WAY_COST
                if (score > best && floor.sees(hero.x, hero.z, x, z) && floor.sees(eye.x, eye.z, x, z))
                {
                    best = score
                    eye.destX = x
                    eye.destZ = z
                    eye.going = true
                }
            }
        }
    }

    /**
     * Has an eye turn toward who it is after and fire at them in time
     */
    private aim(eye: Eye, delta: number): void
    {
        const { target } = eye
        const lookX = eye.chase > 0 ? eye.goalX - eye.x : eye.vx
        const lookZ = eye.chase > 0 ? eye.goalZ - eye.z : eye.vz
        if (target)
        {
            eye.goalX = target.x
            eye.goalZ = target.z
        }
        if (Math.hypot(lookX, lookZ) > 1e-3)
        {
            const turn = Math.atan2(lookX, lookZ) - eye.yaw
            eye.yaw += Math.max(-TURN_RATE * delta, Math.min(TURN_RATE * delta, Math.atan2(Math.sin(turn), Math.cos(turn))))
        }

        if (eye.warning > 0)
        {
            eye.warning -= delta
            if (eye.warning <= 0)
            {
                eye.warning = 0
                eye.fireWait = fireWait()
                if (target && this.floor.sees(eye.x, eye.z, target.x, target.z))
                {
                    this.fire(eye, target)
                }
            }
        }
        else if (target)
        {
            eye.fireWait -= delta
            if (eye.fireWait <= 0)
            {
                eye.warning = WARN_TIME
            }
        }
    }

    private fire(eye: Eye, target: Prey): void
    {
        const dx = target.x - eye.x, dz = target.z - eye.z
        const distance = Math.hypot(dx, dz)
        if (distance === 0)
        {
            return
        }
        const dirX = dx / distance, dirZ = dz / distance
        const x = eye.x + dirX * eye.kind.radius, z = eye.z + dirZ * eye.kind.radius
        this.bolts.push({ x, z, lastX: eye.x, lastZ: eye.z, dirX, dirZ, left: BOLT_RANGE / BOLT_SPEED, damage: eye.kind.damage })
    }

    /**
     * Has an eye glide to where it is going, holding still while it is about to fire
     */
    private fly(eye: Eye, delta: number): void
    {
        let wantX = 0, wantZ = 0
        if (eye.going && eye.warning === 0)
        {
            const dx = eye.destX - eye.x, dz = eye.destZ - eye.z
            const distance = Math.hypot(dx, dz)
            if (distance < 0.02)
            {
                eye.going = false
            }
            else
            {
                const speed = eye.kind.speed * Math.min(1, distance / SLOW_DOWN)
                wantX = dx / distance * speed
                wantZ = dz / distance * speed
            }
        }
        const share = Math.min(1, ACCELERATION * delta)
        eye.vx += (wantX - eye.vx) * share
        eye.vz += (wantZ - eye.vz) * share
        const { x, z } = eye
        this.floor.move(eye, eye.vx * delta, eye.vz * delta)
        // up against a wall, it thinks again
        const speed = Math.hypot(eye.vx, eye.vz)
        if (eye.going && speed > SLOW_DOWN && Math.hypot(eye.x - x, eye.z - z) < speed * delta * 0.5)
        {
            eye.going = false
        }
    }
}
