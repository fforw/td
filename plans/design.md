# Treasure & Dread - design

## The game

A campaign starts at a castle with a dramatic situation. Explorers are
sent out to discover neighboring patches, and what they find fills the
story: dungeons, temples, treasure, people. Heroes go there, into
sub-levels with their own maps and contents, and fight. What the player
takes and whom they leave alive comes back later as threats.

## Principles

- **Two kinds of people.** Explorers discover: hired per mission, never
  seen, never caught, back in days. Heroes adventure: they live in the
  castle, travel only over known land, fight, and get noticed. Discovery
  is cheap and safe, adventure is where the risk and the consequences
  are.
- **Days at the castle, real time in levels.** The overworld moves in
  days, ended by hand at the castle. Inside a level the game is a
  twin-stick action game, frozen whenever the view is elsewhere.
- **One go per attempt.** A level has to be beaten in one go. When
  nobody is left standing in it, the heroes are carried out, robbed of
  what they carried, and the next attempt is another level.
- **Directed, not simulated.** The story is the backbone: dramatic
  situations, realized by small concrete stereotypes, with open slots
  that bias what gets generated. Nothing simulates a society, and
  relationships only exist as story facts. Discovery feels lucky, but
  is directed. *(Not built yet.)*
- **Consequences come back.** Grudges grow from the stakes of what the
  heroes did, and witnesses and tracks decide how well a foe finds the
  castle. *(Not built yet.)*
- **Hide the why, never the what now.** Meeples speak a glyph language
  the player learns over a campaign, so the story comes across as a vague
  sense first. What the player must act on always shows plainly too.
- **A fixed view.** A direction of a stick or the keys always means the
  same direction in the world. Walls give way instead of the camera
  turning.
- **Everything from the seed.** A seed always gives the same world.
  Records only store what changed, so the world can be dropped and built
  again any time.
- **Semantic faces, themed looks.** Face and edge types say what a face
  is for the simulation. New types only come with new behavior, while
  looks belong to themes.

## Plans

The topic files describe what the game does and why. What isn't built
yet is under `## Planned` at the end of each, and the
[roadmap](roadmap.md) lists all of it with the open questions.

### World

- [Levels](world/levels.md): levels, records, kind edits, face and edge
  types, generators
- [Campaign](world/campaign.md): subtitle, start screen, saves
- [Discovery](world/discovery.md): routes, missions, explorers, heroes,
  the patch map, days and journeys
- [Buildings](world/buildings.md): plots, houses, the tavern

### Dungeons

- [Dungeon generation](dungeon/generation.md): walls, rooms, corridors,
  roles, light, the fire room
- [View of a level](dungeon/view.md): camera, walls that give way,
  silhouettes, bloom
- [Fixtures](dungeon/fixtures.md): chests, coins, potions
- [Spawns](dungeon/spawns.md): which monsters go into which room
- [Map of a level](dungeon/map.md): the sheet, jumps

### Action

- [Controls](action/controls.md): keyboard, mouse, controller
- [Combat](action/combat.md): getting hurt, bumping, dying, falling
- [Monsters](action/monsters.md): one heading per monster

### Story

- [Story](story/story.md): situations, stereotypes, arcs, the director
- [Glyphs](story/glyphs.md): the glyph language and how glyphs are built
- [Scenes](story/scenes.md): scripts, the scene camera, the trader

### Other

- [Threats](threats.md): grudges, knowledge, search, bandits, defense
- [Economy](economy.md): gold, and what is still to be designed
- [Sound](sound.md): mixer, sound through rooms, effects
