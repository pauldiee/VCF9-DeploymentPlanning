# Multi-AZ (Stretched Cluster) Prep — extra layer

Run this **only if intake `A13` = Yes** (Multiple Availability Zones /
stretched). Everything here is **additive** to the single-AZ flow — you still
do `prerequisites.md` → `01-network-dns-plan.md` → `02-intake.md`.
This page captures what a stretched (multi-AZ) management domain adds on top.

A stretched cluster spans two data sites (AZ1, AZ2) plus a **third witness
site**. vSAN mirrors every object across both AZs and uses the witness to break
split-brain. That means three things the single-AZ plan never asks for:
a witness at a third location, a fabric that meets latency/bandwidth limits
between all three, and roughly double the raw capacity. The stretch operation
itself is driven by SDDC Manager and is **API-only** — a JSON stretch spec
validated and submitted via the SDDC Manager API (`POST
/v1/clusters/{id}/validations` + `PATCH /v1/clusters/{id}`); there is no UI
workflow. TechDocs:
[Stretching vSAN Clusters](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/stretching-clusters.html) ·
[Stretch a vSAN ESA or OSA Cluster Using the SDDC Manager API](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/building-your-private-cloud-infrastructure/stretching-clusters/stretch-a-cluster.html).

> Convention on this page: `sfo01` = **AZ1 / preferred** fault domain,
> `sfo02` = **AZ2 / secondary** fault domain, `sfo-wit` = **witness** site.
> Replace consistently. VLAN IDs and CIDRs are placeholders.

---

## A. Decision gate — is stretched actually required?

| # | Question                                                        | Notes                                                        |
| - | --------------------------------------------------------------- | ------------------------------------------------------------ |
|M1 | Two independent data sites available (AZ1, AZ2)?                | Separate power/cooling/fire zone — not two racks in one room |
|M2 | A **third** location for the witness?                           | Can be small; only runs the witness appliance                |
|M3 | Inter-AZ link meets **<5 ms RTT** and bandwidth (see C)?        | Hard vSAN requirement; confirm with network team in writing  |
|M4 | AZ↔witness link within the witness RTT budget?                  | **≤200 ms** RTT up to 10 hosts/site; **≤100 ms** for 11–15; ≤500 ms for a single host/site. Witness tolerates far more latency than the data sites |
|M5 | Which AZ is **preferred** (owns quorum if witness is lost)?     | Default `sfo01`                                              |
|M6 | Even, matched host count per AZ?                                | Same host count + hardware both AZs                          |

If any of M1–M4 is No/unknown, stop and resolve it before sizing — a stretched
build on a fabric that misses the latency budget will pass bring-up and then
fail under load.

---

## B. Witness / third site

| Item                              | Value / requirement                                            |
| --------------------------------- | -------------------------------------------------------------- |
| Witness appliance                 | `VMware-VirtualSAN-Witness-*.ova` (see `prerequisites.md`)      |
| Witness site                      | Third location, routable from **both** AZ1 and AZ2             |
| Witness runs on                   | Any supported host at the third site (nested ESXi appliance)   |
| Witness size                      | Match to component count (Tiny / Medium / Large per OVA prompt)|
| Witness network (VCF)             | **One** VMkernel/subnet on the witness appliance carries **both** management **and** witness traffic — the 2nd adapter is unused. Route it to the **management networks in both AZs** |
| Data-host witness traffic (WTS)   | On ESXi hosts in both AZs, witness traffic rides the **ESX Management** VMkernel (WTS-tagged) — **no dedicated witness VLAN needed**. Only witness traffic is routed to the 3rd site; vSAN data stays stretched L2 between AZs |
| AZ↔witness RTT                    | **≤200 ms** RTT (up to 10 hosts/site); **≤100 ms** for 11–15 hosts/site; ≤500 ms for a single host/site (2-node) |
| Witness bandwidth (rule of thumb) | ~2 Mbps per 1000 vSAN components; size from expected object count |
| Witness FQDN                      | A + PTR record, e.g. `sfo-wit01.sfo.example.io`                |
| Witness NTP/DNS                   | Reachable from the witness site (see F)                        |

The witness holds **only metadata (witness components)**, never data. Losing it
does not stop I/O — the preferred AZ (M5) keeps quorum.

> **Witness VLANs/subnets — what you actually need (VCF design).** Per the
> Broadcom [vSAN Design for VCF](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-5-2-and-earlier/5-2/vcf-design-5-2/vcf-vsan-design.html)
> and [Deploying a Witness Appliance](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/vsan-deployment-administration-and-monitoring/vsan-planning-and-deployment/working-with-virtual-san-stretched-cluster/deploying-a-witness-appliance.html),
> VCF puts witness traffic on the **management network** at both ends: the data
> hosts tag their **ESX Management** VMkernel for witness traffic, and the
> witness appliance uses **one** VMkernel for management + witness. So you do
> **not** provision a dedicated witness VLAN/subnet — you need the witness
> appliance's management subnet (3rd site) **routed to the ESX-management
> networks in both AZs**, within the witness RTT budget above. (The generic vSAN
> guide describes an optional dedicated per-site witness VLAN; VCF's design does
> not use it.)

**Routing for witness traffic.** Because witness traffic rides the **ESX
Management** VMkernel — which is on the default TCP/IP stack and uses the
**management default gateway** — it follows normal routed paths, so you do **not
add per-host static routes** (the classic dedicated-witness-VMK design does; the
VCF management-network design doesn't). What you need instead:

- **Bidirectional L3 routing** between **each AZ's ESX-Management subnet** and the
  **witness appliance's network** (3rd site): AZ1 *and* AZ2 hosts must reach the
  witness, and the witness must route back to **both** AZ management subnets.
- Each AZ's **management default gateway** needs a route to the witness subnet,
  and the witness site's gateway routes back to both AZ management subnets — all
  within the **witness RTT budget** (≤200 ms; see the table above).
- vSAN witness traffic is **unicast** on modern vSAN — no multicast on the routed
  path. Ensure the required vSAN ports are permitted end-to-end.

**Deploying the witness appliance — field-verified gotchas.**

- **Don't deploy the OVA via the ESXi Host Client** — it fails at step 1 with
  `Invalid qualifier: ValueMap{"Management", "Secondary"}`. The witness OVA
  carries a deployment-option section (Tiny/Medium/Large) and network properties
  with ValueMap qualifiers, and standalone-host deploys don't support OVF
  properties (the Host Client rejects the qualifier). This bites exactly at the
  witness site, where there is often a lone host without vCenter. Working paths:
  deploy **through any vCenter** that reaches the witness host, or use
  [`ovftool`](https://williamlam.com/2013/08/flexible-ovf-deployments-using.html)
  (`--deploymentOption`, `--prop:`) /
  [`govc`](https://williamlam.com/2016/04/slick-way-of-deploying-ovfova-directly-to-esxi-vcenter-server-using-govc-cli.html)
  against the host directly.
- **Verify the VMkernel gateways after the deploy — whatever the method.** Even
  on the vCenter path with the OVF properties filled, the 9.1 witness OVA came
  up with wrong management and witness/vSAN VMkernel gateways and they had to be
  fixed by hand (DCUI / Host Client on the nested witness ESXi: per-VMkernel
  gateway override, or static routes). Check them before wiring the witness into
  the stretch — the witness must route back to **both** AZ management subnets
  (the routing requirement above).

---

## C. AZ1 ↔ AZ2 fabric

| Item                          | Requirement                                                        |
| ----------------------------- | ------------------------------------------------------------------ |
| RTT AZ1↔AZ2                    | **<5 ms** RTT — hard limit for vSAN data                          |
| Bandwidth AZ1↔AZ2             | **≥10 Gbps** (the VCF design-library figure — see the note under D); the actual need is driven by the write bandwidth being mirrored (VMs replicated between sites). Size against the [vSAN Stretched Cluster Bandwidth Sizing guide](https://www.vmware.com/docs/vmw-vsan-stretched-cluster-bandwidth-sizing) (witness leg: ~2 Mbps per 1000 components; see also TechDocs [Bandwidth and Latency Requirements](https://techdocs.broadcom.com/us/en/vmware-cis/vsan/vsan/8-0/vsan-network-design/understanding-vsan-networking/network-requirements-for-vsan/bandwidth-and-latency-requirements.html)) and plan for **resync** bursts |
| L2 + HA L3 gateway             | Stretched L2 segments (see D) plus a **highly-available Layer 3 gateway** between AZs, provided by the physical fabric |
| MTU across the inter-AZ link   | **9000** end-to-end for vSAN / vMotion / overlay                   |
| Fault domains                  | `sfo01` = preferred, `sfo02` = secondary, `sfo-wit` = witness (3rd)|
| Link redundancy                | No single-path between AZs (dark fibre pair / diverse DWDM)         |

---

## D. Networking — what stretches vs. what stays per-AZ

This extends the VLAN/subnet table in `01-network-dns-plan.md`. In a stretched
build each traffic type is **either** stretched L2 (same subnet visible in both
AZs, for anything that must fail over) **or** per-AZ (a distinct subnet in AZ2,
routed).

The table below is written for the **management domain**, but the per-AZ rows
apply to **any stretched cluster** — a **workload-domain cluster can also be
stretched** (once the management domain is). For each stretched WLD, repeat the
per-AZ analysis for its own vMotion / vSAN / host-TEP networks. The **VM
Management (stretched)** row is management-domain-specific: a WLD's tenant
workloads ride NSX overlay segments, and a WLD that runs its own edges repeats
the Edge Overlay / Uplink rows.

| Traffic                  | Stretched L2? | AZ1 subnet | AZ2 subnet | Notes                                             |
| ------------------------ | ------------- | ---------- | ---------- | ------------------------------------------------- |
| ESX Management           | Per-AZ        | `/24`      | `/24`      | Own gateway per AZ                                |
| VM Management            | **Stretched** | `/24`      | (same)     | Mgmt VMs fail over between AZs → must be L2       |
| vMotion                  | Per-AZ        | `/24`      | `/24`      | Jumbo; routed between AZs                          |
| vSAN                     | Per-AZ        | `/24`      | `/24`      | Jumbo; routed AZ1↔AZ2 and to witness              |
| ESX Host Overlay (TEP)   | Per-AZ        | `/24`      | `/24`      | Jumbo; **per-AZ TEP subnets** — common gotcha     |
| NSX Edge Overlay (TEP)   | Stretched\*   | `/24`      | (same)     | Edges fail over → stretched **(Centralized only)** |
| NSX Edge Uplink-01       | Stretched\*   | `/29–/30`  | (same)     | BGP peer; stretched **(Centralized only)**         |
| NSX Edge Uplink-02       | Stretched\*   | `/29–/30`  | (same)     | BGP peer; stretched **(Centralized only)**         |
| Witness traffic          | Routed to 3rd | —          | —          | Rides the **ESX Management** VMK (WTS) → witness site (≤200 ms); no dedicated witness VLAN |

> **\*** Edge Overlay + Uplinks are stretched **only with NSX Centralized
> connectivity** (intake `A10`). With **Distributed** connectivity each AZ has
> its own local transit gateway / edges, so Edge Overlay + Uplinks are **per-AZ**.
> Consistent with `prerequisites.md`.

> **Edge cluster before or after the stretch — both are supported.** Stretching
> a cluster that already hosts an Edge cluster is a first-class path: the
> stretch spec's `isEdgeClusterConfiguredForMultiAZ` field *"should be set to
> 'true' if the cluster hosts an NSX Edge cluster"*. Deploying an Edge cluster
> onto an **already-stretched** cluster is equally supported (*"VMware Cloud
> Foundation 4.5 and later support deploying an NSX Edge cluster on a vSphere
> cluster that is stretched"*) — new edge nodes are placed on **AZ1** hosts.
> The stretched Edge Overlay + Uplink rows above are required either way; only
> the order is a design choice (the deployment plan defaults to edges first —
> see `06-deployment-plan.md` E6/E7).

> Confirmed against the Broadcom VCF 9 design library — *vSphere Stretched
> Cluster Model* ([techdocs.broadcom.com](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/design/design-library/cluster-models/single-instance-multiple-availability-zones.html)):
> VM Management is *"shared across availability zones"* (stretched); ESX
> Management, vMotion, vSAN, and Host TEP are each *"unique per availability
> zone"* (per-AZ, own gateway). There is no option to stretch ESX Management.
> The AZ1↔AZ2 link is specified as **<5 ms RTT and ≥10 Gbps** — the vSAN
> stretched-cluster limit, not the looser 10 ms generic-AZ figure.

North-south / public peering: the **NSX Edge Uplink BGP sessions** (the two rows
above, captured in the `01` BGP plan and intake `B10`–`B16`) **are** the
north-south / public peering — there is no separate "public peering" item unless
you run a distinct public / DMZ transit (intake `B22`). Decide which AZ owns
**ingress** in steady state and how routes withdraw on an AZ failure (BGP
local-pref / AS-path prepend toward the non-preferred AZ). Capture this alongside
section B of the BGP plan.

> **Public peering is normally a workload-domain concern, not management.** The
> management domain's Edge uplinks peer with the **internal ToR fabric** for
> management routing — not a public network. **Public / upstream / DMZ peering**
> (internet-facing or published routes) normally lives on the **workload-domain**
> edges, where tenant workloads need external reachability. It applies to the
> management domain only if your design deliberately routes a published service
> through the mgmt edges. In multi-AZ, whichever domain hosts the public peering
> must survive an AZ loss the same way: **stretched** under Centralized or
> **per-AZ** under Distributed, with the surviving AZ advertising the public
> prefixes and the failed AZ withdrawing them.

---

## E. Storage policy & capacity

| Item                         | Setting / implication                                              |
| ---------------------------- | ------------------------------------------------------------------ |
| Site disaster tolerance      | **Dual site mirroring** (data copy in each AZ) = PFTT 1            |
| Local protection (per site)  | SFTT — RAID-1 FTT=1, or RAID-5/6 if host count allows              |
| Raw capacity                 | **~2× usable** (full copy per AZ) **+** local FTT overhead         |
| Host count                   | Even, matched per AZ; enough per AZ to satisfy the local RAID rule |
| Witness capacity             | Metadata only — no usable capacity contribution                    |

Worked example: 20 TB usable with dual-site mirror + local RAID-1 (FTT=1) needs
~20 TB in **each** AZ before local mirroring, then local FTT roughly doubles
that again per AZ. Size hosts for this up front — it is the #1 stretched
surprise. Confirm against the *Management Domain Sizing* sheet.

---

## F. DNS / NTP additions

On top of the records in `01-network-dns-plan.md`:

- [ ] A + PTR for the witness appliance (`sfo-wit01.sfo.example.io`)
- [ ] AZ2 hosts have A + PTR in their AZ2 subnets
- [ ] NTP reachable from **all three** sites (AZ1, AZ2, witness)
- [ ] Prefer independent time sources per site (different fault domains — see
      `prerequisites.md`)
- [ ] DNS resolvers reachable from the witness site

---

## G. Ownership matrix

| Area                                   | Owner        | Sign-off |
| -------------------------------------- | ------------ | -------- |
| Inter-AZ RTT/bandwidth (C)             | Network      |          |
| AZ↔witness RTT + witness placement (B) | Network + Architect |   |
| Stretched vs per-AZ subnets (D)        | Network      |          |
| North-south egress / BGP failover (D)  | Network      |          |
| Storage policy + per-AZ capacity (E)   | Storage + Architect |   |
| Witness OVA download + deploy (B)      | Platform     |          |
| DNS/NTP for AZ2 + witness (F)          | AD/DNS/NTP   |          |

---

## Sign-off

Once A–G are filled and signed by the owners above, feed the results back into
the single-AZ planning docs:

- AZ2 + witness subnets → the VLAN/subnet table in `01-network-dns-plan.md`
- Witness + AZ2 host FQDNs → the DNS section of `01-network-dns-plan.md`
- Stretched answer + host counts → intake `A13`/`A14` in `02-intake.md`

Then continue with the normal workbook fill. A stretched build that clears this
page will not surprise you at bring-up.
