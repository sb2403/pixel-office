# Smoother animation spike findings (2026-10-15)

Question: can the desktop office animate more smoothly, or be interactive (hover, clicks on characters), now
that the mod API has `$.ui.blit`? The 2026-10-14 spike settled on an image-mode `Svg` because an interactive
`Svg` whose source changes flickers, and a `Client` could not draw `Svg`.

Answered from the declarations of Claude Code 2.1.301 (the `claude-code.d.ts` the `plugin-authoring` skill
writes). No throwaway mod was needed: the API rules both routes out on the desktop surface before anything
could be observed.

## Findings

1. `$.ui.blit(args)` swaps the next frame of a `Raster`'s `cells` or a keyed `Image`'s `source`
   (`UiBlitArgs = RasterBlitArgs | ImageBlitArgs`). Nothing else.
2. `Raster` and `Image` exist on one surface only. The element table says of `terminal`: "The one surface with
   `Raster` and `Image`, and the one without `Svg`." `desktop` carries the six common elements, `Input`,
   `Select`, `Svg` and `Client`. So blit cannot drive anything in the desktop pane.
3. A `Client` (a surface module that runs on the drawing thread, each call allowed up to a second, and could
   redraw locally without a state write) still cannot draw SVG: `ClientElements = Omit<Elements['terminal'], 'Client' | 'Raster' | 'Image'>`,
   which is `Box`, `Text`, `Button`, `Link`, `Code`, `Markdown`, `Input` and `Select`. Same as on 2.1.295.

## Decisions

- The office stays an image-mode `Svg` with SMIL animation. It is the best the desktop surface offers on this
  build: walks and station loops already animate smoothly inside one source, and a source change does not
  flicker in image mode.
- No code changes. The mod draws nothing new for this spike.
- Where blit does apply is the terminal: a `Raster` of the office, its frames swapped by `$.ui.blit`, would put
  the pixel office in a terminal session, which now gets text only. The spec lists terminal pixel rendering as
  out of scope; this note records that the API for it exists, not a plan to build it.

## What would change the answer

Look again when a Claude Code release does any of these (grep the declarations for the names):

- `Image` or `Raster` appears in the `desktop` element table: blit could then swap frames there.
- `Svg` appears in `ClientElements`: a client module could then animate the office locally and take clicks on
  characters.
- `SvgProps` gains a way to update a mounted source in place, or interactive mode stops reloading the frame on a
  new source: hover tooltips and clicks on characters would then become possible.

Each would need the same kind of observed check as the first spike (flicker, smoothness, hover) in the
desktop app, which this environment cannot run.
