# Frameless Narrative Canvas Design

**Date:** 2026-09-17  
**Status:** Approved for implementation planning  
**Applies to:** OpenBoard Data Canvas after M0/M1 and LC2 acceptance

## 1. Decision

OpenBoard will replace persistent chart cards with direct canvas objects. Charts, tables, KPIs, text annotations, and analytical conclusions will appear directly on the dotted canvas. Object bounds remain available for layout and hit testing but are visible only while hovering, selecting, dragging, or resizing.

The selected visual direction is **Narrative Analysis Board**: data graphics and explanatory text form one spatial analytical story instead of a grid of dashboard widgets.

![Selected Narrative Analysis Board direction](assets/2026-09-17-narrative-analysis-board.png)

The mockup establishes hierarchy and interaction character. It is not a requirement to reproduce invented content or every control shown in the image.

## 2. Goals

1. Remove persistent rectangular containers, title bars, borders, fills, and shadows from canvas content.
2. Make visuals and annotations feel native to one continuous surface.
3. Add direct selection, dragging, resizing, multi-selection, marquee selection, and snapping.
4. Preserve Scene as durable product state and keep browser-only interaction state ephemeral.
5. Commit one user gesture as one Scene revision and one history operation.
6. Preserve retained rendering and avoid data queries during layout-only interaction.
7. Make analytical text and visual evidence composable without turning OpenBoard into a general-purpose design tool.
8. Keep motion coherent, restrained, and accessible.

## 3. Non-goals

- Rotation, skewing, freeform vector editing, or arbitrary path editing.
- A layers panel, generic design-system inspector, or full desktop publishing controls.
- Direct chart cross-filtering or mark selection in this milestone.
- Persisting hover, selection, resize handles, guides, animations, or in-progress pointer gestures.
- Automatic collision avoidance or responsive dashboard reflow.
- Arbitrary CSS, fonts, HTML, or executable styling in Scene state.

## 4. Experience model

### 4.1 Canvas objects

The browser presents two durable object families through one interaction model:

- **Visual objects:** plot, table, and KPI specifications from `Scene.visuals`.
- **Annotation objects:** titles, captions, conclusions, and analytical notes from `Scene.annotations`.

Connectors are derived presentation. An annotation with a visual target renders a lightweight leader line between the annotation and the nearest suitable edge of the target. Connector DOM and routing are disposable and are not persisted.

Each object owns an invisible layout box. The box controls placement, hit testing, minimum size, text wrapping, and renderer dimensions; it does not imply a visible surface.

### 4.2 Object states

| State | Visible treatment |
| --- | --- |
| Default | Content only. No border, fill, title bar, shadow, or technical ID. |
| Hover | Faint halo or outline, move cursor, and a six-dot grab affordance near the title. |
| Selected | One-pixel interaction outline, eight resize handles, and a compact contextual toolbar. |
| Dragging | Direct-follow preview, alignment guides, snap indicators, and optional position chip. |
| Resizing | Direct-follow preview, dimension chip, and type-specific responsive behavior. |
| Working | Small local status text plus a mint pulse on the affected outline or connector. |
| Error | Last valid content remains visible with a short local error message. |

Interaction chrome uses blue-periwinkle. Live construction uses mint. Human-authored insights and anomaly callouts use amber. Red is reserved for errors.

### 4.3 Titles and technical metadata

Visual titles are ordinary floating typography above their content, not headers inside a container. Internal visual IDs and revision metadata are hidden from the normal canvas and remain available in details or diagnostic views.

Large narrative conclusions may use `ui-serif` at 32–48 px. Object titles and interface controls use the system sans-serif stack. Annotation styling is selected from a small semantic registry rather than arbitrary CSS:

- `caption`
- `body`
- `insight`
- `callout`

## 5. Input behavior

### 5.1 Selection

- Click an object to select it.
- Shift-click adds or removes objects from the selection.
- Drag on empty canvas to create a marquee selection.
- Click empty canvas or press Escape to clear selection.
- Local selection does not mutate Scene and does not increment revision.
- Existing `canvas.focus` remains agent-authored semantic focus. It is not reused as browser selection state.

### 5.2 Moving

In V1, rendered chart content is not directly interactive, so dragging anywhere within a selected object's invisible layout box moves it. The title grab affordance is always an explicit drag target. This rule can be narrowed later if direct chart interactions are introduced.

- Pointer movement is converted from screen coordinates to canvas coordinates using the current zoom.
- Dragging updates only a local transform.
- Arrow keys nudge selected objects by one canvas pixel.
- Shift plus an arrow key nudges by ten canvas pixels.
- Repeated keyboard movement is one gesture and commits on keyup.
- Space-drag pans the canvas and never moves an object.

### 5.3 Resizing

- Corner handles resize both axes.
- Edge handles resize one axis.
- Shift preserves the initial aspect ratio.
- Option/Alt resizes from the center.
- A multi-selection uses one shared bounds box and proportionally transforms every selected layout.
- Escape cancels the gesture and restores all original layouts.

Minimum sizes are defined by object type. Plot minimums preserve readable axes; annotations preserve a usable text column; tables preserve a header and at least one row; KPIs preserve their label and value.

### 5.4 Text editing

Double-clicking an annotation enters text editing. While editing, pointer gestures select text rather than moving the object. Escape leaves edit mode and returns to object selection. Annotation resizing changes wrapping width and height; it does not geometrically stretch glyphs.

### 5.5 Snapping

Snapping thresholds are measured in screen pixels so they feel stable at every zoom level. Candidate order is:

1. object edges and centers;
2. equal-gap relationships;
3. canvas grid.

The closest candidate within six screen pixels wins, with the earlier category breaking ties. Snapping never changes Scene until the gesture commits. Holding Control disables snapping for the current gesture.

## 6. Durable and ephemeral state

### 6.1 Browser-only interaction state

The following belongs to an `InteractionController` and is never serialized:

- hovered object;
- selected object references;
- marquee rectangle;
- pointer origin and active pointer ID;
- original and preview layouts;
- active resize handle;
- snap candidates and guides;
- open contextual toolbar;
- gesture phase.

### 6.2 Scene changes

`VisualSpec.layout` remains unchanged and existing scenes require no migration.

`AnnotationSpec` gains optional presentation fields:

```ts
interface AnnotationSpec {
  id: string;
  target?: string;
  text: string;
  anchor?: { x: number; y: number };
  layout?: LayoutSpec;
  style?: {
    variant: "caption" | "body" | "insight" | "callout";
    align?: "start" | "center" | "end";
    color_role?: "default" | "muted" | "accent" | "warning";
  };
  created_at: string;
}
```

Annotations without layout remain valid. The browser derives a deterministic compatibility layout from the annotation anchor, target, or default canvas placement. The derived layout is persisted only after the annotation is moved or resized.

The existing `canvas.annotate` tool remains the only annotation mutation surface. It gains an optional `mode` with backward-compatible `create` default semantics:

```ts
type CanvasAnnotateInput =
  | { mode?: "create"; id?: string; text: string; target?: string; anchor?: Point; layout?: LayoutSpec; style?: AnnotationStyle; expected_revision?: number; work_id?: string }
  | { mode: "patch"; id: string; patch: { text?: string; target?: string | null; anchor?: Point | null; layout?: LayoutSpec; style?: AnnotationStyle }; expected_revision?: number; work_id?: string };
```

Create mode preserves the current duplicate-ID rejection. Patch mode requires an existing annotation, applies only the supplied fields, rejects an empty patch, and commits exactly once. This keeps text editing explicit without adding another MCP tool or abusing `canvas.compose` for content changes.

`canvas.compose` retains the existing single-visual form and adds an atomic batch layout form:

```ts
interface LayoutUpdate {
  target: { kind: "visual" | "annotation"; id: string };
  layout: LayoutSpec;
}

interface ComposeInput {
  action: "move" | "resize" | "delete" | "focus" | "group" | "ungroup" | "arrange";
  target?: string;
  layout?: LayoutSpec;
  layout_updates?: LayoutUpdate[];
}
```

`layout_updates` is used for multi-selection gestures and applies all layouts in one `SceneStore` commit. IDs are paired with object kinds to avoid ambiguity across `visuals` and `annotations`.

## 7. Gesture data flow

### 7.1 Start

1. Hit-test the pointer against canvas objects and interaction handles.
2. Capture the pointer.
3. Record the durable Scene revision and original layouts.
4. Create browser-only preview layouts.

### 7.2 Preview

1. Convert pointer coordinates into canvas coordinates.
2. Apply movement or resize constraints.
3. Resolve snapping.
4. Apply CSS transforms or dimensions locally.
5. Update interaction chrome and derived connectors.

No HTTP call, DuckDB query, Scene mutation, history record, or WebSocket event occurs during preview.

### 7.3 Commit

1. Normalize final layouts and discard no-op updates.
2. Submit one `canvas.compose` request with `expected_revision`.
3. Apply all layout updates in one Scene transaction.
4. Persist Scene and append one history record.
5. Broadcast one `layout.changed` event containing every affected object reference.
6. Clear preview transforms after the durable event is accepted.

### 7.4 Conflict recovery

If the expected revision is stale, the browser fetches the current Scene.

- If none of the gesture's target layouts changed since gesture start, retry once against the new revision.
- If any target layout changed, cancel the local preview, animate back to the durable layout, and show a short conflict message.
- Never silently overwrite a concurrent Codex or user layout mutation.

## 8. Rendering and resizing

Dragging changes only object transforms and never re-renders visual data.

During resize, the existing SVG or HTML content scales as an immediate preview. On commit, the browser recomputes presentation using its last render payload:

- no new DuckDB query;
- axes and labels reflow for the final dimensions;
- the next SVG passes through `render-reconciler`;
- compatible mark nodes retain semantic identity;
- annotations rewrap text instead of scaling glyphs;
- KPIs choose from bounded type-size steps;
- tables use internal scrolling below their ideal size.

Layout-only WebSocket events update geometry without invoking the data-render path.

## 9. Browser module boundaries

The current `web/index.html` owns too many responsibilities. This work introduces focused browser modules:

- `canvas-object-view.js` — maps Visual and Annotation objects to frameless DOM.
- `canvas-interaction.js` — selection, pointer capture, gesture lifecycle, keyboard input, and commit orchestration.
- `canvas-geometry.js` — screen/canvas transforms, bounds, constraints, snapping, and group transforms.
- `interaction-chrome.js` — selection outlines, handles, guides, measurement chips, and contextual controls.
- `canvas-motion.js` — layout, snap, birth, exit, and conflict-recovery motion.
- `annotation-renderer.js` — semantic text variants and derived connectors.
- `render-reconciler.js` — remains responsible for retained data-mark identity.

`index.html` becomes composition and application startup code rather than the implementation home for every canvas behavior.

## 10. Motion rules

- Pointer-driven movement and resizing have no easing and remain directly coupled to the pointer.
- Snap completion uses approximately 120 ms.
- Durable layout changes use 180–240 ms FLIP transitions.
- Compatible data geometry changes use approximately 240 ms.
- New nodes fade in; removed nodes fade out before DOM removal.
- Cross-family visual changes use a directed fade/rebuild/fade sequence when geometry cannot be retained.
- Working state is local to affected objects and never obscures rendered content.
- `prefers-reduced-motion` removes spatial movement and scaling while retaining essential opacity and state changes.

## 11. Inspector and canvas controls

The details surface becomes a floating inspector that overlays the right side of the viewport without changing canvas width. It opens only for an explicit selection or details command.

Initial inspector scope is intentionally narrow:

- position and size;
- annotation semantic style;
- align and distribute actions for multi-selection;
- diagnostic ID and source information in a secondary details section.

It is not a field picker, metric editor, or dashboard configuration panel.

Zoom controls remain lightweight and floating. Fit view accounts for invisible object bounds and annotation connectors. The implementation may add a small minimap only if usability testing shows that large canvases require it; a minimap is not part of initial acceptance.

## 12. Accessibility

- Every canvas object is keyboard focusable and exposes its type and title.
- Resize handles have accessible names describing their edge or corner.
- The contextual toolbar follows the selected object in DOM reading order.
- Keyboard nudging follows the same commit semantics as pointer gestures.
- Focus indication remains visible even when hover chrome is suppressed.
- Status and conflict messages use a polite live region.
- Color is never the only signal for selection, working state, snapping, or errors.
- Motion respects the system reduced-motion preference.

## 13. Verification

### 13.1 Unit and contract tests

- screen-to-canvas coordinate conversion at multiple zoom levels;
- move, edge resize, corner resize, aspect lock, and center resize;
- single- and multi-object bounds;
- deterministic snapping and tie-breaking;
- minimum-size enforcement;
- optional Annotation layout/style validation;
- atomic `layout_updates` validation and one-revision commit;
- conflict detection and no-op gesture suppression.

### 13.2 Browser behavior tests

- default objects have no persistent card surface;
- hover and selection chrome appear only in their intended states;
- selecting does not change revision;
- dragging and resizing each change revision exactly once;
- Escape restores the original preview layout;
- multi-selection commits atomically;
- layout gestures do not issue data queries;
- final resize reflows from cached render payload;
- keyboard gestures and reduced-motion behavior work;
- local selection survives unrelated Scene events but clears when its target is deleted.

### 13.3 Real-browser acceptance

1. Drag a chart, reload, and confirm its position persists.
2. Resize a chart and confirm axes reflow without a DuckDB query.
3. Move a chart and annotation together and confirm one revision and one history operation.
4. Trigger a concurrent layout mutation and confirm safe retry or visible rollback without overwrite.
5. Confirm chart mark identity survives layout-only changes where the renderer supports retention.
6. Confirm the canvas, inspector, and controls produce no console errors or warnings.
7. Inspect at desktop viewport sizes and at 80%, 100%, and 150% canvas zoom.

## 14. Acceptance statement

The milestone is accepted when charts, text, KPIs, and annotations appear directly on the canvas without persistent rectangular containers; a user can select, drag, resize, multi-select, and snap those objects; each completed gesture persists atomically as one Scene revision; layout-only interaction never triggers a data query; and the experience remains visually continuous through retained rendering and restrained motion.
