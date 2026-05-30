# Financial Dashboard — Agent Rules

## Critical workflow
- This project is in Theme Clean phase.
- Do NOT change business logic, math formulas, Supabase queries, DB schema, auth, routing, or data models unless explicitly requested.
- Theme cleanup means only: colors, backgrounds, borders, shadows, readable text contrast, input/button/card/table styling.
- Preserve the latest working UI layout. Do not simplify components.
- Prefer CSS variables:
  - var(--bg-main)
  - var(--bg-card)
  - var(--bg-card-soft)
  - var(--text-main)
  - var(--text-muted)
  - var(--border-main)
  - var(--accent-strong)
  - var(--success)
  - var(--danger)
  - var(--warning)
- Avoid hard-coded dark cards like #111827, #1f2937 unless they are inside a truly dark-only component.
- Every edited page must work in Light Pro and Dark Classic.

## Validation
After changes, run:
- npm run build

## Output required
For every task, report:
1. Files changed
2. What changed
3. Confirmation that no logic/math/Supabase was changed
4. How to test in Light Pro and Dark Classic

## Pending logic task — do not do during Theme Clean
Logic Audit 01 — Align Spendable Cash / Safe-to-Spend.
Issue:
- Overview Quick Snapshot Spendable Cash around -$69.10
- Money Plan Spendable Cash around $221.05
- Money Plan Safe-to-Spend around -$249.81
Only do this after Theme Clean, unless explicitly requested.