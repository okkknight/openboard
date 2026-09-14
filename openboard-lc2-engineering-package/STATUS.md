# Package Status

**Package type:** architecture + implementation specification.

**Production implementation included:** no.

**Source audits included:** yes.
**Target project:** current OpenBoard/Data Canvas repository audited on 2026-09-14.

This package does not claim LC2 is implemented. It freezes the intended architecture, phase gates, contracts, and verification criteria so Codex can implement against the real repository without re-inventing scope.

## Frozen architectural decisions

- RenderArtifact is the LC2 insertion boundary.
- Observable Plot remains the statistical geometry engine.
- Browser keeps a stable plot viewport and reconciles keyed mark/layer nodes.
- Axes may be replaced as a subtree in LC2; mark nodes are the retained priority.
- Identity is explicit and deterministic; browser DOM inference from order/ARIA is forbidden.
- Primitive children gain the same identity contract as Plot marks.
- Motion is driven by render operations, not by “render completed” entrance animation.
- Card spatial motion uses retained card nodes and a lightweight FLIP-style approach.
- Unsupported cross-mark morphs fall back to semantic EXIT + ENTER.
- WorkSession and Durable Scene semantics from LC0/LC1 are preserved.
