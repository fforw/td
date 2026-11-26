# Map of a level

## Sheet

- The map of a level (`game/levelMap.ts`) is a sheet of the manuscript
  map over the paused level. It only opens outside of fights.
- Its regions come from one boolean per face, whether a hero has been
  there, run through the marching squares of the overworld map, with the
  closest face center deciding for a raster point.
- Heroes visit the floor they can see within reach (`VISIT_REACH`)
  whenever they get to another face.
- Unvisited faces are open floor or blocked, which look alike on a shade
  of the paper.
- The line around visited floor is thick and black toward walls and thin
  walls, and left out toward open floor, where there is more to find
  (`MapLayer.ink`). A gap stays readable on a small map, dashes might
  not.
- On it are the chests, open or closed, the exits on visited faces, and
  an arrow for the hero the view is with, pointing where they look.

## Jumps

- Every other room with visited floor has a button on the map. Picking
  it, by mouse or with the controller, puts the hero right onto the
  visited face closest to the middle of that room and closes the map
  (`jumpTargets()`). A jump checks again that there is no fight. It costs
  nothing.

## Saving

- `Campaign.explored` keeps the visited faces per level as base64 bits
  (`game/exploration.ts`), counted through the patches in order and
  without the trailing zero bytes. It stays when a level starts anew.

## Planned

- Whether jumps should cost something.
