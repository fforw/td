import { rng } from "../math/random"
import { FIGURE_SCALE } from "../meeple/figureScale"
import { CHASE_TIME, type Monster, type MonsterKind, MonsterPack, type Prey, turnTo } from "./monsters"

const TAU = Math.PI * 2

/**
 * Number of robe colors to pick from, see ROBE_COLORS in WizardCrowd
 */
export const ROBE_COUNT = 7

/**
 * How fast a wizard turns, in radians per second
 */
const TURN_RATE = 3

/**
 * Seconds between looking around for a wizard with nobody to go after
 */
const LOOK_TIME = 0.25

/**
 * How likely a wizard with nobody to go after walks somewhere when it looks around, and how far in world units
 */
const WANDER_CHANCE = 0.03
const WANDER_LENGTH = 0.6 * FIGURE_SCALE

export interface WizardKind extends MonsterKind
{
    /** walking speed in world units per second */
    speed: number
    /** how close it comes to who it goes after, in world units */
    keepAway: number
}

export const WIZARD: WizardKind = {
    scale: 1,
    radius: 0.09 * FIGURE_SCALE,
    mass: 0.8,
    hp: 5,
    big: true,
    flying: false,
    // the robe, and the staff on its right
    burst: [
        { x: 0, y: 0.5, z: 0, rx: 0.2, ry: 0.5, rz: 0.2, colors: ["#d8d8d8", "#a0a0a0", "#1a1a1a"] },
        { x: -0.3, y: 0.55, z: -0.2, rx: 0.04, ry: 0.5, rz: 0.04, colors: ["#5b3a24"] }
    ],
    speed: 0.45 * FIGURE_SCALE,
    keepAway: 1.5 * FIGURE_SCALE
}

export interface Wizard extends Monster
{
    kind: WizardKind
    /** walking somewhere with nobody to go after */
    wandering: boolean
    /** world units walked in all, which the walk clip follows */
    walked: number
    /** walked in this frame */
    moving: boolean
    /** seconds until it looks around again */
    lookWait: number
    /** index into the robe colors */
    robe: number
}


/**
 * The wizards of a level. A placeholder so far: they wander about, and walk up to heroes they see, but stay some way off
 * and do them no harm.
 */
export default class WizardPack extends MonsterPack<Wizard>
{
    add(kind: WizardKind, face: number, x: number, z: number): Wizard
    {
        const wizard: Wizard = {
            kind,
            hp: kind.hp,
            face,
            x,
            z,
            yaw: rng.next() * TAU,
            wandering: false,
            walked: 0,
            moving: false,
            chase: 0,
            goalX: 0,
            goalZ: 0,
            lookWait: rng.next() * LOOK_TIME,
            robe: Math.floor(rng.next() * ROBE_COUNT),
            flash: 0,
            shoveX: 0,
            shoveZ: 0
        }
        this.members.push(wizard)
        return wizard
    }

    update(delta: number, heroes: readonly Prey[]): void
    {
        for (const wizard of this.members)
        {
            wizard.flash = Math.max(0, wizard.flash - delta)
            wizard.chase = Math.max(0, wizard.chase - delta)
            wizard.moving = false

            const prey = this.closestSeen(wizard, heroes)
            if (prey)
            {
                wizard.chase = CHASE_TIME
                wizard.goalX = prey.x
                wizard.goalZ = prey.z
                wizard.wandering = false
            }
            this.decide(wizard, delta)
        }
    }

    /**
     * Wizards don't hurt anyone yet
     */
    touch(_hero: Prey, _open: boolean): number
    {
        return 0
    }

    protected struck(): void
    {
    }

    /**
     * Walks a wizard after who it goes after, or about now and then with nobody to go after
     */
    private decide(wizard: Wizard, delta: number): void
    {
        if (wizard.chase === 0 && !wizard.wandering)
        {
            wizard.lookWait -= delta
            if (wizard.lookWait > 0)
            {
                return
            }
            wizard.lookWait = LOOK_TIME
            if (rng.next() < WANDER_CHANCE)
            {
                const angle = rng.next() * TAU
                wizard.goalX = wizard.x + Math.sin(angle) * WANDER_LENGTH
                wizard.goalZ = wizard.z + Math.cos(angle) * WANDER_LENGTH
                wizard.wandering = true
            }
            return
        }

        turnTo(wizard, wizard.goalX, wizard.goalZ, TURN_RATE * delta)
        const stop = wizard.wandering ? 0.01 : wizard.kind.keepAway
        const dx = wizard.goalX - wizard.x, dz = wizard.goalZ - wizard.z
        const distance = Math.hypot(dx, dz)
        if (distance <= stop)
        {
            wizard.wandering = false
            return
        }
        const step = wizard.kind.speed * delta
        const length = Math.min(step, distance - stop)
        const { x, z } = wizard
        this.floor.move(wizard, dx / distance * length, dz / distance * length)
        const moved = Math.hypot(wizard.x - x, wizard.z - z)
        wizard.walked += moved
        wizard.moving = moved > 0
        // a wall in the way ends a walk about
        if (wizard.wandering && moved < step / 2)
        {
            wizard.wandering = false
        }
    }
}
