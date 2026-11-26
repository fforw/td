# Campaign

## Title and subtitle

The game is called "Treasure & Dread". Every campaign gets a generated
subtitle on top of that (`game/subtitle.ts`).

- Subtitles name the castle ("Debts of Velmarra") or a key figure of the
  opening story ("The Oath of Kenrik"), never another place. Castle names
  come from `cityNameGenerator`, figure names from `meepleNameGenerator`.
- Everything derives from the seed, so a seed always gives the same
  castle, subtitle and glyph dialect ([glyph
  construction](../story/glyphs.md#glyph-construction)).

## Start screen

- The rendered logo picture with the current campaign's subtitle on its
  floor, and the menu in its dark wall.
- The current campaign is the saved one, or a new one from the seed. The
  top button reads "Continue" for a saved campaign and "Start" for a new
  one, which is only saved once it is played.
- "New game" draws a new seed and stays on the title screen, so the new
  subtitle can be read.

## Saves

- The campaign record lives in `localStorage`. A server may come later,
  so all storage goes through one small interface (`SaveStore` in
  `game/storage.ts`).
- In dev builds a button exports the current save as a JSON download,
  and a saved file can be loaded back into the game. Saves worth keeping
  go into `test/fixtures/saves`, to reopen a situation during
  development and to run tests on it.
- The save carries `generatorVersion`, and a fixture from an older
  generator is refused instead of loaded with shifted faces.

## Pages

- The game is `index.html`: title screen, then the discovery loop. The
  other pages in the root test single parts.

## Planned

- The campaign starts by picking its opening
  [situation](../story/story.md#situations), and the subtitle word comes
  from a weighted list per situation, so it hints at the opening story.
- A palette from `src/palette/curated.json` (made by
  `scripts/curatePalettes.ts`), picked by the seed and stored in the
  campaign record. It colors all speech bubbles and glyphs of the world.
  Each palette has a row per color scheme, used by
  `prefers-color-scheme`: background, main, secondary, accent.
