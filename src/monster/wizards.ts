import { rng } from "../math/random"
import { FIGURE_SCALE } from "../meeple/figureScale"
import { CHASE_TIME, type Monster, type MonsterFloor, type MonsterKind, HERO_RADIUS, MonsterPack, type Prey, turnTo } from "./monsters"
import { BEAM_CAST_END, BEAM_FADE_TIME, BEAM_FIRE, beamPhase } from "../render/beamTiming"
import { SIGIL_DRAW, sigilPhase } from "../render/sigilShape"
import { placeSigil, type SigilFloor, type SigilState, SIGIL_RADIUS } from "./sigils"
import { FIRE_PATTERN_NAMES, FIRE_PATTERNS } from "./firePatterns"
import { BLOCK_ANGLE } from "./eyes"
import FireRain, { type FireFloor } from "./fireRain"
import { brain, type Brain, condition, leaf, selector, sequence, Tree } from "./behavior"

const TAU = Math.PI * 2

/**
 * Colors of robes: blue wizards cast sigils, red ones have it rain fire, and purple ones sweep a beam around
 */
export type Robe = "blue" | "red" | "purple"

/**
 * How fast a wizard turns around with its beam, in radians per second, and how far in all. Heroes can keep ahead of it
 * close by.
 */
export const BEAM_TURN_RATE = 0.6
export const BEAM_TURN = TAU

/**
 * How far from its axis a beam hits heroes besides their own radius, and how far it goes at most, in world units
 */
const BEAM_RADIUS = 0.03 * FIGURE_SCALE
const BEAM_REACH = 40 * FIGURE_SCALE

/**
 * Where the tip of the staff is while it fires, to the left of a wizard and ahead of it, in world units. These are for a
 * wizard of scale 1, with the 0.3 world units per unit of the models that meeples have.
 */
const TIP_LEFT = -0.298 * 0.3 * FIGURE_SCALE
const TIP_AHEAD = 0.675 * 0.3 * FIGURE_SCALE

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
    robe: Robe
    /** walking speed in world units per second */
    speed: number
    /** how close it comes to who it goes after, in world units */
    keepAway: number
    /** hit points a sigil takes */
    damage: number
    /** hit points a strike of fire takes */
    fireDamage: number
    /** hit points a beam takes */
    beamDamage: number
}

/**
 * What wizards of all colors have in common
 */
export const WIZARD: Omit<WizardKind, "robe"> = {
    scale: 1,
    radius: 0.11 * FIGURE_SCALE,
    mass: 0.8,
    hp: 5,
    big: true,
    flying: false,
    // the robe, and the staff on its right
    burst: [
        { x: 0, y: 0.55, z: 0, rx: 0.25, ry: 0.55, rz: 0.22, colors: ["#d8d8d8", "#a0a0a0", "#1a1a1a"] },
        { x: -0.4, y: 0.6, z: 0.18, rx: 0.04, ry: 0.55, rz: 0.04, colors: ["#5b3a24"] }
    ],
    speed: 0.45 * FIGURE_SCALE,
    keepAway: 1.5 * FIGURE_SCALE,
    damage: 3,
    fireDamage: 2,
    beamDamage: 2
}

export const BLUE_WIZARD: WizardKind = { ...WIZARD, robe: "blue" }
export const RED_WIZARD: WizardKind = { ...WIZARD, robe: "red" }
export const PURPLE_WIZARD: WizardKind = { ...WIZARD, robe: "purple" }

/**
 * A beam that turns around with its wizard
 */
export interface BeamState
{
    caster: Wizard
    /** seconds since the staff started to charge */
    age: number
    /** age at which it starts to fade */
    until: number
    /** where it starts, in world units */
    x: number
    z: number
    /** which way it goes, in radians */
    yaw: number
    /** which way it turns, 1 or -1 */
    spin: number
    /** how far it goes in world units */
    reach: number
    /** who it ends at, null if it hits a wall */
    hit: Prey | null
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
    /** sigil it is drawing, null for another spell */
    sigil: SigilState | null
    /** beam it fires, null for another spell */
    beam: BeamState | null
    /** whether the fire is on its way, so putting off the wizard doesn't stop it */
    released: boolean
}

export interface Wizard extends Monster
{
    kind: WizardKind
    brain: Brain
    /** how good it is at fighting, from 0 to 1 */
    skill: number
    /** walking somewhere with nobody to go after */
    wandering: boolean
    /** world units walked in all, which the walk clip follows */
    walked: number
    /** walked in this frame */
    moving: boolean
    /** seconds until it looks around again */
    lookWait: number
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
    /**
     * Returns the distance from a point to the first wall in a direction of length 1, but not more than the given one
     */
    wallAhead(x: number, z: number, dirX: number, dirZ: number, most: number): number
}


/**
 * The wizards of a level. They wander about, and walk up to heroes they see, but stay some way off. Blue ones stop to cast
 * sigils under heroes and red ones to have it rain fire. Purple ones stop to turn around once with a beam, whoever is there.
 */
export default class WizardPack extends MonsterPack<Wizard>
{
    /** on the floor, which stay when their wizard is gone */
    readonly sigils: SigilState[] = []
    /** turn with their wizard, and fade where they are when it is put off or gone */
    readonly beams: BeamState[] = []
    /** goes on when their wizard is gone, too */
    readonly fire: FireRain

    constructor(protected override readonly floor: WizardFloor)
    {
        super(floor)
        this.fire = new FireRain(floor)
    }

    /**
     * @param skill     how good it is at fighting, from 0 to 1
     */
    add(kind: WizardKind, face: number, x: number, z: number, skill = 0): Wizard
    {
        const wizard: Wizard = {
            kind,
            brain: brain(),
            skill,
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
            if (wizard.chase > 0 && !wizard.casting)
            {
                wizard.castWait = Math.max(0, wizard.castWait - delta)
            }
            WIZARD_TREE.tick(wizard, { pack: this, prey, delta })
        }
        this.updateBeams(delta, heroes)
    }

    /**
     * Anyone in a sigil gets hurt once it is drawn, and anyone fire strikes. No shield helps against either, but one in about
     * the right direction does against a beam.
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
        for (const { age, until, yaw, hit, caster } of this.beams)
        {
            const blocked = hero.blocking && -Math.cos(hero.facing - yaw) >= Math.cos(BLOCK_ANGLE)
            if (open && hit === hero && !blocked && beamPhase(age, until).hurts)
            {
                damage = Math.max(damage, caster.kind.beamDamage)
            }
        }
        return damage
    }

    protected struck(wizard: Wizard): void
    {
        WIZARD_TREE.interrupt(wizard)
    }

    protected kill(wizard: Wizard): number
    {
        WIZARD_TREE.interrupt(wizard)
        return 1
    }

    /**
     * A blow breaks the sigil a wizard is drawing and its beam, and keeps fire from coming until the staff hits the floor
     */
    static breakOff(wizard: Wizard): void
    {
        const { casting } = wizard
        if (casting)
        {
            if (casting.sigil)
            {
                casting.sigil.broken = 0
            }
            if (casting.beam)
            {
                casting.beam.until = Math.min(casting.beam.until, casting.beam.age)
            }
            WizardPack.endCast(wizard)
        }
    }

    private static endCast(wizard: Wizard): void
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
     * Has the beams go on, and stop at the first wall or hero in their way
     */
    private updateBeams(delta: number, heroes: readonly Prey[]): void
    {
        const { beams, floor } = this
        for (let i = beams.length - 1; i >= 0; i--)
        {
            const beam = beams[i]
            const { caster } = beam
            beam.age += delta
            if (beam.age >= beam.until + BEAM_FADE_TIME)
            {
                beams.splice(i, 1)
                continue
            }
            if (caster.casting?.beam === beam)
            {
                const { x, z, yaw, kind: { scale } } = caster
                const sin = Math.sin(yaw), cos = Math.cos(yaw)
                beam.yaw = yaw
                beam.x = x + (cos * TIP_LEFT + sin * TIP_AHEAD) * scale
                beam.z = z + (cos * TIP_AHEAD - sin * TIP_LEFT) * scale
            }
            const dirX = Math.sin(beam.yaw), dirZ = Math.cos(beam.yaw)
            // the staff can stick into a wall
            beam.reach = floor.sees(caster.x, caster.z, beam.x, beam.z) ? floor.wallAhead(beam.x, beam.z, dirX, dirZ, BEAM_REACH) : 0
            beam.hit = null
            for (const hero of heroes)
            {
                const dx = hero.x - beam.x, dz = hero.z - beam.z
                const along = dx * dirX + dz * dirZ
                const aside = Math.abs(dx * dirZ - dz * dirX)
                if (!hero.dodging && along > 0 && aside < HERO_RADIUS + BEAM_RADIUS)
                {
                    const reach = Math.max(0, along - Math.sqrt(Math.max(0, HERO_RADIUS ** 2 - aside ** 2)))
                    if (reach < beam.reach)
                    {
                        beam.reach = reach
                        beam.hit = hero
                    }
                }
            }
        }
    }

    /**
     * Has a wizard go on with its spell, and turn with its beam or to where it casts
     *
     * @return false once it is done
     */
    goOnCasting(wizard: Wizard, delta: number): boolean
    {
        const casting = wizard.casting!
        casting.age += delta
        if (wizard.kind.robe === "red" && !casting.released)
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
        if (casting.age >= (casting.beam ? casting.beam.until + BEAM_CAST_END : casting.sigil ? SIGIL_DRAW : FIRE_CAST))
        {
            WizardPack.endCast(wizard)
            return false
        }
        return true
    }

    /**
     * Has a wizard start a spell on a hero close enough, or in sight for a beam
     *
     * @return false if it can't
     */
    startCast(wizard: Wizard, prey: Prey | null): boolean
    {
        const { kind } = wizard
        const { robe } = kind
        if (wizard.castWait > 0 || !prey || robe !== "purple" && Math.hypot(prey.x - wizard.x, prey.z - wizard.z) > CAST_RANGE)
        {
            return false
        }
        if (robe === "purple")
        {
            const beam: BeamState = {
                caster: wizard,
                age: 0,
                until: BEAM_FIRE + BEAM_TURN / BEAM_TURN_RATE,
                x: wizard.x,
                z: wizard.z,
                yaw: wizard.yaw,
                spin: rng.next() < 0.5 ? 1 : -1,
                reach: 0,
                hit: null
            }
            this.beams.push(beam)
            wizard.casting = { age: 0, x: prey.x, z: prey.z, sigil: null, beam, released: false }
            return true
        }
        if (robe === "red")
        {
            wizard.casting = { age: 0, x: prey.x, z: prey.z, sigil: null, beam: null, released: false }
            return true
        }
        const [x, z] = placeSigil(this.floor, prey.x, prey.z, SIGIL_RADIUS)
        const sigil: SigilState = { x, z, radius: SIGIL_RADIUS, damage: kind.damage, age: 0, broken: null, hue: wizard.hue }
        this.sigils.push(sigil)
        wizard.casting = { age: 0, x, z, sigil, beam: null, released: false }
        return true
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
     * With nobody to go after, has a wizard look around now and then, and walk somewhere sometimes
     */
    wander(wizard: Wizard, delta: number): void
    {
        if (!wizard.wandering)
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
        const step = wizard.kind.speed * delta
        // a wall in the way ends a walk about
        if (this.walkTo(wizard, 0.01, delta) < step / 2)
        {
            wizard.wandering = false
        }
    }

    /**
     * Turns a wizard to its goal and walks it there, up to the given distance away
     *
     * @return world units walked
     */
    walkTo(wizard: Wizard, stop: number, delta: number): number
    {
        turnTo(wizard, wizard.goalX, wizard.goalZ, TURN_RATE * delta)
        const dx = wizard.goalX - wizard.x, dz = wizard.goalZ - wizard.z
        const distance = Math.hypot(dx, dz)
        if (distance <= stop)
        {
            return 0
        }
        const length = Math.min(wizard.kind.speed * delta, distance - stop)
        const { x, z } = wizard
        this.floor.move(wizard, dx / distance * length, dz / distance * length)
        const moved = Math.hypot(wizard.x - x, wizard.z - z)
        wizard.walked += moved
        wizard.moving = moved > 0
        return moved
    }
}


/**
 * What the wizard tree gets each frame
 */
interface WizardContext
{
    pack: WizardPack
    /** closest hero in sight */
    prey: Prey | null
    delta: number
}

const cast = leaf<Wizard, WizardContext>("cast", {
    commits: true,
    start: (wizard, { pack, prey }) => pack.startCast(wizard, prey),
    tick: (wizard, { pack, delta }) =>
    {
        if (!pack.goOnCasting(wizard, delta))
        {
            return "success"
        }
        const { casting } = wizard
        if (casting?.beam)
        {
            const { age, until, spin } = casting.beam
            wizard.yaw += age < until ? spin * BEAM_TURN_RATE * delta : 0
        }
        else if (casting)
        {
            turnTo(wizard, casting.x, casting.z, TURN_RATE * delta)
        }
        return "running"
    },
    stop: wizard => WizardPack.breakOff(wizard)
})

const approach = leaf<Wizard, WizardContext>("approach", {
    tick: (wizard, { pack, delta }) =>
    {
        pack.walkTo(wizard, wizard.kind.keepAway, delta)
        return "running"
    }
})

const wander = leaf<Wizard, WizardContext>("wander", {
    tick: (wizard, { pack, delta }) =>
    {
        pack.wander(wizard, delta)
        return "running"
    }
})

/**
 * Wizards go after heroes they saw and cast at them when they can, and wander about otherwise
 */
export const WIZARD_TREE = new Tree<Wizard, WizardContext>(selector("wizard",
    sequence("fight",
        condition("hunting", ({ chase }) => chase > 0),
        selector("attack or close in",
            sequence("spell", condition("ready", ({ castWait }, { prey }) => castWait === 0 && prey !== null), cast),
            approach
        )
    ),
    wander
))
