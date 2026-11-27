# Spawns

## Planner

- One planner decides what lives where in a level (`monster/spawns.ts`,
  `planSpawns()`). The packs of monsters only take what the plan gives
  them. Rolling a chance per kind for every room gave mixes nobody chose,
  and how many monsters a level got could not be steered.
- The plan is per room: a room is closed or open, an open room is taken
  or not, and a taken room gets exactly one group.
- A group (`SpawnGroup`) is a weight and a list of members, each a kind
  of monster and how many of it, from min to max. The members go onto
  random faces of the room. Which pack a monster goes to follows from its
  species, which keeps the kinds typed for the packs.
- Closed are the entrance room, the room of the stranger and rooms nobody
  can get to. The planner rolls nothing for them, instead of monsters
  being dropped afterwards.
- The plan only depends on the level and its seed, from one random
  stream of its own. Whatever changes between loads, like known floor
  (`inUnexplored()`), filters the finished plan, so the rest of it stays
  where it was.

## Groups

- The groups (`SPAWN_GROUPS`) are single kinds for now: a big cuboid,
  small cuboids, an eye, a pair of eyes, a construct, a pair of
  constructs, a brute, soldiers, and wizards, either a blue one, a red
  one or a group of purple ones.
- A fixed share of the open rooms is taken.

## Planned

- Groups of mixed kinds that play together, by role: one that hits
  hard with several fast ones that distract, like a brute with eyes or
  small cuboids around it, or ranged ones behind something in the way.
  This replaces the weighted table.
- An end boss guarding the main exit of each level, as the hard thing
  at its end, which gains the campaign the most experience.
- Escalation: the planner gets a threat level for the level, which grows
  with the [campaign level](../world/campaign.md#campaign-level). Each group gets a cost, the sum of what its members are worth, and
  a lowest threat level it shows up at. The level gets a budget from its
  threat level. The planner spends it on rooms, picking from the groups
  it can afford and that are unlocked, with weights that move toward
  costlier groups as the threat level grows. The share of rooms taken
  falls out of the budget, instead of being a fixed chance.
- [Roles](generation.md#roles) steer where the budget goes: nothing at
  the entrance, cheap groups in the rooms near it as foreshadowing, more
  along the main path, the most expensive affordable group as the
  guardian of the climax, and branches lighter, as they hold side
  rewards. `SpawnLevel` is the place for the roles and the threat level.
- Inhabitants from premises and stereotype slots
  ([monsters](../action/monsters.md#planned)) go through the planner too,
  as rooms it is handed already filled, so it doesn't put a group on top
  of them.
- Once monsters get saved, they can be keyed by room and their place in
  its group.
