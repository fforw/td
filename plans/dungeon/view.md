# View of a level

## Camera

- The view looks from one side at a fixed angle, steep enough to see
  over the walls next to the floor, so that a direction of a stick or
  the keys always means the same direction in the world. Only the
  distance changes.
- Two play testers settled this. A view that turned while the aim stick
  pointed off to the side made a held stick mean another direction from
  frame to frame, and fights felt sluggish, most of all for players new
  to that kind of game. A view that turned toward a fixed aim and stopped
  after a quarter turn felt abrupt.

## Walls that give way

- A fixed view can't look behind a wall, so the walls in front of the
  hero give way. The levels have no direction of their own that would
  suit one side better than another, so this can't be designed around.
- What's in the way only depends on the level (`map/nearWalls.ts`).
  Rooms and corridors are spaces, and a wall is near for a space if floor
  of it lies right behind the wall as the view has it, and the wall faces
  the view enough. Walls running along the view stay.
- Walls are low enough that looking at what is next to a wall is all it
  takes, also for rooms that aren't convex.
- Walls only give way for the space the hero is in. Opening the spaces
  close to the hero as well made the wall they walk up to give way.
- Thick walls are cut about a face deep: each corner takes the first
  floor straight behind it as the view has it, with floor to both sides.
  Cutting all around the edges of the floor spread to walls in front of
  other spaces, and through thin walls.
- A corner also takes the next space straight behind the first one
  within that depth. Else a narrow strip of another space between a wall
  and the open space leaves the wall standing in front of the open one.
- Near walls of the open space turn see-through and stay where they are
  (`render/wallCut.ts`). Lowering them to a curb looked wrong in motion.
- Walls are drawn twice from the same geometry, one mesh without what is
  cut and one with only that, which writes no depth. A single see-through
  mesh would leave holes in the solid walls behind it.
- Each space fades on its own, so walls don't blink on the way through
  small spaces.
- The ground under thick walls shows through them and is near black in
  levels.

## Insides of thick walls

- Thick walls are hollow, and their tops and sides only show from
  outside. Where a cut side met a solid top, the view went under the top
  and out through the far side into a lit room next door.
- The insides of the far sides close that off
  (`createThickWallInsides()`), unlit, in the color of the ground under
  walls.
- Which of them make way depends on where the camera is, so each
  fragment follows its line of sight down to the floor on a grid of the
  spaces and thin walls (`applyInsideCut()`). It makes way if it comes to
  an open space with no wall before that. Fixed pieces for a view
  straight on left a third of the leaks, and black shards.
- Sides with nothing in front that gets cut, or with no other space
  behind, are left out (`isExposed()`). The convex hull of the spaces
  can't tell those.
- Thin walls end right inside of thick ones, as their lit ends showed
  through a cut.

## Door sills

- Once cut, a near wall and a gap in it both show the floor, and
  playtesters had a hard time telling openings. So each DOOR edge gets a
  low sill of warm stone (`findDoorSills()` in `render/dungeonMeshes.ts`),
  lit by the field like the floor. It shows through cut walls and marks
  side openings too.
- Where a face has doors on two neighboring edges, their sills would
  meet in an L. They make way for one sill on the other edge of the face
  that is open, or diagonally across the face, cutting off the corner of
  the doors, if both are. That is a room face with two corridors coming
  in at its corner.
- With neither open, both go: that is a corridor of a single face around
  the corner between two rooms, where the end of the wall between the
  rooms shows the way well enough.

## Walls at vertices

- Walls don't fill their faces, so they also have to meet at vertices
  that keep floors apart or the floor from the void
  (`splitsAtVertex()`). The gaps left otherwise would be real ways around
  them, for heroes and light.

## Marks and silhouettes

- The floor shows the aim and the slash (`render/heroMarks.ts`), as items
  lie along the body and hardly show from above. The sword hits what is
  in that arc, when the blade comes down.
- Walls hide those walking behind them, so meeples can have a
  silhouette: a dark shape with a light rim, showing only where something
  is in front of them (`MeepleCrowd.showSilhouettes()`). Heroes always
  have one.
- It is set per meeple, so monsters can get theirs in another color when
  they start a fight, and those not fighting yet stay a surprise.
- Items have no silhouette, and the aim and slash marks on the floor
  still get hidden.

## Bloom

- Levels are drawn by a `GlowView` (`render/glowView.ts`), which adds
  bloom for effects alone: the beam, the sigil and the fire.
- The scene is drawn as it would be on the canvas, with tone mapping per
  material, so the bloom changes nothing else. What glows
  (`setGlowing()`) is drawn again on its own, behind the depth of the
  picture, and only its bloom is added.
- The sigil and the fire only put a share of their light into it
  (`GLOW_SHARE`), which keeps their shapes clear.
- With no effect around it costs only a copy of the picture.

## Planned

- Several small spaces within a few steps keep the walls changing. That
  could take a delay, or merging small spaces with their neighbors.
- A wireframe with hidden lines as an outline on top of cut walls.
- Silhouettes for monsters seen behind a wall, which needs attacks to
  stop at walls, in both directions.
