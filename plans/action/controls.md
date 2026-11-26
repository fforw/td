# Controls

## Controller

- A level plays as a twin-stick action game in real time, with the
  actions on the shoulders, as the thumbs are busy with the sticks
  (`game/heroControl.ts`).
- The left stick moves, sliding along the walls as they got built, not
  the edges of their faces (`moveOnFloor()`). The right stick aims, and
  the hero looks where it points on the screen.
- L1 dashes, R1 attacks, L2 blocks. R2 is kept for a secondary attack.
- A dash goes where the hero moves, or else where they look. Nothing can
  hurt them from its start until a little after it ends (`DODGE_TIME`).
- A tapped attack waits for what's in its way.
- Holding the dash button after a dash sprints, for longer the stronger
  the hero is (`strSprintTime()`), until letting go, blocking or the next
  dash. The walk cycle steps faster by as much (`Meeple.pace`), and each
  meeple adds up its own stride, so that changing the pace doesn't jump.
- Fighters carry a sword and a shield.

## Face buttons

- While steering a hero, the face buttons only do things in the level,
  so the overworld map and the way back to the castle are for the mouse.
- Cross (the confirm button) opens a chest or takes an exit. Chests open
  only from inside their room, not through walls.
- Triangle toggles the light the hero carries, and square opens the map
  of the level, outside of fights. Circle closes it.
- In the castle, square opens the overworld map as well, and triangle
  ends the day.

## Keyboard and mouse

- Without a controller, keyboard and mouse steer the same hero at the
  same speed (`game/keySteer.ts`). WASD moves, as fast in any direction
  as a stick pushed all the way, and the hero looks at the floor under
  the pointer.
- The left button attacks, the right one blocks, space or left shift
  dashes. E does what the confirm button does, F toggles the light, M
  opens and closes the map of the level.
- A bar along the bottom names the keys while they steer.
- Keys and mouse steer in every frame a controller doesn't, so whichever
  was used last has the hero.
- Walking to a clicked spot along a route was dropped: it was too slow,
  and left no way to fight.

## Carried light

- The light the hero carries burns down in a minute while it is on,
  losing the same share of its strength every second, and goes out when
  little is left. Turning it on again lights it at full strength.

## Planned

- Something to attack or block with for heroes other than fighters.
- A secondary attack on R2.
- Controller buttons for the overworld map and the way back to the
  castle.
