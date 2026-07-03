# Management Domain Sizing & Fit Check

The Broadcom *Planning & Preparation Workbook* has a *Management Domain Sizing*
sheet, but it only works **one direction**: you feed it a fleet and it tells you
the minimum number of hosts. In a customer meeting the question is usually the
other way round — *"we're proposing four hosts with 64 cores and 1 TB each,
does that fit?"* — and the sheet can't answer it.

This toolkit provides an interactive tool that does both:

> **[▶ Open the Management Domain Sizing calculator](https://pauldiee.github.io/VCF9-DeploymentPlanning/tools/mgmt-sizing/)**

It reproduces the workbook's sizing calculation (pinned revision `v1.9.1.001`)
and adds a **cluster fit check**: enter the hosts you intend to build and it
shows whether the fleet fits **at N-1** (surviving one host failure), the
headroom on each dimension, and the binding constraint. Everything runs in the
browser — no customer data leaves the page.

---

## What it models

**Fleet inputs**

- Deployment model (Simple / High Availability) and size (Small / Medium / Large)
- Principal storage (vSAN-ESA / vSAN-OSA / NFS / FC)
- Management components: vCenter, NSX Managers (+ Global Manager), NSX Edges,
  AVI load balancer, Security Services Platform, VCF Operations, Cloud Proxy,
  VCF Automation, VCF Operations for Networks, plus the always-on SDDC Manager,
  VCF services runtime (control + worker), and protection reserve
- A **workload-domain repeater** — each workload domain's vCenter and dedicated
  NSX Managers run inside the management domain, so they add to its footprint

**Cluster inputs (the part the workbook lacks)**

- Cluster type (standard / stretched multi-AZ), host count
- Per-host cores, RAM, and usable vSAN capacity
- CPU/RAM oversubscription, host + operations reserve %, storage growth %

**Outputs**

- Fits / does-not-fit verdict with the tightest dimension called out
- Per-dimension table: what the fleet needs vs. what the cluster offers, with headroom
- Fleet requirement: total nodes / vCPU / RAM / disk, minimum hosts, per-host load at N-1
- vSAN raw-capacity breakdown (VM capacity → swap → FTT redundancy → reserve → growth)

## What it does not model (yet)

The tool models the full management-domain component set (SDDC Manager,
vCenter, NSX Managers/Edges, AVI, SSP, VCFMS control/worker, VCF Operations,
Cloud Proxy, VCF Automation, VCF Operations for Networks + collector, Log
Management, Real-time Metrics, License Server, Software Depot, and the
protection reserve). A few edge cases are still simplified — add their
footprint manually or fall back to the workbook:

- Identity Broker (additional-instance only; served from the VCFMS cluster).
- Per-workload-domain: Site Protection / SRM, AVI load balancer, Security
  Services Platform. Each workload domain currently contributes only its
  vCenter and (dedicated) NSX Managers.
- A workload domain's Global Manager is sized the same as its local NSX Manager
  (the workbook allows a separate Global Manager size).

## How the numbers are derived

Appliance footprints are transcribed from the workbook's `table_*` reference
tables; the host-count and vSAN-capacity formulas are transcribed from the
*Management Domain Sizing* summary cells. The engine is verified against the
sheet's own computed values for the workbook's saved baseline (High
Availability / Medium, VCF Operations excluded — the tool defaults VCF
Operations *on* for a greenfield fleet, which raises these figures):

| Output | Tool | Workbook |
| ------ | ---- | -------- |
| Total vCPU | 122 | 122 |
| Total RAM (GB) | 316 | 316 |
| VM capacity (GB) | 7872 | 7872 |
| Minimum hosts | 4 | 4 |
| vCPU / host (N-1) | 41 | 41 |
| RAM / host (N-1) | 106 | 106 |
| Storage / host (N-1) | 5855 | 5855 |
| vSAN raw (GB) | 17564 | 17564 |

> This is a planning aid. Always confirm the final numbers against the official
> workbook for the customer's actual revision before committing to hardware. For
> stretched (multi-AZ) builds, also work through [`03-multi-az-prep.md`](03-multi-az-prep.md) —
> the tool doubles vSAN raw for the dual-site mirror, but the witness, latency
> budgets, and per-AZ networking still need the multi-AZ prep page.

## Validation against Broadcom TechDocs

The footprints are transcribed from the pinned workbook; they were cross-checked
against Broadcom TechDocs (issue #16). Results:

- **vCenter** (vCPU/RAM), **NSX Manager** (Extra_Small–Large), and **NSX Edge**
  (all sizes) **match** the current vSphere 9 / NSX docs exactly.
- **AVI load balancer — the workbook diverges from the real NSX ALB Controller
  sizes.** The workbook (and so this tool) uses Small 6/32/**512**, Large
  16/48/**1400**, X-Large 16/64/**1750**. The authoritative
  [NSX ALB Controller ladder](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/avi-load-balancer/avi-load-balancer/30-2/vmware-avi-load-balancer-installation-guide/preparing-for-installation/nsx-advanced-load-balancer-controller-sizing.html)
  is **Small 6/32/128, Medium 10/32/256, Large 16/48/512** — i.e. the workbook's
  **disk figures are high**, it has **no Medium tier**, and its **"X-Large" is
  not a real controller size** (Large is the top). vCPU/RAM for Small/Large still
  line up. Treat AVI sizing here as indicative; confirm against the NSX ALB
  install guide for the real controller footprint.
- **vSAN capacity math** — OSA **×2** (FTT=1 mirror), the **30%** rebuild/ops
  reserve, and the stretched **×2** mirror all match the vSAN design guidance.
  The **ESA ×1.5** multiplier reflects ESA's adaptive RAID-5 efficiency, *not* a
  RAID-1 mirror (which is ×2) — reasonable as a default, but size for ×2 if you
  pin FTT=1 **RAID-1** on the management cluster.
- **vCenter disk** figures and the **NSX Manager XLarge** row reflect the pinned
  workbook revision and may differ from later 9.1 point releases.
- **VCF Operations / Automation / VCFMS / Cloud Proxy / Ops-for-Networks** come
  from the workbook's own reference tables; no external per-size Broadcom table
  was available to cross-check — validate against the workbook itself.

## Source

Figures come from `reference/vcf-9.1-planning-and-preparation-workbook.xlsx`
(`v1.9.1.001`), sheet *Management Domain Sizing*. When Broadcom ships a new
revision, re-check the `table_*` values and the summary formulas and update
`web/src/lib/mgmt-sizing.ts` in the same commit.
