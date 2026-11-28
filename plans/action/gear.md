# Gear

What a hero carries besides sword and shield, used with R2: weapons to
throw, wands and scrolls (`game/gear.ts`). It makes heroes stronger
before monsters get more dangerous in groups.

## Pieces

- Throwing weapons hit hard but have to be fetched again: daggers fly
  fast and straight, axes slower, spinning, for more damage. A hero has
  a number of each.
- Wands and scrolls shoot glowing balls of an element, each element with
  its own color. A wand shoots without end but weakly and with a wait
  between shots, a scroll hits harder and has a number of uses.
- The elements are colors only for now.
- Pieces of the same kind, and for wands and scrolls the same element,
  go together into one, so there is one entry for daggers with how many
  there are.
- A hero can carry any number of pieces. One of them is the current
  one, which stays the current one when they leave and come back.

## Using them

- R2 uses the current piece in the direction the hero looks, Q with the
  keyboard, toward the pointer. Left and right on the cross pick the
  current piece, Z and C with the keyboard.
- Holding R2 uses the piece again and again, with a wait after each use
  (`GEAR_USES`) that keeps it from firing like a machine gun. Wands have
  the longest, as they have no other limit. Nothing gets used behind the
  shield or while dashing.

## Thrown weapons

- A thrown weapon hits the first monster in its way. Half of the time it
  falls to the monster's feet, the other half it sticks in it and falls
  only once the monster dies, which makes killing it a way to get the
  weapon back. One that a shield stops or that kills always falls.
- A weapon that hits nothing flies on until a wall stops it, or until it
  leaves the room or corridor it was thrown in, and then falls a little
  after. So a throw into a dark corridor doesn't lose it far away.
- A weapon that fell lies on the floor, not in a bubble like loot, as it
  belongs to the hero who threw it, with a glint under it to be found in
  the dark. Only that hero picks it up again, by walking over it.
- What isn't picked up when the hero walks out of the level, or gets
  carried out, is lost. When the level gets built anew, as the view went
  to another one, all of it is back with the hero.

## Glowing balls

- A ball flies straight and bursts on the first monster or wall it
  meets, or once it has gone its range.

## Getting them

- Every hero gets the base gear of a campaign level when the campaign
  reaches it (`baseGear()`), and new heroes get that of all levels up to
  the current one. It starts with daggers and grows with wands, axes and
  scrolls, as the heroes have to get stronger with the monsters.
- Some chests have a piece in them, which comes out after the coins and
  a potion, from random numbers of its own (`GEAR_CHANCE`). It floats in
  a bubble like all loot and goes to whoever picks it up.

## HUD

- The lower left corner shows what the steered hero needs in a fight: a
  circle with the campaign level, filled from the bottom as far as the
  next level is, and next to it the hit points as a bar, with the gear
  under it as small icons and a frame around the current one.

## Planned

- Elements that do something: burning, freezing, chaining.
- A throwing and casting pose for the hero.
- Light from glowing balls on walls and floor.
- More pieces: bows, bombs, artefacts that aren't shot.
- Whether found gear is something carried, that the heroes get robbed
  of when carried out, like gold.
