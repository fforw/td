# Levels

This builds on the packed patch pipeline: the map worker generates
`QuadPatch`es, and `PatchWorld` connects them along seams.

## Levels

The overworld is one level among many. Every location (overworld, house
interior, dungeon) is a level with:

- its own `PatchWorld` and patch layout. A house is a single small patch,
  a dungeon a block of connected patches, sized per dungeon.
- its own generator in the worker, picked by level kind.
- its own scale (world units per quad) and theme. The overworld is
  miniature, a meeple is as big as a house; inside the house the same
  quads are room-sized.

Sub-levels are generated on a patch layout with ample space. Faces
outside the level have the face type NONE, which bounds the drawable
world, so the packed patch format stays as it is.

## Simulation and rendering

- `SimWorld` (`game/SimWorld.ts`) is the side of the game that needs the
  overworld instead of just looking at it. Its own map worker keeps the
  patches and finds the routes, so they never hold up the main thread.
- Simulation works in faces and per-level cost tables. Only rendering
  converts faces to world units with the level's scale.
- Each level has a canvas of its own that only runs while it is shown
  (`game/levelScene.ts`). The view swaps to the level of the hero it
  follows, and back with the view of the castle, while the hero stays
  inside.
- One dungeon level is kept at a time, the worker builds it again for
  another one. A level with nobody in it can be dropped and rebuilt from
  its seed and what the campaign keeps of it.
- Ground rebuild rules: `updateGround` for a patch and its neighbors when
  seams change.

## Records and ids

- The campaign record (`Campaign` in `game/campaign.ts`) is plain JSON.
  Levels hold their patch nodes by patch key, and the grid gives
  adjacency, while `parent` gives the discovery tree.
- Generated content is a function of seed, level, position and kind.
  Records only store what changed: kind edits, opened chests, visited
  faces, facts. Levels exist lazily.
- Global face ids stay local to a `PatchWorld`. Everything that crosses
  levels or goes into a save uses the stable triple (level, patch q/r,
  local face).
- Local face indexes are only stable as long as generation doesn't
  change, hence `generatorVersion`.

## Kind edits

- A patch has a natural kind from the seed and its position.
  `LevelRecord.kindEdits` holds what game rules changed, the first
  dungeon being the first edit.
- Generators run on the edit if there is one, else on the natural kind,
  and can still veto to EMPTY, which isn't stored as an edit. A rule that
  has to hold checks the generator before writing its edit.
- Patch nodes hold what's known about a patch, not what it is meant to
  be.
- The route finder in the worker is the only thing that needs edits
  sent. `SimWorld` remembers what it sent and sends what's new with the
  next route query. `postMessage` is in order and the worker handles one
  message at a time, so a search always sees all edits made before it.
- The route finder builds patches lazily, so it keeps the edits it got
  per patch and applies them when it builds that patch. A kind edit on a
  patch it has built drops that patch, to be built again when needed.
- A new `SimWorld` starts with nothing sent, so it gets all edits.
  Loading a save always starts over with new workers, even for the same
  seed, since they hold changes of the other timeline. What was sent is
  never saved, the edits are.

## Face and edge types

- One global `FaceType` list (`map/geometry.ts`). Face types are
  semantic: what a face is for simulation (passable, cost, occupied).
  New types only for new behavior, not new looks.
- One global `EdgeType` list on the same pattern, stored per half edge in
  `QuadPatch.edgeType`, a `Uint8Array` like `faceType`. OPEN is 0, the
  others block or cost something to cross, like WALL, DESTRUCTIBLE and
  DOOR. Patches are immutable in their geometry only.
- Edge types are per half edge, so a read needs no lookup and each patch
  stores its own side of a seam. The two sides match unless the edge is
  one-way on purpose.
- What goes where: thin walls and doors are edge types, thick wall masses
  are `FaceType.WALL`, and movable obstacles are fixtures or mobiles on a
  face, since they have state and move.

## Generator requests

- `PatchRequest` carries the patch kind. Every request for a patch has
  to pass the same kind, since generators change faces by kind.
- A table picks the generator per `PatchKind` (`map/patchGenerators.ts`).
  It runs after terrain in up to two steps: one on the face objects
  before packing, one on the packed patch, where `borderParts` works.
- A generator returns its points of interest, each a local face plus the
  plan that goes with it, so routes and rendering read one result. A
  patch without room for them falls back to kind EMPTY with its faces
  unchanged, so asking for EMPTY later gives the same patch.
- The castle generator builds the castle tiles and returns the
  `CastlePlan` as its only point of interest. Kinds without a generator
  of their own keep one point of interest in the middle.
- A kind with a sub-level has two generators. The patch generator only
  places the way in on the overworld, for a dungeon a gate or door on the
  most central face of the best part with nothing on it, opening towards
  the neighbor cheapest to enter. It keeps the face types, so routes stay
  the same, and without such a face the patch stays EMPTY. The level
  generator is a separate worker call made when the level is first
  needed.
- A level generator doesn't work per patch. It builds a `PatchWorld` of
  all patches of the level in the worker, works on packed faces across
  the seams and writes face and edge types before handing the patches
  over. Every face starts as NONE, and only what the generator sets gets
  drawn.
- A level has its own q/r grid in its own `PatchWorld`. Its seed comes
  from the entrance: parent level seed, grid position of the entrance
  patch and an index for several entrances on one patch (`levelSeed()`).
  Entrance face and patch kind stay out of it, so the level doesn't
  change with them. Each new attempt at a level gets another seed
  (`attemptSeed()`).

## Entering a level

- A dungeon patch leads to its level. All a job records is that the hero
  is inside, the face they last got to and that they went in at all.
- Someone comes in at the middle of the deepest room (`entranceFace()`),
  and leaving means finding an exit ([roles](../dungeon/generation.md#roles)).
  Outside they wait for orders again, which can be going back in.
- Days are ended at the castle, with heroes in levels just waiting there.

## Planned

- Level records for interiors and dungeons, with their own kind, seed,
  theme and the portal they hang off.
- An overlay of face and edge edits, saved per patch node:
  - It holds the current value per face or half edge, not a history, so
    a door opened 500 times is still one entry.
  - On patch load, write the entries into `patch.faceType` and
    `patch.edgeType` before `world.add()`, so reads stay at array speed.
  - Setting a face type records it, writes the live array, and rebuilds
    the patch's ground and models and the ground of every neighbor patch
    that a half edge of the face twins into. Setting an edge type does
    the same for both half edges unless it is one-way, and only touches
    the models on the edge.
  - All edits come from the main thread. Levels other than the overworld
    are owned by the main thread once handed over and change in place.
  - Overworld edits are rare, so rebuilding ground and redrawing patch
    images is fine. Face and edge edits reach the route finder like kind
    edits do. Face edits are applied after the kind, so they don't change
    what a patch is.
  - The patch view and patch images react to kind edits.
  - Maybe keep the generated value on first edit, to allow reverting.
- Themes, which map face types, edge types and fixture kinds to
  appearance: color, models, scale range. They replace `GROUND_COLORS`
  (`render/scene3d.ts`) and `FACE_MODELS` (`render/patchMeshes.ts`). A
  castle styled as an oriental bazaar is the same castle plan with
  another theme, and trees become other trees without the simulation
  noticing. Themes are picked by level kind and seed and stored in the
  level record. Per-region overworld themes give biomes.
- Interior face types (FLOOR, ...) in the same list.
- A simulation set per level that keeps simulating while not shown, with
  the patches a running mission targets.
- Portals, fixtures linking a face in one level to a face in another,
  e.g. the HOUSE face on the overworld to the entrance of the house
  interior, stored in both levels as a pair of (level, patch, face).
  Routes across levels search over portals on top of the per-level
  search.
- Doors with state (open, locked), edge types changed through the
  overlay. The castle's GATE stays a face type.
- Side exits leading somewhere else than the patch of the level.
