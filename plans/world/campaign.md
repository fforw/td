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

## Campaign level

`game/campaignLevel.ts`. The campaign, not each hero, gains experience
and goes up in levels, as the player plays all heroes.

- A broad range of deeds counts, so most play moves it on. Finding
  things gains little: a patch with something in it discovered, a
  dungeon gone into for the first time, a room seen. What takes going
  there or fighting gains more: getting to a temple or a treasure the
  map shows, killing a monster. Beating the end boss of a level gains
  the most.
- First visits are kept on the patch (`entered`), and rooms count once
  per level, so a level that starts anew is another level with rooms
  to find again.
- Each level takes more experience than the one before, so levels come
  ever slower.
- The skill of all monsters is a function of the level, which grows
  ever slower towards the best they get. So the game gets harder over
  the whole campaign, and each level up is when the world gets harder
  too ([monsters](../action/monsters.md#behavior-trees)).
- The level shows in the bar at the top, with the experience for the
  next one in its title, and a report tells of each level up. In a
  level it shows in the [HUD](../action/gear.md#hud) as well.
- Every hero gets the base gear of each level the campaign reaches
  ([gear](../action/gear.md#getting-them)), the first bonus of a level.

## Pages

- The game is `index.html`: title screen, then the discovery loop. The
  other pages in the root test single parts.

## Planned

- More bonuses with each campaign level, for all heroes or for the
  defenses of the castle, so there is no hero to choose.
- Experience for beating the end boss of a level, once there are bosses
  ([spawns](../dungeon/spawns.md#planned)).

- The campaign starts by picking its opening
  [situation](../story/story.md#situations), and the subtitle word comes
  from a weighted list per situation, so it hints at the opening story.
- A palette from `src/palette/curated.json` (made by
  `scripts/curatePalettes.ts`), picked by the seed and stored in the
  campaign record. It colors all speech bubbles and glyphs of the world.
  Each palette has a row per color scheme, used by
  `prefers-color-scheme`: background, main, secondary, accent.
