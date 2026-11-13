/**
 * Groups of sounds with a volume each
 */
export type SoundGroup = "music" | "effects" | "ambience"

const VOLUMES: Record<SoundGroup, number> = {
    music: 1,
    effects: 1,
    ambience: 0.6
}

/**
 * Seconds a mute or volume change takes
 */
const FADE = 0.15

/**
 * The one AudioContext of the page, with a gain per sound group that all go into the master gain. Browsers only start
 * it with a user gesture, so it resumes on the first click or key press.
 */
export class Mixer
{
    readonly context = new AudioContext()
    private readonly master: GainNode
    private readonly groups: Record<SoundGroup, GainNode>

    constructor()
    {
        const { context } = this
        this.master = new GainNode(context)
        this.master.connect(context.destination)
        const group = (name: SoundGroup): GainNode => {
            const gain = new GainNode(context, { gain: VOLUMES[name] })
            gain.connect(this.master)
            return gain
        }
        this.groups = { music: group("music"), effects: group("effects"), ambience: group("ambience") }

        if (context.state !== "running")
        {
            const resume = (): void => {
                void context.resume()
                window.removeEventListener("pointerdown", resume, true)
                window.removeEventListener("keydown", resume, true)
            }
            window.addEventListener("pointerdown", resume, true)
            window.addEventListener("keydown", resume, true)
        }
    }

    /**
     * Returns the node to connect the sounds of a group to
     */
    input(group: SoundGroup): AudioNode
    {
        return this.groups[group]
    }

    /**
     * Plays a media element through a group
     */
    attach(element: HTMLMediaElement, group: SoundGroup): void
    {
        this.context.createMediaElementSource(element).connect(this.groups[group])
        // a media element may be allowed to play before the context is
        element.addEventListener("play", () => void this.context.resume())
    }

    /**
     * Mutes all sounds, or lets them be heard again
     */
    mute(muted: boolean): void
    {
        this.master.gain.setTargetAtTime(muted ? 0 : 1, this.context.currentTime, FADE / 3)
    }
}


let shared: Mixer | null = null

/**
 * Returns the mixer of the page, which gets created on the first call
 */
export function mixer(): Mixer
{
    shared ??= new Mixer()
    return shared
}
