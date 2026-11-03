import { Color } from "three"
import { rng, weightedRandom } from "../math/random"
import { HairStyle, type MeepleLook } from "./Meeple3D"

/*
 * Random looks of meeples
 */

const SKINS = [
    "#f0c8aa",
    "#d9a07e",
    "#a86a48",
    "#6b321b",
    "#301911"]
const HAIR = weightedRandom(
    [
        [1, "#a63a36"],
        [1, "#e1e6e6"],
        [0.5, "#9928b6"],
        [0.5, "#008ee1"],
        [6, "#bfa239"],
        [6, "#754b21"],
        [4, "#141414"]
    ]
)

const HAIR_STYLES = [
    HairStyle.CURLY,
    HairStyle.SHORT,
    HairStyle.BALD,
    HairStyle.LONG,
    HairStyle.SIDE_PART
];

const SHIRTS = ["#a01828", "#1a78b0", "#8c2898", "#187830", "#3a8c8c", "#8c8c8c", "#d0a838"]

function pick<T>(array: T[]): T
{
    return array[rng.nextInt(0, array.length - 1)]
}

/**
 * Returns a random look from the shared random sequence
 */
export function randomLook(): MeepleLook
{
    return {
        skin: new Color(pick(SKINS)),
        shirt: new Color(pick(SHIRTS)),
        hair: new Color(HAIR()),
        hairStyle: pick(HAIR_STYLES),
        height: rng.next()
    }
}
