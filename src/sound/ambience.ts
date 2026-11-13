import Prando from "prando"

/**
 * Seconds of overlap between the end and the start of a loop, which hides the seam
 */
const SEAM = 0.5

/**
 * Drips per second, about
 */
const DRIP_RATE = 0.6

/**
 * Returns a seamless loop of dungeon ambience: a low rumble of brown noise with water dripping now and then
 *
 * @param seed          seed of the loop, the same one gives the same samples
 * @param sampleRate    samples per second
 * @param seconds       length of the loop
 *
 * @returns mono samples between -1 and 1
 */
export function dripLoop(seed: number, sampleRate: number, seconds: number): Float32Array<ArrayBuffer>
{
    const random = new Prando(seed)
    const length = Math.round(seconds * sampleRate)
    const seam = Math.round(SEAM * sampleRate)
    const raw = new Float32Array(length + seam)

    let brown = 0
    for (let i = 0; i < raw.length; i++)
    {
        brown = (brown + 0.02 * random.next(-1, 1)) * 0.998
        raw[i] = brown * 0.6
    }

    const drips = Math.max(1, Math.round(seconds * DRIP_RATE))
    for (let d = 0; d < drips; d++)
    {
        addDrip(raw, sampleRate, random.nextInt(0, length - 1), random.next(900, 1800), random.next(0.15, 0.4))
    }

    // the tail fades into the start, so the end of the loop goes on where its start comes from
    const loop = raw.slice(0, length)
    for (let i = 0; i < seam; i++)
    {
        const share = i / seam
        loop[i] = raw[i] * share + raw[length + i] * (1 - share)
    }
    return loop
}


/**
 * Adds a drop of water hitting a puddle: a short tone that rises in pitch and dies away, like the bubble it leaves
 */
function addDrip(samples: Float32Array, sampleRate: number, at: number, pitch: number, loudness: number): void
{
    const length = Math.round(0.12 * sampleRate)
    let phase = 0
    for (let i = 0; i < length; i++)
    {
        const t = i / sampleRate
        phase += Math.PI * 2 * pitch * (1 + 0.6 * (1 - Math.exp(-t * 50))) / sampleRate
        const envelope = Math.min(1, t * 2000) * Math.exp(-t * 40)
        samples[(at + i) % samples.length] += Math.sin(phase) * envelope * loudness
    }
}
