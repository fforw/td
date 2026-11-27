import type { FloorSpot } from "../map/dungeonWays"
import { rng } from "../math/random"
import { FIGURE_SCALE } from "../meeple/figureScale"
import type { BurstSphere, Death } from "./bursts"
import { type Body, bump, fadeShove, HERO_MASS } from "./shove"

/**
 * Seconds after a monster did damage to someone in which no monster can do so again
 */
export const HURT_WAIT = 1

/**
 * Room a hero takes up in world units
 */
export const HERO_RADIUS = 0.09 * FIGURE_SCALE

/**
 * How far a monster notices a hero in world units, and for how many seconds it goes on after losing sight of them
 */
export const NOTICE_DISTANCE = 3 * FIGURE_SCALE

/**
 * How close a hero threatens a monster, in world units beyond its radius, a bit beyond the reach of a sword, and how far
 * off facing it in radians
 */
export const THREAT_RANGE = 0.9 * FIGURE_SCALE
const THREAT_ANGLE = 0.6
export const CHASE_TIME = 3

/**
 * How many seconds a monster that got hit shows it
 */
export const FLASH_TIME = 0.12

/**
 * Momentum a sword blow gives a monster it hits, away from the one with the sword, as mass times world units per second.
 * It goes into the shove, so a light monster flies back and a heavy one hardly moves.
 */
export const SWORD_SHOVE = 1.2 * FIGURE_SCALE


export interface MonsterKind
{
    /** size of the model as a multiple of how it was made */
    scale: number
    /** half its width in world units */
    radius: number
    /** how hard it is to shove, against a hero with HERO_MASS */
    mass: number
    hp: number
    /**
     * Big ones are in the way of everything, small ones only of what is on the same ground. Heroes count as big.
     */
    big: boolean
    /** hovers over the floor instead of walking on it */
    flying: boolean
    /** rough volume it bursts into particles from when it dies, none for one that goes another way */
    burst: readonly BurstSphere[]
}

export interface Monster extends FloorSpot
{
    kind: MonsterKind
    hp: number
    /** which way the model is turned, in radians */
    yaw: number
    /** seconds left of showing a hit */
    flash: number
    /** seconds it goes on going after someone, 0 with nobody to go after */
    chase: number
    /** where it last saw them */
    goalX: number
    goalZ: number
    /** speed it got from bumping into others, in world units per second */
    shoveX: number
    shoveZ: number
    /** goes through everyone without bumping into them, as it would carry them along otherwise */
    passing?: boolean
}

/**
 * Hero as monsters see them, with the position in world units
 */
export interface Prey
{
    x: number
    z: number
    /** where they look, as a meeple facing */
    facing: number
    blocking: boolean
    /** can't be hurt right now, e.g. while dashing */
    dodging: boolean
    /** seconds until monsters can hurt them again */
    hurtWait: number
    /** how fast they moved in the last frame, in world units per second */
    vx: number
    vz: number
    /**
     * Speed they got from bumping into monsters, in world units per second, which the scene moves them by and lets die down.
     * Monsters also move them out of the way in x and z, which the scene moves them to as far as the walls let them.
     */
    shoveX: number
    shoveZ: number
}

/**
 * How heroes count for getting in the way, see inTheWay()
 */
const HERO_KIND: Pick<MonsterKind, "big" | "flying"> = { big: true, flying: false }

/**
 * What monsters need to know about the level
 */
export interface MonsterFloor
{
    /**
     * Moves a monster by the given distance in world units, as far as the walls let it
     */
    move(monster: Monster, dx: number, dz: number): void

    /**
     * Returns whether there is no wall between two points
     */
    sees(x0: number, z0: number, x1: number, z1: number): boolean
}


/**
 * Something of the level that hurts heroes where they stand, shield or not
 */
export interface Hazard
{
    /**
     * Returns the hit points it takes from someone at the given point right now
     */
    damageAt(x: number, z: number): number
}


/**
 * Returns whether two things get in each other's way: those on the same ground always, a flying one and one on the ground only
 * if the one on the ground is big
 */
export function inTheWay(a: Pick<MonsterKind, "big" | "flying">, b: Pick<MonsterKind, "big" | "flying">): boolean
{
    return a.flying === b.flying || (a.flying ? b.big : a.big)
}

/**
 * Returns the angle in (-PI, PI] to turn by from one facing to another
 */
export function turnBetween(from: number, to: number): number
{
    const turn = to - from
    return Math.atan2(Math.sin(turn), Math.cos(turn))
}

/**
 * Returns whether a hero is close to a monster and faces it, ready to strike. A sword blow lands too soon after the swing
 * starts to react to it, so monsters that block have to go by this.
 */
export function threatens(hero: Prey, monster: Monster): boolean
{
    const dx = monster.x - hero.x, dz = monster.z - hero.z
    return !hero.dodging && Math.hypot(dx, dz) <= THREAT_RANGE + monster.kind.radius &&
        Math.abs(turnBetween(hero.facing, Math.atan2(dx, dz))) <= THREAT_ANGLE
}

/**
 * Turns a monster towards a point, by at most the given angle
 */
export function turnTo(monster: Monster, x: number, z: number, most: number): void
{
    const dx = x - monster.x, dz = z - monster.z
    if (dx === 0 && dz === 0)
    {
        return
    }
    const turn = turnBetween(monster.yaw, Math.atan2(dx, dz))
    monster.yaw += Math.max(-most, Math.min(most, turn))
}


/**
 * Monsters of one sort in a level. Plain state without the scene, which shows them and tells what the walls allow.
 */
export abstract class MonsterPack<M extends Monster = Monster>
{
    readonly members: M[] = []

    /** monsters that died since the scene last took them, to burst */
    readonly deaths: Death[] = []

    constructor(protected readonly floor: MonsterFloor)
    {
    }

    /**
     * Moves on by a frame
     *
     * @param delta     seconds since the last call
     * @param heroes    everyone in the level
     */
    abstract update(delta: number, heroes: readonly Prey[]): void

    /**
     * Returns the hit points the monsters take from a hero right now, and has them react to a shield
     *
     * @param hero      hero to look at
     * @param open      whether the hero can get hurt now, damage done otherwise doesn't count
     */
    abstract touch(hero: Prey, open: boolean): number

    /**
     * Has a monster react to a blow that left it alive
     *
     * @param dx        direction of the blow in world units, from the one with the sword to the monster
     * @param dz        direction of the blow in world units
     * @param distance  length of the direction
     */
    protected abstract struck(monster: M, dx: number, dz: number, distance: number): void

    /**
     * Returns whether a monster stops a blow, e.g. with a shield, which leaves it unhurt. By default none does.
     *
     * @param dx        direction of the blow in world units, from the one with the sword to the monster
     * @param dz        direction of the blow in world units
     */
    protected stops(_monster: M, _dx: number, _dz: number): boolean
    {
        return false
    }

    /**
     * Has a monster that died go its way, the default bursts all of it
     *
     * @param away  direction of the blow as a meeple facing
     * @param smite whether it goes at once and all of it, without anything coming out of it
     *
     * @return share of its volume that bursts
     */
    protected kill(_monster: M, _away: number, _smite: boolean): number
    {
        return 1
    }

    /**
     * Takes out a monster that died and has it burst, as far as it does
     */
    private die(monster: M, away: number, smite: boolean): void
    {
        this.members.splice(this.members.indexOf(monster), 1)
        const share = this.kill(monster, away, smite)
        if (share > 0)
        {
            const { kind, x, z, yaw, shoveX, shoveZ } = monster
            this.deaths.push({ monster, kind, x, z, yaw, away, share, vx: shoveX, vz: shoveZ })
        }
    }

    /**
     * Has a sword go through all monsters within its arc
     *
     * @param x         where the one with the sword is, in world units
     * @param z         where the one with the sword is, in world units
     * @param facing    where they look, as a meeple facing
     * @param reach     how far the arc goes in world units
     * @param width     width of the arc in radians
     * @param damage    hit points it takes
     *
     * @return number of monsters hit
     */
    strike(x: number, z: number, facing: number, reach: number, width: number, damage: number): number
    {
        let hits = 0
        for (const monster of [...this.members])
        {
            const dx = monster.x - x, dz = monster.z - z
            const distance = Math.hypot(dx, dz)
            const turn = Math.atan2(dx, dz) - facing
            const inArc = Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) <= width / 2
            // right on top of the hero, the direction means little
            const within = distance < monster.kind.radius + HERO_RADIUS || inArc && distance <= reach + monster.kind.radius
            if (within && this.floor.sees(x, z, monster.x, monster.z))
            {
                hits++
                // even a shield gets pushed back, right on top of the hero it goes where the blow goes
                const [awayX, awayZ] = distance > 1e-6 ? [dx / distance, dz / distance] : [Math.sin(facing), Math.cos(facing)]
                monster.shoveX += awayX * SWORD_SHOVE / monster.kind.mass
                monster.shoveZ += awayZ * SWORD_SHOVE / monster.kind.mass
                if (this.stops(monster, dx, dz))
                {
                    monster.chase = CHASE_TIME
                    monster.goalX = x
                    monster.goalZ = z
                    continue
                }
                monster.hp -= damage
                if (monster.hp <= 0)
                {
                    // right on top of the hero, they go where the blow goes
                    this.die(monster, distance > 1e-6 ? Math.atan2(dx, dz) : facing, false)
                }
                else
                {
                    monster.flash = FLASH_TIME
                    monster.chase = CHASE_TIME
                    monster.goalX = x
                    monster.goalZ = z
                    this.struck(monster, dx, dz, distance)
                }
            }
        }
        return hits
    }

    /**
     * Annihilates the given monsters: they burst whole, as from a blow from a random direction, and nothing comes out of
     * them, not even the small cuboids of a big one
     */
    smite(doomed: (monster: M) => boolean): void
    {
        for (const monster of this.members.filter(doomed))
        {
            this.die(monster, rng.next(0, Math.PI * 2), true)
        }
    }

    /**
     * Returns whether any monster can see a hero right now, whether it has got around to noticing them or not
     */
    sees(hero: Prey): boolean
    {
        return this.members.some(monster => this.closestSeen(monster, [hero]) !== null)
    }

    protected closestSeen({ x, z }: Monster, heroes: readonly Prey[]): Prey | null
    {
        let closest: Prey | null = null
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
}


/**
 * All monsters of a level
 */
export default class Monsters
{
    /**
     * @param packs     all monsters
     * @param floor     the level
     * @param hazards   what else hurts heroes
     */
    constructor(readonly packs: readonly MonsterPack[], private readonly floor: MonsterFloor, private readonly hazards: readonly Hazard[] = [])
    {
    }

    /**
     * Moves on by a frame
     *
     * @param delta     seconds since the last call
     * @param heroes    everyone in the level
     *
     * @return heroes that ran into a monster, or a monster into them
     */
    update(delta: number, heroes: readonly Prey[]): Set<Prey>
    {
        const before = new Map<Monster, readonly [number, number]>()
        for (const { members } of this.packs)
        {
            for (const monster of members)
            {
                before.set(monster, [monster.x, monster.z])
            }
        }
        for (const pack of this.packs)
        {
            pack.update(delta, heroes)
        }
        return this.bumpAll(delta, heroes, before)
    }

    /**
     * Has what gets a hero hurt them, unless they got hurt just before or their shield stops it. It doesn't matter if what gets
     * them now is what did it before, so someone staying in touch gets hurt over and over.
     *
     * @param hero      hero to look at
     * @param delta     seconds since the last call
     *
     * @return hit points the hero loses now
     */
    hurt(hero: Prey, delta: number): number
    {
        hero.hurtWait = Math.max(0, hero.hurtWait - delta)
        const open = hero.hurtWait === 0 && !hero.dodging
        const touched = this.packs.reduce((most, pack) => Math.max(most, pack.touch(hero, open)), 0)
        const damage = this.hazards.reduce((most, hazard) => Math.max(most, hazard.damageAt(hero.x, hero.z)), touched)
        if (open && damage > 0)
        {
            hero.hurtWait = HURT_WAIT
            return damage
        }
        return 0
    }

    /**
     * Has a sword go through all monsters within its arc, see MonsterPack.strike()
     *
     * @return number of monsters hit
     */
    strike(x: number, z: number, facing: number, reach: number, width: number, damage: number): number
    {
        return this.packs.reduce((hits, pack) => hits + pack.strike(x, z, facing, reach, width, damage), 0)
    }

    /**
     * Annihilates all monsters on the given faces, see MonsterPack.smite()
     */
    smiteOn(faces: ReadonlySet<number>): void
    {
        for (const pack of this.packs)
        {
            pack.smite(({ face }) => faces.has(face))
        }
    }

    /**
     * Returns whether any monster can see a hero right now
     */
    sees(hero: Prey): boolean
    {
        return this.packs.some(pack => pack.sees(hero))
    }

    /**
     * Has monsters go on by their shoves, and bump into each other and into heroes. Without it, they would all end up in one
     * spot on their way to the same hero.
     *
     * @param before    where each monster was at the start of the frame, to tell how fast it moved
     *
     * @return heroes that traded momentum with a monster
     */
    private bumpAll(delta: number, heroes: readonly Prey[], before: ReadonlyMap<Monster, readonly [number, number]>): Set<Prey>
    {
        const bumped = new Set<Prey>()
        const { floor } = this
        const monsters = this.packs.flatMap(({ members }) => members as Monster[])
        const bodies: Body[] = monsters.map(monster =>
        {
            const { kind, shoveX, shoveZ } = monster
            if (shoveX !== 0 || shoveZ !== 0)
            {
                floor.move(monster, shoveX * delta, shoveZ * delta)
                fadeShove(monster, delta)
            }
            const [x0, z0] = before.get(monster) ?? [monster.x, monster.z]
            const { x, z } = monster
            const vx = delta > 0 ? (x - x0) / delta : 0
            const vz = delta > 0 ? (z - z0) / delta : 0
            return { x, z, vx, vz, shoveX: monster.shoveX, shoveZ: monster.shoveZ, radius: kind.radius, mass: kind.mass }
        })
        const heroBodies: Body[] = heroes.map(({ x, z, vx, vz, shoveX, shoveZ }) =>
            ({ x, z, vx, vz, shoveX, shoveZ, radius: HERO_RADIUS, mass: HERO_MASS }))

        for (let i = 0; i < monsters.length; i++)
        {
            const a = monsters[i]
            if (a.passing)
            {
                continue
            }
            for (let j = i + 1; j < monsters.length; j++)
            {
                if (!monsters[j].passing && inTheWay(a.kind, monsters[j].kind))
                {
                    bump(bodies[i], bodies[j])
                }
            }
            if (inTheWay(a.kind, HERO_KIND))
            {
                heroBodies.forEach((hero, h) =>
                {
                    if (bump(bodies[i], hero)! > 0)
                    {
                        bumped.add(heroes[h])
                    }
                })
            }
        }

        monsters.forEach((monster, i) =>
        {
            const body = bodies[i]
            floor.move(monster, body.x - monster.x, body.z - monster.z)
            monster.shoveX = body.shoveX
            monster.shoveZ = body.shoveZ
        })
        heroes.forEach((hero, i) =>
        {
            const body = heroBodies[i]
            hero.x = body.x
            hero.z = body.z
            hero.shoveX = body.shoveX
            hero.shoveZ = body.shoveZ
        })
        return bumped
    }
}
