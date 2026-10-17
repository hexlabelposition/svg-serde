# Editor fixtures

Real SVG files exported from graphics editors, checked by `test/corpus.test.ts`:
each file must parse, round-trip through `stringify()`, and produce stable output.

Add files exported from editors such as Inkscape, Adobe Illustrator, Figma,
Affinity Designer, and Sketch, grouped by editor:

```text
fixtures/
  inkscape/
  illustrator/
  figma/
```

Only add files you have the right to publish, such as your own drawings.
Keep them small and free of personal data.
