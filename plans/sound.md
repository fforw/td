# Sound

## Mixer

- One shared `AudioContext` (`sound/mixer.ts`) with gain groups for
  music, effects and ambience, and a master that mutes all of them. The
  title music `<audio>` element is routed into the music group.
- The context starts with the first user gesture, like the music does.

## Room propagation

The browser panner only knows straight-line distance, so a sound behind
a wall would be as loud as one in the same room. Inside a level, sound
travels along the room graph instead.

- Spaces (`sound/soundSpaces.ts`) are the rooms and the corridors of a `DungeonLevel`; a
  corridor joins the two rooms at its ends. Rooms and corridors form a
  tree, so there is one way between any two spaces.
- The listener is the focused hero of the level scene, not the camera,
  so panning the map does not change what is heard.
- Hops between the space of a sound and the listener's space set its
  gain and a lowpass cutoff: the same space plays clear and full,
  each hop is quieter and more muffled, beyond a few hops it is silent.
- A sound from another space is panned from the doorway it enters the
  listener's space through, not from where it is. Stepping through
  that doorway moves it onto its real position.
- Changes of gain, cutoff and position ramp over a fraction of a second,
  so a hero walking through a door fades sound in instead of switching.
- Room ambience (dripping, fire, wind) is a loop at the middle of each
  room, which makes it fade in at the doorway. Corridors have none. The
  loops are generated (`sound/ambience.ts`): brown noise with drips, a
  few variants with different playback rates.

## Effects

- One-off effects (`sound/effects.ts`) load once from `media/sounds/`, so
  `playEffect()` plays them without waiting, and play to their end through
  the effects group of the mixer, from nowhere in particular. They belong
  to what someone does, not to the level, so they don't fade out with it.
- The smite of the hero in god mode sings a hallelujah on every press,
  whether there is anything in the room to smite or not. It loads with the
  level while `GOD_MODE` is on.
- Recorded foley sits in `media-src/foley`: each take, its cut pieces and a
  page to sort them. The good pieces go to `media/sounds/` as mp3, with
  several variants of one sound numbered, so a sound that repeats a lot
  can vary.

## Planned

- A volume per group in the options, and fades and ducking for the
  music.
- Per-face walking distance instead of hops, baked in the map worker
  next to the lighting, once single mobiles make noise. Mobiles could
  hear heroes over the same distance.
- Recorded ambience: dripping, fire, wind.
- Combat sounds for humanoid characters: a sword hit for every hit and
  a hurt sound (`meeple-hurt-*`) from the one it hits. The sword hit
  sounds of what it lands on: flesh, armor, metal, or wood for shields
  and staffs (`sword-on-*`, from Freesound). Most of them lead in with
  a whoosh, so they start a moment before the blade lands. The burst of
  a monster that dies has no sound of its own; its last hit plays a
  hurt sound like any other. Big deaths, like the brute's and later the
  end boss's, get a death sound (`meeple-death-*`) instead, since they
  are rare enough to be dramatic.
