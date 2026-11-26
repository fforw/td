# Dungeon generation

A dungeon level is a block of connected patches, 2 x 2 by default
(`map/generateDungeon.ts`). How it looks is a matter of style per
dungeon (`DungeonStyle`).

## Walls

- Walls are mostly faces: thick masses between rooms, to avoid a look of
  many skinny walls. Edge walls ([face and edge
  types](../world/levels.md#face-and-edge-types)) are for dividing a
  space and for doors, and rule nothing else out.
- Faces next to floor are `FaceType.WALL`, everything behind them stays
  NONE and draws nothing.
- Thick walls are the wall ground of marching squares raised to wall
  height. Wall edges are thin walls that reach a little past their ends
  and run into each other, without any columns
  (`render/dungeonMeshes.ts`). Where more than two meet, or two at a
  tight angle, the corners of faces between them are rounded, and tight
  corners get a flat outer side.
- The floor wins the contested samples in levels (`LEVEL_PRIORITY`), the
  other way around than on the overworld, or walls would spread into the
  floor.

## Rooms

- Room candidates come from classifying the mesh: count the quads around
  each vertex across seams. Faces that touch a vertex of 5 or more quads,
  or the outer edge of the level, are wall. The connected regions of the
  other faces are candidates. Irregular vertices end up in the walls, so
  the floors are nearly regular grids.
- Two candidates can't share an edge, but they can touch at a corner.
  Half of them are tiny, a quarter big.
- Rooms keep the regions of 8 faces or more, largest first, until 40% of
  the faces are floor (`map/dungeonRooms.ts`). That takes nearly all of
  them, about 80 rooms on 2 x 2 patches. Everything else is wall, and
  corridors are carved through it.

## Corridors

- Corridors are one face wide (`map/dungeonCorridors.ts`).
- Some rooms spread out over the level get connected first, closest
  first. Other rooms are in their way, so these corridors are long and
  wind through the wall. How many is a matter of style (`labyrinth`, per
  patch). 0 leaves only short connections, high values put the rooms too
  close together for long corridors.
- The other rooms then connect to what is closest, mostly by a face or
  two. That makes a tree, with a door at each end of a corridor.
- Corridors can't cross each other, so they can fence in a room, in a
  few percent of the levels. It then gets a corridor branching off the
  one in its way.

## Growing rooms

- Rooms then grow into the wall around the corridors, one random face
  next to a random room at a time, until a share of the faces is floor
  (`floorShare`, a matter of style).
- Corridors come first so growth can't eat them. Rooms end up sharing
  edges, and wall edges separate everything that touches, so corridors
  stay one face wide with rooms right next to them. Irregular vertices
  end up in the floors.

## Roles

- The rooms and corridors are a tree with the first room, the largest,
  as its root (`map/dungeonRoles.ts`). It has the main exit.
- The main path is the longest way from there, and the entrance is at its
  far end, in the deepest room.
- Some levels have a second exit on the branch furthest off the main
  path (`SIDE_EXIT_CHANCE`).
- A hero in a level stays there until they find an exit, or get carried
  out.
- Monsters and chests stay out of the entrance room.

## Light

- Light is baked into a field over the plan of the level, which floors,
  walls and meeples look up by position (`map/dungeonLights.ts`,
  `render/dungeonLighting.ts`).
- A point gets the angle under which it sees a light, minus the angles of
  the walls in front of it, which needs no rays and gives exact soft
  shadows. Lights stay below the top of the walls, so 2D is right for the
  floor.
- The field only keeps the share of a light that the walls leave, per
  texel in up to 4 channels with an id for each. Lights in one channel
  never meet. Whenever lights change, a pass works out the rest from the
  distance to the light into 4 textures that everything looks up. So
  lights can flicker and change color without baking, but their shadows
  stay where they are.
- The textures are RGBA8, which needs no extension to render to and
  keeps weak devices in.
- The field is fine enough (`LIGHT_TEXELS`) to keep shadows from getting
  blocky near the ends of walls.
- Rooms get a light in the middle, sized by the room, or, for some of the
  rooms that are long enough, two smaller lights in different colors at
  the ends of their long axis, each on its own half (`PAIR_CHANCE`). Each
  light gets a random intensity that scales its color.
- The biggest rooms come first. A light gets smaller until it is clear of
  walls and finds a free channel, counting doors as open. A room whose two
  lights don't both fit gets one in the middle, and rooms where even the
  smallest light doesn't fit stay dark. A few rooms stay dark on purpose
  (`DARK_CHANCE`).

## Rims

- A meeple gets a rim instead of its outline only where it stands in the
  dark and a light still reaches it, so not close to a light.
- The rim only follows the light with the most energy at a point, with
  its own direction and hue, which the field pass keeps in 2 more
  textures. Two rims at once would look odder than a rim that jumps
  between lights.
- Where a rim shows goes by the lights at full strength, and its
  brightness follows their strength, so changing lights don't make rims
  come and go.

## Metal

- Metal reflects a drawn environment instead of the level: a spooky green
  glow around the horizon, cut by dark wall segments
  (`render/dungeonEnvironment.ts`).
- It goes on the metallic materials of our own models as they load, not
  on the whole scene, which would light the dark up.
- The Kenney kits mark things as metal that are not, so their metalness
  is set to 0.

## Floor patterns

- Half of the rooms get a pattern over their floor from the Kenney
  Pattern Pack, low in contrast, to vary them a little
  (`render/floorPatterns.ts`). Every face is a tile of the pattern.
- The floor keeps the edges of the wall faces next to it, so the pattern
  goes on into them, each continuing the room face that reaches it first.
  A wall face can lie between two rooms or a room and a corridor, so a
  room only covers the triangles from the middle of a wall face to its
  edges with the room.
- The texture coordinates flood out from a face, each face continuing the
  pattern over the edge it was reached by. Around an irregular vertex the
  pattern turns, so where two paths meet the edge doesn't match, which is
  accepted. Of several starts the one with the most matching edges wins,
  which matches nearly all edges inside rooms. Growing first where the
  most neighbors agree gains next to nothing.
- The pattern multiplies the lit floor by 2 x its texel, which lightens
  and darkens around the mean of the pattern, so the room keeps its
  brightness.
- Only irregular patterns are used: stones, cobbles, paving, scatter,
  wood grain and waves. Grids, bricks and checkers show how bent the quads
  are, and make the turns obvious.

## Fire room

- A level has at most one fire room (`map/fireRoom.ts`), a room on the
  main path that can't be walked around, and not the one of the stranger.
- Lines of fire cross the ways between all its doors from wall to wall
  (`FireHazard`), one after the other, while a hero is in there or near a
  door. Doors and the switch are safe.
- The switch is on the wall next to the door towards the exit, if
  possible on one the view sees. It stops the fire for good, as a fact of
  the level (`fireOff`).
- Monsters there come from `LIMITED_GROUPS`, a single one at most.
- `dungeon.html` shows the lines and the switch.

## Planned

- The premise is a stereotype, and decides inhabitants, fixtures and
  theme.
- Splitting or trimming big rooms at their narrow necks, with a door edge
  where that keeps the faces.
- Small regions along a corridor as closets or niches.
- Loops in the corridors.
- Four quads around a vertex aren't a classification, most vertices have
  that. Inside a room such a block is a spot for a 2 x 2 fixture.
- Thin walls that aren't scaled cubes.
- Rebaking the lights near a changed wall: those within `MAX_INFLUENCE`
  of it, whose shadows reach up to twice as far.
- Meeple shadows in levels.
- More roles: approach, branches, climax (deepest point or end of the
  main path), reward behind the climax.
- Content following the roles: foreshadowing early, resistance along the
  main path, the guardian slot in the climax, the reward behind it, side
  rewards or shortcuts in branches.
- Locks and keys: put a lock on a main path connection, place the key in
  the part of the graph reachable without passing it, ideally a branch,
  and repeat, which guarantees solvability. Keys can be items, levers,
  abilities (hidden passage, barred door) or facts (a password found on a
  note).
- Shortcuts: doors that only open from the far side, so the way out is
  short after the climax. A one-way edge, where the two half edges
  differ.
- Side exits that lead somewhere else than the patch of the level, which
  makes them more than a shortcut.
