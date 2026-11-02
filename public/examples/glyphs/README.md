# Glyph specimen

Prototype of the glyph language: 24 concept glyphs built from the stroke order and
stroke kinds of source kanji, drawn in a world-seeded dialect and a curated palette.
Open `index.html` in a browser; a `#seed-123` link reopens a world.

- `kanjivg/` - source SVGs from [KanjiVG](https://kanjivg.tagaini.net/)
- `extract.mjs` - samples the strokes and component trees into `strokes.json`
- `template.html` - the specimen page, with placeholders for the data
- `build.mjs` - embeds `strokes.json` and `src/palette/curated.json` into `index.html`

To rebuild after changing the source characters or the page:

```bash
node public/examples/glyphs/extract.mjs
node public/examples/glyphs/build.mjs
```

The KanjiVG SVGs, `strokes.json` and the glyphs derived from them are licensed
under CC BY-SA 3.0 (KanjiVG by Ulrich Apel), not under the license of this project.
