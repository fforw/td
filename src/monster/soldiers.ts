import { rng } from "../math/random"
import { FIGURE_SCALE } from "../meeple/figureScale"
import { BLOCK_ANGLE } from "./eyes"
import { CHASE_TIME, HERO_RADIUS, type Monster, type MonsterKind, MonsterPack, type Prey, turnBetween, turnTo } from "./monsters"

const TAU = Math.PI * 2

/**
 * Seconds the attack takes, when in it the sword comes down, and until when the soldier turns after who it goes after, as in
 * the attack clip of the model
 */
export const SWING_TIME = 1.5
export const CUT_TIME = 15 / 24
export const AIM_TIME = 9 / 24

/**
 * Seconds it takes to raise the shield all the way and to lower it again, as in the block clip of the model
 */
export const RAISE_TIME = 0.5
export const LOWER_TIME = 0.5

/**
 * How far up the shield has to be to stop a blow, from 0 down to 1 all the way up
 */
export const SHIELD_UP = 0.6

/**
 * Width in radians of the arc in front of a soldier that its shield covers
 */
export const SHIELD_ARC = Math.PI * 0.75

/**
 * Seconds a soldier keeps its guard up after a swing, or after a blow, at least and at most
 */
export const GUARD_MIN = 1
export const GUARD_MAX = 2.5

/**
 * Width in radians of the arc in front of a soldier that the sword hits
 */
export const CUT_ARC = Math.PI * 0.5

/**
 * Share of its walking speed at which a soldier closes in behind its shield
 */
const GUARD_PACE = 0.4

/**
 * How fast a soldier turns, in radians per second
 */
const TURN_RATE = 4

/**
 * Seconds between looking around for a soldier with nobody to go after
 */
const LOOK_TIME = 0.25

/**
 * How likely a soldier with nobody to go after walks somewhere when it looks around, and how far in world units
 */
const WANDER_CHANCE = 0.03
const WANDER_LENGTH = 0.6 * FIGURE_SCALE

/**
 * How close a soldier comes to who it goes after, as a share of its reach
 */
const CLOSE_IN = 0.8


export interface SoldierKind extends MonsterKind
{
    /** hit points the sword takes */
    damage: number
    /** walking speed in world units per second */
    speed: number
    /** how far the sword reaches from the middle of the soldier, in world units */
    reach: number
}

export const SOLDIER: SoldierKind = {
    scale: 1,
    radius: 0.09 * FIGURE_SCALE,
    hp: 8,
    big: true,
    flying: false,
    // the body, the shield on its left and the sword on its right
    burst: [
        { x: 0, y: 0.5, z: 0, rx: 0.2, ry: 0.5, rz: 0.17, colors: ["#a88788", "#a88788", "#4448a8"] },
        { x: 0.15, y: 0.33, z: 0.2, rx: 0.15, ry: 0.15, rz: 0.05, colors: ["#4c291e", "#4448a8"] },
        { x: -0.33, y: 0.78, z: 0, rx: 0.04, ry: 0.33, rz: 0.04, colors: ["#989bd9"] }
    ],
    damage: 3,
    speed: 0.55 * FIGURE_SCALE,
    reach: 0.25 * FIGURE_SCALE
}


export interface Soldier extends Monster
{
    kind: SoldierKind
    /** walking somewhere with nobody to go after */
    wandering: boolean
    /** seconds into the current attack, null without one */
    attack: number | null
    /** the sword comes down in this frame */
    impact: boolean
    /** world units walked in all, which the walk clip follows */
    walked: number
    /** walked in this frame */
    moving: boolean
    /** seconds until it looks around again */
    lookWait: number
    /** raising the shield or holding it up, lowering it otherwise */
    guarding: boolean
    /** seconds until it lowers the shield again */
    guardLeft: number
    /** how far up the shield is, from 0 down to 1 all the way up */
    shield: number
}


/**
 * The soldiers of a level: they walk after heroes, swing a sword that a shield stops, and then hold up their own for a
 * while, which stops blows from the front. Blows from the side or behind get through, as do those while it swings.
 */
export default class SoldierPack extends MonsterPack<Soldier>
{
    add(kind: SoldierKind, face: number, x: number, z: number): Soldier
    {
        const soldier: Soldier = {
            kind,
            hp: kind.hp,
            face,
            x,
            z,
            yaw: rng.next() * TAU,
            wandering: false,
            attack: null,
            impact: false,
            walked: 0,
            moving: false,
            chase: 0,
            goalX: 0,
            goalZ: 0,
            lookWait: rng.next() * LOOK_TIME,
            guarding: false,
            guardLeft: 0,
            shield: 0,
            flash: 0
        }
        this.members.push(soldier)
        return soldier
    }

    update(delta: number, heroes: readonly Prey[]): void
    {
        for (const soldier of this.members)
        {
            soldier.flash = Math.max(0, soldier.flash - delta)
            soldier.chase = Math.max(0, soldier.chase - delta)
            soldier.impact = false
            soldier.moving = false

            const prey = this.closestSeen(soldier, heroes)
            if (prey)
            {
                soldier.chase = CHASE_TIME
                soldier.goalX = prey.x
                soldier.goalZ = prey.z
                soldier.wandering = false
            }

            if (soldier.attack !== null)
            {
                this.swing(soldier, delta)
            }
            else if (soldier.guarding)
            {
                this.guard(soldier, delta)
            }
            else
            {
                this.decide(soldier, delta, prey !== null)
            }

            soldier.shield = soldier.guarding
                ? Math.min(1, soldier.shield + delta / RAISE_TIME)
                : Math.max(0, soldier.shield - delta / LOWER_TIME)
        }
    }

    /**
     * Only the sword hurts, in the frame it comes down, unless the shield of the hero stops it
     */
    touch(hero: Prey, open: boolean): number
    {
        let damage = 0
        for (const soldier of this.members)
        {
            if (open && soldier.impact && this.cutHits(soldier, hero) && !this.heroBlocks(hero, soldier))
            {
                damage = Math.max(damage, soldier.kind.damage)
            }
        }
        return damage
    }

    /**
     * Takes cover behind its shield, unless it is in the middle of a swing
     */
    protected struck(soldier: Soldier): void
    {
        if (soldier.attack === null)
        {
            this.raiseGuard(soldier)
        }
    }

    /**
     * A shield far enough up stops blows from the front
     */
    protected stops({ yaw, shield }: Soldier, dx: number, dz: number): boolean
    {
        return shield >= SHIELD_UP && Math.abs(turnBetween(yaw, Math.atan2(-dx, -dz))) <= SHIELD_ARC / 2
    }

    /**
     * Returns whether the sword of a soldier reaches a hero
     */
    cutHits({ kind, x, z, yaw }: Soldier, hero: Prey): boolean
    {
        const dx = hero.x - x, dz = hero.z - z
        const distance = Math.hypot(dx, dz)
        if (distance > kind.reach + HERO_RADIUS || !this.floor.sees(x, z, hero.x, hero.z))
        {
            return false
        }
        // right on top of it, the direction means little
        return distance < kind.radius + HERO_RADIUS || Math.abs(turnBetween(yaw, Math.atan2(dx, dz))) <= CUT_ARC / 2
    }

    /**
     * Returns whether a hero holds their shield up against a soldier in front of them
     */
    private heroBlocks(hero: Prey, { x, z }: Soldier): boolean
    {
        const dx = x - hero.x, dz = z - hero.z
        const distance = Math.hypot(dx, dz)
        return hero.blocking && (distance < 1e-6 || dx * Math.sin(hero.facing) + dz * Math.cos(hero.facing) >= Math.cos(BLOCK_ANGLE) * distance)
    }

    private raiseGuard(soldier: Soldier): void
    {
        soldier.guarding = true
        soldier.guardLeft = rng.next(GUARD_MIN, GUARD_MAX)
        soldier.wandering = false
    }

    private swing(soldier: Soldier, delta: number): void
    {
        const before = soldier.attack!
        const now = before + delta
        if (before < AIM_TIME && soldier.chase > 0)
        {
            turnTo(soldier, soldier.goalX, soldier.goalZ, TURN_RATE * delta)
        }
        soldier.impact = before < CUT_TIME && now >= CUT_TIME
        if (now < SWING_TIME)
        {
            soldier.attack = now
        }
        else
        {
            soldier.attack = null
            this.raiseGuard(soldier)
        }
    }

    /**
     * Has a soldier behind its shield face who it goes after and close in slowly, until it lowers the shield again
     */
    private guard(soldier: Soldier, delta: number): void
    {
        soldier.guardLeft -= delta
        if (soldier.guardLeft <= 0)
        {
            soldier.guarding = false
        }
        if (soldier.chase > 0)
        {
            turnTo(soldier, soldier.goalX, soldier.goalZ, TURN_RATE * delta)
            this.walk(soldier, soldier.kind.speed * GUARD_PACE * delta, soldier.kind.reach * CLOSE_IN)
        }
    }

    /**
     * Has a soldier with its shield down go after who it saw last, or wander about. It swings once the shield is all the way
     * down.
     *
     * @param sees  whether it sees someone right now
     */
    private decide(soldier: Soldier, delta: number, sees: boolean): void
    {
        const { kind } = soldier
        if (soldier.chase === 0 && !soldier.wandering)
        {
            soldier.lookWait -= delta
            if (soldier.lookWait > 0)
            {
                return
            }
            soldier.lookWait = LOOK_TIME
            if (rng.next() < WANDER_CHANCE)
            {
                const angle = rng.next() * TAU
                soldier.goalX = soldier.x + Math.sin(angle) * WANDER_LENGTH
                soldier.goalZ = soldier.z + Math.cos(angle) * WANDER_LENGTH
                soldier.wandering = true
            }
            return
        }

        const distance = Math.hypot(soldier.goalX - soldier.x, soldier.goalZ - soldier.z)
        if (sees && distance <= kind.reach)
        {
            turnTo(soldier, soldier.goalX, soldier.goalZ, TURN_RATE * delta)
            if (soldier.shield === 0)
            {
                soldier.attack = 0
            }
            return
        }
        const stop = soldier.wandering ? 0.01 : kind.reach * CLOSE_IN
        if (distance <= stop)
        {
            soldier.wandering = false
            return
        }
        turnTo(soldier, soldier.goalX, soldier.goalZ, TURN_RATE * delta)
        const step = kind.speed * delta
        const moved = this.walk(soldier, step, stop)
        // a wall in the way ends a walk about
        if (soldier.wandering && moved < step / 2)
        {
            soldier.wandering = false
        }
    }

    /**
     * Walks a soldier towards its goal by at most the given step, stopping the given distance short of it
     *
     * @return world units it moved
     */
    private walk(soldier: Soldier, step: number, stop: number): number
    {
        const dx = soldier.goalX - soldier.x, dz = soldier.goalZ - soldier.z
        const distance = Math.hypot(dx, dz)
        if (distance <= stop)
        {
            return 0
        }
        const length = Math.min(step, distance - stop)
        const { x, z } = soldier
        this.floor.move(soldier, dx / distance * length, dz / distance * length)
        const moved = Math.hypot(soldier.x - x, soldier.z - z)
        soldier.walked += moved
        soldier.moving = moved > 0
        return moved
    }
}
