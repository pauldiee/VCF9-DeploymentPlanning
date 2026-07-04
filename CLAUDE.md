# VCF9-DeploymentPlanning — Claude Code Context

> Auto-loaded by Claude Code. Conventions for any collaborator's Claude instance working in this repo.

---

## Project overview

A public field guide to the **VMware Cloud Foundation 9.1 Planning and Preparation Workbook** (`vcf-9.1-planning-and-preparation-workbook.xlsx`, Broadcom). The workbook has ~9 deeply-technical visible sheets and hundreds of fields; opened cold it tends to produce gaps and weeks of back-and-forth. All public-facing prose (docs, samples, site) is written as generic guidance addressed directly to the reader — no consultant-for-customer framing (#89); the consulting-engagement conventions below are repo-internal only.

This repo flips the order:
1. **Lock the network / DNS / NTP / AD plan first** (`docs/01-network-dns-plan.md`) — one page, one meeting. 80% of workbook errors trace back to this layer.
2. **Run a role-based intake** (`docs/02-intake.md`) — questions grouped by who owns the answer (Architect, Network, AD/DNS/NTP, PKI, Platform, Security, Depot).
3. **Transfer answers into the official workbook last** via `docs/workbook-cell-mapping.md` (mapping uses sheet name + field label, **not** P-coordinates — Broadcom shifts rows between revisions).

Generic / reusable — no customer names pre-filled. Real engagements live outside the repo (see "Customer data hygiene" below).

Sister projects (**ITQ Consulting Services — internal / private, not public tools**; do **not** present them as public `github.com/pauldiee/…` links on public-facing pages like `README.md` or the site):
- pauldiee/VCFHealthCheck — post-cutover health checks of live VCF 9 environments.
- pauldiee/VCF9ReadinessAssessment — pre-cutover readiness scoring from RVTools / HST exports.

GitHub: `https://github.com/pauldiee/VCF9-DeploymentPlanning` (public)

---

## File layout

| Path                             | Purpose                                                       |
| -------------------------------- | ------------------------------------------------------------- |
| `README.md`                      | Project overview + workflow                                   |
| `CHANGELOG.md`                   | Per-release notes; **newest entry at TOP**                    |
| `CLAUDE.md`                      | This file                                                     |
| `.gitignore`                     | Excludes customer artifacts, the Broadcom workbook, dumps     |
| `docs/prerequisites.md`          | Environment prereq gate (HW, network, AD, DNS, NTP, CA, …)    |
| `docs/01-network-dns-plan.md`    | Step 1 — one-page network / DNS / NTP / AD / BGP / CA plan    |
| `docs/02-intake.md`              | Step 2 — role-based intake questionnaire                      |
| `docs/03-multi-az-prep.md`       | Multi-AZ (stretched) extra prep — witness, latency, capacity |
| `docs/04-sizing.md`              | Step 3 — mgmt-domain sizing; links the interactive sizing tool|
| `docs/05-day2-deployments.md`    | Day-N fleet added after bring-up (VCF Automation, Log Management, network placement) |
| `docs/06-deployment-plan.md`     | Agile work breakdown (epics/stories/tasks); feeds the interactive export tool |
| `docs/07-firewall-ports.md`      | Curated firewall flows by zone + links to the authoritative Ports & Protocols tools |
| `docs/08-backup-and-depot.md`    | Build guide — SFTP backup target + offline depot / VCF Download Tool |
| `docs/workbook-cell-mapping.md`  | Intake-ID → workbook sheet + field label (+ named-range map)  |
| `samples/`                       | Rainpole-style worked examples (e.g. a filled Step 1 plan)    |
| `web/public/templates/`          | Blank fillable CSV planning templates (IP/DNS, VLAN, NTP/AD/CA, BGP) — served for download; **filled copies are customer data → OneDrive** |
| `reference/`                     | Pinned Broadcom P&P workbook (v1.9.1.001) — the mapping target |
| `web/`                           | ITQ-branded Astro site (GitHub + GitLab Pages) + interactive sizing & deployment-plan tools |
| `tools/`                         | (future) helper scripts — none planned currently (the workbook-writer idea was closed as not needed, issue #1) |

Docs **plus** an Astro site (`web/`, incl. the interactive sizing and deployment-plan export tools) today. If scripts ever get added, they follow the conventions used by the sister projects: required `$scriptVersion`/`$scriptAuthor`/`$scriptBlogUrl` variables, 62-char banner, `.NOTES` field order, `.CHANGELOG` newest-first, max 10 values on every version component (`.0`–`.9`).

---

## Author

| Field | Value                          |
| ----- | ------------------------------ |
| Name  | Paul van Dieen                 |
| Blog  | https://www.hollebollevsan.nl  |

These go into every new script / doc that exposes author metadata.

---

## Pre-commit checklist

Before committing any doc change:

1. **`CHANGELOG.md`** — new entry at the **TOP** (newest first, descending order). **Max 10 values on EVERY version component** (`.0`–`.9`, never `.10`): after patch `.9` roll the minor (`0.3.9` → `0.4.0`, never `0.3.10`), and after minor `.9` roll the major (`0.9.9` → `1.0.0`, never `0.10.0`).
2. **README.md** — if a file was added/moved/removed, the contents table is in sync
3. **`docs/workbook-cell-mapping.md`** — if an intake question was renumbered or added in `02-intake.md`, the mapping is updated in the same commit. Mapping uses sheet name + field label, **never** P-coordinates.
4. **Sample / example values** — confirm no real customer data leaked in (use Rainpole-style placeholders only: `sfo.example.io`, `rainpole.io`, `10.11.x.x`)

If/when scripts get added under `tools/`, also follow the script-side pre-commit checklist from VCFHealthCheck (`.NOTES Version` + `$scriptVersion` + README table version bumped together; max 10 values on every version component).

---

## Customer data hygiene

The workbook contains **highly sensitive** customer data: DNS names, public/private IPs, BGP AS numbers, passwords, AD service-account DNs, certificate templates. NEVER:

- Commit a filled workbook (`*-filled.xlsx`) or any customer-specific copy
- Commit a real customer's intake doc (`*-customer.md`)
- Commit screenshots of the workbook with real values visible
- Commit BGP / AS / IP planning sheets with real customer values

The official Broadcom workbook **is** kept in the repo (`reference/vcf-9.1-planning-and-preparation-workbook.xlsx`) as the pinned reference revision for this repo's mapping. Update it deliberately when Broadcom ships a new revision and re-validate `docs/workbook-cell-mapping.md` against the new sheet/field labels in the same commit.

`.gitignore` excludes these patterns. Re-check after any session that worked with real customer values.

### Where customer-engagement files live

Per-engagement working files (filled intake, filled workbook, network plan with real VLANs/IPs, BGP peers, follow-up emails) live **outside the repo**, in:

```
C:/Users/paul/OneDrive - ITQ/<customer>/VCF9-Deployment/
```

That folder is the source of truth for everything customer-specific. The repo only ever contains generic templates and Rainpole-style examples. When asked to "draft the intake for $customer" or "fill in the workbook for $customer", default to writing to the customer's OneDrive folder, not the repo.

### Customer-facing language

Internal working files (gap notes, planning sheets, memory) freely use consulting shorthand. Customer-facing prose (emails, intake docs sent to the customer, presentations) must not — translate before delivery:

- **"artifacts"** → "materials", "supporting materials", or be specific (e.g. "the RVTools export", "the filled workbook")
- **"in flight"** → "has requested", "is being prepared", or describe the state plainly
- Avoid VMware-internal jargon when the customer audience is mixed (network/AD/security teams who don't know VCF deeply) — expand `vDS`, `VMK`, `TEP`, `BOM`, `BGP MD5` on first use

---

## Workbook handling

- **Workbook revision tracking:** record the revision (e.g. `v1.9.1.001`, cell `VCF & VVF Planning!P5`) at the top of any cell-mapping change. Broadcom ships new minor revs that shift rows without renaming fields — that's why the mapping uses field labels.
- **Don't pin to P-coordinates.** If a P-style coordinate appears in commit messages or docs (e.g. "Deploy Management Domain P12"), reject the change and rewrite using sheet name + field label.
- **Working dump location:** when extracting workbook content for analysis, write to `_workbook_dump/` (gitignored). Use `ImportExcel` (available on the workstation) — `Get-ExcelSheetInfo` for sheet list, `Import-Excel -NoHeader -DataOnly` for content.

---

## GitHub issues discipline

- Every bug, fix, idea, or doc edit gets a GitHub issue — even if fixed in the same session, even if it feels too small.
- Open the issue **before** starting the work — not during, not after. Back-filling at session end matches the ledger but loses the audit trail's timing direction; it is a process miss.
- **Before creating a new issue, always check both open AND closed issues** (`gh issue list --state all`) to avoid duplicates.
- **Always ask "who requested this?"** before running `gh issue create` — apply the matching `requested-by:` label. Don't guess from context even when it's obviously Paul.
- Close issues only when the user confirms testing / use passed — looking done is not enough.

Current `requested-by:` labels are tracked at issue creation time. Add new labels with:
```bash
gh label create "requested-by: Full Name" --color "8250df" --description "Issue requested by Full Name"
```

---

## Git remotes

| Remote   | URL                                                                            | Status                                        |
| -------- | ------------------------------------------------------------------------------ | --------------------------------------------- |
| `origin` | `https://github.com/pauldiee/VCF9-DeploymentPlanning`                          | Public, primary                               |
| `gitlab` | `https://gitlab.msp.itq.eu/ugt_con_sddc_nl/vcf9-deploymentplanning.git`        | Internal ITQ mirror (configured 2026-05-15)   |

`main` tracks `origin/main`. To push commits to both remotes use the `pushall` alias (configured locally on this repo):

```bash
git pushall   # equivalent to: git push origin && git push gitlab
```

Regular `git push` only goes to `origin` (GitHub). Use `git pushall` for any commit you want mirrored to the ITQ GitLab too.

Issues and releases are mirrored separately by `..\Sync-VCFReposToGitLab.ps1` (the multi-repo sync script in the parent GitHub directory). Run that after a `pushall` to keep issues/releases in sync.
