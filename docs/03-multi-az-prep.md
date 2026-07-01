# Multi-AZ (Stretched Cluster) Prep — extra layer

Run this **only if intake `A13` = Yes** (Multiple Availability Zones /
stretched). Everything here is **additive** to the single-AZ flow — you still
do `prerequisites.md` → `01-network-dns-plan.md` → `02-customer-intake.md`.
This page captures what a stretched (multi-AZ) management domain adds on top.

A stretched cluster spans two data sites (AZ1, AZ2) plus a **third witness
site**. vSAN mirrors every object across both AZs and uses the witness to break
split-brain. That means three things the single-AZ plan never asks for:
a witness at a third location, a fabric that meets latency/bandwidth limits
between all three, and roughly double the raw capacity.

> Convention on this page: `sfo01` = **AZ1 / preferred** fault domain,
> `sfo02` = **AZ2 / secondary** fault domain, `sfo-wit` = **witness** site.
> Replace consistently. VLAN IDs and CIDRs are placeholders.

---

## A. Decision gate — is stretched actually required?

| # | Question                                                        | Notes                                                        |
| - | --------------------------------------------------------------- | ------------------------------------------------------------ |
|M1 | Two independent data sites available (AZ1, AZ2)?                | Separate power/cooling/fire zone — not two racks in one room |
|M2 | A **third** location for the witness?                           | Can be small; only runs the witness appliance                |
|M3 | Inter-AZ link meets **≤5 ms RTT** and bandwidth (see C)?        | Hard vSAN requirement; confirm with network team in writing  |
|M4 | AZ↔witness link meets **≤200 ms RTT**?                          | Witness tolerates high latency, data sites do not            |
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
| Witness management IP             | Routed to VM-mgmt reachability from SDDC Manager / vCenter      |
| Witness traffic (WTS)             | Separate witness VMK/subnet from vSAN data — recommended        |
| AZ↔witness RTT                    | **≤200 ms**                                                     |
| Witness bandwidth (rule of thumb) | ~2 Mbps per 1000 vSAN components; size from expected object count |
| Witness FQDN                      | A + PTR record, e.g. `sfo-wit01.sfo.example.io`                |
| Witness NTP/DNS                   | Reachable from the witness site (see F)                        |

The witness holds **only metadata (witness components)**, never data. Losing it
does not stop I/O — the preferred AZ (M5) keeps quorum.

---

## C. AZ1 ↔ AZ2 fabric

| Item                          | Requirement                                                        |
| ----------------------------- | ------------------------------------------------------------------ |
| RTT AZ1↔AZ2                    | **≤5 ms** — hard limit for vSAN data                               |
| Bandwidth AZ1↔AZ2             | Size for **resync** worst case; 10 GbE+ typical, workload-dependent |
| MTU across the inter-AZ link   | **9000** end-to-end for vSAN / vMotion / overlay                   |
| Fault domains                  | `sfo01` = preferred, `sfo02` = secondary, `sfo-wit` = witness (3rd)|
| Link redundancy                | No single-path between AZs (dark fibre pair / diverse DWDM)         |

---

## D. Networking — what stretches vs. what stays per-AZ

This extends the VLAN/subnet table in `01-network-dns-plan.md`. In a stretched
build each traffic type is **either** stretched L2 (same subnet visible in both
AZs, for anything that must fail over) **or** per-AZ (a distinct subnet in AZ2,
routed).

| Traffic                  | Stretched L2? | AZ1 subnet | AZ2 subnet | Notes                                             |
| ------------------------ | ------------- | ---------- | ---------- | ------------------------------------------------- |
| ESX Management           | Per-AZ        | `/24`      | `/24`      | Own gateway per AZ                                |
| VM Management            | **Stretched** | `/24`      | (same)     | Mgmt VMs fail over between AZs → must be L2       |
| vMotion                  | Per-AZ        | `/24`      | `/24`      | Jumbo; routed between AZs                          |
| vSAN                     | Per-AZ        | `/24`      | `/24`      | Jumbo; routed AZ1↔AZ2 and to witness              |
| ESX Host Overlay (TEP)   | Per-AZ        | `/24`      | `/24`      | Jumbo; **per-AZ TEP subnets** — common gotcha     |
| NSX Edge Overlay (TEP)   | **Stretched** | `/24`      | (same)     | Edges fail over → stretched                        |
| NSX Edge Uplink-01       | **Stretched** | `/29–/30`  | (same)     | BGP peer; stretched                                |
| NSX Edge Uplink-02       | **Stretched** | `/29–/30`  | (same)     | BGP peer; stretched                                |
| Witness traffic          | Routed to 3rd | —          | —          | AZ data nodes → witness site (≤200 ms)            |

North-south egress: decide which AZ owns **ingress** in steady state and how
routes withdraw on an AZ failure (BGP local-pref / AS-path prepend toward the
non-preferred AZ). Capture this alongside section B of the BGP plan.

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
the single-AZ artifacts:

- AZ2 + witness subnets → the VLAN/subnet table in `01-network-dns-plan.md`
- Witness + AZ2 host FQDNs → the DNS section of `01-network-dns-plan.md`
- Stretched answer + host counts → intake `A13`/`A14` in `02-customer-intake.md`

Then continue with the normal workbook fill. A stretched build that clears this
page will not surprise you at bring-up.
