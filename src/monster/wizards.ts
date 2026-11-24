import { rng } from "../math/random"
import { FIGURE_SCALE } from "../meeple/figureScale"
import { CHASE_TIME, type Monster, type MonsterFloor, type MonsterKind, MonsterPack, type Prey, turnTo } from "./monsters"
import { SIGIL_DRAW, sigilPhase } from "../render/sigilShape"
import { placeSigil, type SigilFloor, type SigilState, SIGIL_RADIUS } from "./sigils"
import { FIRE_PATTERN_NAMES, FIRE_PATTERNS } from "./firePatterns"
import FireRain, { type FireFloor } from "./fireRain"

const TAU = Math.PI * 2

/**
 * Number of robe colors to pick from, see ROBE_COLORS in WizardCrowd
 */
export const ROBE_COUNT = 7

/**
 * Index of the blue robe, whose wizards cast sigils
 */
export const SIGIL_ROBE = 0

/**
 * Index of the red robe, whose wizards have it rain fire
 */
export const FIRE_ROBE = 2

/**
 * Seconds into casting a wizard stomps the staff on the floor, which is when a rain of fire starts, and seconds
 * casting one takes, both as the cast clip goes
 */
export const STAFF_STOMP = 0.75
const FIRE_CAST = 1.25

/**
 * How close a hero must be for a wizard to cast something at them, in world units, a bit more than it keeps away
 */
const CAST_RANGE = 2.2 * FIGURE_SCALE

/**
 * Seconds from noticing a hero to the first spell, and from the end of a cast to the next one
 */
const FIRST_WAIT_MIN = 0.4
const FIRST_WAIT_MAX = 1
const CAST_WAIT_MIN = 2
const CAST_WAIT_MAX = 3.5

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
    /** hit points a sigil takes */
    damage: number
    /** hit points a strike of fire takes */
    fireDamage: number
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
    keepAway: 1.5 * FIGURE_SCALE,
    damage: 3,
    fireDamage: 2
}

/**
 * A spell a wizard is casting
 */
export interface Cast
{
    /** seconds since it started */
    age: number
    /** where the wizard looks */
    x: number
    z: number
    /** sigil it is drawing, null for a rain of fire */
    sigil: SigilState | null
    /** whether the fire is on its way, so putting off the wizard doesn't stop it */
    released: boolean
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
    /** varies the hue of its robe and spells, from 0 to 1 */
    hue: number
    /** spell it is casting, null if it isn't */
    casting: Cast | null
    /** seconds until it may cast, which pass while it goes after someone */
    castWait: number
}

/**
 * What wizards need to know about the level
 */
export interface WizardFloor extends MonsterFloor, SigilFloor, FireFloor
{
}


/**
 * The wizards of a level. They wander about, and walk up to heroes they see, but stay some way off. Blue ones stop to cast
 * sigils under heroes and red ones to have it rain fire, the others do no harm yet.
 */
export default class WizardPack extends MonsterPack<Wizard>
{
    /** on the floor, which stay when their wizard is gone */
    readonly sigils: SigilState[] = []
    /** goes on when their wizard is gone, too */
    readonly fire: FireRain

    constructor(protected override readonly floor: WizardFloor)
    {
        super(floor)
        this.fire = new FireRain(floor)
    }

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
            hue: rng.next(),
            casting: null,
            castWait: rng.next(FIRST_WAIT_MIN, FIRST_WAIT_MAX),
            flash: 0,
            shoveX: 0,
            shoveZ: 0
        }
        this.members.push(wizard)
        return wizard
    }

    update(delta: number, heroes: readonly Prey[]): void
    {
        this.updateSigils(delta)
        this.fire.update(delta)
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
            this.cast(wizard, prey, delta)
            if (wizard.casting)
            {
                turnTo(wizard, wizard.casting.x, wizard.casting.z, TURN_RATE * delta)
            }
            else
            {
                this.decide(wizard, delta)
            }
        }
    }

    /**
     * Anyone in a sigil gets hurt once it is drawn, and anyone fire strikes. No shield helps against either.
     */
    touch(hero: Prey, open: boolean): number
    {
        let damage = open ? this.fire.damageAt(hero.x, hero.z) : 0
        for (const { x, z, radius, age, broken, damage: taken } of this.sigils)
        {
            if (open && sigilPhase(age, broken).hurts && Math.hypot(hero.x - x, hero.z - z) < radius && this.floor.sees(x, z, hero.x, hero.z))
            {
                damage = Math.max(damage, taken)
            }
        }
        return damage
    }

    protected struck(wizard: Wizard): void
    {
        this.breakOff(wizard)
    }

    protected kill(wizard: Wizard): number
    {
        this.breakOff(wizard)
        return 1
    }

    /**
     * A blow breaks the sigil a wizard is drawing, and keeps fire from coming until the staff hits the floor
     */
    private breakOff(wizard: Wizard): void
    {
        const { casting } = wizard
        if (casting)
        {
            if (casting.sigil)
            {
                casting.sigil.broken = 0
            }
            this.endCast(wizard)
        }
    }

    private endCast(wizard: Wizard): void
    {
        wizard.casting = null
        wizard.castWait = rng.next(CAST_WAIT_MIN, CAST_WAIT_MAX)
    }

    private updateSigils(delta: number): void
    {
        const { sigils } = this
        for (let i = sigils.length - 1; i >= 0; i--)
        {
            const sigil = sigils[i]
            if (sigil.broken === null)
            {
                sigil.age += delta
            }
            else
            {
                sigil.broken += delta
            }
            if (sigilPhase(sigil.age, sigil.broken).opacity === 0)
            {
                sigils.splice(i, 1)
            }
        }
    }

    /**
     * Has a wizard go on with its spell, or start one on a hero close enough
     */
    private cast(wizard: Wizard, prey: Prey | null, delta: number): void
    {
        const { casting, kind, robe } = wizard
        if (casting)
        {
            casting.age += delta
            if (!casting.sigil && !casting.released)
            {
                // aims at where it last saw them until the staff hits the floor
                casting.x = wizard.goalX
                casting.z = wizard.goalZ
                if (casting.age >= STAFF_STOMP)
                {
                    casting.released = true
                    this.rainFire(wizard, casting.x, casting.z)
                }
            }
            if (casting.age >= (casting.sigil ? SIGIL_DRAW : FIRE_CAST))
            {
                this.endCast(wizard)
            }
            return
        }
        if (robe !== SIGIL_ROBE && robe !== FIRE_ROBE || wizard.chase === 0)
        {
            return
        }
        wizard.castWait = Math.max(0, wizard.castWait - delta)
        if (wizard.castWait > 0 || !prey || Math.hypot(prey.x - wizard.x, prey.z - wizard.z) > CAST_RANGE)
        {
            return
        }
        if (robe === FIRE_ROBE)
        {
            wizard.casting = { age: 0, x: prey.x, z: prey.z, sigil: null, released: false }
            return
        }
        const [x, z] = placeSigil(this.floor, prey.x, prey.z, SIGIL_RADIUS)
        const sigil: SigilState = { x, z, radius: SIGIL_RADIUS, damage: kind.damage, age: 0, broken: null, hue: wizard.hue }
        this.sigils.push(sigil)
        wizard.casting = { age: 0, x, z, sigil, released: false }
    }

    /**
     * Has fire come down in one of the patterns
     */
    private rainFire(wizard: Wizard, x: number, z: number): void
    {
        const name = FIRE_PATTERN_NAMES[Math.min(FIRE_PATTERN_NAMES.length - 1, Math.floor(rng.next() * FIRE_PATTERN_NAMES.length))]
        const spots = FIRE_PATTERNS[name]({ x, z, fromX: wizard.x, fromZ: wizard.z })
        this.fire.cast(spots, x, z, wizard.kind.fireDamage)
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
