# Threats

Status: not built. Explorers' notes on passed patches only call
dungeons dangerous until there are threats.

What the player takes and whom they leave alive comes back later as
threats.

## Grudge

- Computed from the stakes of the slots involved: material loss scales
  with the value taken, personal harm (killed guardian, desecration)
  weighs far more. Grudges against the same castle add up.
- Personality scales it: greedy, proud, vengeful react to different
  stakes.
- Material grudges fade over time, personal ones don't.

## Knowledge

- Witnesses: surviving mobiles that saw the hero.
- Identity: a recognizable hero, a dropped item, a castle banner.
- Tracks: the routes heroes travel (explorers leave none), readable
  depending on terrain (clear in snow and mud, faint on rock and paved
  ground) and decaying over days.
- Resulting state: knows the castle (comes straight at it), has a trail
  (follows it, then searches), knows nothing (searches outward).
- Player countermeasures: silence witnesses, detour over rock, lead
  them off with a hero as bait.

## Search

- Uses the discovery mechanic in reverse, patch by patch, with a budget
  from the grudge: coins and a chalice may buy 2 patches, a killed
  daughter is unlimited.
- Visible to the player as sightings and rumors in discovered patches.
- Giving up is an event; new knowledge (a witness spots the hero, a new
  theft) revives the grudge.

## Bandits

- Background pressure that scales with time, discovered area and wealth.
- Come from the edge of the discovered area and path toward the castle
  with their own cost table.

## Warning and defense

- Threats show up with an ETA in days from the route cost, giving the
  player time to intercept, fortify or pay off.
- Defenses are overlay edits (WALL, GATE) that raise path costs or cut
  routes. Terrain that blocked the heroes also protects the castle.
