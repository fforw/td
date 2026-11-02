# Discovery gameplay - implementation plan

Gameplay starts at the castle patch. Heroes are sent out to discover
neighboring patches. Discovered patches can be good, bad or neutral
(dungeon, treasure, temple, empty). Later phases add bandits, and foes
that come out of what the player did during discovery.

This plan builds on the packed patch pipeline: the map worker generates
`QuadPatch`es, `PatchWorld` connects them along seams on the main thread.

## Phase 0 - Foundations

### 0.1 Separate the simulation set from the render set

Today `world3d.ts` loads patches around the camera, and `PatchWorld` only
contains what is rendered. Missions and threats need patches regardless
of where the camera is.

- New owner of the `PatchWorld` (e.g. `game/SimWorld.ts`): holds all
  known patches plus patches targeted by a running mission, requests them
  from `MapWorkerClient`, connects them.
- Rendering picks the patches near the camera out of the simulation set
  and only adds ground meshes and models for those. Patches outside the
  simulation set (pure scenery) can still be loaded for display.
- Ground rebuild rules stay as they are (`updateGround` for a patch and
  its neighbors when seams change).

### 0.2 Patch nodes

Persistent game state per patch, keyed by `q/r`:

```ts
interface PatchNode
{
    q: number
    r: number
    kind: PatchKind          // CASTLE, DUNGEON, TREASURE, TEMPLE, EMPTY, ...
    state: "targeted" | "discovered"
    parent: string | null    // patch key it was discovered from
    overlay: Map<number, number>   // local face -> FaceType index
    entities: Entity[]       // gameplay objects on faces, keyed by local face
    events: PatchEvent[]     // looted, cleared, desecrated, ...
}
```

- The grid gives adjacency, `parent` gives the discovery tree.
- Patch contents are `f(seed, q, r, kind)` plus the overlay. The kind is
  game state, not derived from the seed alone, so it is persisted.
- Serializable to JSON. Store a generator version with saves: overlays,
  entities and events reference local face indexes, which are only stable
  as long as generation doesn't change.

### 0.3 Face overlay

- On patch load, write the node's overlay entries into `patch.faceType`
  before `world.add()`. Reads stay at array speed.
- `setFaceType(globalFace, type)`: resolve slot -> patch `q/r` + local
  face, record in the overlay, write into the live array, rebuild the
  patch's ground and models, and the ground of every neighbor patch
  that a half edge of the face twins into.
- Optional: keep the generated value on first edit to allow reverting.

### 0.4 Patch kinds in the worker

- Replace `PatchRequest.castle: boolean` with `kind: PatchKind`.
- The worker runs the feature planner for the kind after terrain, like
  `planCastle` today: CASTLE (existing), DUNGEON (entrance), TREASURE,
  TEMPLE, EMPTY (terrain only).
- `BuiltPatch.castle` becomes a per-kind feature plan.

### 0.5 Campaign start

The game is called "Treasure & Dread". Every campaign gets a generated
subtitle on top of that.

- Subtitle: "<Word> of <castle name>", e.g. "Oaths of Velmarra". The
  castle name comes from `cityNameGenerator`; the word from a weighted
  list (Tidings, Trails, Tales, Trespasses, Debts, Deeds, Oaths, ... common;
  Tombs, Dread, Ashes, ... rare). No other place names in the subtitle.
- Everything derives from the seed, picked with the seeded rng, so a
  seed always gives the same castle and subtitle.
- Start screen: logo, subtitle and a preview of the generated castle
  patch behind it. Reroll draws a new seed; play creates the campaign
  record. Nothing is saved before play.
- The campaign record holds seed, subtitle, castle name and the patch
  nodes.
- Keep the subtitle generator separate from the castle code, so it can
  later name a key figure instead ("The Oath of Kenrik", via
  `meepleNameGenerator`).

## Phase 1 - Discovery

### 1.1 Movement cost and pathfinding

- Cost per `FaceType`; impassable defaults to the existing `occupied`
  flag (WATER, ROCK, TREE, WALL, HOUSE, ...). GATE is passable.
- A* over faces of the simulation `PatchWorld`, crossing seams via
  `twin()`. Heuristic: centroid distance times the cheapest cost.
- Cost tables are per traveller, so hero traits (ranger, dwarf) and later
  bandits can use their own.
- Main thread first; move into the worker if it gets slow.

### 1.2 Missions

- A mission is a hero plus a target patch adjacent to a discovered patch.
- On start: roll the target's kind (rule first, then seeded roll), mark it
  `targeted`, generate it into the simulation set.
- The route may go through any discovered patch, not only the one next to
  the target.
- Success: A* cost -> day bucket. Thresholds are multiples of the cost of
  crossing one patch on open ground (`PATCH_SIZE` faces times the
  cheapest cost), so they survive changes of `PATCH_SIZE`/`FACE_SIZE`.
  The patch becomes `discovered` with `parent` set.
- Failure: "can't get from here to there". Costs the days to the furthest
  point the search reached, so failing isn't a free probe.
- Rule: the first *successful* discovery is a DUNGEON (attaching it to the
  first attempt could waste it on a blocked route).

### 1.3 Heroes

- Heroes come out of the generated meeple population.
- Attribute for wisdom/exploration: scales the failure cost down. The
  Explorer class is a hero with a high value, finding dead ends early.
- Keep classes distinct: the Explorer is cheap at failing, not best at
  everything.

### 1.4 Patch map UI

- Hex map of discovered and targeted patches with their kinds.
- Pick a hero and a neighboring unknown patch to start a mission; show
  running missions and their remaining days.

### 1.5 Time

- Game time advances in days; missions resolve when their days are up.

## Phase 2 - Threats

### 2.1 Event log

- Patch interactions append to `PatchNode.events` from phase 1 on, even
  before anything reads them.

### 2.2 Bandits

- Background pressure that scales with time, discovered area and wealth.
- Spawn at the edge of the discovered area and path toward the castle with
  their own cost table.

### 2.3 Nemesis foes

- Generated from specific events ("You stole my treasure!"), rare and
  named.
- Path from their patch toward the castle; the A* cost gives an ETA.

### 2.4 Warning and defense

- Threats show up with an ETA in days, giving the player time to
  intercept, fortify or pay off.
- Defenses are overlay edits (WALL, GATE) that raise path costs or cut
  routes.

## Open questions

- Does a hero stay at the discovered patch or return to the castle? If
  they stay, hero position is state and the next mission starts there.
- PLOT/HOUSE: ground types for appearance, with buildings as entities on
  top, or do they stay coupled?
- Where saves live (localStorage, file export).
- Which view hosts the game: `world.html` (3D) or a separate patch map.
