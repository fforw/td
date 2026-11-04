import { patchSeed, rng, weightedRandom, withSeed } from "../math/random"
import type { Impression, PatchKind, PatchNode } from "./campaign"

/**
 * Mixed into the seed of a patch for its kind roll, and into the campaign seed for the start
 */
const KIND_SALT = 0x6b1d
const START_SALT = 0x57a7

/**
 * Offsets of the eight patches around a patch
 */
export const NEIGHBORS: readonly [number, number][] = [
    [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]
]

const KIND_CHOICES = weightedRandom<PatchKind>([
    [5, "EMPTY"],
    [2, "DUNGEON"],
    [2, "TREASURE"],
    [1, "TEMPLE"]
])


/**
 * Rolls the kind of an overworld patch. Only depends on the seed and the position.
 */
export function randomKind(seed: number, q: number, r: number): PatchKind
{
    return withSeed(patchSeed(seed ^ KIND_SALT, q, r), () => KIND_CHOICES(rng.next()))
}


/**
 * What an explorer passing through makes of a patch. Only dungeons count as dangerous until there are threats to
 * look out for.
 */
export function impressionOf(kind: PatchKind): Impression
{
    return kind === "DUNGEON" ? "dangerous" : "safe"
}


/**
 * Returns the patches known at the start of a campaign: the castle and the eight patches around it, which the 3D
 * view shows from the start. Knowing a patch means knowing its kind, so the first dungeon (plan 1.2) is one of them.
 */
export function startPatches(seed: number): PatchNode[]
{
    const dungeon = withSeed(patchSeed(seed ^ START_SALT, 0, 0), () => rng.nextInt(0, NEIGHBORS.length - 1))
    return [
        { q: 0, r: 0, kind: "CASTLE", state: "discovered", parent: null },
        ...NEIGHBORS.map(([q, r], i): PatchNode => ({
            q,
            r,
            kind: i === dungeon ? "DUNGEON" : randomKind(seed, q, r),
            state: "discovered",
            parent: "0/0"
        }))
    ]
}
