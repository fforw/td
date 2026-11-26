# Glyphs

## Glyph language

Meeples don't speak in readable text but in speech bubbles of emoji and
unknown symbols. This adds mystery and keeps text generation simple: the
story only has to come across as a vague sense, and the player learns
the language over the campaign. What the player must act on never
depends on decoding: the language hides the why, never the what now.

- The game knows concepts so far only for the wares of the trader
  (`Campaign.concepts`). The player learns one by buying or finding the
  ware, and it then shows as its emoji in every later trade. Unknown ones
  show as runes, and words of scenes as plain emoji (`scene/SceneBox.ts`).

## Glyph construction

The prototype is built from `examples/glyphs/` into
`public/examples/glyph/index.html` (`#seed-123` reopens a world). It is
not in the game yet. Glyphs are built from the stroke data of a source
kanji per concept (KanjiVG, CC BY-SA 3.0), but never show the kanji.

- Sources are chosen by meaning and by complexity. Dense characters make
  small tiles, so simpler or more evocative sources win over exact
  synonyms (仇 for enemy, 戸 for door, 封 for seal).
- Strokes: each stroke kind becomes one tile, sized by stroke length.
  The five main kinds (horizontal, vertical, falling left, falling right,
  turning) get polygons, and the hexagon is drawn as an outline. A curved
  stroke becomes an arc around its group, start and span in quarter
  turns. Dots are a square of two horizontal lines, hooks and sweeps one
  of two vertical lines.
- Roots: the top-level components of the character. Each root is
  composed once, keyed by its base form (忄 is drawn as 心), and reused
  as a rigid block, so a root looks the same in every glyph. Only one
  level deep, nested components are laid out flat inside their root.
- Composition: tiles and roots are packed without overlap and pulled
  towards the center. Every tile is then set face to face against the one
  before it, on one of its sides, if there is room, and line squares take
  the length of that side. Two neighboring roots are joined by a short
  dash across the gap, a loose stroke next to a root by a dot.
- Dialect per world: the world seed deals the polygons to the stroke
  kinds (one kind gets a line below its group instead), picks the side
  each tile attaches to, the arcs and the color roles. Within a world
  every root has one fixed form, and another world shows the same roots
  differently.
- Color: tiles take the palette's main, secondary or accent color, mostly
  the main one, decided per root, so a root keeps its colors throughout a
  world. The bubble is the palette's background.
- Learned concepts: a glyph is replaced by its emoji in full color, so
  understanding literally adds color to the bubbles.
- The source kanji behind a glyph looks good as art (title screen,
  inscriptions in old places, the moment a concept is learned), but it
  gives the meaning away to players who read Japanese, so it stays out of
  anything meant to be decoded.

## Planned

- Glyphs from the prototype in the game, in the colors of the campaign
  [palette](../world/campaign.md#planned).
- Content channel: one fixed glyph per concept (treasure, daughter,
  castle, revenge, ...), ordered by a simple grammar. Facts of an arc
  become glyph sequences almost directly.
- Emotion channel: readable emoji (anger, fear, joy, love). The player
  always knows how someone feels, not exactly what they mean.
- Known concepts: once a concept has been shown clearly enough, its glyph
  renders as the readable emoji (red heart, money bag, skull, castle).
  Bubbles turn from cryptic to readable over a campaign, and the player
  sees their understanding grow.
- Planned exposure: the director knows which concepts an upcoming beat
  uses. Before the beat it stages vignettes for the ones still unknown,
  small scenes showing a glyph in an unambiguous context (coins at the
  market, a flower handed over with a heart). Played in passing, no UI.
- Vignettes double as characterization: the heart scene introduces the
  maiden, the coin scene the greedy merchant who fills a slot later.
- Concepts no beat needs stay cryptic, so some mystery remains.
- A custom icon set in the game's style instead of system emoji, which
  differ across platforms, themable like everything else.
- No localization needed for most of the game's text.
- Threats, ETAs and mission results show in the map UI and warnings as
  well, never only in glyphs.
