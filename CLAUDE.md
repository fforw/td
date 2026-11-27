# Treasure & Dread

Browser game in TypeScript and three.js, built with Vite.

## Saving context

Context stays in the session once loaded, so look things up narrowly.

- Find code with `grep -n` and read ranges. Read a large file whole only if the task needs all of it, and not twice in a
  session. Large ones: `src/map/HexagonPatch.ts`, `src/game/gameView.ts`, `src/meeple/Meeple3D.ts`,
  `src/map/dungeonLights.ts`, `src/game/castleScene.ts`, `src/render/dungeonLighting.ts`.
- `plans/design.md` lists the plan files by topic, read just the ones you need. `grep -n '^#'` finds a section.
- Check behavior with tests or `--eval` before taking screenshots. Keep screenshots small, and clip them for details.

## Commands

- `pnpm test` runs all tests, `pnpm exec vitest run test/game/saves.ts` one file
- `pnpm typecheck` covers `src`, `test` and `vite.config.ts`, not `scripts`
- The dev server is the `vite` config in `.claude/launch.json`, on port 5173

## Screenshots and page checks

The built-in browser pane has no WebGL here, so use `scripts/shot.ts` with the dev server running. Its header lists all
steps. Write the images to the scratchpad.

```bash
node scripts/shot.ts /dungeon3d.html --wait 4000 --shot a.jpg --clip canvas --scale 1 --shot b.jpg
```

The game page takes its campaign from `?seed=`, and starts on clicking `.play`. With `--gamepad`, the first `--press`
only activates pad mode, so use a second one to trigger the action. Button 3 (north) ends the day. Frame rates in
headless Chrome mean nothing, as it renders in software.

## Layout

- `src/game`: the game page, with campaign state, UI (`gameView.ts`), castle scene and gamepad input
- `src/map`: patch and dungeon generation, routes
- `src/render`: meshes, lighting and the manuscript map
- `src/meeple`, `src/castle`, `src/items`: characters, castle, item sprites
- `src/scene`: scenes in levels, with scripts, the trader and the scene camera
- `src/icons`: SVG icons made by `pnpm build-icons` from the Inkscape drawings in `media-src/icons`, don't edit them
- `public/media/treasure/*-potion.glb`: models made by `pnpm export-models` from the Blender files in `media-src`, which
  needs Blender on the PATH or in `BLENDER`
- `src/worker`: the map worker, which generates patches off the main thread
- `test/` mirrors `src/`
- `plans/`: the design by topic, update the topic file when the design changes. Link by file and heading, without
  numbers for sections. Open questions go into `plans/roadmap.md`. Topic files describe what
  exists, in the present tense with the reason, and what isn't built under `## Planned`, with a line in the roadmap.
  Leave out history, unless a rejected approach would be tried again, and tuning values, unless they are the design.
  `plans/design.md` holds the principles, without file names or numbers.
- `*.html` in the root: `index.html` is the game, the others are test pages for single parts (`src/*Test.ts`)
- `docs/` is ignored build output, don't search it

## Code style

Four spaces, no semicolons, double quotes, opening braces of functions and control statements on their own line.
