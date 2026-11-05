# Treasure & Dread - implementation plan

A campaign starts at a castle with a dramatic situation. Explorers are
sent out to discover neighboring patches, and what they find fills the
story: dungeons, temples, treasure, people. Some patches lead into
sub-levels (houses, dungeons) with their own maps and contents. What the
player takes and whom they leave alive comes back later as threats.

This plan builds on the packed patch pipeline: the map worker generates
`QuadPatch`es, `PatchWorld` connects them along seams on the main thread.

## Phase 0 - Foundations

### 0.1 Levels, simulation set and render set

The overworld is one level among many. Every location (overworld, house
interior, dungeon) is a level with:

- its own `PatchWorld` and patch layout. A house is a single small
  patch, a dungeon a block of width x height connected patches, 2 x 2
  to start with, sized per dungeon.
- its own generator in the worker, picked by level kind.
- Sub-levels are generated on a patch layout with ample space. Faces
  outside the level get a new face type NONE, which bounds the drawable
  world; the packed patch format stays as it is.
- its own scale (world units per quad) and theme (see 0.4). The
  overworld is miniature, a meeple is as big as a house; inside the
  house the same quads are room-sized.

Simulation is separated from rendering:

- A simulation owner per level (e.g. `game/SimWorld.ts`) holds all known
  patches plus patches a running mission targets, requests them from
  `MapWorkerClient` and connects them. Levels keep simulating while not
  shown.
- A level's patches stay loaded while anyone is inside. A level with
  nobody in it can be dropped and rebuilt from its seed and overlay.
- Rendering shows one level at a time, picks the patches near the camera
  from its simulation set and adds ground meshes and models for those.
  Entering a portal swaps the level group and the camera setup.
- Simulation works in faces and per-level cost tables. Only rendering
  converts faces to world units with the level's scale.
- Ground rebuild rules stay as they are (`updateGround` for a patch and
  its neighbors when seams change).

### 0.2 Records and ids

Persistent game state, serializable to JSON:

```ts
interface Campaign
{
    seed: number
    subtitle: string
    castleName: string
    gold: number
    day: number
    levels: Map<string, LevelRecord>
    arcs: Arc[]                    // see phase 2
    generatorVersion: number
}

interface LevelRecord
{
    id: string
    kind: LevelKind                // OVERWORLD, HOUSE, DUNGEON, ...
    seed: number
    theme: string
    portal: EntityRef | null       // fixture it hangs off, null for the overworld
    patches: Map<string, PatchNode>
}

interface PatchNode
{
    q: number
    r: number
    kind: PatchKind                // CASTLE, DUNGEON, TREASURE, TEMPLE, EMPTY, ...
    state: "targeted" | "discovered"
    parent: string | null          // patch key it was discovered from
    overlay: Map<number, number>   // local face -> FaceType index
    edges: Map<number, number>     // local half edge -> EdgeType index
    fixtures: Map<string, FixtureState>  // changes to generated fixtures
    events: PatchEvent[]
}
```

- The grid gives adjacency, `parent` gives the discovery tree.
- Generated content is `f(seed, level, q, r, kind)`. Records only store
  what changed: overlay, fixture state, events. Levels exist lazily;
  an interior is created when someone enters it or a mission needs it.
- Global face ids stay local to a `PatchWorld`. Everything that crosses
  levels or goes into a save uses the stable triple (level, patch q/r,
  local face).
- Local face indexes are only stable as long as generation doesn't
  change, hence `generatorVersion`.

### 0.3 Overlay

The overlay holds what changed on the faces and edges of a level. It is
the current value per face or half edge, not a history, so a door opened
500 times is still one entry. Generated data stays `f(seed, ...)`.

- On patch load, write the node's overlay entries into `patch.faceType`
  and `patch.edgeType` before `world.add()`. Reads stay at array speed.
- `setFaceType(globalFace, type)`: resolve slot -> patch `q/r` + local
  face, record in the overlay, write into the live array, rebuild the
  patch's ground and models, and the ground of every neighbor patch
  that a half edge of the face twins into.
- `setEdgeType(globalHalfEdge, type)`: the same for an edge, for both of
  its half edges unless it is one-way. Ground doesn't read edge types,
  so this only touches the models on the edge.
- Optional: keep the generated value on first edit to allow reverting.

All edits come from the main thread, workers never send any back.

- Patch kinds work the same way. A patch has a natural kind from the seed
  and its position; `LevelRecord.kindEdits` holds what game rules changed,
  the first dungeon being the first edit. Generators run on edit ?? natural
  and can still veto to NONE, which isn't stored as an edit and runs before
  the face overlay, so later edits to faces don't change what a patch is.
  A rule that has to hold checks the generator before writing its edit.
  Patch nodes hold what's known about a patch, not what it is meant to be.
- Levels other than the overworld are local. The worker generates them
  and hands the patches over; the main thread owns them from then on and
  changes them in place. No messages, however often they change. Reopening
  a level regenerates it and applies its overlay.
- Overworld edits are rare, so they can be expensive: rebuilding ground
  and redrawing patch images is fine. The patch view gets them directly,
  patch images redraw from a newly built patch with the overlay applied.
- The route finder is the only thing that needs them sent. `SimWorld`
  remembers what it sent and sends what's new with the next route query.
  `postMessage` is in order and the worker handles one message at a time,
  so a search always sees all edits made before it. Kind edits do this
  already, face and edge edits will follow.
- The route finder builds patches lazily, so it keeps the edits it got
  per patch and applies them when it builds that patch. A kind edit on a
  patch it has built drops that patch, to be built again when needed.
  The patch view and patch images don't react to kind edits yet, no rule
  changes a patch they have shown.
- A new `SimWorld` starts with nothing sent, so it gets the whole overlay.
  Loading a save always starts over with new workers, even for the same
  seed, since they hold changes of the other timeline.
- What was sent is never saved, the overlay is.

### 0.4 Face types and themes

- One global `FaceType` list. Face types are semantic: what a face is
  for simulation (passable, cost, occupied). Interior types (FLOOR,
  ...) are added to the same list; new types only for new behavior, not
  new looks.
- One global `EdgeType` list on the same pattern, stored per half edge
  in `QuadPatch.edgeType`, a `Uint8Array` like `faceType`. 0 is OPEN, the
  others block or cost something to cross: WALL, DESTRUCTIBLE, DOOR to
  start with. Patches are immutable in their geometry only.
- Per half edge, so a read needs no lookup, each patch stores its own
  side of a seam and overlays apply per patch. The two sides match
  unless the edge is one-way on purpose.
- What goes where: thin walls and doors are edge types; thick wall masses
  are `FaceType.WALL`, destroyed through the face overlay; movable
  obstacles are fixtures or mobiles on a face, since they have state and
  move.
- A theme maps face types, edge types and fixture kinds to appearance:
  color, models, scale range. It replaces `GROUND_COLORS` (`render/scene3d.ts`)
  and `FACE_MODELS` (`world3d.ts`). A castle styled as an oriental bazaar
  is the same castle plan with a different theme; TREE/TREE2 become other
  trees without the simulation noticing.
- Themes are picked by level kind and seed and stored in the level
  record. Per-region overworld themes later give biomes.

### 0.5 Generator requests

- `PatchRequest` carries the patch kind. Callers know it; every request
  for a patch has to pass the same kind, since generators change faces
  by kind.
- A table picks the generator per `PatchKind` (`map/patchGenerators.ts`).
  It runs after terrain in up to two steps: one on the face objects
  before packing, one on the packed patch, where `borderConnected` works.
- A generator returns its points of interest, each a local face plus the
  plan that goes with it, so routes and rendering read one result. A
  patch without room for them falls back to kind NONE with its faces
  unchanged, so asking for NONE later gives the same patch. The castle
  generator builds the castle tiles and returns the `CastlePlan` as its
  only point of interest. Kinds without a generator of their own keep one
  point of interest in the middle.
- A kind with a sub-level has two generators. The patch generator only
  places the way in on the overworld, for a dungeon a gate or door on the
  central connected face; it keeps the face types, so routes stay the
  same. The level generator is a separate worker call made when the level
  is first needed.
- A level generator doesn't work per patch. It builds a `PatchWorld` of
  all patches of the level in the worker, works on packed faces across the
  seams and writes face and edge types before handing the patches over.
- A dungeon is width x height connected patches, sized per dungeon.
  Every face starts as NONE; only what the generator sets gets drawn.

### 0.6 Campaign start

The game is called "Treasure & Dread". Every campaign gets a generated
subtitle on top of that.

- The campaign starts by picking its opening situation (see phase 2).
- Subtitle: "[The] <Word> of <castle name>", e.g. "Debts of Velmarra"
  or "The Rise of Blatopia". The
  castle name comes from `cityNameGenerator`; the word from a weighted
  list per situation, so the subtitle hints at the opening story. No
  other place names in the subtitle.
- Everything derives from the seed, picked with the seeded rng, so a
  seed always gives the same castle, situation, subtitle, palette and
  glyph dialect (see 2.6).
- Palette: one of the curated palettes in `src/palette/curated.json`
  (generated by `scripts/curatePalettes.ts`), picked by the seed and
  stored in the campaign record. It colors all speech bubbles and
  glyphs of the world. Each palette has a row per color scheme, used
  by `prefers-color-scheme`: background, main, secondary, accent.
- Start screen: logo, subtitle and a preview of the generated castle
  patch behind it, e.g. "Treasure & Dread: The Rise of Blatopia". Reroll
  draws a new seed; play creates the campaign record and goes straight
  into the discovery loop. Nothing is saved before play.
- Keep the subtitle generator separate from the castle code, so it can
  later name a key figure instead ("The Oath of Kenrik", via
  `meepleNameGenerator`).

### 0.7 Saves

- The campaign record lives in `localStorage` for now. A server may
  come later, so all storage goes through one small interface.
- Dev tooling, after the fixtures in qlive-framework: in dev builds a
  button exports the current save as a JSON download, and a saved file
  can be loaded back into the game. Saves worth keeping go into the
  repo as fixtures, to reopen a situation during development and to run
  tests on it.
- The save carries `generatorVersion`; a fixture from an older generator
  is refused instead of loaded with shifted faces.

### 0.8 Game page

- The game is `index.html`: title screen (0.6), then the discovery loop.
- The current 2D view moves from `index.html` to its own page (e.g.
  `2d.html`), like `3d.html`, `meeple.html` and `world.html`.

## Phase 1 - Discovery

### 1.1 Movement cost and routes

- Constant cost per `FaceType`, summed over all faces entered: 1 by
  default, SAND 1.5, SNOW 2, forests 3, SWAMP 4. WATER, ROCK, WALL,
  HOUSE and TAVERN are impassable. Passing is separate from `occupied`,
  which is about what can be placed on a face: nothing gets built in a
  forest, but people walk through it. An impassable THICKET may follow.
  Crossing an edge adds the cost of its `EdgeType` (0.4).
- A route leads from the center of the castle to all points of interest
  of the target and costs as much as the farthest one. If any can't be
  reached, there is no route.
- Dijkstra over the faces of a level's `PatchWorld`, crossing seams via
  `twin()`. It reaches several goals, so a heuristic has little to offer.
- It runs in the map worker, which builds the patches it needs itself
  once the search gets there, so a route doesn't cost more patches than
  it reaches. `SimWorld` only sends one request with what the worker
  can't know: the kinds of known patches. Patches are addressed by q/r
  between threads, slots stay private to each `PatchWorld`. Overworld
  edits reach the worker with the route queries (0.3).
- Routes inside other levels run on the main thread, which owns those
  patches (0.3). They can move to a worker if they turn out to stutter.
- Portals are extra edges between levels; routes across levels search
  over portals on top of the per-level search.
- Cost tables are per traveller, so hero traits (ranger, dwarf) and
  foes can use their own.

Generators own their points of interest: they make sure these connect
to the border of the patch, a patch without room for them falls back to
kind NONE. Whether the border can be reached from outside depends on
the neighbors, which is what makes a mission fail. The castle has one
point of interest, its center, where every route starts.

### 1.2 Missions

- A mission is an explorer plus a target patch adjacent to a discovered
  patch.
- On start: roll the target's kind, weighted by the story director (see
  2.4), mark it `targeted`, generate it into the simulation set.
- The route may go through any patch, known or not. Explorers get through
  unknown land unnoticed, even an enemy kingdom. Passing through is not
  discovering: only a patch an explorer was sent to is discovered and can
  affect the story. A patch passed on the way only gets a note on the map,
  "looked safe" or "looked dangerous", and stays a possible target.
- Explorers are freakishly good at this, so missions are no realistic
  journeys: a route cost maps to a few neat day steps of 1, 3, 5, ...,
  the way back included. The first targets take 1 day, every ring
  further out one step more. The limits are measured on generated
  worlds.
- Nothing shows the days before a mission, the tavern only shows speed
  and experience. A coarse hint may follow.
- Success: the patch becomes `discovered` with `parent` set.
- Failure: "can't get from here to there". Takes the days to the
  reachable point closest to the target, so failing isn't free. The
  patch stays unknown and can be tried again once more of the map is
  known.
- Explorers leave no tracks or witnesses, so a discovery mission never
  creates a threat by itself (see 4.2).
- The castle and its eight neighbors are known from the start: the 3D
  view shows them, and what is shown is known. Knowing a patch means
  knowing its kind, so the first DUNGEON is one of these neighbors, the
  first case of director steering. Missions start one ring further out.

### 1.3 Explorers and heroes

Discovery and adventure are split between two kinds of people.

Explorers are a caste of their own, a fickle bunch loitering in the
TAVERN (3.6). You pay one to go look somewhere, wait, and they report
back.

- Hiring is per mission and costs gold (5.1). No upkeep or loyalty
  beyond that.
- The TAVERN offers a few explorers at a time, at the start two or
  three. They differ in speed and wisdom, and their price follows.
  Wisdom decides how much of a patch the report reveals, e.g. hidden
  features or the kind of a neighbor.
- Fickle: the crowd changes over the days. Explorers come and go, and
  one who reported back hangs around for a while before moving on.
- Expert sneakers: they are never caught, never fight, and leave no
  witnesses or tracks. Their only job is discovery.
- Good speed gets a mission done one or two day steps earlier, down to
  1 day. It grows with experience, from every mission, failed ones
  included, and so does their price; a seasoned explorer is worth hiring
  for long or hard targets while they are still around.
- They report back to the TAVERN after each mission; their position is
  not state, every mission starts at the castle.

Heroes do everything that happens inside a discovered patch:

- Heroes start out as local heroes: gifted individuals born in the
  castle, meeples with a class beyond peasant. They live there, are
  small-time at the beginning and take on special jobs from the
  castle. They are not hired per job like explorers.
- They learn from their jobs. Later events bring new heroes or make
  others leave.
- A job targets a known patch other than the castle. Until levels
  exist, it is the trip there and back and a report.
- Attribute for wisdom: inside levels finds hidden traps and passages.
- They enter levels, take treasure and fight, and are the ones who get
  seen, followed and hated (phase 4).

### 1.4 Patch map UI

- Hex map of discovered and targeted patches with their kinds.
- Pick an explorer and a neighboring unknown patch to start a mission;
  show running missions and their remaining days.

### 1.5 Time

- Game time advances in days; missions resolve when their days are up.

### 1.6 Event log

- Patch interactions append facts to `PatchNode.events` from here on,
  even before anything reads them: what was taken, who was killed, who
  survived and saw what.

## Phase 2 - Story

The story is the backbone. A campaign starts with a dramatic situation,
gameplay fills its slots, and when they are filled the story progresses.
Nothing simulates a society; relationships only exist as story facts.

### 2.1 Situations

- Abstract layer after Polti's Thirty-Six Dramatic Situations: roles,
  stakes and chaining rules.
- Start with a curated subset the game can express: Daring enterprise,
  Obtaining, Crime pursued by vengeance, Pursuit, Abduction, Deliverance,
  Enigma, Supplication, Disaster, Revolt, Ambition, Conflict with a god,
  Fatal imprudence, Recovery of a lost one.
- The subset is a start, not a ceiling. New mechanics are chosen partly
  by which situations they unlock (loyalty -> Revolt, temples and favor ->
  Conflict with a god, bonds -> the love situations).

### 2.2 Stereotypes

- Concrete story patterns realizing one or more situations: "bandit
  hideout", "desecrated tomb", "the maiden". Small and specific, this is
  what the player sees.
- Map situation roles to actor slots, filled by special monsters or
  meeples. Slots can be filled late; an avenger doesn't need to exist
  until the story calls for one.
- Declare stakes per slot (killing the guardian is blood, taking the
  reward is greed), setting, theme, inhabitants and text material.
- Tagged (romance, horror, intrigue, ...) for the director.
- Not tied to dungeons: they start in dungeons, on overworld patches
  (an EMPTY patch with an encounter), along mission routes, at the
  castle, or as continuations. Patch kinds say what is there,
  stereotypes say what happens.

### 2.3 Arcs

- An arc is a stereotype instance with its bound actors and facts.
- Tentative until the first event the player sees; the director may drop
  or replace it silently. Committed afterwards: it has to resolve, by
  finishing, an escape condition or a continuation.
- Each stereotype declares escape conditions ("the maiden marries
  someone else", "the bandits move on"). An escape is a resolution and
  can lead into a new arc.
- Outcomes chain into follow-up arcs by the situations' chaining rules
  ("the chief died, the lieutenant survived as witness" -> vengeance
  with the lieutenant as avenger). The campaign story is that chain.
- Relationships are facts arcs create ("Elvira loves Kenrik"); later
  situations bind to them.
- One main arc plus small side arcs from encounters.

### 2.4 Director

- Open slots bias generation: patch kind rolls, dungeon premises,
  encounters. Discovery feels lucky, but is directed.
- Steers back when the player drifts (actors approach, stakes rise) and
  takes an escape condition when steering fails.
- Player taste: tags of beats the player keeps fleeing lose weight in
  future picks.

### 2.5 Glyph language

Meeples don't speak in readable text but in speech bubbles of emoji and
unknown symbols. This adds mystery and keeps text generation simple: the
story only has to come across as a vague sense, and the player learns
the language over the campaign.

- Content channel: one fixed glyph per concept (treasure, daughter,
  castle, revenge, ...), ordered by a simple grammar. Facts of an arc
  become glyph sequences almost directly.
- Emotion channel: readable emoji (anger, fear, joy, love). The player
  always knows how someone feels, not exactly what they mean.
- Known concepts: once a concept has been shown clearly enough, its
  glyph renders as the readable emoji (red heart, money bag, skull,
  castle). Bubbles turn from cryptic to readable over a campaign; the
  player sees their understanding grow.
- Planned exposure: the director knows which concepts an upcoming beat
  uses. Before the beat it stages vignettes for the ones still unknown,
  small scenes showing a glyph in an unambiguous context (coins at the
  market, a flower handed over with a heart). Played in passing, no UI.
- Vignettes double as characterization: the heart scene introduces the
  maiden, the coin scene the greedy merchant who fills a slot later.
- Concepts no beat needs stay cryptic, so some mystery remains.
- Custom icon set in the game's style instead of system emoji, which
  differ across platforms; themable like everything else. Unicode emoji
  as placeholders until then.
- No localization needed for most of the game's text.
- What the player must act on never depends on decoding: threats, ETAs
  and mission results also show in the map UI and warnings. The
  language hides the why, never the what now.

### 2.6 Glyph construction

The prototype is built from `examples/glyphs/` into
`public/examples/glyph/index.html` (`#seed-123` reopens a world).
Glyphs are built from the stroke data of a source kanji per concept
(KanjiVG, CC BY-SA 3.0), but never show the kanji.

- Sources: chosen by meaning and by complexity. Dense characters make
  small tiles, so simpler or more evocative sources win over exact
  synonyms (仇 for enemy, 戸 for door, 封 for seal).
- Strokes: each stroke kind becomes one tile, sized by stroke length.
  The five main kinds (horizontal, vertical, falling left, falling
  right, turning) get polygons; the hexagon is drawn as an outline.
  A curved stroke becomes an arc around its group, start and span in
  quarter turns. Dots are a square of two horizontal lines, hooks and
  sweeps one of two vertical lines.
- Roots: the top-level components of the character. Each root is
  composed once, keyed by its base form (忄 is drawn as 心), and reused
  as a rigid block, so a root looks the same in every glyph. Only one
  level deep, nested components are laid out flat inside their root.
- Composition: tiles and roots are packed without overlap and pulled
  towards the center. Like gen-100, every tile is then set face to
  face against the one before it, on one of its sides, if there is
  room; line squares take the length of that side. Two neighboring
  roots are joined by a short dash across the gap, a loose stroke next
  to a root by a dot.
- Dialect per world: the world seed deals the polygons to the stroke
  kinds (one kind gets a line below its group instead), picks the side
  each tile attaches to, the arcs and the color roles. Within a world
  every root has one fixed form; another world shows the same roots
  differently.
- Color: tiles take the palette's main, secondary or accent color with
  weights 0.65, 0.3, 0.05, decided per root, so a root keeps its
  colors throughout a world. The bubble is the palette's background.
- Learned concepts: a glyph is replaced by its emoji in full color, so
  understanding literally adds color to the bubbles.
- The source kanji behind a glyph looks good as art (title screen,
  inscriptions in old places, the moment a concept is learned), but
  it gives the meaning away to players who read Japanese, so it stays
  out of anything meant to be decoded.

## Phase 3 - Levels and contents

### 3.1 Doors and portals

- A door within a level is an edge type with state (open, locked),
  changed through the overlay. The castle's GATE stays a face type.
- A portal is a fixture linking a face in one level to a face in another,
  e.g. the HOUSE face on the overworld to the entrance of the house
  interior. Stored in both levels as a pair of (level, patch, face).

### 3.2 Fixtures

- Static entities placed by the generator: chests, traps, altars,
  levers, workbenches, beds, storage, portals. Deterministic from the
  seed with a stable id (level, patch, face, index); records only store
  changes ("chest 3 looted").
- Orientation: one of the face's four half edges.
- Interaction anchor: the position and facing a meeple takes to use it.
- Range per kind: an action can be triggered once a meeple is within
  range (in faces or level map units, never render units). The meeple
  then walks to the anchor, aligns and performs the action.
- Interactions per kind: open, disarm, use, rest. House functions
  (crafting, storage, healing) are fixture kinds.
- Traps can be hidden; detection uses the hero's wisdom attribute.

### 3.3 Mobiles

- Monsters and meeples are simulation state. Inhabitants fill stereotype
  slots or are placed by the dungeon premise, with a reason to be there;
  no generic spawners.
- Live mobiles are saved while their level is active. On reload,
  unchanged inhabitants are regenerated; the record keeps who is dead,
  fled or moved.

### 3.4 Dungeon generation

- The premise is a stereotype; it decides inhabitants, fixtures and
  theme.
- Walls are mostly faces: thick masses between rooms, to avoid a look of
  many skinny walls. Edge walls (0.4) are for dividing a space and for
  doors, and rule nothing else out.
- Room candidates come from classifying the mesh, after gen-88: count
  the quads around each vertex across seams. Faces that touch a vertex
  of 5 or more quads, or the outer edge of the level, are wall. The
  connected regions of the other faces are candidates. Irregular vertices
  end up in the walls, so the floors are nearly regular grids.
- Two candidates can't share an edge, but they can touch at a corner.
  A 2 x 2 level has about 5300 faces and 200 to 240 regions, half of them
  4 faces or fewer, 52 to 58 with 12 or more, the largest 95 to 217.
- Rooms: keep regions of about 12 faces or more, split or trim big ones
  at their narrow necks, with a door edge where that keeps the faces, and
  pick around 10, spaced apart and not touching at corners. Everything
  else is wall, corridors are carved through it. Small regions along a
  corridor can become closets or niches. The numbers are a starting
  point; picking and carving aren't tried yet.
- Four quads around a vertex aren't a classification, 77% of the vertices
  have that. Inside a room such a block is a spot for a 2 x 2 fixture.
- Room graph roles from structure: entrance, approach, branches, climax
  (deepest point or end of the main path), reward behind the climax,
  way out. Depth from the entrance and main path vs. branch decide.
- Content follows roles: foreshadowing early, resistance along the main
  path, the guardian slot in the climax, the reward behind it, side
  rewards or shortcuts in branches.
- Locks and keys: put a lock on a main path connection, place the key in
  the part of the graph reachable without passing it, ideally a branch;
  repeat. Guarantees solvability. Keys can be items, levers, abilities
  (hidden passage, barred door) or facts (a password found on a note).
- Shortcuts: doors that only open from the far side, so the way out is
  short after the climax. A one-way edge, where the two half edges
  differ (0.4).

### 3.5 House interiors

- Single small patch, generator per house kind; fixtures for the house
  functions; portal back to the overworld face.

### 3.6 Plots and buildings

- PLOT and HOUSE stay face types. A PLOT is a site set aside for the
  next building, so the player always has a plan where to build; a
  HOUSE is a built one, turned from a PLOT through the overlay.
- What a HOUSE does is its facility kind: resource production or
  processing of raw materials (5.1). The facility is a fixture on the
  HOUSE, so the face type stays semantic and the theme picks the model
  per facility.
- The first facility kind is the TAVERN. Every castle has one from the
  start; it is where explorers are hired (1.3).

## Phase 4 - Threats

### 4.1 Grudge

- Computed from the stakes of the slots involved: material loss scales
  with the value taken, personal harm (killed guardian, desecration)
  weighs far more. Grudges against the same castle add up.
- Personality scales it: greedy, proud, vengeful react to different
  stakes.
- Material grudges fade over time, personal ones don't.

### 4.2 Knowledge

- Witnesses: surviving mobiles that saw the hero.
- Identity: a recognizable hero, a dropped item, a castle banner.
- Tracks: the routes heroes travel (explorers leave none), readable
  depending on terrain (clear in snow and mud, faint on rock and paved
  ground) and decaying over days.
- Resulting state: knows the castle (comes straight at it), has a trail
  (follows it, then searches), knows nothing (searches outward).
- Player countermeasures: silence witnesses, detour over rock, lead
  them off with a hero as bait.

### 4.3 Search

- Uses the discovery mechanic in reverse, patch by patch, with a budget
  from the grudge: coins and a chalice may buy 2 patches, a killed
  daughter is unlimited.
- Visible to the player as sightings and rumors in discovered patches.
- Giving up is an event; new knowledge (a witness spots the hero, a new
  theft) revives the grudge.

### 4.4 Bandits

- Background pressure that scales with time, discovered area and wealth.
- Come from the edge of the discovered area and path toward the castle
  with their own cost table.

### 4.5 Warning and defense

- Threats show up with an ETA in days from the route cost, giving the
  player time to intercept, fortify or pay off.
- Defenses are overlay edits (WALL, GATE) that raise path costs or cut
  routes. Terrain that blocked the heroes also protects the castle.

## Phase 5 - Economy

### 5.1 Resources

Still to be designed: who needs what and who produces what.

- Gold coins first: one simple countable valuable. A campaign starts
  with 1000 gold. Hiring explorers costs gold; for now there is no
  spending limit, the balance may go negative.
- Resources the castle produces and stores.
- Facilities (3.6) that produce raw materials or process them.
- Consumers: explorers (1.3), new buildings, heroes, defenses, paying
  off threats (4.5).

## Open questions

- The economy (phase 5) beyond gold: resources, facilities, and what
  buildings cost.
- What wisdom reveals in an explorer's report, exactly.
- Does the game run in the 3D view of `world.html` with the patch map as
  an overlay, or is the patch map a view of its own?
- How do heroes act inside a level: orders from the player, how time
  passes there, how fights work?
- How are thin walls drawn where they meet at irregular vertices?
