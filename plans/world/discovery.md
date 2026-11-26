# Discovery

## Movement cost

- Each `FaceType` has a constant cost, summed over all faces entered
  (`map/route.ts`). Forests and swamps cost a lot, water, rock, walls and
  houses can't be passed.
- Passing is separate from `occupied`, which is about what can be placed
  on a face: nothing gets built in a forest, but people walk through it.
- Crossing an edge adds the cost of its [edge
  type](levels.md#face-and-edge-types).

## Routes

- A route leads from the center of the castle to all points of interest
  of the target and costs as much as the farthest one. If any can't be
  reached, there is no route.
- A* over the faces of a level's `PatchWorld`, crossing seams via
  `twin()`. All goals lie within the circle around the target patch, so
  the distance to that circle at the cheapest cost per face size never
  overestimates. Without the face size the search is plain Dijkstra, as
  in dungeon levels.
- The estimate is weak, as terrain costs much more than the cheapest
  face, so the search still looks around a lot: a way around a lake takes
  entering many times the patches it crosses.
- Explorer routes have no ring to stay in, only a most number of patches
  the search may get into (`EXPLORER_PATCHES`), after which the mission
  fails. Without it a target cut off from the castle would have the
  search build patches forever. Hero routes keep the ring of one beyond
  what's known, as they only cross discovered patches anyway.
- Routes run in the map worker, which builds the patches it needs itself
  once the search gets there, so a route doesn't cost more patches than
  it reaches. `SimWorld` sends with each request what the worker can't
  know: the [kind edits](levels.md#kind-edits). Patches are addressed by
  q/r between threads, and slots stay private to each `PatchWorld`.
- The route gets pulled taut inside its faces (`tautPath()`), so it cuts
  the stairs of the grid without touching what's beside the faces. It
  stops a bit short of the point of interest.

## Points of interest

- Generators own their points of interest: they make sure these connect
  to the border of the patch, and a patch without room for them falls
  back to kind EMPTY.
- They go into the part of the patch that borders the most neighbors,
  the larger one if there are several, since routes come from all sides
  and a patch doesn't depend on where one comes from.
- Whether the border can be reached from outside depends on the
  neighbors, which is what makes a mission fail.
- The castle has one point of interest, its center, where every route
  starts.

## Missions

- A mission is an explorer plus a target patch adjacent to a discovered
  patch (`game/missions.ts`). On start the target is marked `targeted`.
- The route may go through any patch, known or not. Explorers get
  through unknown land unnoticed, even an enemy kingdom.
- Passing through is not discovering: only a patch an explorer was sent
  to is discovered and can affect the story. A patch passed on the way
  only gets a note on the map, "looked safe" or "looked dangerous", and
  stays a possible target.
- A mission fails when the route search runs out of patches. That stands
  for what an explorer can carry, so it isn't a flaw: the target stays on
  the map as `unreachable`, still unknown and still a target, until it
  gets discovered.
- Explorers are freakishly good at this, so missions are no realistic
  journeys: a route cost maps to a few neat day steps of 1, 3, 5, ... to
  get there (`missionDays()`). They report on arrival and are back in the
  tavern, as the way back takes no time. The first targets take 1 day,
  every ring further out one step more.
- Nothing shows the days before a mission, the tavern only shows speed
  and experience.
- Success: the patch becomes `discovered` with `parent` set.
- Failure: "can't get from here to there". It takes the days to the
  reachable point closest to the target, so failing isn't free. The patch
  can be tried again once more of the map is known.
- Explorers leave no tracks or witnesses, so a discovery mission never
  creates a threat by itself ([knowledge](../threats.md#knowledge)).
- The castle and its eight neighbors are known from the start: the 3D
  view shows them, and what is shown is known. Knowing a patch means
  knowing its kind, so the first DUNGEON is one of these neighbors
  (`game/patchKinds.ts`). Missions start one ring further out.

## Explorers

Discovery and adventure are split between two kinds of people.
Explorers are a caste of their own, a fickle bunch loitering in the
[tavern](buildings.md#plots-and-buildings). You pay one to go look
somewhere, wait, and they report back.

- Hiring is per mission and costs gold ([economy](../economy.md)), with
  no upkeep or loyalty beyond that.
- The tavern offers a few explorers at a time (`game/tavern.ts`). They
  differ in speed and wisdom, and their price follows.
- Fickle: the crowd changes over the days. Explorers come and go, and
  one who reported back hangs around for a while before moving on.
- Expert sneakers: they are never caught, never fight, and leave no
  witnesses or tracks. Their only job is discovery.
- Good speed gets a mission done one or two day steps earlier, down to 1
  day. It grows with experience from every mission, failed ones included,
  and so does their price. A seasoned explorer is worth hiring for long
  or hard targets while they are still around.
- Their position is not state, every mission starts at the castle.

## Heroes

Heroes do everything that happens inside a discovered patch.

- Heroes start out as local heroes: gifted individuals born in the
  castle, meeples with a class beyond peasant. They live there, are
  small-time at the beginning and take on special jobs from the castle.
  They are not hired per job like explorers.
- They learn from their jobs.
- Unlike explorers they get noticed, so they only travel over discovered
  patches. A job without a way over known land is blocked until
  explorers have discovered enough of it, and the popup for the job says
  so.
- A job targets a point of interest of a known patch other than the
  castle, one hero per job. It is a journey of days per ring, after which
  the hero waits at the target until told to enter, for as long as that
  takes.
- Entering a dungeon takes them into [its level](levels.md#entering-a-level).
  Other kinds have no levels yet, and entering those brings the hero
  straight back with a report.
- The hero can also be told to return instead, which takes the same days
  back along the way and teaches nothing unless they went in. The target
  is free for another hero meanwhile.
- They enter levels, take treasure and fight, and are the ones who get
  seen, followed and hated ([threats](../threats.md)).

## Patch map

- The map is a popup over the 3D view, a sheet of the manuscript map
  (`game/mapSheet.ts`). The 3D view pauses while it is open. Nobody is
  listed on it, it only shows what's known, but the mission list stays
  in front of it. A line of the list closes the map and goes there.
- Discovered patches are drawn in full detail, patches an explorer only
  passed through in a coarse raster, as layers clipped to their cells on
  the patch grid. A coarser raster suits a big map, but doesn't fit the
  detailed patches next to it. Patches no explorer found a way to get a
  finer one, as they would stay holes otherwise. Anything else is blank
  paper.
- Patches are cells of the grid here, not their jagged shape. The wobble
  hides the difference.
- Points of interest of discovered patches are the markers to click for
  a job of a hero. Empty patches have nothing to click.
- The sheet has the shape of the bounding rectangle of discovered and
  passed patches, as large as the screen allows, so there is no blank
  paper beside them. A patch an explorer is on the way to takes up no
  room, and its marker stays on the screen.
- Moving the pointer to the border of a discovered patch next to an
  unknown one shows a fat floating arrow in the gap around the map, over
  the edge of the paper and the stopped 3D view. It opens a smaller popup
  to hire an explorer.
- Running missions show their remaining days.

## Time and journeys

- Game time advances in days, and missions resolve when their days are
  up.
- Whoever leaves the castle really walks there, on a route.
- Days decide how far along someone is: each day of a journey stands for
  an equal share of the way. The way is saved with the journey, so it
  doesn't depend on later edits, the position is not (`game/journey.ts`).
  Journeys from older saves have no way and happen unseen.
- Someone sent off stands at the castle for a moment first
  (`DEPARTURE_DELAY`), with the mission listed already, counted only
  while the 3D view runs. So there is always time to go after them once
  the map is closed.
- Someone followed walks up to the share of the next day, which ends the
  day. Days can only be ended by hand from the castle, so nobody followed
  ever falls behind.
- Anyone else just gets seen leaving: they walk on no matter the days
  until they are well away from the castle or at the end of the way, then
  disappear. Going after them finds them at the share their days have
  reached, or further if they were followed that far before. Someone
  still in sight just goes on, unless that's already past the next day's
  share.
- The view is bound to the castle, with a wide area to look around in,
  or to someone on a journey, with a small one and closer in. The mission
  list has a line to jump to each of them. Following someone is what
  turns walking into time: reaching the share of the next day ends the
  day for everyone. It isn't saved, and a loaded game starts at the
  castle.
- Patches on the way get built in 3D only for whoever is followed, and
  stay there. Seeing them doesn't make them known: the map and the rules
  don't change, it just leaves ground to walk on. It can show what a
  target is a bit before the report.
- On arrival, an explorer the view follows stays there with the result
  until the view moves on, otherwise a notice tells it. A hero out of
  sight gets a notice that stays, with a button to go there. Enter and
  return are only offered with the view there.
- A returning hero is a journey like any other. Out of sight, only the
  last day of it can be seen coming in. Getting home brings the view back
  to the castle, or a notice if it is elsewhere.

## Planned

- An impassable THICKET.
- Cost tables per traveller, so hero traits (ranger, dwarf) and foes can
  use their own.
- Routes across levels, over portals, and routes inside other levels on
  the main thread, which owns those patches. They can move to a worker if
  they turn out to stutter.
- Rolling the kind of a target weighted by the story
  [director](../story/story.md#director), instead of only from the seed.
- Friendly cities as other starting points for missions.
- A coarse hint at the days of a mission.
- Wisdom deciding how much of a patch the report reveals, e.g. hidden
  features or the kind of a neighbor. Inside levels, wisdom finds hidden
  traps and passages.
- Later events bring new heroes or make others leave.
- An event log: patch interactions append facts to the patch node, even
  before anything reads them: what was taken, who was killed, who
  survived and saw what.
