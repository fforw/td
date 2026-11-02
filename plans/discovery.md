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
  patch, a dungeon three hexagon patches around a shared corner, the
  most compact cluster with room to grow in every direction.
- its own generator in the worker, picked by level kind.
- its own scale (world units per quad) and theme (see 0.4). The
  overworld is miniature, a meeple is as big as a house; inside the
  house the same quads are room-sized.

Simulation is separated from rendering:

- A simulation owner per level (e.g. `game/SimWorld.ts`) holds all known
  patches plus patches a running mission targets, requests them from
  `MapWorkerClient` and connects them. Levels keep simulating while not
  shown.
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

### 0.3 Face overlay

- On patch load, write the node's overlay entries into `patch.faceType`
  before `world.add()`. Reads stay at array speed.
- `setFaceType(globalFace, type)`: resolve slot -> patch `q/r` + local
  face, record in the overlay, write into the live array, rebuild the
  patch's ground and models, and the ground of every neighbor patch
  that a half edge of the face twins into.
- Optional: keep the generated value on first edit to allow reverting.

### 0.4 Face types and themes

- One global `FaceType` list. Face types are semantic: what a face is
  for simulation (passable, cost, occupied). Interior types (FLOOR,
  DOOR, ...) are added to the same list; new types only for new
  behavior, not new looks.
- A theme maps face types and fixture kinds to appearance: color,
  models, scale range. It replaces `GROUND_COLORS` (`render/scene3d.ts`)
  and `FACE_MODELS` (`world3d.ts`). A castle styled as an oriental bazaar
  is the same castle plan with a different theme; TREE/TREE2 become other
  trees without the simulation noticing.
- Themes are picked by level kind and seed and stored in the level
  record. Per-region overworld themes later give biomes.

### 0.5 Generator requests

- Replace `PatchRequest.castle: boolean` with level kind, patch kind and
  level seed.
- The worker runs the planner for the kind after terrain, like
  `planCastle` today, and returns a feature plan: face types plus
  fixtures as plain data (`{ kind, face, orientation, params }`).
- `BuiltPatch.castle` becomes that per-kind feature plan.

### 0.6 Campaign start

The game is called "Treasure & Dread". Every campaign gets a generated
subtitle on top of that.

- The campaign starts by picking its opening situation (see phase 2).
- Subtitle: "<Word> of <castle name>", e.g. "Debts of Velmarra". The
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
  patch behind it. Reroll draws a new seed; play creates the campaign
  record. Nothing is saved before play.
- Keep the subtitle generator separate from the castle code, so it can
  later name a key figure instead ("The Oath of Kenrik", via
  `meepleNameGenerator`).

## Phase 1 - Discovery

### 1.1 Movement cost and pathfinding

- Cost per `FaceType`; impassable defaults to the existing `occupied`
  flag (WATER, ROCK, TREE, WALL, HOUSE, ...). GATE is passable.
- A* over faces of a level's `PatchWorld`, crossing seams via `twin()`.
  Heuristic: centroid distance times the cheapest cost.
- Portals are extra edges between levels; routes across levels search
  over portals on top of per-level A*.
- Cost tables are per traveller, so hero traits (ranger, dwarf) and
  foes can use their own.
- Main thread first; move into the worker if it gets slow.

### 1.2 Missions

- A mission is an explorer plus a target patch adjacent to a discovered
  patch.
- On start: roll the target's kind, weighted by the story director (see
  2.4), mark it `targeted`, generate it into the simulation set.
- The route may go through any discovered patch, not only the one next to
  the target.
- Success: A* cost, scaled by the explorer's efficiency (1.3) -> day
  bucket. Thresholds are multiples of the cost of crossing one patch on
  open ground (`PATCH_SIZE` faces times the cheapest cost), so they
  survive changes of `PATCH_SIZE`/`FACE_SIZE`.
  The patch becomes `discovered` with `parent` set.
- Failure: "can't get from here to there". Costs the days to the furthest
  point the search reached, so failing isn't a free probe.
- Explorers leave no tracks or witnesses, so a discovery mission never
  creates a threat by itself (see 4.2).
- The first *successful* discovery is a DUNGEON. This is the first case
  of director steering, not a separate rule.

### 1.3 Explorers and heroes

Discovery and adventure are split between two kinds of people.

Explorers are a caste of their own, modeled after the youth scouts in
FIFA's career mode: you assign them, wait, and they report back.

- They are just there and work for the castle; no recruiting, no pay,
  no loyalty to manage.
- Expert sneakers: they are never caught, never fight, and leave no
  witnesses or tracks. Their only job is discovery.
- Each explorer has an efficiency that scales a mission's days and the
  failure cost down. It grows with experience, from every mission,
  failed ones included, so seasoned explorers are worth sparing for
  long or hard targets.
- Like scouts, they report back to the castle after each mission; their
  position is not state, every mission starts at the castle.

Heroes do everything that happens inside a discovered patch:

- Heroes come out of the generated meeple population.
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

- A door within a level is a face type with state (open, locked); GATE
  is one already, changed through the overlay.
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
- Rooms: take the most square faces as seeds (`faceRatio`, like house
  placement in `Castle.ts`), spaced apart, grow each into a compact
  region with a size limit, wall it in, connect rooms by carved
  corridors.
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
  short after the climax.

### 3.5 House interiors

- Single small patch, generator per house kind; fixtures for the house
  functions; portal back to the overworld face.

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

- Threats show up with an ETA in days from the A* cost, giving the
  player time to intercept, fortify or pay off.
- Defenses are overlay edits (WALL, GATE) that raise path costs or cut
  routes. Terrain that blocked the heroes also protects the castle.

## Open questions

- How many explorers does a campaign get, and can more appear?
- PLOT/HOUSE: ground types for appearance, with buildings as fixtures on
  top, or do they stay coupled?
- Dungeon walls as faces (like the castle, costs a ring of faces per
  room) or on edges (keeps space, needs a wall flag per half edge in the
  packed patch)?
- Where saves live (localStorage, file export).
- Which view hosts the game: `world.html` (3D) or a separate patch map.
