# VCF9-DeploymentPlanning

A field guide to the **VMware Cloud Foundation 9.1 Planning and
Preparation Workbook** for anyone planning a from-scratch VCF 9
fleet deployment.

The official workbook (`vcf-9.1-planning-and-preparation-workbook.xlsx`,
downloaded from Broadcom) has ~9 deeply-technical sheets that ask hundreds of
questions in a single flat layout. Opened cold, it tends to
produce gaps, wrong VLANs, missing DNS entries, and weeks of back-and-forth.

This repo flips the order:

1. **Lock the network / DNS / NTP / AD plan first** — one page, one
   conversation. Most workbook errors trace back to this layer.
2. **Use a role-based intake doc** — questions grouped by *who owns the
   answer* (Network team, AD/PKI team, Platform team, Architect). Each
   question maps back to a specific workbook cell.
3. **Transfer answers into the workbook last** — by then it's mechanical.

## Contents

### Planning docs, in order

| Path                                | Purpose                                                |
| ----------------------------------- | ------------------------------------------------------ |
| `docs/prerequisites.md`             | Environment prerequisites (gate before any inputs)     |
| `docs/01-network-dns-plan.md`       | Step 1 — one-page network / DNS / NTP / AD plan        |
| `docs/02-intake.md`                 | Step 2 — role-based intake questionnaire               |
| `docs/03-multi-az-prep.md`          | Extra prep for stretched / multi-AZ builds (if `A13`=Yes) |
| `docs/04-sizing.md`                 | Step 3 — management-domain sizing + link to the fit-check calculator |
| `docs/05-day2-deployments.md`       | Day-N — fleet components added after bring-up (VCF Automation, Log Management, Operations for Networks, network placement) |
| `docs/06-deployment-plan.md`        | Agile work breakdown (epics/stories/tasks); build a scope (stretch, Day-2, workload domains) and export it |

### Reference — per-component build guides

| Path                                | Purpose                                                |
| ----------------------------------- | ------------------------------------------------------ |
| `docs/07-firewall-ports.md`         | Deployment-critical firewall flows by zone + links to the Ports & Protocols tools |
| `docs/08-backup-target.md`          | Build guide for the SFTP backup target (building, verifying, field-notes gotchas) |
| `docs/09-binary-depot.md`           | Build guide for the offline depot / VCF Download Tool (feed the depot, connect VCF, the fleet proxy) |
| `docs/10-supervisor-enablement.md`  | Build guide for enabling a vSphere Supervisor on a workload domain (Centralized Transit Gateway + Avi, validation, field notes) |
| `docs/11-esx-coredump.md`           | Build guide for the ESXi network Dump Collector (enable on vCenter, point every host at it, verify) |
| `docs/12-sso-configuration.md`      | Build guide for configuring fleet SSO via the VCF Identity Broker (identity provider, per-product federation, role mapping, verification) |
| `docs/13-shutdown-startup.md`       | The ordered fleet shutdown / startup runbook (the 11-step management sequence, the fleet-level VCF Operations rule, shared NSX, infrastructure VMs last) |
| `docs/14-avi-load-balancer.md`      | Build guide for deploying Avi Load Balancer (VCF Operations wizard, controller first-login setup, the licensing chain) |
| `docs/15-license-hub.md`            | Build guide for deploying License Hub (2.0 standalone OVA and 5.1.2 SSP Installer flows, post-deploy registration/licensing chain) |
| `docs/16-remove-components.md`      | Cleanly remove and reinstall optional Day-N fleet components (Log Management, Real-time Metrics, VON, Depot Service, Identity Broker, VCF Automation) via `cleanup_component.py` |
| `docs/17-vcfa-tenant-config.md`     | Build guide for first-time VCF Automation tenant/org config (Login Provider Manual setup — region, external IP block, external connections, organization + Avi) |
| `docs/18-vdefend-ssp.md`            | Build guide for deploying + first-time config of the vDefend Security Services Platform (SSP Installer wizard, form factors, onboard NSX Manager, activate Security Intelligence / NDR / Malware Prevention) |
| `docs/workbook-cell-mapping.md`     | Intake answers mapped to workbook cells                |

### Interactive tools (on the site)

| Path                                | Purpose                                                |
| ----------------------------------- | ------------------------------------------------------ |
| `web/src/pages/tools/mgmt-sizing.astro` | Interactive sizing & cluster fit-check tool (client-side) |
| `web/src/pages/tools/deployment-plan.astro` | Interactive deployment-plan export tool — scope + deployment choices (connectivity, storage, stretch, per-WLD Supervisor, VCF Automation model, Day-2 components) + Markdown/CSV backlog export |
| `web/src/pages/tools/plan-tracker.astro` | Interactive deployment tracker — the plan as a checklist (story checkboxes, per-epic progress, save/load progress file); follows the scope set in the export tool |
| `web/src/pages/tools/test-plan.astro` | Interactive test plan — scope-driven verification cases in phases TP-0…TP-6 with P/F1/F2/NA tracking, actual-result capture, "How to run this" instructions, and Excel/report/CSV/runbook export; follows the scope set in the export tool |
| `web/src/pages/version-overview.astro` | Auto-updating VCF 9.1 Version Overview (latest version + build per component); data refreshed weekly from Broadcom |

### Reference data + templates

| Path                                | Purpose                                                |
| ----------------------------------- | ------------------------------------------------------ |
| `reference/vcf-9.1-planning-and-preparation-workbook.xlsx` | Pinned copy of the Broadcom workbook (v1.9.1.001) — the revision this repo's mapping targets |
| `web/public/templates/`             | Blank fillable **CSV planning templates** (IP/DNS, VLAN, NTP/AD/CA, BGP, firewall request) — downloadable from the site; feed the workbook / Coscia planner |
| `samples/`                          | Worked examples (Rainpole-style) — e.g. a filled Step 1 network/DNS plan |

### PowerShell tools (`tools/`)

| Path                                | Purpose                                                |
| ----------------------------------- | ------------------------------------------------------ |
| `tools/Get-VCFCredentials.ps1`      | Read-only, takes a `-Credential` in both modes. `-SDDCManager`: the passwords SDDC Manager stores/rotates for managed components (ESXi, vCenter, NSX, PSC, backup) via `GET /v1/credentials`, masked by default (`-ShowPasswords`, `-ExportCsv`). `-VCFOps`: the VCF Management account **inventory** (component/username/expiry, no secrets — that side has no reveal) via the internal Ops password-management API (Ops token + unsupported-API flag) |
| `tools/Get-VCFBackupConfig.ps1`     | Read-only check of the VCF 9.1 *VCF Management* backup configuration via the Fleet LCM API — shows the target / **username** / schedule / retention the platform actually stored |
| `tools/Set-VCFBackupConfig.ps1`     | Sets that backup location through the API (`-WhatIf`, `-ShowThumbprint`) — for when the wizard fails without a usable error |
| `tools/Get-VCFProxyConfig.ps1`      | Read-only check of the proxy (`peerProxy`) stored on the VCF services runtime (VSP) via the Fleet LCM API |
| `tools/Set-VCFProxyConfig.ps1`      | Sets that proxy through the API (`-WhatIf`, authenticating / TLS proxy, exclude lists) — or clears it (`-Remove`) — so the fleet can download bundles without direct internet |
| `tools/Set-ESXCoredump.ps1`         | Points every ESX host (or a chosen subset) at a Dump Collector via `esxcli` / PowerCLI (`-WhatIf`, firewall ruleset check). **Assumes the Dump Collector service is already enabled on vCenter** — see `docs/11-esx-coredump.md` |
| `tools/third-party/`                | **Not our work.** Mirrored third-party scripts, each with its licence alongside. Currently `fleet_lcm_deploy_vcf_automation_to_different_network.ps1` — © 2022 William Lam, BSD 2-Clause, unmodified mirror of [his script](https://github.com/lamw/vmware-scripts) for deploying VCF Automation to a non-management network, hosted for air-gapped use. Prefer upstream; see `docs/05-day2-deployments.md` section D. Copied to the site alongside `tools/*.ps1` at build time |

### The site itself

| Path                                | Purpose                                                |
| ----------------------------------- | ------------------------------------------------------ |
| `web/`                              | ITQ-branded Astro site (GitHub + GitLab Pages) rendering the `docs/` in place |
| `web/scripts/scrape-versions.mjs`   | Node scraper behind the Version Overview — reads vCenter build KB + Broadcom TechDocs patch tree, emits `web/src/data/vcf-versions.json`; run weekly by `.github/workflows/scrape-versions.yml` |
| `web/src/lib/mgmt-sizing.ts`        | Sizing engine — appliance tables + formulas from the pinned workbook |
| `web/src/lib/deployment-plan.ts`    | Deployment-plan engine — structured epics/stories/tasks + Markdown/CSV exporters + progress tracking |
| `web/src/lib/test-plan.ts`          | Test-plan engine — scope-driven verification cases in phases TP-0…TP-6, each mapped to the epic/story it proves; result tracking + exporters (customer **report** with a verdict and an exit-criteria self-audit, working **CSV**, full **runbook**) |
| `web/src/lib/test-plan-xlsx.ts`     | Builds the test plan as an `.xlsx` laid out like a field verification workbook (Title/Summary/Version + one sheet per phase, live COUNTIF stats, Status dropdown, conditional formatting) |
| `web/src/lib/xlsx.ts`               | Minimal dependency-free `.xlsx` writer (ZIP via `CompressionStream` + OOXML parts). Narrow by design — inline strings, formulas, styles, merges, frozen panes, autofilter, list validation, conditional formatting |
| `web/src/styles/theme.css`          | Theme layer — semantic surface / text / border tokens defined once with `light-dark()`, giving the site its light **and** dark scheme; the toggle only flips `color-scheme` |

## Web version

The planning docs are published as an ITQ-branded site via GitHub Pages:
**<https://vcf-planning.hollebollevsan.nl/>**

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
- **[VCFJsonSpecCreators](https://github.com/pauldiee/VCFJsonSpecCreators)** —
  optional interactive PowerShell that **builds, validates, and submits SDDC
  Manager API JSON** for **post-bring-up (Day-N) expansion**: network pools, workload
  domains, added clusters, and vSAN cluster **stretch**. The step *after*
  VCFHostPreparation — commission the hosts there, feed their SDDC Manager UUIDs
  to these scripts; each spec is validated against the live `/validations`
  endpoint before submit. Distinct from VCF.JSONGenerator above, which builds
  the *initial* management-domain bring-up JSON from the workbook — this one
  drives the ongoing domain/cluster lifecycle. Referenced from the deployment
  plan's E7 (mgmt stretch) and E9 (workload domain) stories.

**ITQ Consulting Services** (professional services, not public tools):

- **VCF9 Readiness Assessment** — pre-cutover readiness scoring from RVTools /
  HST exports.
- **VCF Health Check** — post-cutover health checks of live VCF 9 environments.

## Author

Paul van Dieen — <https://hollebollevsan.nl>

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
