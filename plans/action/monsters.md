# Monsters

What all of them share is in [combat](combat.md), which rooms they get
placed in is in [spawns](../dungeon/spawns.md).

## Placement and reloading

- The spawn planner places monsters from the level seed. They aren't
  saved.
- Only those on floor no hero has been to get created
  (`inUnexplored()`). So a reload brings back the ones in the unexplored
  parts, and whatever lived on known floor is gone for good, killed or
  not.

## Behavior trees

`monster/behavior.ts`. Monsters with choices to make decide by a tree,
the simple ones keep their own code. Wizards and soldiers are on one so
far.

- A tree is shared by all monsters of a kind and holds no state. What a
  monster runs is in its `Memory`, and anything else the tree needs is
  plain state on the monster, so monsters stay plain objects.
- The structure is data built by small functions, and the leaves are
  code. So `Tree.path()` names what a monster does, for tests and
  checks, without a file format nobody would edit.
- Only leaves act. Conditions only read, so going through the tree
  every frame changes nothing by itself. What a monster notices, like
  how long a hero has threatened it, the pack works out before the tree
  runs.
- A move with a warning or a fixed timing is a committed leaf: it runs
  to its end without the tree being gone through, so a warning always
  means what it says. Only an interrupt, like a blow, ends it early.
  Walking somewhere isn't committed, so anything more urgent takes over.
- Skill, from 0 to 1, makes a monster harder in two ways: `skilled()`
  keeps branches for the better ones, so a harder monster knows more
  tricks rather than being another monster, and leaves tune themselves
  by it, like how fast they react. Whole trees are for another
  character, not for being harder.
- For now skill grows with the depth of the room, from 0 in the first
  room to 1 in the deepest (`depthSkill()`), so a level gets harder as
  the heroes go in, the same for the seed.

## Acid cuboid

`monster/cuboids.ts`. Comes big, or at half the size.

- Hops after heroes it sees, the big one slower.
- The big one can lunge, half as far again as a hop, after a moment of
  winding up.
- The big one breaks up into 2 to 7 small ones when it dies. They hop
  off in a fan away from the blow, so they rarely land on whoever struck
  it.
- Touching hurts. A shield stops small ones, from the front only.
- It hurts from a little beyond where they meet (`TOUCH_SLACK`), as
  bumping keeps the two from overlapping.

## Flying eye

`monster/eyes.ts`. Hovers low over the floor and keeps away from heroes.

- It picks a spot that sees them, as far off as it can get without a
  long way there.
- While it sees someone it fires fast bolts at random intervals. Showing
  the lower eye of its texture for half a second is the warning.
- A shield stops a bolt coming from roughly in front, dodging lets it
  pass, walls put it out.
- A blow knocks the eye back and spoils its shot.
- The eyes of a level share a memory of where one of them last saw a
  hero, or got hit from (`MEMORY_TIME`). Each new sighting replaces it.
  Eyes that see the spot fly there to look, others stay put, as eyes
  don't find ways around walls.

## Construct

`monster/constructs.ts`. A metal cage around a glowing core that pulses,
hovering like an eye. It takes 2 sword blows.

- With nobody around it flies straight from point to point at an even
  speed and holds still at each for a moment, which makes it look made
  rather than alive.
- Once it sees a hero it zips through them, to as far behind them as it
  was in front, or less if a wall is in the way, but always a little
  behind. Without room behind them it doesn't zip.
- The line is fixed when the zip starts. It eases in by the fifth power
  of the time, so it creeps for most of the zip, which is the warning,
  and passes the hero late. Stepping aside makes it miss. A long zip
  takes longer, so it never gets faster than a set speed at the end
  (`MAX_ZIP_SPEED`), which would be too fast to see. The core beats
  faster and burns brighter as the zip goes on.
- Only the zip hurts, touching it otherwise does not. A shield stops it
  from the front and throws it back, dodging lets it pass.
- While zipping it goes through heroes and monsters without bumping, as
  bumping would carry whoever it hits along to the end.
- After a zip it holds still a moment and looks again, so it keeps
  zipping back and forth through a hero it sees. A blow stops the zip.

## Brute

`monster/brutes.ts`. Slow and heavy: it walks at about a third of a
hero's running speed and takes 8 sword blows, which don't stop it and
hardly push it.

- Within reach it swings its club. It turns after the hero while raising
  the club and stops turning before it comes down (`AIM_TIME`,
  `IMPACT_TIME`).
- The club hurts once and a lot, in front only, and no shield stops it.
  The way out is to step back or aside, or to dodge.
- Each brute has its own rigged copy with an `AnimationMixer`
  (`BruteCrowd`), so brutes are for few at a time. The walk follows the
  ground covered, the attack the time into the swing.
- When it dies, its body bursts right away and the club goes on alone,
  with the die clip: it drops from the hand, tips over and comes to rest,
  baked from a rigid body simulation in `media-src/brute2.blend`. The
  club bursts at a random frame after it first hits the floor, more
  likely a later one, so not every club takes the whole fall. A smitten
  brute goes the same way.

## Soldier

`monster/soldiers.ts`. Walks after heroes a bit slower than they run and
takes 4 sword blows. It is drawn a bit larger than its model, with body
and reach to match.

- It swings a sword that hurts in front, which a shield stops.
- After each swing, and when struck while not swinging, it holds up its
  own shield for a while, turning after the hero and closing in slowly.
  Then it lowers the shield and swings again once it is all the way down.
- A blow from the front does nothing once the shield is up far enough
  (`SHIELD_UP`, `SHIELD_ARC`), so the way in is from the side or behind,
  or during the swing. A monster that stops a blow says so with
  `MonsterPack.stops()`.
- Blocking is a mode, not a move: the state keeps how far up the shield
  is, and `SoldierCrowd` takes the time into the block clip from that.
  The first half of the clip goes up, the second half comes down from as
  far as it got. Swing and block never overlap and start and end at rest,
  so neither fades.
- From `FLANK_SKILL` up soldiers going after the same hero spread around
  them, opposite each other for two, as a shield only covers the front.
  They take the slots in the order they are around the hero, so nobody
  crosses over, and the slots are turned so that all go about as far.
  They circle out of reach of the sword, facing the hero, and step in at
  their slot.
- They swing together, once all are in place, so the hero can't face
  them all. One that can't get there doesn't hold the others up for
  long (`CUE_WAIT_TIME`).
- From `COVER_SKILL` up a flanking soldier that a hero faces raises its
  shield once it saw that long enough, so the one the hero turns to is
  covered and the others strike. It has to see the next blow coming
  anew after that. Alone it doesn't, as it would never strike.
- The walk splits by bone: the body walks on beneath a guard, while the
  arms give way to swinging and guarding. Each clip has only the bones
  its action moves, or a guard would hold the body still.

## Wizard

`monster/wizards.ts`. Wanders, and walks up to heroes it sees, but stops
at a distance (`CAST_RANGE`).

- The color of the robe tells the attack: purple fires the beam, red
  rains fire, blue casts a sigil on the floor. More colors can come with
  more attacks.
- The robe of the model is a gradient from white to grey, which
  `WizardCrowd` tints (`ROBE_COLORS`). The face in the hood is dark with
  glowing eyes, which the light field leaves alone.
- The model has the soldier's walk, the casts and a block.
- From `BLOCK_SKILL` up it sees blows coming: a hero close by who faces
  it threatens it, and once that lasted its reaction time, shorter the
  more skilled it is, it raises the staff. A sword blow strikes too
  soon after the swing starts to react to it, so the block has to come
  first.
- With the staff up far enough a blow from the front does nothing, as
  with the soldier's shield. It turns slowly while it guards, so the way
  in is around it. It holds the staff for a while, longer while still
  threatened but not for long, and has to see the next blow coming
  anew after lowering it, which leaves a gap. It doesn't cast with the
  staff up.
- From `BACK_OFF_SKILL` up blue and red ones back off from a hero that
  comes well within the distance it keeps, walking backwards while facing them,
  until it is that far again. Backing off isn't committed, so it can
  still block on the way.

## Beam

`render/beam.ts`, test page `beam.html`. The attack of purple wizards,
who come in groups and are living obstacles.

- Once they see a hero they stand still and turn around once with the
  beam. They don't aim: a turn starts where they look and goes either
  way, so it starts by moving off the hero.
- The beam goes from the staff to the first wall or hero and passes over
  monsters. It hurts that hero unless they dodge or hold a shield against
  it.
- A blow ends it. Between turns they walk like other wizards, but they
  don't back off from heroes, as obstacles that give way wouldn't be in
  the way.
- Only a few beams of a level light up what is around them (`BeamCrowd`).

## Sigil

`render/sigil.ts`, test page `sigil.html`. The attack of blue wizards.

- It draws itself under the hero as a dim blue warning and stays there,
  then flares up blue-white and hurts who is in it, shield or not, until
  it dissolves. It doesn't turn red, as that is the color of fire.
- A blow on the wizard while it draws breaks it.
- `placeSigil()` moves it off the walls where it can, but keeps the hero
  in it.
- The hue of the sigil and the robe varies a little per wizard.

## Rain of fire

`monster/fireRain.ts`, `render/FireRainCrowd.ts`, test page
`fireRain.html`. The attack of red wizards, but it doesn't know about
them, so hazards and bosses can use it as well.

- A pattern (`FIRE_PATTERNS`) lays out spots with delays around an aim:
  `scatter` at random, `line` from the caster's side through the target,
  and `rings` from the outermost to the innermost, whose strikes overlap
  in the middle. Spots in or behind walls are left out.
- A disc grows to the outline of each spot until it strikes and hurts,
  shield or not. The outline hides until the disc is big enough to see.
- The flames are cartoon-like: a shader layers see-through circles that
  rise and go from large and red to small and yellow, and cuts out others
  that rise at varying speed and size.
- Red wizards pick a pattern at random and aim until the staff hits the
  floor (`STAFF_STOMP`). A blow before that stops the rain, after it
  nothing does.

## Planned

- Skill from the threat level of [escalation](../dungeon/spawns.md#planned)
  as well as the depth of the room.
- Trees for the flying eye and brutes: eyes moving to another spot when
  a hero closes in and hiding when hurt, brutes charging from afar.
- Showing the path of the tree over a monster on a test page.

- Monsters and meeples as simulation state: live ones are saved while
  their level is active. On reload unchanged inhabitants are regenerated,
  and the record keeps who is dead, fled or moved.
- Inhabitants fill stereotype slots or are placed by the dungeon premise,
  with a reason to be there. No generic spawners.
