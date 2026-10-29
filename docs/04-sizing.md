# Management Domain Sizing & Fit Check

The Broadcom *Planning & Preparation Workbook* has a *Management Domain Sizing*
sheet, but it only works **one direction**: you feed it a fleet and it tells you
the minimum number of hosts. In a planning meeting the question is usually the
other way round — *"we're proposing four hosts with 64 cores and 1 TB each,
does that fit?"* — and the sheet can't answer it.

This toolkit provides an interactive tool that does both:

> **[▶ Open the Management Domain Sizing calculator](https://vcf-planning.hollebollevsan.nl/tools/mgmt-sizing/)**

> **Not sure which VCF Operations or Log Management size to enter?** The
> [Ops & Logs Planning Sizer](https://vcf-planning.hollebollevsan.nl/tools/ops-logs-sizing/)
> ([guide](30-ops-logs-sizing.md)) recommends a Log Management size and replica count and
> what it adds to the services runtime (workers, IPs, VIPs), plus a quick VCF Operations
> estimate. For the final VCF Operations node size, use Broadcom's
> [VCF Operations Sizing Estimator](https://vcfopssizer.broadcom.com/).

It reproduces the workbook's sizing calculation — the **VCF 9.1.1** workbook,
pinned revision `v1.9.1.102` — and adds a **cluster fit check**: enter the hosts
you intend to build and it shows whether the fleet fits **at N-1** (surviving one
host failure), the headroom on each dimension, and the binding constraint.
Everything runs in the browser — no data leaves the page.

For **vSphere Foundation (VVF)** the tool has a second platform setting: the
workbook has no VVF sheet, so that profile is built from Broadcom TechDocs (see
[VVF / Standalone profile](#vvf--standalone-profile)). Both platforms also get a
**licence count**: cores and vSAN TiB, per KB 313548 (see
[Licensing: counting cores](#licensing-counting-cores)).

> **Two workbook revisions in `reference/`.** The sizer follows the 9.1.1
> workbook (`vcf-9.1.1-planning-and-preparation-workbook.xlsx`, `v1.9.1.102`).
> The rest of the repo's cell mapping (intake, deployment plan,
> [`workbook-cell-mapping.md`](workbook-cell-mapping.md)) still targets the 9.1
> workbook (`v1.9.1.001`) until it is re-pinned separately.

---

## Deployment profiles

The workbook (and the tool) start from a **deployment model and size**. They set
how many of each management appliance are deployed and at which size:

| Profile | What it deploys | Fits | Reference fleet* |
| ------- | --------------- | ---- | ---------------- |
| **Simple** (Small) | Single NSX Manager, 1 services-runtime control node + workers (12 vCPU / 24 GB each), single-node VCF Operations; VCF Automation (optional) single-node — no management-plane HA | Labs, edge and small sites | 76 vCPU / 251 GB / 7,448 GB |
| **HA-Small** (**new in 9.1.1**) | 3 NSX Managers, 3 control nodes + **smaller** workers (10 vCPU / 16 GB each), a **2-node** VCF Operations cluster (primary + replica); VCF Automation (optional) single-node — the HA layout on the small appliance sizes | The cheapest HA: no single points of failure in the core management plane | 106 vCPU / 335 GB / 8,422 GB |
| **HA-Medium** | Medium vCenter, 3 NSX Managers, 3 control nodes + workers (12 vCPU / 24 GB each), 3-node VCF Operations; VCF Automation (optional) 3-node | Typical production fleet | 184 vCPU / 656 GB / 11,445 GB |
| **HA-Large** | Large vCenter (XLarge storage) and NSX Managers, 3 larger control nodes + workers (16 vCPU / 32 GB each), 3-node VCF Operations; VCF Automation (optional) 3-node on Large | Large fleets, many workload domains | 298 vCPU / 949 GB / 15,357 GB |

\* Management domain with VCF Operations, Cloud Proxy and VCF Automation, before
workload domains and Day-N services — Broadcom's
[VCF Fleet Sizing Models](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/vcf-fleet-sizing-models-9-x.html),
which the tool reproduces exactly (see below). **VCF Automation is optional** in
every profile (bring-up can defer it indefinitely); it is in the reference
figures only because Broadcom's models include it, and the tool leaves it off by
default. In HA-Small it is single-node, so not highly available. The worker
count isn't fixed per profile: the workbook derives it from what runs on the
services runtime, and the workers grow to a larger size once Log Management or
Real-time Metrics are included (see below).

The **Advanced management domain sizing** option overrides the profile-derived
sizes when a fleet doesn't fit one of the four profiles (see below).

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
- **Advanced management domain sizing** (the workbook's R24–R32): override the
  management vCenter size and storage, NSX Manager model and size, VCF
  Operations model and size, Cloud Proxy size and VCF Automation size instead of
  taking them from the profile. While on, VCF Operations, its Cloud Proxy and VCF
  Automation follow these choices (Exclude removes them), and the NSX Manager
  model sets the host minimum (4 for an HA cluster)
- A **workload-domain repeater** — each workload domain's vCenter, dedicated NSX
  Managers, Global Manager (own size), Avi controllers and SSP run inside the
  management domain, so they add to its footprint; DR coverage per domain; and an
  advisory **Supervisor planned + NSX Edge form factor** check (the WLD Edge
  cluster itself is not counted — it runs on WLD hosts)

**Cluster inputs (the part the workbook lacks)**

- Cluster type (standard / stretched multi-AZ / stretched vMSC), host count
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
- **VCF Operations Continuous Availability** is not offered.
- **One deliberate difference in advanced mode.** The workbook reads some advanced
  cells even while the mode is *Unselected* — the License Server row checks the
  advanced VCF Operations model, and the Cloud Proxy RAM / disk use the advanced
  proxy size if one was left set. The tool applies advanced values only while the
  mode is on. (Also note the workbook's advanced VCF Operations size list has
  values with a leading space, e.g. " Small", which its own lookups don't find.)

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
over a copy of the workbook for **157 input scenarios** — every profile and
instance model, each optional component and size, workload domains, protection
blueprints, all storage types and the advanced overrides — and records every row
Excel computes.
`web/scripts/verify-sizer.mjs` runs the engine on the same inputs and compares row
by row (nodes / vCPU / RAM / disk) plus the host count and every capacity step.
**All 157 match exactly**, and the check runs on every site build (`prebuild`).

Four of those scenarios reproduce Broadcom's own reference fleets from
[VCF Fleet Sizing Models](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/vcf-fleet-sizing-models-9-x.html)
to the gigabyte:

| Fleet (Ops + Cloud Proxy + VCF Automation) | Sizer / workbook | Broadcom TechDocs |
| ------------------------------------------ | ---------------- | ----------------- |
| Simple | 76 vCPU / 251 GB / 7,448 GB | 76 / 251 / 7,448 |
| High Availability – Small | 106 vCPU / 335 GB / 8,422 GB | 106 / 335 / 8,422 |
| High Availability – Medium | 184 vCPU / 656 GB / 11,445 GB | 184 / 656 / 11,445 |
| High Availability – Large | 298 vCPU / 949 GB / 15,357 GB | 298 / 949 / 15,357 |

> This is a planning aid. Always confirm the final numbers against the official
> workbook for your actual revision before committing to hardware. For
> stretched (multi-AZ) builds, also work through [`03-multi-az-prep.md`](03-multi-az-prep.md) —
> the tool doubles vSAN raw for the dual-site mirror, but the witness, latency
> budgets, and per-AZ networking still need the multi-AZ prep page.
>
> **Stretched (vMSC)** is the NFS / FC option: a vSphere Metro Storage Cluster built
> by the storage vendor ([KB 417356](https://knowledge.broadcom.com/external/article/417356)).
> The tool keeps the one-site-down (N/2) CPU/RAM check but applies neither the
> vSAN ×2 mirror nor the 8-host floor of the vSAN stretch (hosts are rounded to an
> even number, at least 2). The array-side capacity (synchronous mirror),
> tiebreaker / arbiter and inter-site latency are the storage vendor's design and
> are not modelled; enter the datastore capacity the management cluster gets.

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
- **Cloud Proxy** — Small 4 / 16, Standard 8 / 48 — are the **Unified** Cloud
  Proxy figures in [KB 397782](https://knowledge.broadcom.com/external/article/397782)
  (VCF Operations 9.0 sizing). VCF 9 deploys the unified configuration (see
  [`27-vcf-operations-ha-cloud-proxy-vvf.md`](27-vcf-operations-ha-cloud-proxy-vvf.md));
  the plain Cloud Proxy in the same KB is smaller (2 / 8, 4 / 32), so the tool
  errs on the large side.
- **License Server** (2 vCPU / 4 GB / 12 GB) is a workbook figure. TechDocs
  sends you to the workbook's *Management Domain Sizing* tab for its
  requirements rather than listing them, so there is no separate official
  figure to check it against (checked 2026-10-15, as are the Cloud Proxy and
  Supervisor entries).
- **Supervisor control plane: storage differs.** The 9.1
  [Change the Control Plane Size of a Supervisor](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsphere-supervisor-installation-and-configuration/configuring-and-managing-a-supervisor-cluster/change-the-control-plane-size-on-a-supervisor-cluster.html)
  page matches the workbook's vCPU / RAM (Tiny 2 / 8, Small 4 / 16, Medium
  8 / 24, Large 16 / 32), but lists **32 GB** storage per VM where the workbook
  uses **48 GB**, and has **no XLarge** (the workbook's 32 / 64). The tool keeps
  the workbook figures so it still matches the workbook exactly; the difference
  is 16 GB per control-plane VM, on the safe side.
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
- **VCF management services: Broadcom's 9.1.0 → 9.1.1 figures are one worker
  below the workbook's.** Broadcom's
  [VCF blog of 2026-10-13](https://blogs.vmware.com/cloud-foundation/2026/10/13/customer-favorite-capabilities-accelerating-your-path-to-vcf-9-1-1/) (Brandon Hahn) gives the
  baseline footprint per profile (management services only, no Day-N services),
  read from its charts:

  | Profile | 9.1.0 | 9.1.1 | 9.1.1 total |
  | --- | --- | --- | --- |
  | Simple (Small) | 1 control (4 / 10) + **3** workers (12 / 24) | 1 control + **1** worker (12 / 24) | 16 vCPU / 34 GiB (−43 % CPU, −41 % RAM) |
  | **Small HA** | not available | 3 control (4 / 10) + **2** workers (10 / 16) | 32 vCPU / 62 GiB |
  | Medium HA | 3 control (4 / 10) + 3 workers (24 / 48) | 3 control + **2** workers (12 / 24) | 36 vCPU / 78 GiB (−40 % / −38 %) |
  | Large HA | 3 control (8 / 14) + 3 workers (24 / 48) | 3 control + **3** workers (16 / 32) | 56 vCPU / 106 GiB (−42 % / −43 %) |

  The blog's Small HA row labels the workers "2 x Control Plane (10 vCPU /
  16GiB)" — a typo: only workers make its total add up. The worker **sizes**
  match the workbook exactly; the **counts** are one lower than the sizer's
  baseline in every profile (sizer: Simple 2, HA-Small 3, HA-Medium 3, HA-Large
  4), which is the workbook's per-profile **+1 node**. The blog is the newest
  official source; the tool keeps the workbook formula so it stays verified
  against the workbook, which puts it one worker on the safe side. KB 455842
  ([below](#vvf--standalone-profile)) shrinks a 9.1.0 deployment to the 9.1.1
  footprint after an upgrade.
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

## VVF / Standalone profile

Set **Platform** to *VMware vSphere Foundation (VVF) / standalone* to size a
VVF 9.1 management footprint. VVF has no SDDC Manager, NSX, workload domains or
VCF Automation, and **VCF Management Services are optional**. In VVF the
management VMs usually run on the same cluster as your workloads, so the tool
also shows the vCPU and RAM **left for workloads at N-1**.

**Not workbook-verified.** The P&P workbook (9.1.1, `v1.9.1.102`) has no VVF
sizing sheet, so nothing in Broadcom's own tooling can be used to check this
profile against. The component list is taken from TechDocs 9.1 (pages *Last
Updated October 15, 2026*, read 2026-10-15). The appliance sizes come from the
same workbook tables as the VCF profile.

| Component | Counted | Source |
| --------- | ------- | ------ |
| vCenter | Always; size + storage selectable, default **Medium** | [vSphere Foundation FQDNs and IP Addresses](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/vcf-components-fqdns-and-ip-addresses/vsphere-foundation-platform-fqdns-and-ip-addresses.html); Installer default from [Start a New vSphere Foundation Deployment by Using the VCF Installer Deployment Wizard](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/deploy-vmware-vsphere-foundation-using-the-deployment-wizard.html): *"medium vCenter, medium VCF Operations, and small VCF management services"* |
| VCF Operations | Always; Single Node (Installer default), HA - 2 nodes (primary + replica) or HA - 3 nodes (+ data node); default **Medium** | Same pages; HA build in [`27-vcf-operations-ha-cloud-proxy-vvf.md`](27-vcf-operations-ha-cloud-proxy-vvf.md) |
| Cloud Proxy | Optional (TechDocs: *"Cloud Proxy (Optional)"*), Small / Standard, default Small | FQDN page above |
| License Server | Always (2 vCPU / 4 GB / 12 GB): *"You must add at least one license server to each VCF Operations instance that you use for license management."* | Wizard page above |
| VCF Management Services | **Include** (default) or **Leave out**, chosen right under the platform switch; sized by the deployment model + size (Installer: Simple / Small). *Leave out* warns that the VCF Installer doesn't offer it: it is a manual build | See below |
| Log Management | Requires the management services: with them left out, Log Management is set to *Exclude* and locked | [`31-log-management.md`](31-log-management.md) §1 |
| Supervisor control plane, Avi controllers, License Hub (Avi) | Optional, same sizes as VCF. Listed last in VVF mode (*Add-ons*), as most VVF environments use none of them | Avi is listed under *Add-ons* on the FQDN page |

**VCF Management Services.** The VCF Installer *"deploys vSphere Foundation only
with VCF management services"*. A manual build without them is
[a supported model](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/deploy-vmware-vsphere-foundation-using-the-deployment-wizard/deploying-vmware-vsphere-foundation-9-1-without-vcf-management-services.html),
but it has no Log Management, no software depot and no integrated lifecycle of
VCF Operations. For VVF the management services are
[*"VCF services runtime, Fleet lifecycle, SDDC lifecycle, Software depot, Telemetry"*](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/upgrading-your-vsphere-foundation-to-9-1/install-vcf-management-services-to-vsphere-foundation-environment.html).
That list has **no Identity Broker and no Salt**, which a VCF first instance
does run. The worker count uses the VCF first-instance formula (1.2× RAM, 1.09×
CPU, +1 node; see [How the numbers are derived](#how-the-numbers-are-derived)),
fed with only those four services plus Log Management. At Simple / Small that
gives **1 control node + 2 workers**, the same node count as VCF's Simple
profile. This is the tool's own model, not a Broadcom figure.

> **Broadcom's own sources disagree on the Simple worker count** (all three
> pages *Last Updated October 15, 2026*, read 2026-10-15):
>
> | Source | Simple model |
> | ------ | ------------ |
> | [VCF Fleet Sizing Models](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/vcf-fleet-sizing-models-9-x.html) and the 9.1.1 workbook | 1 control node + **2** workers |
> | [VCF Management Services Models](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/vcf-management-services-models.html), [Simple VCF Management Services Model](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/vcf-management-services-availabilty-detailed-design/vcf-management-services-simple-deployment-model.html) | 1 control node + **3** workers |
> | [VCF blog, 2026-10-13](https://blogs.vmware.com/cloud-foundation/2026/10/13/customer-favorite-capabilities-accelerating-your-path-to-vcf-9-1-1/) (newest; read 2026-10-16) | 9.1.0: 1 + 3; **9.1.1: 1 control node + 1 worker** |
>
> [William Lam (September 2026)](https://williamlam.com/2026/09/vcf-9-1-1-adopting-the-reduced-vcf-management-services-vcfms-footprint-after-an-upgrade.html)
> explains the gap: VCF 9.1.1 removed one worker from new Simple deployments,
> so 3 is the 9.1.0 layout and the design pages haven't caught up. The blog
> confirms 3 for 9.1.0 but gives **1** for 9.1.1 — one below the Fleet Sizing
> Models and the workbook, the same +1 gap as every other profile (see
> [Validation](#validation-against-broadcom-techdocs)). The VVF wizard needs
> Installer 9.1.1 anyway, so the tool uses 2: the workbook's count, one worker
> on the safe side of the blog. One caveat:
> [KB 455842](https://knowledge.broadcom.com/external/article/455842), the
> procedure for shrinking the workers after an upgrade, says it *"is not
> applicable to a VMware vSphere Foundation … Environment"*, so VVF's runtime
> may be sized differently from VCF's. No source gives VVF's worker count; a
> deployed VVF 9.1.1 shows it under *Build > Lifecycle > VCF Management >
> Components > VCF Services Runtime*.

**Defaults** (Installer layout, vSAN-ESA): vCenter Medium, 1 × VCF Operations
Medium, Cloud Proxy Small, License Server, management services Simple / Small =
**7 VMs, 50 vCPU, 140 GB RAM, 4,483 GB disk**. Without the management services:
4 VMs, 22 vCPU, 82 GB RAM, 1,483 GB disk.

**Minimum hosts (VVF).** There is no workbook cell to follow here. The minimum is
the highest of three counts: enough hosts for the cores (CPU oversubscription
applied), enough for the RAM (RAM oversubscription applied) plus one host for
N-1, and a floor of 3 hosts on vSAN or 2 otherwise. vSAN capacity and stretched
clusters raise it the same way as for VCF.

**Only VVF inputs are shown.** In VVF mode the tool hides every VCF-only
selection (instance model, NSX Edges / Global Manager, SSP, VCF Automation,
Operations for Networks, Real-time Metrics, additional-instance services, DR,
workload domains, advanced overrides). The engine ignores any values still
stored for them.

**Not modelled for VVF:** Real-time Metrics, VCF Operations for Networks and VMware
Live Recovery, which are not confirmed for VVF 9.1 in the sources above. Avi
Service Engines and the Foundation Load Balancer are left out, as they are for VCF.

## Licensing: counting cores

The tool's **Licensing** panel counts what the hosts you entered need: the
cores to license, the vSAN TiB the subscription includes, and the vSAN add-on
capacity still to buy. It counts only those hosts, so license every other host
in the environment as well. It follows Broadcom
[KB 313548](https://knowledge.broadcom.com/external/article/313548), and the
build checks it against all six worked examples in that KB, for both VCF and
VVF (12/12 match, `npm run verify:sizer`).

| Rule | VCF | VVF |
| ---- | --- | --- |
| Cores to license | Physical cores, at least **16 per CPU** | Same |
| vSAN included | **1 TiB** per licensed core | **0.25 TiB** per licensed core, *"rounded up to the next TiB"* |
| vSAN measured on | **Raw** physical capacity the hosts contribute (not the usable datastore) | Same |
| Add-on to buy | Raw TiB − included TiB, rounded up; 0 if the entitlement covers it | Same |

The tool takes raw capacity as devices per host × device size. Device sizes
are entered in **decimal GB**, as drives are sold, and converted to TiB
(1 TiB = 1,099.5 GB), so a 3.84 TB NVMe device counts as 3.49 TiB. Per the KB,
the vSAN Capacity view in the vSphere Client shows usable datastore capacity, not
raw. For counts from an existing environment, use the KB's PowerCLI tool
(`Get-FoundationCoreAndTiBUsage -DeploymentType VVF`). The KB's *Environment*
list still names VCF 4.5 / 5.1 and vSphere 8. It is Broadcom's current
core-counting article, and nothing in the 9.1 TechDocs contradicts it.

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

> On a low-core-count CPU the licence quantity is **higher** than the physical
> core count. The Licensing panel applies the 16-core-per-CPU floor from the
> **CPUs (sockets) per host** input, separately from the vCPU / RAM / storage
> fit check.

## Source

Figures come from `reference/vcf-9.1.1-planning-and-preparation-workbook.xlsx`
(`v1.9.1.102`), sheet *Management Domain Sizing* and its *Static Reference
Tables*. When Broadcom ships a new revision: regenerate the tables in
`web/src/lib/mgmt-sizing.ts`, re-run `web/scripts/sizer-golden/` against the new
workbook, and make `npm run verify:sizer` pass before bumping
`WORKBOOK_REVISION`.
