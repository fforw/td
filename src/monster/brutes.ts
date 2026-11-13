import type Prando from "prando"
import { rng } from "../math/random"
import { CHASE_TIME, HERO_RADIUS, type Monster, type MonsterKind, MonsterPack, type Prey } from "./monsters"

const TAU = Math.PI * 2

/**
 * Seconds the attack takes, and when in it the club comes down, as in the attack clip of the model
 */
export const ATTACK_TIME = 3
export const IMPACT_TIME = 1

/**
 * Seconds into the attack until which a brute still turns after who it goes after, so that stepping aside while it raises
 * the club helps only late
 */
export const AIM_TIME = 0.75

/**
 * Width in radians of the arc in front of a brute that the club hits
 */
export const CLUB_ARC = Math.PI * 0.6

/**
 * How fast a brute turns, in radians per second
 */
const TURN_RATE = 2.5

/**
 * Seconds between looking around for a brute with nobody to go after
 */
const LOOK_TIME = 0.25

/**
 * How likely a brute with nobody to go after walks somewhere when it looks around, and how far in world units
 */
const WANDER_CHANCE = 0.03
const WANDER_LENGTH = 0.6

/**
 * Share of the rooms with a brute in them
 */
const ROOMS_TAKEN = 0.08

/**
 * How close a brute comes to who it goes after, as a share of its reach
 */
const CLOSE_IN = 0.8


export interface BruteKind extends MonsterKind
{
    /** hit points the club takes */
    damage: number
    /** walking speed in world units per second */
    speed: number
    /** how far the club reaches from the middle of the brute, in world units */
    reach: number
}

export const BRUTE: BruteKind = {
    scale: 1,
    radius: 0.11,
    hp: 16,
    big: true,
    flying: false,
    // the body, and the club held up at its side
    burst: [
        { x: 0, y: 0.58, z: 0.02, rx: 0.33, ry: 0.58, rz: 0.26, colors: ["#706f59", "#706f59", "#2c33a8"] },
        { x: -0.41, y: 1.31, z: 0.01, rx: 0.18, ry: 0.75, rz: 0.18, colors: ["#4c291f"] }
    ],
    damage: 5,
    speed: 0.35,
    reach: 0.32
}


export interface Brute extends Monster
{
    kind: BruteKind
    /** walking somewhere with nobody to go after */
    wandering: boolean
    /** seconds into the current attack, null without one */
    attack: number | null
    /** the club comes down in this frame */
    impact: boolean
    /** world units walked in all, which the walk clip follows */
    walked: number
    /** walked in this frame */
    moving: boolean
    /** seconds until it looks around again */
    lookWait: number
}


/**
 * Returns who goes where in a level: a brute in a few rooms, but not the one the heroes come in by
 *
 * @param rooms     faces of each room of the level
 * @param entrance  index of the room the heroes come in by
 * @param random    random numbers, for the same level to always have the same brutes
 */
export function placeBrutes(rooms: readonly (readonly number[])[], entrance: number, random: Prando): { face: number, kind: BruteKind }[]
{
    return rooms.filter((_, index) => index !== entrance).filter(() => random.next() < ROOMS_TAKEN).map(room => ({
        face: room[random.nextInt(0, room.length - 1)],
        kind: BRUTE
    }))
}


/**
 * Returns the angle in (-PI, PI] to turn by from one facing to another
 */
function turnBetween(from: number, to: number): number
{
    const turn = to - from
    return Math.atan2(Math.sin(turn), Math.cos(turn))
}


/**
 * The brutes of a level: slow and hard to bring down, they walk after heroes and swing a club that no shield stops. It takes
 * a while to come down, which leaves time to step back or dodge.
 */
export default class BrutePack extends MonsterPack<Brute>
{
    add(kind: BruteKind, face: number, x: number, z: number): Brute
    {
        const brute: Brute = {
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
            flash: 0
        }
        this.members.push(brute)
        return brute
    }

    update(delta: number, heroes: readonly Prey[]): void
    {
        for (const brute of this.members)
        {
            brute.flash = Math.max(0, brute.flash - delta)
            brute.chase = Math.max(0, brute.chase - delta)
            brute.impact = false
            brute.moving = false

            const prey = this.closestSeen(brute, heroes)
            if (prey)
            {
                brute.chase = CHASE_TIME
                brute.goalX = prey.x
                brute.goalZ = prey.z
                brute.wandering = false
            }

            if (brute.attack !== null)
            {
                this.swing(brute, delta)
            }
            else
            {
                this.decide(brute, delta, prey !== null)
            }
        }
    }

    /**
     * Only the club hurts, in the frame it comes down, and a shield doesn't stop it
     */
    touch(hero: Prey, open: boolean): number
    {
        let damage = 0
        for (const brute of this.members)
        {
            if (open && brute.impact && this.clubHits(brute, hero))
            {
                damage = Math.max(damage, brute.kind.damage)
            }
        }
        return damage
    }

    /**
     * Shrugs off a blow, it only shows the flash
     */
    protected struck(): void
    {
    }

    /**
     * Returns whether the club of a brute reaches a hero
     */
    clubHits({ kind, x, z, yaw }: Brute, hero: Prey): boolean
    {
        const dx = hero.x - x, dz = hero.z - z
        const distance = Math.hypot(dx, dz)
        if (distance > kind.reach + HERO_RADIUS || !this.floor.sees(x, z, hero.x, hero.z))
        {
            return false
        }
        // right on top of it, the direction means little
        return distance < kind.radius + HERO_RADIUS || Math.abs(turnBetween(yaw, Math.atan2(dx, dz))) <= CLUB_ARC / 2
    }

    private swing(brute: Brute, delta: number): void
    {
        const before = brute.attack!
        const now = before + delta
        if (before < AIM_TIME && brute.chase > 0)
        {
            this.turnTo(brute, brute.goalX, brute.goalZ, delta)
        }
        brute.impact = before < IMPACT_TIME && now >= IMPACT_TIME
        brute.attack = now < ATTACK_TIME ? now : null
    }

    /**
     * Has a brute not attacking go after who it saw last, or wander about
     *
     * @param sees  whether it sees someone right now
     */
    private decide(brute: Brute, delta: number, sees: boolean): void
    {
        const { kind } = brute
        if (brute.chase === 0 && !brute.wandering)
        {
            brute.lookWait -= delta
            if (brute.lookWait > 0)
            {
                return
            }
            brute.lookWait = LOOK_TIME
            if (rng.next() < WANDER_CHANCE)
            {
                const angle = rng.next() * TAU
                brute.goalX = brute.x + Math.sin(angle) * WANDER_LENGTH
                brute.goalZ = brute.z + Math.cos(angle) * WANDER_LENGTH
                brute.wandering = true
            }
            return
        }

        const dx = brute.goalX - brute.x, dz = brute.goalZ - brute.z
        const distance = Math.hypot(dx, dz)
        const stop = brute.wandering ? 0.01 : kind.reach * CLOSE_IN
        if (sees && distance <= kind.reach)
        {
            brute.attack = 0
            return
        }
        if (distance <= stop)
        {
            brute.wandering = false
            return
        }
        this.turnTo(brute, brute.goalX, brute.goalZ, delta)

        const step = Math.min(kind.speed * delta, distance - stop)
        const { x, z } = brute
        this.floor.move(brute, dx / distance * step, dz / distance * step)
        const moved = Math.hypot(brute.x - x, brute.z - z)
        brute.walked += moved
        brute.moving = moved > 0
        // a wall in the way ends a walk about
        if (brute.wandering && moved < step / 2)
        {
            brute.wandering = false
        }
    }

    private turnTo(brute: Brute, x: number, z: number, delta: number): void
    {
        const dx = x - brute.x, dz = z - brute.z
        if (dx === 0 && dz === 0)
        {
            return
        }
        const turn = turnBetween(brute.yaw, Math.atan2(dx, dz))
        const most = TURN_RATE * delta
        brute.yaw += Math.max(-most, Math.min(most, turn))
    }
}
