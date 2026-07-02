# VCF9-DeploymentPlanning

Helper material for working with the **VMware Cloud Foundation 9.1 Planning and
Preparation Workbook** when guiding a customer through a from-scratch VCF 9
fleet deployment.

The official workbook (`vcf-9.1-planning-and-preparation-workbook.xlsx`,
downloaded from Broadcom) has ~9 deeply-technical sheets that ask hundreds of
questions in a single flat layout. Handing it to a customer cold tends to
produce gaps, wrong VLANs, missing DNS entries, and weeks of back-and-forth.

This repo flips the order:

1. **Lock the network / DNS / NTP / AD plan first** — one page, one
   conversation. Most workbook errors trace back to this layer.
2. **Use a role-based intake doc** — questions grouped by *who owns the
   answer* (Network team, AD/PKI team, Platform team, Architect). Each
   question maps back to a specific workbook cell.
3. **Transfer answers into the workbook last** — by then it's mechanical.

## Contents

| Path                                | Purpose                                                |
| ----------------------------------- | ------------------------------------------------------ |
| `docs/01-network-dns-plan.md`       | Step 1 — one-page network / DNS / NTP / AD plan        |
| `docs/02-customer-intake.md`        | Step 2 — role-based customer intake questionnaire      |
| `docs/03-multi-az-prep.md`          | Extra prep for stretched / multi-AZ builds (if `A13`=Yes) |
| `docs/04-sizing.md`                 | Step 3 — management-domain sizing + link to the fit-check calculator |
| `docs/workbook-cell-mapping.md`     | Reference — intake answers mapped to workbook cells    |
| `web/src/pages/tools/mgmt-sizing.astro` | Interactive sizing & cluster fit-check tool (client-side) |
| `web/src/lib/mgmt-sizing.ts`        | Sizing engine — appliance tables + formulas from the pinned workbook |
| `docs/prerequisites.md`             | Customer-side prerequisites (gate before any inputs)   |
| `reference/vcf-9.1-planning-and-preparation-workbook.xlsx` | Pinned copy of the Broadcom workbook (v1.9.1.001) — the revision this repo's mapping targets |
| `samples/`                          | Worked examples (Rainpole-style) — e.g. a filled Step 1 network/DNS plan |
| `web/`                              | ITQ-branded Astro site (GitHub Pages) rendering the `docs/` in place |

## Web version

The planning docs are published as an ITQ-branded site via GitHub Pages:
**<https://pauldiee.github.io/VCF9-DeploymentPlanning/>**

The site (`web/`, built with [Astro](https://astro.build)) renders the same
`docs/*.md` in place — the markdown stays the single source of truth, so editing
a doc updates both the GitHub view and the site. To run it locally:

```
cd web
npm install
npm run dev      # http://localhost:4321/VCF9-DeploymentPlanning/
```

A GitHub Actions workflow (`.github/workflows/deploy.yml`) rebuilds and deploys
on every push to `main` that touches `web/` or `docs/`.

## Workflow

```
Prereqs check  →  Network/DNS plan  →  Intake doc  →  Workbook fill  →  VCF Installer
   (gate)         (1 page, 1 mtg)     (per team)      (mechanical)       (UI/API)
```

## Related tools

- **[vcfplanning.lcoscia.fr](https://vcfplanning.lcoscia.fr/)** — Leonardo
  Coscia's browser-based reimplementation of the official workbook. 600+ fields
  across a five-phase form (Planning → Prerequisites → Sizing → Deploy →
  As-Built), with live sizing, VLAN/IP/CIDR conflict detection, and
  JSON/Markdown/CSV export. Complements this repo: run the intake here, enter
  the answers there instead of fighting the raw `.xlsx`. Client-side only — no
  data leaves the browser.
- **[pauldiee/VCF9ReadinessAssessment](https://github.com/pauldiee/VCF9ReadinessAssessment)**
  — pre-cutover readiness scoring from RVTools / HST exports.
- **[pauldiee/VCFHealthCheck](https://github.com/pauldiee/VCFHealthCheck)** —
  post-cutover health checks of live VCF 9 environments.

## Author

Paul van Dieen — <https://hollebollevsan.nl>

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
