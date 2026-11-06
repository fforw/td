# Treasure & Dread

Browser game in TypeScript and three.js, built with Vite.

## Saving context

Context stays in the session once loaded, so look things up narrowly.

- Find code with `grep -n` and read ranges. Read a large file whole only if the task needs all of it, and not twice in a
  session. Large ones: `src/map/HexagonPatch.ts`, `src/game/gameView.ts`, `src/meeple/Meeple3D.ts`,
  `src/map/dungeonLights.ts`, `src/game/castleScene.ts`, `src/render/dungeonLighting.ts`.
- `plans/discovery.md` is long. Run `grep -n '^#' plans/discovery.md`, then read just the section you need.
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
only activates pad mode, so use a second one to trigger the action. Button 2 (west) ends the day. Frame rates in
headless Chrome mean nothing, as it renders in software.

## Layout

- `src/game`: the game page, with campaign state, UI (`gameView.ts`), castle scene and gamepad input
- `src/map`: patch and dungeon generation, routes
- `src/render`: meshes, lighting and the manuscript map
- `src/meeple`, `src/castle`, `src/items`: characters, castle, item sprites
- `src/worker`: the map worker, which generates patches off the main thread
- `test/` mirrors `src/`
- `plans/discovery.md`: the implementation plan, update it when the design changes
- `*.html` in the root: `index.html` is the game, the others are test pages for single parts (`src/*Test.ts`)
- `docs/` is ignored build output, don't search it

## Code style

Four spaces, no semicolons, double quotes, opening braces of functions and control statements on their own line.
