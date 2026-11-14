import { blendShots, type Shot, SHOTS } from "./sceneCamera"
import ScenePlayer, { type Beat } from "./script"

/**
 * Seconds the camera takes from one shot to the next
 */
export const BLEND_TIME = 0.9

/**
 * Seconds an act beat takes
 */
export const ACT_TIME = 1.2


/**
 * Plays a scene in time: it moves the camera between shots, waits for acts to end, and for the player to go on after
 * someone said or showed something, or to choose.
 */
export default class SceneStage
{
    /** where the camera is, relative to the main actors */
    readonly shot: Shot
    private readonly from: Shot
    private to: Shot | null = null
    /** seconds the current beat has been going on */
    private time = 0

    /**
     * @param onBeat    called when the scene waits on another beat, or ended, not for the one it starts with
     */
    constructor(private readonly player: ScenePlayer, private readonly onBeat: () => void)
    {
        const first = player.beat
        // the first shot is a cut
        this.shot = { ...SHOTS[first?.kind === "shot" ? first.shot : "two"] }
        this.from = { ...this.shot }
        if (first?.kind === "shot")
        {
            player.done()
        }
        this.setUp()
    }

    /**
     * The beat the scene waits on, null once it ended
     */
    get beat(): Beat<string> | null
    {
        return this.player.beat
    }

    get ended(): boolean
    {
        return this.player.ended
    }

    /**
     * Returns whether the player can go on with the current beat, which they have to for things said or shown
     */
    get waitsOnPlayer(): boolean
    {
        const kind = this.beat?.kind
        return kind === "say" || kind === "show"
    }

    /**
     * Seconds the current beat has been going on
     */
    get beatTime(): number
    {
        return this.time
    }

    update(delta: number): void
    {
        const { beat } = this
        if (!beat)
        {
            return
        }
        this.time += delta
        if (beat.kind === "shot")
        {
            const t = Math.min(1, this.time / BLEND_TIME)
            blendShots(this.from, this.to!, t, this.shot)
            if (t === 1)
            {
                this.advance()
            }
        }
        else if (beat.kind === "act" && this.time >= ACT_TIME)
        {
            this.advance()
        }
    }

    /**
     * The player goes on after something said or shown
     *
     * @returns false if the beat isn't one they can go on from yet
     */
    next(): boolean
    {
        if (!this.waitsOnPlayer)
        {
            return false
        }
        this.advance()
        return true
    }

    /**
     * The player picks an option of the current choice
     */
    choose(index: number): void
    {
        this.player.choose(index)
        this.begin()
    }

    private advance(): void
    {
        this.player.done()
        this.begin()
    }

    private begin(): void
    {
        this.setUp()
        this.onBeat()
    }

    private setUp(): void
    {
        this.time = 0
        const { beat } = this
        if (beat?.kind === "shot")
        {
            Object.assign(this.from, this.shot)
            this.to = SHOTS[beat.shot]
        }
    }
}
