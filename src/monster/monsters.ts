import type { FloorSpot } from "../map/dungeonWays"
import type { BurstSphere, Death } from "./bursts"

/**
 * Seconds after a monster did damage to someone in which no monster can do so again
 */
export const HURT_WAIT = 1

/**
 * Room a hero takes up in world units
 */
export const HERO_RADIUS = 0.09

/**
 * How far a monster notices a hero in world units, and for how many seconds it goes on after losing sight of them
 */
export const NOTICE_DISTANCE = 3
export const CHASE_TIME = 3

/**
 * How many seconds a monster that got hit shows it
 */
export const FLASH_TIME = 0.12


export interface MonsterKind
{
    /** size of the model as a multiple of how it was made */
    scale: number
    /** half its width in world units */
    radius: number
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
}

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
 * Returns whether two things get in each other's way: those on the same ground always, a flying one and one on the ground only
 * if the one on the ground is big
 */
export function inTheWay(a: MonsterKind, b: MonsterKind): boolean
{
    return a.flying === b.flying || (a.flying ? b.big : a.big)
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
     * Has a monster that died go its way, the default bursts all of it
     *
     * @param away  direction of the blow as a meeple facing
     *
     * @return share of its volume that bursts
     */
    protected kill(_monster: M, _away: number): number
    {
        return 1
    }

    /**
     * Takes out a monster that died and has it burst, as far as it does
     */
    private die(monster: M, away: number): void
    {
        this.members.splice(this.members.indexOf(monster), 1)
        const share = this.kill(monster, away)
        if (share > 0)
        {
            this.deaths.push({ kind: monster.kind, x: monster.x, z: monster.z, yaw: monster.yaw, away, share })
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
                monster.hp -= damage
                if (monster.hp <= 0)
                {
                    // right on top of the hero, they go where the blow goes
                    this.die(monster, distance > 1e-6 ? Math.atan2(dx, dz) : facing)
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
     * TEMP god mode: kills the given monsters on the spot, as a blow from a random direction would
     */
    killAll(doomed: (monster: M) => boolean): number
    {
        const killed = this.members.filter(doomed)
        for (const monster of killed)
        {
            this.die(monster, Math.random() * Math.PI * 2)
        }
        return killed.length
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
    constructor(readonly packs: readonly MonsterPack[], private readonly floor: MonsterFloor)
    {
    }

    /**
     * Moves on by a frame
     *
     * @param delta     seconds since the last call
     * @param heroes    everyone in the level
     */
    update(delta: number, heroes: readonly Prey[]): void
    {
        for (const pack of this.packs)
        {
            pack.update(delta, heroes)
        }
        this.keepApart(heroes)
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
        const damage = this.packs.reduce((most, pack) => Math.max(most, pack.touch(hero, open)), 0)
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
     * TEMP god mode: kills all monsters on the given faces, and whatever they break up into
     */
    killOn(faces: ReadonlySet<number>): void
    {
        while (this.packs.reduce((killed, pack) => killed + pack.killAll(({ face }) => faces.has(face)), 0) > 0)
        {
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
     * Pushes monsters out of each other, which would otherwise all end up in one spot on their way to the same hero, and flying
     * ones out of heroes
     */
    private keepApart(heroes: readonly Prey[]): void
    {
        const { floor } = this
        const all = this.packs.flatMap(({ members }) => members as Monster[])
        for (let i = 0; i < all.length; i++)
        {
            const a = all[i]
            for (let j = i + 1; j < all.length; j++)
            {
                const b = all[j]
                if (!inTheWay(a.kind, b.kind))
                {
                    continue
                }
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
            // heroes go where they are steered
            if (a.kind.flying)
            {
                for (const hero of heroes)
                {
                    const dx = a.x - hero.x, dz = a.z - hero.z
                    const room = a.kind.radius + HERO_RADIUS
                    const distance = Math.hypot(dx, dz)
                    if (distance > 0 && distance < room)
                    {
                        const push = (room - distance) / distance
                        floor.move(a, dx * push, dz * push)
                    }
                }
            }
        }
    }
}
