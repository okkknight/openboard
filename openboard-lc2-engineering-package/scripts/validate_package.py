from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = [
    "README.md",
    "STATUS.md",
    "AGENTS_LC2.md",
    "CODEX_START_PROMPT.md",
    "PHASE_GATES.md",
    "source-audits/README.md",
    "docs/specs/2026-09-14-openboard-lc2-design.md",
    "docs/plans/2026-09-14-openboard-lc2-implementation-plan.md",
    "contracts/identity-contract.md",
    "contracts/motion-grammar.md",
    "contracts/transition-matrix.md",
    "contracts/render-artifact-v2.schema.json",
    "contracts/render-operation.schema.json",
    "tests/acceptance-matrix.md",
    "tests/e2e-scenarios.md",
    "source-audits/CURRENT_IMPLEMENTATION_REPORT.md",
    "source-audits/RENDERER_IMPLEMENTATION_REPORT.md",
]

missing = [p for p in REQUIRED if not (ROOT / p).exists()]
if missing:
    raise SystemExit("Missing required package files: " + ", ".join(missing))

for p in ["contracts/render-artifact-v2.schema.json", "contracts/render-operation.schema.json"]:
    with (ROOT / p).open("r", encoding="utf-8") as f:
        json.load(f)

currency = (ROOT / "source-audits/README.md").read_text(encoding="utf-8")
if "pre-LC0/LC1" not in currency or "historical" not in currency:
    raise SystemExit("source audit currency guide must classify the pre-LC0/LC1 reports as historical")

for md in ROOT.rglob("*.md"):
    text = md.read_text(encoding="utf-8")
    for forbidden in ("TBD", "TODO", "fill in details"):
        if forbidden in text:
            raise SystemExit(f"Forbidden placeholder {forbidden!r} in {md.relative_to(ROOT)}")

print("package validation: OK")
