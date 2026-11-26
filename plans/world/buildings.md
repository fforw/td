# Buildings

## Plots and buildings

- PLOT and HOUSE are face types. A PLOT is a site set aside for the next
  building, so the player always has a plan where to build. A HOUSE is a
  built one.
- The TAVERN is a face type of the castle plan
  (`castle/castlePlan.ts`). Every castle has one from the start, and it
  is where [explorers](discovery.md#explorers) are hired.

## Planned

- A PLOT turns into a HOUSE through the overlay.
- What a HOUSE does is its facility kind: resource production or
  processing of raw materials ([economy](../economy.md)). The facility is
  a fixture on the HOUSE, so the face type stays semantic and the theme
  picks the model per facility. The TAVERN becomes the first facility
  kind.
- House interiors: a single small patch, a generator per house kind,
  fixtures for the house functions, and a portal back to the overworld
  face.
