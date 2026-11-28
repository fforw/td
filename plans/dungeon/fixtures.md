# Fixtures

## Chests

- The only fixture so far is the chest (`treasure/chests.ts`). Some rooms
  other than the first have one, chosen from the level seed, against a
  wall and away from doors and corridors.
- It can't be walked through, but can be seen past. A hero close enough
  opens it, from inside its room only.
- `Campaign.chests` keeps which coins of each opened chest are still
  lying around, per level. Everything else about them follows from the
  seed.

## Coins

- The coins of a chest spill to where a hero can get to, each in a bubble
  that floats over the floor, with the coin turning slowly inside. Every
  item to pick up is meant to float like that.
- The bubble is a sphere with a shader (`createBubbleMaterial` in
  `render/dungeonLighting.ts`): a slight fresnel edge, the rim of the
  light field like the meeples get, and one highlight dot. It adds light,
  so the coin shows through.
- A hero who comes within reach of a landed one picks it up: it moves to
  them and disappears with `media/sounds/pick-up.mp3`, pitched to a
  random step of the major pentatonic scale around its own pitch.
- Each coin is worth 10 gold. The hero carries it (`Job.gold`), and it
  only goes to the campaign once they are back at the castle. A hero
  carried out of a level gets robbed of all they carry, and it goes back
  into the level, which starts anew.

## Gear

- Some chests also have a piece of [gear](../action/gear.md) in them
  (`GEAR_CHANCE`), which comes out last, from random numbers of its own
  like the potion. It floats in a bubble like everything else, and goes
  to the hero who picks it up.

## Potions

- Some chests also have a potion of healing, speed or strength
  (`POTION_CHANCE`). It comes out after the coins, from random numbers of
  its own, so the coins stay the same.
- A hero drinks it on picking it up, like a bought one, and the player
  learns its [glyph](../story/glyphs.md).
- The potions are Blender models (`media-src/potions.blend`), exported by
  `pnpm export-models` with one instanced mesh per part.

## Planned

- Fixtures are static entities placed by the generator: chests, traps,
  altars, levers, workbenches, beds, storage, portals. Deterministic from
  the seed with a stable id (level, patch, face, index). Records only
  store changes ("chest 3 looted").
- Orientation: one of the face's four half edges.
- Interaction anchor: the position and facing a meeple takes to use it.
- Range per kind: an action can be triggered once a meeple is within
  range (in faces or level map units, never render units). The meeple
  then walks to the anchor, aligns and performs the action.
- Interactions per kind: open, disarm, use, rest. House functions
  (crafting, storage, healing) are fixture kinds.
- Traps can be hidden, and detection uses the hero's wisdom attribute.
- Chests placed by the premise instead of the seed.
- Glass for the potions that is faked better than plain alpha.
