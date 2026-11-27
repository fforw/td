# Combat

What all [monsters](monsters.md) share is in `monster/monsters.ts`:
noticing heroes, the sword arc, the hurt cooldown and bumping.

## Getting hurt

- After a monster hurt a hero, no monster can hurt that hero for a
  moment (`HURT_WAIT`), and after that whatever still touches them hurts
  again.

## Bumping

- Monsters are big or small and walk or fly. Those on the same ground
  bump into each other, a flying one only into big ones on the ground and
  into heroes, who count as big. A monster that is passing, like a
  construct zipping, bumps into nothing.
- Bumping (`monster/shove.ts`) is circles on the floor that move out of
  each other by mass, the lighter one more, and trade momentum along the
  line between them, with a little bounce.
- What they get goes into a shove speed that dies down quickly, on top of
  where they go on their own. Speeds come from how far each moved in the
  frame, so a dash shoves much harder than running. A brute barely gives
  way to a hero, while an eye flies off.
- A sword blow shoves what it hits away from the hero (`SWORD_SHOVE`),
  even when a shield stops it.
- A dash ends when it trades momentum with a monster, and what the bump
  left of it goes on as a shove. It also ends when a wall stops more than
  half of it, and the hero bounces off. Grazing a wall slides along it.
- The dodge and the wait for the next dash go on as they were, so dashing
  into a cuboid doesn't hurt: the dash is the dodge for all monsters
  alike. The risk is in being bounced off and still touching the monster
  once the dodge runs out.

## Dying monsters

- A monster that dies bursts into small cubes (`monster/bursts.ts`), as a
  fallback until monsters get ways of dying of their own.
- Each kind gives its rough volume as a few spheres with the colors of
  that part. The cubes fill them by volume, fly out and away from the
  blow, fall, bounce and shrink away.
- They carry on with the shove the monster had when it died, which for a
  sword kill includes the blow, so a light monster flies apart further
  than a heavy one. Bursting takes most of that energy
  (`BURST_ENERGY`).
- A big cuboid bursts only what doesn't go into the small ones it breaks
  up into.
- Smiting (`MonsterPack.smite()`) is annihilation: the monster bursts
  whole and nothing comes out of it. It belongs to a temporary god mode
  (`GOD_MODE`), and maybe to mighty weapons.
- A part that goes on after the monster died, like the brute's club,
  gives its sphere a bone. `Bursts.add()` leaves those out, and the view
  that poses the monster bursts them later with `burst()`, from where the
  bone ended up. A death tells which monster it was, for the view to find
  its figure.

## Falling

- A hero's hit points are kept on the job. Without any left they fall and
  lie where they are, out of the fight, as long as someone else still
  stands in the level (`fall()`).
- Once the last one standing walks out or falls as well, everyone who
  fell gets carried out with 1 hit point (`fallenToCarry()`). They are
  only back at full strength with the next job.
- So heroes only get thrown out of a level nobody is in anymore, which
  lets it start anew (`carryOut()`): the chests are full, the map is
  forgotten, and the level gets another seed (`attemptSeed()`), so its
  layout, chests and monsters are new.
- A level therefore has to be beaten in one go: on with 1 hit point, or
  home to heal first.
- Once all floor of a level is known and its chests and coins are gone,
  the notice of the hero in there says so (`LevelScene.spent()`).

## Fights and the day

- A fight only runs while the view is in its level, so the player can go
  to the castle and send others to help. Everything in the level freezes
  meanwhile.
- The day can't end while a monster can see a hero in the level kept
  (`LevelScene.inFight()`).
- Going to the castle takes Escape or the mouse, no controller button,
  which is a risk on purpose.

## Planned

- Ways of dying of their own for monsters, instead of the burst.
- Dying heroes are still to be decided.
