# Changelog

## v0.1.8 — 2026-07-01
- VCF 9.1 accuracy pass on the Step 1 Section A VLAN table and the Step 2 intake
  Network questions (follow-on from #6, cross-checked vs. the pinned workbook and
  Broadcom 9.1 TechDocs):
  - Added the **VPC Gateway / Distributed Transit Gateway external network**
    (VLAN row 11, intake `B20`, mapping row) — only for the Distributed
    connectivity model (`A10`).
  - Noted Host Overlay MTU is inherited from the vDS; overlay needs MTU ≥ 1600.
  - Clarified `B4` (VCF Management Services range = `/28`–`/27`, inside VM Mgmt)
    and `B5` (VCF Automation = 5 IPs / `/29`); reworded the Automation split,
    which the workbook and TechDocs describe differently. Closes #7.

## v0.1.7 — 2026-07-01
- `01-network-dns-plan.md`: reworked the Step 1 Section A IP range carve-out.
  The old single VM Mgmt row under-counted a VCF 9.1 management domain (~15 IPs)
  and was internally inconsistent. Split into host-facing subnets plus a proper
  VM Management appliance breakdown (~30–48 IPs): per-component counts for
  vCenter, NSX (3 + VIP), SDDC Manager, VCF Operations (3 analytics + cloud proxy
  + license server, optional VIP), the VCF Automation `/29`, and the VCF
  management-services runtime `/28`–`/27` (where the "12–30" actually belongs).
  Added a note on the separate internal `198.18.0.0/15` services CIDR. Counts
  cross-checked against the pinned workbook and Broadcom 9.1 TechDocs. Closes #6.

## v0.1.6 — 2026-07-01
- Web: improved readability of the wide fill-in tables (e.g. Step 1 Section A).
  Tables now use the full content width, empty cells show a faint placeholder,
  columns have dividers, and each table sits in a bordered scroll container for
  narrow screens. Running text keeps a comfortable reading measure. Bumped the
  Pages CI build to Node 22. Closes #5.

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
