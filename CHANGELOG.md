# Changelog

## v0.1.20 — 2026-07-02
- `03-multi-az-prep.md` section D clarifications: (1) the per-AZ networking table
  applies to **any stretched cluster**, not just the management domain — a
  workload-domain cluster can also be stretched; added a note on the WLD case
  (repeat per-AZ rows per WLD; VM Management stretched is mgmt-specific). (2)
  Fixed an inconsistency with `prerequisites.md`: Edge Overlay + Uplinks are
  stretched **only with NSX Centralized connectivity** (intake `A10`) — per-AZ
  under Distributed; the rows now carry that caveat. (3) Clarified that the NSX
  Edge Uplink BGP sessions **are** the north-south / public peering (captured in
  the `01` BGP plan + intake `B10`–`B16`), not a separate item.

## v0.1.19 — 2026-07-02
- `05-day2-deployments.md`: read all the Broadcom option pages and expanded
  section C with accurate per-placement detail — Shared VLAN (no isolation, not
  DR-suited), Dedicated VLAN (dedicated port group; Cloud Proxy stays on VM-mgmt),
  NSX Overlay (Ops/Automation/Ops-for-Networks/License Server on the overlay via
  Edge cluster + Tier-0 BGP + Tier-1; Cloud Proxy on VLAN), NSX VLAN Segment, and
  the stretched-overlay DR model (NSX Federation + Global Manager primary/
  secondary for IP mobility). Added common prerequisites (unique FQDN→IP,
  dual-stack A/AAAA, binaries to VCF Installer).
- Fixed the spurious `Duplicate id` build warning: the docs/samples content
  collections used a relative `base` outside the project root, which the `dev`
  and `build` content syncs tracked under two normalized paths. Anchored both to
  an absolute URL (`new URL('../../docs', import.meta.url)`) so every file has one
  canonical id. Verified clean under a live dev-cache + build collision.

## v0.1.18 — 2026-07-02
- Corrected the Day-2 network-placement options in `05-day2-deployments.md`. The
  first cut wrongly framed the choice as "Shared Management Network vs. NSX VPC"
  — the *Deploy Fleet Management Day-N* sheet (verified from the raw data-
  validation lists) actually offers four placements: **Shared Management
  Network / Dedicated Management Network / NSX Overlay Segment / NSX VLAN
  Segment**, and there is no VPC option. Reconciled with the Broadcom design
  library (*Fleet-Level Components Networking Detailed Design* — four models incl.
  the DR-oriented stretched-overlay) and the custom-networking deployment
  guidance: the NSX Overlay path is a **hybrid** (Ops + Automation on the overlay
  segment, Cloud Proxy / collectors stay on the VLAN), needs an NSX Edge cluster
  with a centralized transit gateway + Tier-1 (Active/Standby), and the VCF
  Automation internal **cluster CIDR** defaults to `198.18.0.0/15`. Updated the
  deploy-method options (Exclude / Deploy VCF Operations and Automation / Deploy
  VCF Automation) and fixed intake `B21`/`E15` and the Day-N mapping to match.

## v0.1.17 — 2026-07-02
- New **Day-2 / Day-N fleet deployment** prep: `docs/05-day2-deployments.md`,
  sourced from the workbook's *Deploy Fleet Management Day-N* sheet + TechDocs.
  Enumerates the components deployed after bring-up (VCF Operations, Cloud
  Proxy, License Server, VCF Automation, Identity Broker, Operations for Logs /
  Networks) and captures the key decisions: bring-up vs Day-2, the two VCF
  Automation deployment methods (SDDC Manager API vs via VCF Operations), and
  the **network placement** — Shared Management Network vs a dedicated network
  that can be an **NSX VPC** (ties to `A10`/`B20`). Added intake questions
  `A17` / `B21` / `E15` (with `[DAYN]` sheet legend), mapped them plus the
  Log/Networks appliances to the *Deploy Fleet Management Day-N* sheet, and
  added a sidebar **Day-2** step + README row. Closes #23.

## v0.1.16 — 2026-07-02
- New **interactive Management Domain sizing tool** on the site
  (`web/src/pages/tools/mgmt-sizing.astro` + engine `web/src/lib/mgmt-sizing.ts`).
  Reproduces the workbook's *Management Domain Sizing* sheet (pinned rev
  `v1.9.1.001`) — appliance footprints from the `table_*` ranges, host-count and
  vSAN raw-capacity formulas from the summary cells — and **adds a cluster fit
  check the spreadsheet lacks**: enter your proposed host count + per-host spec
  and it reports fits / doesn't-fit at N-1, per-dimension headroom, and the
  binding constraint. Includes a workload-domain repeater (each WLD's vCenter +
  dedicated NSX Managers add to the mgmt footprint). Engine verified against the
  sheet's own values at defaults (122 vCPU / 316 GB / 7872 GB / 4 hosts /
  41 CPU + 106 GB + 5855 GB per host at N-1 / 17564 GB vSAN raw). Added
  `docs/04-sizing.md` (Step 3) linking the tool, a sidebar **Tools** entry, and
  README rows. Closes #15.

## v0.1.15 — 2026-07-02
- `03-multi-az-prep.md` table D: added a sourcing note confirming the
  stretched-vs-per-AZ traffic split against the Broadcom VCF 9 design library
  (*vSphere Stretched Cluster Model*). ESX Management, vMotion, vSAN, and Host
  TEP are "unique per availability zone" (per-AZ); only VM Management is
  "shared across availability zones" (stretched) — there is no option to
  stretch ESX Management. Also pins the AZ1↔AZ2 figure at the vSAN
  stretched-cluster limit (<5 ms RTT, ≥10 Gbps), not the looser 10 ms
  generic-AZ number. Closes #14.

## v0.1.14 — 2026-07-01
- Site proofread: verified every doc cross-link resolves to a real route, the
  ITQ-authored chrome is free of em-dashes and emoji, and there are no
  doubled-word or leftover-marker issues. Fixed one stray "MR" shorthand in
  `prerequisites.md` (now "multi-AZ", consistent with the rest). Closes #13.

## v0.1.13 — 2026-07-01
- Added the first `samples/` worked example: `01-network-dns-plan-rainpole.md`,
  a filled Step 1 plan using the classic Rainpole reference values (VLANs,
  subnets, IP carve-out, BGP AS/uplinks, DNS records, NTP, AD/CA) drawn from the
  pinned workbook. Surfaced it on the site via a `samples` content collection +
  route and a sidebar "Worked example" link. README `samples/` row updated.
  Closes #12.

## v0.1.12 — 2026-07-01
- Built out the Workload Domain / Cluster intake, previously a single stub line
  (`E13`). New **section H** (sourced from the workbook Deploy Workload Domain +
  Deploy Cluster sheets): per-WLD name/vCenter/NSX/connectivity/Supervisor/
  storage and per-cluster hosts/networks/vDS/overlay/stretched/passwords, with
  `E13` now pointing to it. Surfaced the 9.1 sizing gotcha that each WLD's
  vCenter (1) + NSX cluster (4) consume **5 IPs on the management VM Mgmt
  subnet** — noted in section H and the Step 1 carve-out. Mapped `H1`–`H12` in
  `workbook-cell-mapping.md` (replacing the "same as mgmt domain" placeholder).
  Closes #11.

## v0.1.11 — 2026-07-01
- `02-customer-intake.md` Platform (E) section 9.1 accuracy pass: VCF Operations
  and VCF Automation were captured as single "VIP FQDN + IP" entries, but in 9.1
  they are multi-node clusters. Corrected `E9` (3 analytics nodes + optional
  load-balancer VIP) and `E10` (appliance/cluster FQDN + services-runtime FQDN;
  nodes from the `/29`), and added `E14` for the fleet/services FQDNs new in 9.x
  (Cloud Proxy, License Server, Identity Broker, VCF services runtime). Updated
  `workbook-cell-mapping.md` to match (E9/E10 relabelled, E14 added). Verified
  the Architect (A), Security (F) and Depot (G) sections against the workbook —
  no changes needed. Closes #10.

## v0.1.10 — 2026-07-01
- Verified the `03-multi-az-prep.md` stretched-vSAN figures against Broadcom
  vSAN 9.x docs and corrected two:
  - Witness RTT is **tiered by host count**, not a flat ≤200 ms: ≤200 ms up to
    10 hosts/site, **≤100 ms** for 11–15 hosts/site, ≤500 ms for a single
    host/site. Updated M4 and the witness table.
  - Site-to-site bandwidth has **no fixed figure** — it's driven by the write
    bandwidth being mirrored. Replaced the "10 GbE+ typical" wording and pointed
    at VMware's bandwidth-sizing guidance.
  - Added the requirement for a **highly-available Layer 3 gateway** between AZs
    alongside the stretched L2 segments.
  - Confirmed the witness-bandwidth rule (~2 Mbps / 1000 vSAN components) and the
    <5 ms inter-site RTT are correct as written. Closes #9.

## v0.1.9 — 2026-07-01
- VCF 9.1 accuracy pass on `prerequisites.md` (cross-checked vs. the pinned
  workbook Prerequisite Checklist + Management Domain Sizing sheets and Broadcom
  9.1 TechDocs). The hardware minimums were already sound; added:
  - CPU: vSphere 9 **16-core/CPU** licensing minimum, size on physical cores,
    vCPU:pCPU ≤ 2:1.
  - A note that the **9.1 management footprint is larger** (~12 appliances /
    ~120 vCPU baseline incl. the VCF services runtime 3 control + 3 worker
    nodes) — don't reuse a 4.x/5.x host spec.
  - vSAN-OSA disk-group detail (600 GB cache/group, 6.25 TB capacity/group;
    32 GB host RAM for max disk groups).
  - A **vDS teaming** network requirement, overlay MTU ≥ 1600, and a sharper
    stretched-networks caveat (uplinks/edge overlay stretched only under NSX
    Centralized connectivity) cross-linked to `03-multi-az-prep.md`. Closes #8.

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
