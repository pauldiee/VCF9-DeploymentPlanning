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
| `docs/workbook-cell-mapping.md`     | Reference — intake answers mapped to workbook cells    |
| `docs/prerequisites.md`             | Customer-side prerequisites (gate before any inputs)   |
| `reference/vcf-9.1-planning-and-preparation-workbook.xlsx` | Pinned copy of the Broadcom workbook (v1.9.1.001) — the revision this repo's mapping targets |
| `samples/`                          | Example pre-filled fragments (Rainpole-style)          |

## Workflow

```
Prereqs check  →  Network/DNS plan  →  Intake doc  →  Workbook fill  →  VCF Installer
   (gate)         (1 page, 1 mtg)     (per team)      (mechanical)       (UI/API)
```

## Author

Paul van Dieen — <https://hollebollevsan.nl>

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
