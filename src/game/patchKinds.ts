import { generatePatch } from "../map/generatePatch"
import { PATCH_SIZE } from "../map/HexagonPatch"
import { FACE_SIZE } from "../map/scale"
import { patchSeed, rng, weightedRandom, withSeed } from "../math/random"
import type { Impression, KindEdits, PatchKind, PatchNode } from "./campaign"

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
 * Returns the natural kind of an overworld patch, which only depends on the seed and the position: the castle at 0/0, a
 * roll anywhere else.
 */
export function naturalKind(seed: number, q: number, r: number): PatchKind
{
    return q === 0 && r === 0
        ? "CASTLE"
        : withSeed(patchSeed(seed ^ KIND_SALT, q, r), () => KIND_CHOICES(rng.next()))
}


/**
 * Returns the kind an overworld patch is meant to be: what the game rules made it, its natural kind otherwise. Its
 * generator can still end up with NONE.
 */
export function wantedKind(seed: number, edits: KindEdits, q: number, r: number): PatchKind
{
    return edits[q + "/" + r] ?? naturalKind(seed, q, r)
}


/**
 * Returns the edits that are not in the given ones sent before. Edits never get removed, going back to the natural kind
 * is an edit as well.
 */
export function unsentEdits(edits: KindEdits, sent: KindEdits): KindEdits
{
    return Object.fromEntries(Object.entries(edits).filter(([key, kind]) => sent[key] !== kind))
}


/**
 * Returns what a patch ends up as when it is meant to be the given kind
 */
export type GeneratedKind = (seed: number, q: number, r: number, kind: PatchKind) => PatchKind


/**
 * Asks the generator on this thread. Generating a patch resets the random generator, so that happens under a seed of its
 * own.
 */
const generatedKind: GeneratedKind = (seed, q, r, kind) => withSeed(
    seed,
    () => generatePatch(q * PATCH_SIZE, r * PATCH_SIZE, seed, FACE_SIZE, kind).kind
)


/**
 * Returns the kind edits a campaign starts with. The first dungeon (plan 1.2) has to be next to the castle, so it goes on
 * the first patch next to the castle that has room for it, starting at one picked by the seed. A world without such a
 * patch starts without an edit.
 *
 * @param seed          campaign seed
 * @param generated     what patches end up as
 */
export function startEdits(seed: number, generated: GeneratedKind = generatedKind): KindEdits
{
    const first = withSeed(patchSeed(seed ^ START_SALT, 0, 0), () => rng.nextInt(0, NEIGHBORS.length - 1))
    for (let i = 0; i < NEIGHBORS.length; i++)
    {
        const [q, r] = NEIGHBORS[(first + i) % NEIGHBORS.length]
        if (generated(seed, q, r, "DUNGEON") === "DUNGEON")
        {
            return { [q + "/" + r]: "DUNGEON" }
        }
    }
    return {}
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
 * view shows from the start. Knowing a patch means knowing what it ended up as.
 *
 * @param seed          campaign seed
 * @param edits         kind edits of the campaign
 * @param generated     what patches end up as
 */
export function startPatches(seed: number, edits: KindEdits, generated: GeneratedKind = generatedKind): PatchNode[]
{
    return [
        { q: 0, r: 0, kind: "CASTLE", state: "discovered", parent: null },
        ...NEIGHBORS.map(([q, r]): PatchNode => ({
            q,
            r,
            kind: generated(seed, q, r, wantedKind(seed, edits, q, r)),
            state: "discovered",
            parent: "0/0"
        }))
    ]
}
