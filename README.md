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
| `docs/05-day2-deployments.md`       | Day-N — fleet components added after bring-up (VCF Automation, Log Management, Operations for Networks, network placement) |
| `docs/06-deployment-plan.md`        | Agile work breakdown (epics/stories/tasks); build a scope (stretch, Day-2, workload domains) and export it |
| `docs/workbook-cell-mapping.md`     | Reference — intake answers mapped to workbook cells    |
| `web/src/pages/tools/mgmt-sizing.astro` | Interactive sizing & cluster fit-check tool (client-side) |
| `web/src/pages/tools/deployment-plan.astro` | Interactive deployment-plan export tool — type selector + Markdown/CSV backlog export |
| `web/src/lib/mgmt-sizing.ts`        | Sizing engine — appliance tables + formulas from the pinned workbook |
| `web/src/lib/deployment-plan.ts`    | Deployment-plan engine — structured epics/stories/tasks + Markdown/CSV exporters |
| `docs/prerequisites.md`             | Customer-side prerequisites (gate before any inputs)   |
| `reference/vcf-9.1-planning-and-preparation-workbook.xlsx` | Pinned copy of the Broadcom workbook (v1.9.1.001) — the revision this repo's mapping targets |
| `samples/`                          | Worked examples (Rainpole-style) — e.g. a filled Step 1 network/DNS plan |
| `web/`                              | ITQ-branded Astro site (GitHub + GitLab Pages) rendering the `docs/` in place |

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

For **internal visibility**, the same site also publishes to **GitLab Pages** on
the ITQ GitLab mirror via `.gitlab-ci.yml`. The Astro `site` / `base` are
env-configurable (`SITE_URL` / `SITE_BASE`), so one codebase serves both: GitHub
uses the defaults; the GitLab job **derives them from the actual Pages URL**
(`CI_PAGES_URL`), so the base matches automatically — including GitLab's
unique-domain path suffix (`/<project>-<hash>`). Once the `pages` job runs, the
site + its URL appear under **Deploy → Pages** (newer GitLab; older versions had
it under Settings → Pages). The ITQ runner is a shell executor, so the job also
fetches a local Node build itself.

## Workflow

```
Prereqs → Network/DNS plan → Intake → Fill the workbook → Generate JSON → VCF Installer
 (gate)    (1 page, 1 mtg)   (per team)  (raw .xlsx, or      (VCF.JSON-      (submit the
                                          Coscia's tool)      Generator)      JSON, UI/API)
```

The **filled P&P workbook is the machine-readable handoff**: Coscia's tool (or
the raw `.xlsx`) fills it, then **VCF.JSONGenerator** reads it to produce the
deployment JSON for the VCF Installer — see *Related tools* below.

## Related tools

- **[vcfplanning.lcoscia.fr](https://vcfplanning.lcoscia.fr/)** — Leonardo
  Coscia's browser-based reimplementation of the official workbook. 600+ fields
  across a five-phase form (Planning → Prerequisites → Sizing → Deploy →
  As-Built), with live sizing, VLAN/IP/CIDR conflict detection, and
  JSON/Markdown/CSV export. Complements this repo: run the intake here, enter
  the answers there instead of fighting the raw `.xlsx`. Client-side only — no
  data leaves the browser.
- **VCF.JSONGenerator** — Ken Gould's cross-platform PowerShell module, a
  **companion to the P&P workbook**: it **reads a populated workbook** (the same
  one this repo targets) and generates the JSON payloads for the VCF management
  components (VCF Installer / SDDC Manager). The "last mile" — plan → fill the
  workbook → generate the JSON → submit to the Installer. It does *not* configure
  prerequisites or submit the JSON; you do that.
  [GitHub](https://github.com/vmware/powershell-module-for-vmware-cloud-foundation-jsongenerator)
  · [PowerShell Gallery](https://www.powershellgallery.com/packages/VCF.JSONGenerator/)
- **[VCFHostPreparation](https://github.com/pauldiee/VCFHostPreparation)** —
  helper for quickly **imaging and commissioning ESXi hosts** before bring-up
  (management, workload-domain, and second-AZ hosts). Referenced from the
  deployment plan's host-prep stories (E5 bring-up / E7 mgmt stretch / E9 workload domains).

**ITQ Consulting Services** (delivered as engagements, not public tools):

- **VCF9 Readiness Assessment** — pre-cutover readiness scoring from RVTools /
  HST exports.
- **VCF Health Check** — post-cutover health checks of live VCF 9 environments.

## Author

Paul van Dieen — <https://hollebollevsan.nl>

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
