import { mixer } from "./mixer"

const SOUNDS = import.meta.env.BASE_URL + "media/sounds/"

const buffers = new Map<string, Promise<AudioBuffer | null>>()


/**
 * Loads a sound effect from the sounds directory once, for playEffect() to play it without waiting. A sound that doesn't
 * load comes out as null.
 *
 * @param name  file name
 */
export function loadEffect(name: string): Promise<AudioBuffer | null>
{
    let buffer = buffers.get(name)
    if (!buffer)
    {
        buffer = fetch(SOUNDS + name)
            .then(response => response.arrayBuffer())
            .then(data => mixer().context.decodeAudioData(data))
            .catch(error => {
                console.warn("Sound effect", name, "didn't load:", error)
                return null
            })
        buffers.set(name, buffer)
    }
    return buffer
}

/**
 * Plays a sound effect from the sounds directory once through the effects of the mixer, from nowhere in particular, as
 * soon as it is loaded. It plays to its end, whatever happens meanwhile.
 *
 * @param name  file name
 */
export function playEffect(name: string): void
{
    void loadEffect(name).then(buffer => {
        if (buffer)
        {
            const source = new AudioBufferSourceNode(mixer().context, { buffer })
            source.connect(mixer().input("effects"))
            source.start()
        }
    })
}
