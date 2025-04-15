import Prando from "prando";


export function clamp(v)
{
    return v < 0 ? 0 : v > 1 ? 1 : v;
}


/**
 * Creates a random seed to create a Prando instance, since we're about to create prando, we don't use it but the
 * non-reproducible normal js random
 *
 * @return {number}
 */
export function randomSeed(override = null)
{
    const seed = Math.round(typeof override === "number" ? override : Math.random() * 0xffffffff)
    console.log("SEED", seed)
    return seed
}


export let rng = new Prando(randomSeed() )

export function resetRandom(seed)
{
    rng = new Prando(seed)
}
