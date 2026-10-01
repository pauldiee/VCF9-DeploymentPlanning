# Management Domain Sizing & Fit Check

The Broadcom *Planning & Preparation Workbook* has a *Management Domain Sizing*
sheet, but it only works **one direction**: you feed it a fleet and it tells you
the minimum number of hosts. In a planning meeting the question is usually the
other way round — *"we're proposing four hosts with 64 cores and 1 TB each,
does that fit?"* — and the sheet can't answer it.

This toolkit provides an interactive tool that does both:

> **[▶ Open the Management Domain Sizing calculator](https://vcf-planning.hollebollevsan.nl/tools/mgmt-sizing/)**

It reproduces the workbook's sizing calculation — the **VCF 9.1.1** workbook,
pinned revision `v1.9.1.102` — and adds a **cluster fit check**: enter the hosts
you intend to build and it shows whether the fleet fits **at N-1** (surviving one
host failure), the headroom on each dimension, and the binding constraint.
Everything runs in the browser — no data leaves the page.

> **Two workbook revisions in `reference/`.** The sizer follows the 9.1.1
> workbook (`vcf-9.1.1-planning-and-preparation-workbook.xlsx`, `v1.9.1.102`).
> The rest of the repo's cell mapping (intake, deployment plan,
> [`workbook-cell-mapping.md`](workbook-cell-mapping.md)) still targets the 9.1
> workbook (`v1.9.1.001`) until it is re-pinned separately.

---

## What it models

**Fleet inputs** (the workbook's *Management Domain Sizing* inputs)

- Instance (first / additional), deployment model and size — Simple: Small;
  High Availability: **Small**, Medium or Large
- Principal storage (vSAN-ESA / vSAN-OSA / NFS / FC)
- Management components: NSX Global Manager, NSX Edges or Virtual Network
  Appliances, a **management-domain Supervisor** (single node or HA, with its
  control-plane size), Avi Load Balancer, Security Services Platform (sized by the
  management NSX Manager size, plus one SSP Installer per five SSP deployments),
  and **License Hub** as an explicit choice (needed for vDefend; for Avi only with
  on-prem licensing)
- Fleet components: **VCF Operations** (Include / **Existing** / Exclude — Existing
  counts only its Cloud Proxy and the License Server), a Cloud Proxy on its own,
  VCF Automation, VCF Operations for Networks (Small to XXL)
- VCF management services that run **on the services-runtime workers** and so
  raise the **worker count** rather than adding rows: Log Management (size +
  replicas), Real-time Metrics, and on an additional instance Software Depot and
  Identity Broker
- Protection blueprints: Site Protection & DR (management, workload or both) and
  on-premises Ransomware Recovery, as VMware Live Recovery appliances
- A **workload-domain repeater** — each workload domain's vCenter, dedicated NSX
  Managers, Global Manager (own size), Avi controllers and SSP run inside the
  management domain, so they add to its footprint; DR coverage per domain; and an
  advisory **Supervisor planned + NSX Edge form factor** check (the WLD Edge
  cluster itself is not counted — it runs on WLD hosts)

**Cluster inputs (the part the workbook lacks)**

- Cluster type (standard / stretched multi-AZ), host count
- Per-host cores, RAM, and usable vSAN capacity
- CPU/RAM oversubscription, storage growth %, and the **vSAN rebuild + operations
  reserve %** — vSAN only; NFS / FC skip it, as they skip the FTT and stretched ×2 steps

**Outputs**

- Fits / does-not-fit verdict with the tightest dimension called out
- Per-dimension table: what the fleet needs vs. what the cluster offers, with headroom
- Fleet requirement: total nodes / vCPU / RAM / disk, minimum hosts, per-host load at N-1
- Capacity breakdown per storage type: **vSAN** raw (VM capacity → swap → FTT
  redundancy → reserve → growth → ×2 if stretched); **NFS / FC** datastore
  capacity (VM capacity → swap → growth), checked against the datastore size

## What it does not model (yet)

- **Avi Service Engines.** The **controllers** run in the management domain
  (scoped **per NSX instance**); the **Service Engines** run **per cluster in the
  workload domain** (minimum 2 per cluster) and are not modelled — add them to the
  WLD's own capacity. See [`prerequisites.md` → Avi Load Balancer](prerequisites.md).
- **License Hub 5.1.2.** The License Hub row is the current **2.0** appliance
  (6 vCPU / 12 GB / 256 GB, as in the 9.1.1 workbook and TechDocs'
  [License Hub Appliance System Requirements](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/license-hub/2-0/license-hub-appliance/license-hub-appliance-system-requirements.html)).
  A site staying on the older SSP-Installer-based 5.1.2 should add the difference
  by hand (TechDocs: installer 400 + controller 155 + worker 255 GB, #176). See
  [`15-license-hub.md`](15-license-hub.md).
- **VCF Operations Continuous Availability** and the workbook's **Advanced
  Management Domain Sizing** mode (per-component size overrides) are not offered
  yet (#378 part 2).

## How the numbers are derived

The appliance tables are **generated** from the workbook's `table_*` named
ranges, not retyped, and the component rows and host / capacity summary follow
the sheet's formulas row by row. Two parts are worth knowing:

- **VCF services runtime workers** (workbook row 23) are sized from demand: the
  Day-0 services (fleet / SDDC lifecycle, Identity Broker, Software Depot, Salt,
  telemetry) plus the Day-N services above, with **1.2× RAM** and **1.09× CPU**
  headroom, divided by the per-worker size, plus the workbook's per-profile +1
  node. On a **first instance with Log Management or Real-time Metrics**, the
  workers also switch to a larger size (Simple / HA-Small 16 vCPU / 32 GB,
  HA-Medium / Large 24 / 48). The sizer shows the resulting worker count.
- **Minimum hosts** reproduce the workbook's cell exactly — including that its RAM
  term ignores RAM oversubscription for High Availability. The fit check itself
  applies oversubscription fully, and raises the minimum for vSAN capacity and
  stretched clusters (shown as "N (workbook M)" when it does).

**Verified against the workbook itself.** `web/scripts/sizer-golden/` drives Excel
over a copy of the workbook for **127 input scenarios** — every profile and
instance model, each optional component and size, workload domains, protection
blueprints and all storage types — and records every row Excel computes.
`web/scripts/verify-sizer.mjs` runs the engine on the same inputs and compares row
by row (nodes / vCPU / RAM / disk) plus the host count and every capacity step.
**All 127 match exactly**, and the check runs on every site build (`prebuild`).

Two of those scenarios reproduce Broadcom's own reference fleets from
[VCF Fleet Sizing Models](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/vcf-fleet-sizing-models-9-x.html)
to the gigabyte:

| Fleet (Ops + Cloud Proxy + VCF Automation) | Sizer / workbook | Broadcom TechDocs |
| ------------------------------------------ | ---------------- | ----------------- |
| High Availability – Medium | 184 vCPU / 656 GB / 11,445 GB | 184 / 656 / 11,445 |
| High Availability – Large | 298 vCPU / 949 GB / 15,357 GB | 298 / 949 / 15,357 |

> This is a planning aid. Always confirm the final numbers against the official
> workbook for your actual revision before committing to hardware. For
> stretched (multi-AZ) builds, also work through [`03-multi-az-prep.md`](03-multi-az-prep.md) —
> the tool doubles vSAN raw for the dual-site mirror, but the witness, latency
> budgets, and per-AZ networking still need the multi-AZ prep page.

## Validation against Broadcom TechDocs

Beyond the workbook itself, the footprints were cross-checked against Broadcom
sources (2026-10-01):

- **vCenter** vCPU / RAM **and disk** (Default / Large / XLarge storage) match the
  9.1 [hardware](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vcenter-installation-and-setup/deploying-the-vcenter-server-appliance/vcenter-server-appliance-requirements/vcenter-server-appliance-hardware-requirements.html)
  and [storage](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vcenter-installation-and-setup/deploying-the-vcenter-server-appliance/vcenter-server-appliance-requirements/vcsa-storage-requirements.html)
  requirements. (The 9.1 workbook's vCenter disk table was 15–50% lower.)
- **NSX Manager** and **NSX Edge** sizes match the NSX installation requirements.
- **Avi controllers** — Small 6/32/512, Large 16/48/1,400, X-Large 16/64/1,750 —
  match the [Avi 32.1 controller sizing](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/avi-load-balancer/avi-load-balancer/32-1/vmware-avi-load-balancer-installation-guide/preparing-for-installation/nsx-advanced-load-balancer-controller-sizing.html).
- **VCF Operations** vCPU / RAM per size match VMware Configuration Maximums 9.1
  (where KB 324340 points for 9.1.x); the **274 GB** disk is a workbook figure.
  Object / metric limits and scaling: the upgrade guide's
  [VCF Operations sizing and scaling](https://docs.hollebollevsan.nl/docs/24-vcf-operations-sizing-and-scaling/).
- **Security Services Platform** (Medium 64 vCPU / 222 GB / 3.26 TB) matches the
  9.1 [SSP sizing and reservations](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/security-modernization/vdefend-lateral-security/security-services-platform-for-vmware-cloud-foundation/security-services-platform-detailed-design/security-services-platform-for-vcf-sizing-and-reservations.html)
  total.
- **Log Management** per replica (8/16, 16/32, 32/64) matches Configuration
  Maximums; the 9.1 *Deploy Log Management* page lists Medium as 24 / 48 — an
  inconsistency on Broadcom's side.
- **vSAN capacity math** — OSA **×2** (FTT=1 mirror), the **30%** rebuild/ops
  reserve, and the stretched **×2** mirror match the vSAN design guidance. The
  **ESA ×1.5** multiplier reflects ESA's adaptive RAID-5 efficiency, *not* a
  RAID-1 mirror (×2) — size for ×2 if you pin FTT=1 **RAID-1** on the management
  cluster.
- **Thick provisioning.** All disk figures are fully provisioned sizes plus a swap
  reservation equal to configured RAM — a worst case. vSAN's default policy and
  NFS are thin in practice; Broadcom only requires thick for some appliances (Avi
  controllers: *Thick provision – Lazy Zeroed*).
- **VCF Automation is sized on its own size.** The sizer keeps a separate
  Small / Medium / Large selector that also fixes the node count (Small = 1,
  Medium / Large = 3, #193); the workbook uses the fleet profile size. Setting it
  to the profile size reproduces the workbook.

## NSX Edge / VNA form factors

The NSX Edge node has four form factors. The Virtual Network Appliance (VNA,
Distributed connectivity) shares the identical per-node footprint, so the sizer's
single Edge selector covers both families. Per node:

| Form factor | vCPU | RAM (GB) | Disk (GB) |
| ----------- | ---: | -------: | --------: |
| Small       |    2 |        4 |      200 |
| Medium      |    4 |        8 |      200 |
| Large       |    8 |       32 |      200 |
| XLarge      |   16 |       64 |      200 |

The management Edge cluster is a **2-node** deployment, so the sizer doubles these
totals. Figures come from the pinned workbook and match the
[NSX Edge Installation Requirements](https://techdocs.broadcom.com/us/en/vmware-cis/nsx/vmware-nsx/4-2/installation-guide/installing-nsx-edge/nsx-edge-installation-requirements.html).

> **An Edge-backed Supervisor needs Large or bigger.** When a vSphere Supervisor
> uses an NSX Edge cluster — VPC networking with a **Centralized** Transit
> Gateway, or classic NSX segment networking — that Edge cluster must be at the
> **Large** form factor minimum
> ([`10-supervisor-enablement.md`](10-supervisor-enablement.md) §3.1); Small and
> Medium only cover plain north-south routing. The other Supervisor paths use no
> Edge cluster and the minimum does not apply: VPC networking with a
> **Distributed** Transit Gateway runs on a VNA cluster, and vDS networking uses
> no NSX at all. The sizer flags an NSX Edge selection below Large when a
> **management-domain Supervisor** is included (whose control plane it also
> counts), and per workload domain via a **Supervisor planned** toggle. A
> workload domain's Edge cluster runs on that domain's hosts, so it is advisory
> only there — not added to the management-domain totals.

## Licensing: counting cores

**"Per-host cores" in the sizing tool above is a capacity input — how much
CPU the cluster has to work with. It is not the same question as how many
cores you need to *license*.** For VCF/VVF per-core licensing, count only
**physical CPU cores** — hyperthreading/logical cores are not counted at
all. On top of that, a **16-core-per-CPU minimum** applies: license at least
16 physical cores per socket even if the CPU has fewer. The two rounding
rules apply **per CPU**, not per host, so they don't average out — Broadcom
KB 313548 ("Counting Cores for VMware Cloud Foundation and vSphere
Foundation and TiBs for vSAN"), verbatim example: a host with **2 CPUs × 8
cores** licenses as **2 × 16 = 32 cores**, not 16.

> When sizing hardware against this tool's per-host core input, remember the
> license quantity you'll actually buy can be **higher** than the physical
> core count on a low-core-count CPU — factor the 16-core-per-CPU floor into
> the licensing budget, separately from the vCPU/RAM/storage fit check above.

## Source

Figures come from `reference/vcf-9.1.1-planning-and-preparation-workbook.xlsx`
(`v1.9.1.102`), sheet *Management Domain Sizing* and its *Static Reference
Tables*. When Broadcom ships a new revision: regenerate the tables in
`web/src/lib/mgmt-sizing.ts`, re-run `web/scripts/sizer-golden/` against the new
workbook, and make `npm run verify:sizer` pass before bumping
`WORKBOOK_REVISION`.
