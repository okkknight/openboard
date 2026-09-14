# LC2 Phase 5 — Cross-mark transitions

Representation changes now plan by mark families and semantic identity, not by chart templates. Bar↔dot, bar↔arc, and bar↔line have deterministic coordinated exit/enter strategies; every other pair visibly falls back to fade EXIT + ENTER. The reconciler delays compatible layer replacement until the exit action resolves, then introduces the detached target layer through normal ENTER actions. No arbitrary SVG path morph is required.

`npm run verify:core` passed on 2026-09-14: contracts validated and 105 tests passed, 0 failed.
