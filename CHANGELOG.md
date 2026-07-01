# Changelog

## v0.1.5 — 2026-07-01
- Added `web/` — an ITQ-branded Astro site published to GitHub Pages
  (<https://pauldiee.github.io/VCF9-DeploymentPlanning/>). Renders the existing
  `docs/*.md` in place via a glob content collection (markdown stays the single
  source of truth), themed entirely on the ITQ design tokens (Titillium, Royal
  Blue + Orange, square bullets). Landing page presents the Prereqs → Network →
  Intake → Multi-AZ → Mapping flow; sidebar nav + prev/next pager; `.md`
  cross-links rewritten to site routes. Deploys via
  `.github/workflows/deploy.yml` on pushes touching `web/` or `docs/`. Closes #4.

## v0.1.4 — 2026-07-01
- Added `docs/03-multi-az-prep.md` — standalone extra-prep checklist for
  stretched / multi-AZ (`A13`=Yes) builds: witness/third site, AZ1↔AZ2 fabric
  (≤5 ms / ≤200 ms latency budgets), stretched-vs-per-AZ networking, site+local
  storage-policy capacity, DNS/NTP additions, ownership matrix. README contents
  table updated; intake `A13` now cross-links the checklist. Closes #3.

## v0.1.3 — 2026-06-16
- README: added a "Related tools" section linking to Leonardo Coscia's
  browser-based VCF 9.1 planner (<https://vcfplanning.lcoscia.fr/>) alongside
  the two sister projects (VCF9ReadinessAssessment, VCFHealthCheck). Closes #2.

## v0.1.2 — 2026-05-15
- Pinned reference copy of the Broadcom workbook at
  `reference/vcf-9.1-planning-and-preparation-workbook.xlsx` (v1.9.1.001).
  Repo no longer relies on collaborators downloading the workbook themselves.
- Updated `.gitignore` and `CLAUDE.md` to reflect the new policy.

## v0.1.1 — 2026-05-15
- Added `CLAUDE.md` with project conventions, customer-data hygiene rules, and
  workbook-handling guidance for any collaborator's Claude Code instance.

## v0.1.0 — 2026-05-15
- Initial repo skeleton.
- Added customer-facing prerequisites checklist (`docs/prerequisites.md`).
- Added Step 1 one-page network / DNS / NTP / AD plan template
  (`docs/01-network-dns-plan.md`).
- Added Step 2 role-based customer intake questionnaire
  (`docs/02-customer-intake.md`).
- Added workbook cell mapping reference (`docs/workbook-cell-mapping.md`).
