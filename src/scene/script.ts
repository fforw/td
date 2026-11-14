/**
 * Scripts of scenes, see plans/discovery.md 2.7. A script is a graph of beats. The player walks it, and whatever shows
 * the scene tells it when a beat that takes time is over, or what the player chose.
 */

/**
 * Who takes part in a scene: "a" and "b" are the two main actors, who span the line of action, the hero is always one
 * of them
 */
export type ActorRole = "a" | "b"

/**
 * Things a hero can buy and drink or use at once
 */
export type Ware = "healing" | "speed" | "strength" | "map"

/**
 * How an actor feels, shown in their bubble along with what they say
 */
export type Emotion = "joy" | "anger" | "fear" | "love" | "sad" | "puzzled"

/**
 * A camera position relative to the two main actors, see sceneCamera.ts
 */
export type ShotName = "two" | "overA" | "overB"

/**
 * A word of the glyph language: a concept, or a ware
 */
export type Word = string

/**
 * What a check asks about the hero
 */
export type Condition =
    | { gold: number }
    | { fact: string }

export interface Choice<K extends string>
{
    /** what the player sees, which gets less doubtful as they understand more */
    label: string
    next: K
}

/**
 * One step of a scene. Beats that take time wait for the stage, the others happen at once. A beat without next ends
 * the scene.
 */
export type Beat<K extends string> =
    | { kind: "shot", shot: ShotName, next?: K }
    | { kind: "say", actor: ActorRole, words: Word[], emotion?: Emotion, next?: K }
    | { kind: "act", actor: ActorRole, clip: string, next?: K }
    | { kind: "show", actor: ActorRole, ware: Ware, price: number, next?: K }
    | { kind: "choice", options: Choice<K>[] }
    | { kind: "check", condition: Condition, then: K, else: K }
    | { kind: "pay", gold: number, next?: K }
    | { kind: "use", ware: Ware, next?: K }
    | { kind: "set", fact: string, next?: K }

export type BeatKind = Beat<string>["kind"]

/**
 * Beats that wait for the stage before the scene goes on
 */
const TIMED: ReadonlySet<BeatKind> = new Set(["shot", "say", "act", "show", "choice"])

export interface Script<K extends string = string>
{
    /** which of the main actors is on the left of the screen, the camera stays on that side of the line between them */
    left: ActorRole
    start: K
    beats: Record<K, Beat<K>>
}

/**
 * What a scene can find out about and change in the game. The hero is the one who takes part.
 */
export interface SceneWorld
{
    /** gold the hero carries */
    gold(): number
    /** takes gold from the hero */
    pay(gold: number): void
    /** has the hero drink or use a ware */
    use(ware: Ware): void
    fact(name: string): boolean
    setFact(name: string): void
}

/**
 * Most instant beats in a row before a script counts as stuck in a loop
 */
const MOST_INSTANT = 1000


/**
 * Walks the beat graph of a script
 */
export default class ScenePlayer<K extends string = string>
{
    private current: K | null

    constructor(private readonly script: Script<K>, private readonly world: SceneWorld)
    {
        this.current = script.start
        this.settle()
    }

    /**
     * The beat the scene waits on, null once it ended
     */
    get beat(): Beat<K> | null
    {
        return this.current === null ? null : this.script.beats[this.current]
    }

    get ended(): boolean
    {
        return this.current === null
    }

    /**
     * The stage is done with the beat it was showing
     */
    done(): void
    {
        const beat = this.beat
        if (!beat || beat.kind === "choice" || beat.kind === "check")
        {
            throw new Error("Nothing to be done with: " + (beat?.kind ?? "the scene ended"))
        }
        this.go(beat.next)
    }

    /**
     * The player picked one of the options of the current choice
     */
    choose(index: number): void
    {
        const beat = this.beat
        if (beat?.kind !== "choice")
        {
            throw new Error("No choice to make")
        }
        const option = beat.options[index]
        if (!option)
        {
            throw new Error("No option " + index)
        }
        this.go(option.next)
    }

    private go(next: K | undefined): void
    {
        this.current = next ?? null
        this.settle()
    }

    /**
     * Runs the beats that happen at once, until one that takes time or the end
     */
    private settle(): void
    {
        const { world, script } = this
        for (let count = 0; this.current !== null; count++)
        {
            if (count === MOST_INSTANT)
            {
                throw new Error("Scene loops without waiting at " + this.current)
            }
            const beat: Beat<K> | undefined = script.beats[this.current]
            if (!beat)
            {
                throw new Error("No beat " + this.current)
            }
            if (TIMED.has(beat.kind))
            {
                return
            }
            switch (beat.kind)
            {
                case "check":
                    this.current = holds(beat.condition, world) ? beat.then : beat.else
                    break
                case "pay":
                    world.pay(beat.gold)
                    this.current = beat.next ?? null
                    break
                case "use":
                    world.use(beat.ware)
                    this.current = beat.next ?? null
                    break
                case "set":
                    world.setFact(beat.fact)
                    this.current = beat.next ?? null
                    break
            }
        }
    }
}


function holds(condition: Condition, world: SceneWorld): boolean
{
    return "gold" in condition ? world.gold() >= condition.gold : world.fact(condition.fact)
}


/**
 * Returns the beats that a script can't get to from its start, and the links to beats it doesn't have
 */
export function checkScript(script: Script): { unreachable: string[], missing: string[] }
{
    const seen = new Set<string>()
    const missing = new Set<string>()
    const open = [script.start]
    while (open.length)
    {
        const key = open.pop()!
        if (seen.has(key))
        {
            continue
        }
        const beat = script.beats[key]
        if (!beat)
        {
            missing.add(key)
            continue
        }
        seen.add(key)
        open.push(...links(beat))
    }
    return { unreachable: Object.keys(script.beats).filter(key => !seen.has(key)), missing: [...missing] }
}


function links(beat: Beat<string>): string[]
{
    switch (beat.kind)
    {
        case "choice":
            return beat.options.map(option => option.next)
        case "check":
            return [beat.then, beat.else]
        default:
            return beat.next === undefined ? [] : [beat.next]
    }
}
