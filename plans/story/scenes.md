# Scenes

Meeples talk to the heroes in scenes: the level stops, the camera moves
in close to the meeples involved, and a script plays, straight through
or with choices for the player. This is how a stereotype shows up in
person: a trader, a stranger with a message, a prisoner who begs.

## Playing a scene

- A scene starts by interacting with a meeple: cross near them, like a
  chest, with a prompt for it. Only outside of fights, like the map of
  the level.
- The level freezes while a scene plays: monsters, coins and bursts
  stop, the carried light doesn't burn down, nothing can hurt anyone.
  Only the actors of the scene move. Room ambience keeps playing.
- The actors are the focused hero and the meeples the scene names. The
  hero goes to a mark at talking distance from the stranger, toward
  where they came from, turned around the stranger until every shot sees
  both of them from inside the room.
- The stage (`scene/stage.ts`) plays a script in time: it cuts to the
  first shot, blends to the others, waits for acts by time and for the
  player to go on after something said or shown.
- `scene/SceneBox.ts` shows the bubbles above the heads and the buttons
  to go on or choose, which the mouse, the keyboard and a controller all
  work.

## Camera

- The 180-degree rule: the two main actors A and B span the line of
  action, and the camera stays on one side of it.
- A shot is an angle around the middle between them, from the direction
  of A (0) to that of B (180), plus distance and height. The two-shot is
  near 90, over the shoulder of A near 20, over that of B near 160
  (`scene/sceneCamera.ts`).
- Camera moves go along that arc, so they never cross the line, and
  whoever is left on the screen stays left.
- The [near walls](../dungeon/view.md#walls-that-give-way) only give way
  toward the level view, so a shot across the room could have a wall in
  front. The marks are chosen for all shots to see the actors from inside
  the room, and where that doesn't work out, a shot is pulled in toward
  the actors until no wall is in the way.

## Scripts

- A script is a graph of beats (`scene/script.ts`), typed data in TS, so
  stereotypes can make scenes as well as hold written ones. The beats
  are shot, say (a bubble of words plus an emotion), act (a clip), show a
  ware, choice, trade, check a condition, pay, use a ware and set a fact.
- A scene plays as a whole and is never saved halfway. What it changed
  is saved when it ends.
- What scenes found out or decided is saved with the campaign as facts
  by level (`Campaign.facts`), gone when the level starts anew like
  `explored`.
- Choices grow with the language. Early on the player half understands
  at best, so the choices are just agreeing or not, full of doubt:
  "Yes?", "No, I guess?".

## The trader

- The first scene is a trader (`scene/trader.ts`), a stranger in a room
  of a dungeon, met by interacting.
- The stranger stands in the middle of a big room of the level, not the
  entrance room (`scene/stranger.ts`), and no monsters are placed in that
  room. A stranger wears a dashing moustache (`MeepleLook.moustache`).
- Heroes carry nothing but their weapons and the gold they found
  (`Job.gold`), so the wares are drunk or used at once: potions of
  healing, speed and strength, which last a while of level time
  (`POTION_TIME`) and aren't saved, and the map of the level.
- The map is expensive. It draws the whole level as if visited, with
  every special feature (chests, exits) marked only by a "?" until a
  hero has been there, so the player still has to find out which "?" is
  an exit. A bought map is the fact `charted`, and the trader doesn't
  offer it twice.
- The talk is short: the trader offers to trade, and the hero agrees or
  not. No ends the scene, and talking again starts it over.
- Yes opens a trade: every ware with what it looks like, its glyph and
  its price in coins, the ones the hero can't pay for disabled. Buying
  uses the ware at once, and the player learns its
  [glyph](glyphs.md#glyph-language). Back leaves the trade and ends the
  scene.
- Paying takes from the gold the hero carries, so spending it in the
  level is a trade-off against bringing it home.
- A talk with the stranger played to the end is the fact `metStranger`,
  after which the map of the level shows the stranger as 🥸.
- The "?" is an Inkscape drawing in `media-src/icons`, which
  `pnpm build-icons` turns into a plain SVG in `src/icons`.
- In god mode the map of a level has a button that shows all of it with
  what is where, the stranger included, and makes every room a jump
  target.

## Planned

- More triggers: reaching a place (entering a room, coming close to a
  mark), or a scene that follows another. A trigger that fires during a
  fight waits for it to end.
- Marks for all actors a few faces apart on open floor of the room, so
  there is room around them for the camera. The script, or the generator
  that made it, says which side of the line the camera is on, and the
  marks are chosen to suit it.
- A third actor stands back on the far side of the line, and the line
  stays with A and B for the whole scene.
- Move-to-mark and give beats.
- A clear enough showing of a concept in a scene counts as an exposure
  toward learning it, so a message the player can't read yet is still
  worth hearing.
- Choices as emoji or whole sentences in meeplish once the player knows
  more of the language.
- Scripts that outgrow plain data and need some scripting or a node
  editor. The beat graph should leave room for that.
- A messenger who tells a few glyphs, some known, some not, and the hero
  takes it in or turns away.
- Fading the walls in the way of a shot, if pulling it in isn't enough.
- Sprites for the potions and glyphs for the wares.
- Saving the potions.
- Special rooms on the bought map.
- Taking god mode out of the map of a level once it isn't needed.
