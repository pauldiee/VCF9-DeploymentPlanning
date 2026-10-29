# Step 1 — Network / DNS / NTP / AD Plan (one page)

Lock this **before** filling any other workbook page. If you only have time
for one meeting with the network + AD/PKI teams, run it on this
page. Everything in the workbook flows from these decisions.

> **Prefer a spreadsheet?** Download the blank [fillable planning templates](https://vcf-planning.hollebollevsan.nl/docs/prerequisites/#fillable-planning-templates-download)
> (IP/DNS, VLAN/subnet, NTP/AD/CA, BGP) — capture the plan in CSV, then transfer to the workbook or Coscia's planner.
> For the firewall flows these networks depend on, see [Firewall & Ports](07-firewall-ports.md).
> To see this page filled in, read the [Rainpole worked example](https://vcf-planning.hollebollevsan.nl/samples/01-network-dns-plan-rainpole/).

> **Want a generated starting point?** [Coscia's VCF 9.1 Network Planner](https://vcfplanner.lcoscia.fr/)
> produces a complete starter network design — VLAN plan, appliance IPs + FQDNs, VIPs, with
> validation and XLSX/JSON export — from a handful of inputs (scenario, host count, storage,
> NSX config, DNS prefix/suffix). Generate there, then walk it through this page: the sizing
> minimums, the VM-Management carve-out, and the hand-off order (network team owns the
> subnets, you assign from them) still need a human decision per row.

> Convention used in the templates below: site code `sfo`, instance `m01`,
> rack `r01`. Replace consistently when copying for a real deployment. VLAN IDs
> and CIDRs are placeholders.

---

## A. VLAN / Subnet plan

Fill one row per traffic type. The same table covers Mgmt Domain *and* the
first WLD — duplicate it for additional WLDs / clusters.

| # | Traffic                        | VLAN ID | CIDR (IPv4)       | CIDR (IPv6, optional) | MTU  | Gateway          | Notes                                          |
| - | ------------------------------ | ------- | ----------------- | --------------------- | ---- | ---------------- | ---------------------------------------------- |
| 1 | ESX Management                 |         | `/24`             |                       | 1500 |                  | ESXi host mgmt VMKs. The VCF Installer must be able to **reach / route to** this network to commission the hosts (it does not live here) |
| 2 | VM Management                  |         | `/24`             |                       | 1500 |                  | Largest subnet — appliances + two reserved blocks; see carve-out below. The **VCF Installer** deploys here using the **SDDC Manager IP + FQDN** — see note below |
| 3 | VCF Management (optional)      |         | `/24`             |                       | 1500 |                  | Only if separating VCF services from VM-mgmt   |
| 4 | vMotion                        |         | `/24`             |                       | 9000 |                  | Jumbo required                                 |
| 5 | vSAN                           |         | `/24`             |                       | 9000 |                  | Jumbo required; skip if NFS/FC only            |
| 6 | ESX Host Overlay (TEP)         |         | `/24`             |                       | 9000 |                  | Jumbo; MTU inherited from the vDS; **static TEP pool recommended** (DHCP scope supported) |
| 7 | NSX Edge Overlay (TEP)         |         | `/24`             |                       | 9000 |                  | Jumbo                                          |
| 8 | NSX Edge Uplink-01             |         | `/29` or `/30`    |                       | 9000 |                  | Point-to-point to ToR-A; BGP peer              |
| 9 | NSX Edge Uplink-02             |         | `/29` or `/30`    |                       | 9000 |                  | Point-to-point to ToR-B; BGP peer              |
| 10| NFS (optional)                 |         | `/24`             |                       | 9000 |                  | Only if principal storage = NFS                |
| 11| Transit Gateway external (Distributed only)|  | `/24`         |                       | 9000 |                  | External / north-south network for the **Distributed** Transit Gateway (DTGW): the VLAN + **gateway CIDR** every ESX host attaches to, replacing the Edge uplinks (rows 8–9). Only when connectivity = **Distributed** (intake `A10` / `H4`). Also plan the routable **external IP block** (north-south NAT / VIPs) advertised upstream — see §B |
| 12| Public / upstream peering uplink (optional)| | `/29` or `/30`  |                       | 9000 |                  | Point-to-point to a public / upstream / DMZ router, **separate** from the ToR fabric. Only if you run a distinct public peering (intake `B22`); BGP session details in §B. Most fleets don't need this |

> **Overlay MTU:** host and edge TEP networks carry GENEVE and need MTU **≥ 1600**;
> set 9000 on the distributed switch. The host-overlay VMK inherits its MTU from
> the vDS rather than a per-network field.

> **VCF Installer = SDDC Manager identity.** When you deploy the VCF Installer on
> one of the management-domain ESX hosts (the usual greenfield case), you give it
> the **IP and FQDN you plan for SDDC Manager** — the appliance *switches into
> SDDC Manager mode* after bring-up, so there is **no throwaway / temporary IP**.
> Reserve that single IP + FQDN as SDDC Manager (intake `E7`); the Installer just
> needs routed reachability to the **ESX Management** network to commission the
> hosts. (Only an Installer deployed *outside* the management infrastructure uses
> a separate temporary address.) Per
> [Broadcom TechDocs](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/deploy-the-vmware-cloud-foundation-installer-appliance.html).
>
> **Port group VLAN gotcha:** on the host you deploy it on, place the Installer on
> a port group carrying the **VM Management VLAN**. A fresh ESXi host's default
> `VM Network` port group is **untagged (VLAN 0)**, so if VM Management is a tagged
> VLAN, set the VLAN ID on it (or use a tagged port group) first — otherwise the
> appliance comes up with no management connectivity.

### IP range carve-out (per subnet)

Inside each `/24` reserve contiguous ranges so static pools / DHCP scopes don't
collide with appliance IPs.

**Host-facing subnets** — one IP per host VMK, sized here for up to 16 mgmt
hosts:

| Subnet       | Reserved for            | Range example              |
| ------------ | ----------------------- | -------------------------- |
| ESX Mgmt     | Host mgmt VMK           | `.11–.30`                  |
| vMotion      | Host vMotion VMK        | `.101–.116`                |
| vSAN         | Host vSAN VMK           | `.101–.116`                |
| ESX Overlay  | Host TEPs (×2 per host) | Static pool (recommended), e.g. `.101–.132`; DHCP scope supported |
| Edge Overlay | Edge TEPs (×2 per edge node) | IP Pool (start–end) **or** per-node static list — size **2 × edge nodes**, e.g. `.11–.14` for a 2-edge cluster (no DHCP option) |

> **TEP addressing:** prefer a **static IP pool**, entered in the VCF Installer —
> no external DHCP dependency, and no per-AZ scopes in stretched designs. Per
> [Broadcom TechDocs](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/building-your-private-cloud-infrastructure/working-with-workload-domains/deploy-a-vi-workload-domain-using-the-sddc-manager-ui.html)
> either a static IP pool or a DHCP server on the Host Overlay VLAN satisfies
> the prerequisite; pools can also be created per cluster later
> ([Create an IP Pool for Tunnel Endpoint IP Addresses](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/advanced-network-management/transport-zones-and-transport-nodes/create-an-ip-pool-for-tunnel-endpoint-ip-addresses.html)).

**VM Management subnet — the crowded one.** A VCF 9.1 management domain packs a
lot onto this network: ~32–50 IPs. Size it generously (a `/24` is normal — do
**not** try to squeeze it into a `/27`). On top of discrete appliance IPs it
needs **two dedicated contiguous blocks**: a `/29` for VCF Automation and a
`/28`–`/27` for the VCF management-services runtime. Each additional VI Workload
Domain also lands its **vCenter (1) + NSX Manager cluster (4)** on *this* subnet
— **+5 IPs per WLD** — so leave headroom. The full per-component FQDN/IP list is
on TechDocs: [VCF Components FQDNs and IP addresses](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/vcf-components-fqdns-and-ip-addresses.html).

| Component                       | IPs        | Block       | Notes                                                                     |
| ------------------------------- | ---------- | ----------- | ------------------------------------------------------------------------- |
| vCenter                         | 1          |             | Management domain vCenter                                                 |
| NSX Manager                     | 4          |             | 3 cluster nodes + 1 cluster VIP                                           |
| SDDC Manager                    | 1          |             |                                                                           |
| VCF Operations                  | 5          |             | 3 analytics nodes (primary / replica / data) + cloud proxy + license server |
| VCF Operations VIP              | 1          |             | Optional: external load balancer for an HA deployment                     |
| NSX Edge nodes (if deployed)    | 2          |             | **Centralized connectivity only** — mgmt-domain edge cluster; matches `en01`/`en02` in the DNS table below |
| Virtual Network Appliances (VNA)| 2          |             | **Distributed connectivity only** (the alternative to the Edge nodes above — a domain has one or the other). 2 appliances minimum for HA, each with an FQDN + static IP; matches `vna01`/`vna02` in the DNS table below. Intake `H4` / `A10` |
| VCF Automation nodes            | 5          | `/29`       | **3 node IPs + 2 buffer** for automatic redeploy of failed nodes / rolling updates (TechDocs). Allocate a **contiguous `/29`** — that is what the *Add VCF Automation* wizard's **VCF services runtime nodes CIDR** field takes (field-verified on `9.1.0.0200`). A relaxed, non-contiguous option exists **on the upgrade path only** — see the callout below before assuming it applies here. **IP-only — no DNS records**. Must **not overlap** the management-services runtime block below |
| VCF Automation FQDN             | 1          |             | Discrete IP **outside** the `/29` above — the wizard: *"VCF Automation FQDN and VCF services runtime FQDN must resolve to IP addresses that fall outside of the provided CIDR"* |
| VCF Automation services runtime | 1          |             | Automation's **own** services runtime — a second FQDN, also on a discrete IP **outside** the `/29`. **Not** the same component as the fleet runtime below; TechDocs lists *"VCF services runtime — 1 FQDN"* under **both**. Intake `E10` |
| VCF management-services runtime | 12–30      | `/28`–`/27` | Dedicated contiguous block: `/28` = 12 (minimum), `/27` = 30 (recommended) — the headroom absorbs Day-N **Log Management** and **real-time metrics** worker nodes (rows below). **No FQDN resolves into this block**: its own FQDN (intake `E14`) and every other component FQDN get a discrete IP outside it, see the *VCF Management Services FQDNs* row |
| Avi Controller cluster (optional)| 4 **per NSX instance** |  | 3 controller nodes + cluster VIP — **reserve four, type three**: the wizard takes the node IPs but **not the VIP address**, which it reaches via the **cluster FQDN**. That record must therefore **already resolve before the deploy**, so raise it with the Step 1 DNS request. Only if Avi is the chosen LB (e.g. Supervisor LB choice / optionally fronting VCF Automation / tenant LB). Controllers **always** run here in the management domain, even when they serve a workload domain, and a set is scoped to the **NSX instance** — WLDs sharing an NSX instance share one set; a WLD with its own NSX adds another **+4**. (Service Engines are separate: per cluster, in the WLD.) See `prerequisites.md` |
| License Hub (optional)          | **2.0: 3** (+**2 FQDNs**) — **5.1.2: ~9** (+**3 FQDNs**) | | Figure depends on version — confirm which one applies before sizing. **2.0** (current, standalone OVA): 1 appliance IP + a 2-address Kafka pool, contiguous; **Appliance FQDN** (own IP) + **Kafka FQDN** → the pool's **2nd** IP (field-confirmed). Also needs a dedicated **non-routable internal cluster CIDR**, ≥512 addresses — see the callout below, not this routed subnet. **5.1.2** (SSP Installer + `.tar` flow): three FQDNs — the installer's own, plus an **Instance FQDN** → 1st service-pool IP and a **Messaging FQDN** → 2nd service-pool IP; two IP pools, **installer 1 + node 4 + service 4**, contiguous. Either version: **A + PTR** for each FQDN, pool ranges fixed **before** requesting records; pools/FQDNs/storage policy are **immutable after deployment**. Only if **vDefend** is in scope, or **Avi on on-prem licensing** (Avi on Cloud Licensing needs no hub) — and **not** the `License Server` two rows up (they coexist). See `15-license-hub.md` |
| VCF Operations for Networks (optional) | 2 (+2 if Large) |  | Platform node + collector node — lands here when the Day-2 placement is the **Shared Management Network** (a **Large** platform is a 3-node cluster: +2). **IP-only *to deploy*: the wizard has no FQDN field — but the FQDN becomes mandatory at certificate replacement** (`DNS/FQDN SAN` is a required field on the CSR, and a Large 3-node platform needs every node's). Plan the A/PTR records here rather than discovering it at the certificate pass (`05-day2-deployments.md` B.2) |
| Log Management (optional)       | 1 + (from runtime block) | | Day-N: **worker nodes:** **6 IPs, plus 1 per Small or Medium replica and 2 per Large replica** ([Log Management Detailed Design](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/vcf-operations-design/vcf-operations-for-logs-deployment-models.html)), plus 1 per extra ingestion VIP. These are **allocated from the services-runtime block above**, not extra subnet IPs; size the block `/27` if Log Management is planned. **The VIP itself is different:** its FQDN resolves to **one discrete IP outside the runtime block** (the integrated load balancer answers on it). The deploy wizard has no IP field, only the FQDN, which *"should not point to any IP addresses already assigned to VCF services runtime nodes"* ([Deploy Log Management](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/manual-deployment-of-components-to-complete-your-vcf-platform/installing-vcf-logs.html)). Each extra ingestion VIP likewise gets its own FQDN + IP outside the block. **Replica IPs, two sources disagree:** the design page above (Last Updated 2026-10-19) says *"1 IP for every small or medium replica and 2 IPs for every large replica"*; [First VCF Instance FQDNs and IP addresses](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/vcf-components-fqdns-and-ip-addresses/first-vcf-instance-fqdns-and-ip-addresses.html) (Last Updated 2026-10-15) says *"6 IP Addresses; 2 IP Addresses for each additional replica"*. The sizer follows the design page (#401); budgeting 2 per replica is the safe side, it is never less. The [Ops & Logs Planning Sizer](https://vcf-planning.hollebollevsan.nl/tools/ops-logs-sizing/) works out the count. See `05-day2-deployments.md` |
| Real-time metrics (optional)    | — (from runtime block) | | Day-N: 6 IPs, **also allocated from the services-runtime block** (TechDocs FQDN/IP list) |
| VCF Management Services FQDNs   | 4          |             | **Fleet components**, **Instance components**, **VCF services runtime** (intake `E14`) and **Identity Broker**: each its own discrete IP **outside** the services-runtime block. TechDocs ([First VCF Instance FQDNs and IP addresses](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/vcf-components-fqdns-and-ip-addresses/first-vcf-instance-fqdns-and-ip-addresses.html), Last Updated 2026-10-15): *"Each FQDN must resolve to a unique, currently unassigned IP address, and those IP addresses must not overlap with any IP ranges already reserved for VCF services runtime nodes or VCF Automation nodes."* The block holds only the Log Management / real-time metrics **worker** IPs |
| **Approx. total**               | **~36–54** |             | A `/24` VM Mgmt subnet leaves ample room (+4 **per NSX instance** if the Avi LB is in scope, +3 if **License Hub 2.0** is too — or +9 for the legacy 5.1.2 flow, +2–4 if Ops for Networks shares this subnet; Log Management / real-time metrics **worker nodes** come out of the runtime block — size it `/27`; +1 here for the Log Management **VIP**, which sits outside that block) |

> **Separate internal networks — keep off the VM Mgmt subnet.** The VCF services
> runtime uses an *internal* container CIDR, `198.18.0.0/15` by default
> (change to `240.0.0.0/15` or `250.0.0.0/15` if it clashes) — and **VCF
> Automation uses the same kind of internal cluster CIDR, with the same default
> and alternatives** (the *cluster CIDR* captured in intake `B21`; see
> `05-day2-deployments.md` section D). **License Hub 2.0** needs one too — its
> own non-routable **Internal Cluster Network** field, ≥512 addresses
> (`/23` or larger), field-confirmed to default to **`10.10.0.0/16`** with the
> product's own guidance to leave it at default unless that block is already
> in use (see `15-license-hub.md`). These are internal to the platform, not
> routed appliance IPs — just make sure the blocks do not overlap anything you
> actually route, or each other. The one documented exception: the services
> runtime and VCF Automation **may share** one block. The full list of internal
> blocks (also the Cloud Proxy Docker subnet, vDefend SSP pods, Supervisor /
> VKS and the NSX transit ranges), with defaults and alternatives, is in
> [`34-internal-cidrs.md`](34-internal-cidrs.md).

---

## B. North-south connectivity plan

Pick **one** model per domain (intake `A10` for the management domain, `H4` per
workload domain) and fill in **only that model's table**:

- **Centralized** — a **Centralized Transit Gateway (CTGW)**: NSX **Edge
  cluster** + **Tier-0**, BGP-peered to the ToRs. Fill in **B.1**.
- **Distributed** — a **Distributed Transit Gateway (DTGW)**: the transit
  gateway maps onto a **VLAN every ESX host attaches to**, no Edge VMs. Fill in
  **B.2**.
- **Distributed VXLAN (EVPN)** — **9.1.1 and later**: the transit gateway
  attaches to an existing **EVPN-VXLAN fabric** through a Route Controller, no
  Edge VMs and no VLAN across the fabric. Fill in **B.3**.

> **"Distributed" is not the same thing as "VPC".** VPCs run on **either**
> transit-gateway type — the choice below is about *how north-south traffic
> leaves the fabric* (Edge VMs vs. straight off the hosts), not about whether
> you use VPCs. Likewise, a **VNA cluster is not a small Edge cluster**: it
> gives a **DTGW stateful services** (NAT/SNAT), and **no Tier-0 or Tier-1 runs
> on it**.

### B.1 BGP plan (**Centralized** connectivity only)

| Item                    | Value | Notes                                              |
| ----------------------- | ----- | -------------------------------------------------- |
| NSX Edge AS (your side) |       | Private ASN, e.g. 65001                            |
| ToR-A AS                |       | Private ASN, e.g. 65010                            |
| ToR-B AS                |       | Same as ToR-A if iBGP within fabric, else distinct |
| ToR-A peer IP (Uplink-01)|      |                                                    |
| ToR-B peer IP (Uplink-02)|      |                                                    |
| BGP MD5 password (optional) |   | **Optional** — only if you enable BGP MD5 authentication; per peer. Not required by NSX (neighbor IP + remote AS are the only required settings) |
| BFD enabled             | Y/N   | Recommended on point-to-points                     |
| ECMP                    | Yes   | Required on Edge↔ToR                               |
| Prefix-list / route-map | TBD   | Often advertise default in / Tier-0 subnets out    |
| Public / upstream peering (optional) | | Separate BGP session for **public / north-south** routes (internet edge, DMZ, or upstream provider), distinct from the internal ToR fabric peering above. If used, capture its peer AS, peer IP, MD5, and advertised/received prefixes — plus a dedicated uplink subnet if it does not share the Edge uplinks. Most fleets don't need this; the ToR uplinks already carry north-south. |

> **Multi-AZ:** whether the Edge uplinks and this peering are **stretched** across
> AZs or **per-AZ** depends on the NSX connectivity model — **stretched** under
> **Centralized**, **per-AZ** under **Distributed** (intake `A10`). See
> `03-multi-az-prep.md` section D.

> TechDocs: the Edge cluster / Tier-0 / BGP peering this plan feeds is set up per
> [Set up Centralized Connectivity with Edge Clusters](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/advanced-network-management/administration-guide/setting-up-network-connectivity/setting-up-centralized-connectivity-with-edge-clusters.html)
> — neighbor IP + remote AS are the only required BGP settings (MD5 and BFD are
> optional).

### B.2 Distributed Transit Gateway plan (**Distributed** connectivity only)

No BGP, no Edge uplinks: the DTGW attaches to **one external VLAN that every ESX
host in the domain can reach**, and the physical gateway on that VLAN routes for
it. Stateful services (NAT/SNAT) come from a **VNA cluster**.

| Item                          | Value | Notes                                                                 |
| ----------------------------- | ----- | --------------------------------------------------------------------- |
| External VLAN ID              |       | The DTGW's external connection — VLAN 11 in the table above. **Every ESX host in the domain must attach to it** |
| External gateway CIDR         |       | The subnet + gateway IP on that VLAN, routed by the physical fabric (the ToR SVI does the routing NSX would otherwise do on a Tier-0) |
| External IP block             |       | **Routable** block for north-south — NAT/SNAT addresses and load-balancer VIPs — advertised upstream by the fabric. Sized for your workloads, not for the appliances |
| Private transit-gateway block |       | Private IPs for the transit-gateway subnets, **not** advertised northbound. **9.1: must be a `/16`** (a `/24` worked in 9.0 and never completes in 9.1) — see `prerequisites.md` → vSphere Supervisor |
| VNA appliance 1 — FQDN + IP   |       | ESX Mgmt subnet; needed only for **stateful services** (NAT/SNAT) on the DTGW |
| VNA appliance 2 — FQDN + IP   |       | **2 nodes minimum for HA** |
| Default outbound NAT          | Y/N   | Enabled on the transit gateway against the VNA cluster + external IP block |

> **Routing is the fabric's job here.** Because there is no Tier-0, the physical
> network must route the external VLAN and advertise the external IP block —
> confirm with the network team that this is in place **before** the domain is
> built, exactly as you would confirm BGP for the Centralized model.

> TechDocs: [Configure Distributed Network Connectivity](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/building-your-private-cloud-infrastructure/managing-network-connectivity-in-vcenter/managing-distributed-network-connectivity.html)
> and [Transit Gateways](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/advanced-network-management/virtual-private-cloud-in-nsx/transit-gateways.html)
> (*"You can also add NAT rules for a DTGW … by creating a virtual network
> appliance (VNA)"*).

### B.3 Distributed VXLAN (EVPN) plan (**VCF 9.1.1 and later**)

The third model: the transit gateway attaches straight to an existing **EVPN-VXLAN
fabric** instead of a VLAN or an Edge cluster. Pick it when the fabric team
already runs EVPN-VXLAN and wants direct VM-to-physical routing with no Edge
nodes. TechDocs: *"Use this type of external connection in environments with an
existing EVPN-VXLAN fabric that requires direct VM-to-physical-network routing
without edge nodes."* ([Managing External Connections in VCF Automation][evpn-vcfa]).

> **Status.** The 9.1.1 NSX release notes list EVPN-VXLAN distributed
> connectivity, its advanced networking services, Active/Active Route Controllers
> and Direct Prefix Routing under *What's New*, without a technical-preview label
> (I searched the page for "technical preview": no hit; pages *Last Updated
> October 26, 2026*, read 2026-10-29). That is the absence of a label, not a
> statement of support level; confirm with Broadcom if the design depends on it.
> **Neither pinned planning workbook has EVPN fields**, so there is nothing to
> transfer: this table is the hand-off to the fabric and NSX teams (intake `B23`).

**What it is.** A **Route Controller** (a two-node NSX cluster) is the common
control plane: it peers over MP-BGP with the **EVPN gateways** (border gateways,
BGWs) of the physical fabric, while forwarding stays on the ESX hosts, whose TEP
VMkernel interface *"can handle both Geneve and VXLAN traffic simultaneously"*.
Each distributed VXLAN transit gateway maps **one-to-one** to a **Layer 3 VNI**
(L3VNI) in the fabric, which is the tenant's VRF ([Distributed VXLAN
Connectivity][evpn-dvx]).

| Item | Value | Notes |
| ---- | ----- | ----- |
| Route Controller HA mode | Active/Standby, or Active/Active | **Active/Standby** (default): both nodes on the same VLAN/subnet, one **BGP floating IP**, only the active node peers. **Active/Active** (9.1.1+): no floating IP, each node peers from its own interface IP, minimum 2 and up to 8 nodes, each node may be on a different VLAN, and *"BGW must be manually configured with separate BGP neighbors for each Route Controller node"* |
| Route Controller nodes | 1 or 2 (lab: 1) | *"Unless you are configuring a lab environment, deploy two nodes"* for high availability Form factor **Small** = PoC and lab only; **Medium** = production |
| Per node: FQDN, management IP | | A port group reachable from NSX Manager. Add the FQDNs to the DNS table in section C |
| Per node: BGP interface IP/mask, port group, MTU | | Active/Standby: all interfaces in one subnet plus the floating IP in that subnet |
| Local AS (Route Controller side) | | Unique AS number for the Route Controller |
| EVPN gateway: remote AS, neighbor IP | | Per BGP peer. Optional: **gateway IP** (multihop), **max hop limit**, **BGP password**; ECMP, multipath relax and BFD are settings on the session |
| Reachability | | The ESX NSX overlay VMkernel adapter must reach the **TEP addresses of the EVPN gateway**; the **Route Controller VIP** must be reachable from the BGW routers |
| Per tenant (organization / transit gateway): **L3 VNI** | | Must match the L3VNI on the physical gateway for that tenant |
| Per tenant: **Route Distinguisher** | | Unique per distributed VXLAN connection |
| Per tenant: **import / export Route Target** | | Your import RT must match the gateway's **export** RT, and your export RT its **import** RT |
| Summarisation on the EVPN gateway | Y/N | The Route Controller advertises a **/32 per workload** (EVPN type 5); *"You can summarize these routes at the EVPN gateway"* |
| Default route toward the hosts | | From 9.1.1 the Route Controller *"no longer advertises a default route to the ESX"*: the **BGW must originate it** if hosts need one |
| Direct Prefix Routing (9.1.1) | Y/N | Optional, per external connection: a direct VXLAN tunnel from the ESXi VTEP to the physical leaf VTEP so latency-sensitive storage traffic (NFS, S3/object) bypasses the EVPN gateway |
| Services on top (9.1.1) | NAT / LB / DHCP relay | Needs a **VNA cluster** (see B.2), all host transport nodes on **ESX 9.1.1.0 or later**, and the `host_tn_min_os_version` opt-in through the NSX API |

> **Services and what they need.** TechDocs lists, for 9.1.1 and later: NAT
> (including default outbound SNAT), the NSX native load balancer, **Avi in
> active/standby and active/active L2 scale-out modes**, the distributed DHCP
> server and **DHCP relay to external servers**. Avi needs **32.1.3 or later** for
> this model ([Avi external connectivity][evpn-avi]); DHCP relay works for **public
> VPC subnets only**; vSphere Kubernetes Service needs a load balancer. EVPN
> connectivity is supported for VCF Automation and vSphere Supervisor.

> **Constraints.**
> - *"An organization can use only one connection type per region — centralized,
>   distributed VLAN, or - for version 9.1.1 only - distributed VXLAN. Mixing
>   connection types within a single region is not supported."*
> - The connection is created in the **VCF Automation Provider Management UI**
>   (*Infrastructure → Networking → External Connections → Distributed VXLAN
>   Connections*); the Route Controller and the VNA cluster are built in **NSX
>   Manager** (*Networking → EVPN → Route Controller*; *System → Fabric → VNA
>   Clusters*).
> - **Not found in the pages read:** Route Controller node sizes in vCPU/RAM, and
>   the firewall ports for the BGP sessions. Check the Ports & Protocols tool
>   ([`07-firewall-ports.md`](07-firewall-ports.md)) before the network team signs off.

[evpn-dvx]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/advanced-network-management/ethernet-vpn-evpn/distributed-vxlan-connection.html
[evpn-vcfa]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/provider-management/managing-networking-resources/managing-provider-gateways.html
[evpn-avi]: https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/avi-load-balancer/avi-load-balancer-vmware-cloud-foundation/9-1/configure-and-consume-avi/managing-network-topologies.html

> TechDocs: [Create a Route Controller](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/advanced-network-management/ethernet-vpn-evpn/distributed-vxlan-connection/create-a-route-controller.html),
> [Create a New Distributed VXLAN Connection](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/provider-management/managing-networking-resources/managing-provider-gateways/create-a-new-distributed-vxlan-connection.html),
> [Enable Advanced Networking Services for Distributed VXLAN Connections](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/advanced-network-management/ethernet-vpn-evpn/distributed-vxlan-connection/enable-advanced-networking-services-for-distributed-vxlan-connections.html)
> and the [NSX 9.1.1.0 release notes](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/release-notes/vmware-cloud-foundation-9-1-1-0-release-notes/nsx-9-1-1-0-release-notes.html).

---

## C. DNS

### Two DNS servers (resolver IPs to put into appliances)

Two is not just the recommendation — the VCF Installer's *General Information*
screen accepts a **maximum of 2 DNS servers** at bring-up. If you run more,
pick the two the VCF appliances will use.

| #   | FQDN / hostname           | IPv4         |
| --- | ------------------------- | ------------ |
| 1   |                           |              |
| 2   |                           |              |

### Required A + PTR records (Mgmt Domain — minimum)

Every FQDN below needs **both** an A and a PTR. Add WLD/cluster hosts in the
same shape.

> **Lowercase only.** The TechDocs [FQDN/IP list](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/vcf-components-fqdns-and-ip-addresses.html)
> marks the fleet-services family with *"Do not use capital letters in the
> FQDN"*: **VCF Automation, VCF services runtime, fleet components, instance
> components, Identity Broker, Log Management, real-time metrics**. DNS itself
> is case-insensitive but the appliances are not always — the practical rule:
> create **every** VCF FQDN lowercase.

> **No `.local` domain for the fleet-services family.** `.local` is reserved for
> multicast DNS (RFC 6762), and VCF 9.x is tightening up on it. Settle this
> **before** you request any records, because a `.local` AD/DNS domain is the
> kind of thing you only find out about at the deploy wizard.
>
> - **TechDocs 9.1** — [*Deploy VCF Management Services and License Server for vSphere Foundation*](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/upgrading-your-vsphere-foundation-to-9-1/install-vcf-management-services-to-vsphere-foundation-environment.html),
>   verbatim: *"the FQDN validation relies on RFC1034 and RFC1123, and only top
>   level domains of the internet are validated. The .local domain is not
>   supported"*. The **fleet components**, **instance components** and **VCF
>   services runtime** FQDN fields each add *"Do not use a .local FQDN."*
> - **Broadcom VCF blog, 2026-04-17** — [*Bridging the (.Local) Gap: A Split-Domain Design for VMware Cloud Foundation Deployment*](https://blogs.vmware.com/cloud-foundation/2026/04/17/bridging-the-local-gap-a-split-domain-design-for-vmware-cloud-foundation-deployment/):
>   **VCF Identity Broker, VCF Automation and vSphere Supervisor** no longer
>   accept `.local`; **VCF Operations, vCenter, NSX and SDDC Manager** still
>   do, *"for now"*.
>
> Put together, the management services, Identity Broker, VCF Automation and
> the Supervisor need FQDNs in a real, Internet-style top-level domain
> (`sfo.example.io`, or an internal zone such as `vcf.internal`). Neither source
> names Log Management or real-time metrics, but they run on the same services
> runtime, so plan them the same way. The older
> appliances can stay on `.local` for now, but treat that as a transition state,
> not a design choice.
>
> **If the existing domain is `.local` and renaming it isn't realistic**, the
> blog's **split-domain design** is the way out:
>
> 1. Leave vCenter, NSX, VCF Operations and SDDC Manager on the `.local` zone.
> 2. Create a new RFC-compliant DNS zone and give the Identity Broker, VCF
>    Automation, the Supervisor and the services-runtime components their FQDNs
>    in it.
> 3. Make sure the DNS servers the appliances use resolve **both** zones. The
>    blog gives two ways to link them: a **two-way forest trust** between the
>    two domains, or **separate domains with DNS forwarding** between them.
> 4. Put **both** domains in the DNS **search domain** list of the components
>    you deploy (the blog's example: VKS has to find the `.local` vCenter it
>    depends on).
> 5. Configure the identity provider so it recognises users from **both**
>    domains.
>
> The blog says this design was validated on **VCF 9.0**. On 9.1, check the
> current TechDocs before you rely on it.

> **Two "VCF services runtime" FQDNs — not one.** The TechDocs FQDN/IP list
> carries the row *"VCF services runtime — 1 FQDN"* **twice**: once under **VCF
> Automation** and once under **VCF Management Services**. The workbook repeats
> the same field label the same way. They are **separate components with
> separate FQDNs** — the fleet one resolves into the management-services runtime
> block; the Automation one gets a discrete VM Mgmt IP. Plan and create **both**
> A + PTR records; see intake `E10` (Automation) and `E14` (fleet).

> **Both Automation FQDNs go *outside* the `/29`.** The *Add VCF Automation*
> wizard takes the `/29` as its **VCF services runtime nodes CIDR** and warns:
> *"VCF Automation FQDN and VCF services runtime FQDN must resolve to IP
> addresses that fall outside of the provided CIDR."* So the `/29` is for the
> **nodes only** (IP-only, no DNS records) and the two Automation FQDNs each
> need their **own discrete VM Mgmt IP** on top of it — budget **`/29` + 2**.
>
> **Contiguity: plan a `/29`. The relaxed option is documented for the *upgrade*
> path only.** The one place Broadcom states a version split is
> [Perform the Upgrade to VCF Automation 9.1](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/upgrading-cloud-foundation/phase-3-import-and-upgrade-aria-automation-8-to-vcf-automation-9/upgrade-to-vcf-automation.html)
> — an **upgrade** page. Verbatim: for `9.1.0.0`–`9.1.0.300`, *"verify that you
> have a dedicated CIDR for use by the VCF services runtime instance that hosts
> the VCF Automation nodes"*; for **`9.1.0.400` and later**, *"verify that you
> have dedicated 5 unique IP addresses"*, and *"The IP addresses can be
> contiguous or non-contiguous."* The **field is renamed** across that boundary —
> *VCF services runtime nodes **CIDR*** (`9.1.0.0`–`9.1.0.300`, takes *"a valid
> CIDR"*) becomes *VCF services runtime nodes **IP pool*** (`9.1.0.400`+, takes
> *"a CIDR or 5 comma-separated individual IP addresses"*).
>
> **None of that is stated for a fresh deployment.** What *is* verified in the
> field: on `9.1.0.0200` the *Add VCF Automation* wizard asks for a **CIDR**. So
> allocate a contiguous `/29` — correct on every version, and the only option
> observed in-product. Do not plan scattered addresses for a new deployment on
> the strength of an upgrade page.
>
> **9.1.1 update (screenshot, not yet field-verified here).** William Lam's
> [VCF 9.1.1 post](https://williamlam.com/2026/10/vcf-9-1-1-new-ui-support-for-deploying-vcf-management-services-vcfms-vcf-automation-vcfa-on-non-management-networks.html)
> (2026-10-19) shows the Day-N *Add VCF Automation* → Parameters page with the
> renamed field *VCF services runtime nodes **IP pool*** and a **CIDR / Individual
> IPs** choice (plus *Exclude IP addresses*), hinting *"Minimum 5 IPs are
> required"*. So on 9.1.1 a fresh Day-N deployment can take 5 individual
> addresses from the UI too. A contiguous `/29` remains the safe plan on every
> version (#425).
>
> **Mind the digits — the real build numbers carry four.** Broadcom's patch
> release notes, the Version Overview and the product itself all use a
> **four-digit** patch component: `9.1.0.0100`, `9.1.0.0200`, **`9.1.0.0400`**.
> The upgrade page quoted above writes three (`9.1.0.300`, `9.1.0.400`) for what
> is evidently the same train. **Use the four-digit form** when checking what a
> fleet is actually running — that is what you will see in the release notes and
> in the UI; treat the three-digit strings as that page's own shorthand.
>
> **And you cannot reach `9.1.0.0400` on Automation today anyway.** Patch trains
> run **per component**: as of **2026-07-22** SDDC Manager, VCF Operations,
> Orchestrator and Log Management are at **`9.1.0.0400`** (released 2026-07-13)
> while **VCF Automation is at `9.1.0.0200`** (build 25556825). So the relaxed
> option is unreachable for Automation regardless of which path you are on —
> check the current per-component versions on the
> [Version Overview](https://vcf-planning.hollebollevsan.nl/version-overview/)
> rather than assuming the fleet moves as one.
>
> **Never reuse the fleet runtime's addressing.** TechDocs: *"The IP addresses
> and FQDN for the VCF services runtime instance for VCF Automation must be
> unique. You cannot reuse the CIDR block and FQDN from the VCF services runtime
> instance for VCF management services."* The two runtime ranges must not
> overlap.

| Role               | Sample FQDN                          | IP source            |
| ------------------ | ------------------------------------ | -------------------- |
| ESXi host 1..N     | `sfo01-m01-r01-esx0N.sfo.example.io` | ESX Mgmt subnet      |
| vCenter            | `sfo-m01-vc01.sfo.example.io`        | VM Mgmt subnet       |
| NSX Manager VIP    | `sfo-m01-nsx01.sfo.example.io`       | VM Mgmt subnet       |
| NSX Manager node 1 | `sfo-m01-nsx01a.sfo.example.io`      | VM Mgmt subnet       |
| NSX Manager node 2 | `sfo-m01-nsx01b.sfo.example.io`      | VM Mgmt subnet       |
| NSX Manager node 3 | `sfo-m01-nsx01c.sfo.example.io`      | VM Mgmt subnet       |
| SDDC Manager       | `sfo-vcf01.sfo.example.io`           | VM Mgmt subnet       |
| VCF Operations LB VIP (optional — external LB only) | `sfo-vcfops01.sfo.example.io` | VM Mgmt subnet — no built-in cluster/floating IP; without an LB use the node FQDNs |
| VCF Operations node 1–3 | `sfo-vcfops01{a,b,c}.sfo.example.io` | VM Mgmt subnet    |
| Cloud Proxy        | `sfo-cp01.sfo.example.io`            | VM Mgmt subnet       |
| License Server     | `sfo-lic01.sfo.example.io`           | VM Mgmt subnet       |
| Identity Broker    | `sfo-idb01.sfo.example.io`           | VM Mgmt subnet — a discrete IP **outside** the services-runtime block (like every FQDN here) |
| Fleet components   | `sfo-fc01.sfo.example.io`            | VM Mgmt subnet       |
| Instance components | `sfo-ic01.sfo.example.io`           | VM Mgmt subnet       |
| VCF services runtime (VCF Management Services) | `sfo-svcs01.sfo.example.io` | VM Mgmt subnet — a discrete IP **outside** the services-runtime block; the **fleet** runtime. Intake `E14` |
| VCF Automation VIP | `sfo-vcfauto01.sfo.example.io`       | VM Mgmt subnet — **outside** the Automation `/29` |
| VCF services runtime (VCF Automation) | `sfo-autosvcs01.sfo.example.io` | VM Mgmt subnet — **outside** the Automation `/29`. Automation's **own** runtime, a **second, separate** FQDN. Intake `E10` |
| NSX Edge 1 (Centralized only) | `sfo-m01-en01.sfo.example.io` | VM Mgmt subnet       |
| NSX Edge 2 (Centralized only) | `sfo-m01-en02.sfo.example.io` | VM Mgmt subnet       |
| Virtual Network Appliance 1 (Distributed only) | `sfo-m01-vna01.sfo.example.io` | ESX Mgmt subnet — the VNA cluster that gives a Distributed Transit Gateway its stateful services (NAT); **not** a replacement for an Edge cluster (no Tier-0/Tier-1 runs on it) |
| Virtual Network Appliance 2 (Distributed only) | `sfo-m01-vna02.sfo.example.io` | ESX Mgmt subnet — 2 nodes minimum for HA |
| Route Controller node 1 (Distributed VXLAN / EVPN only) | `sfo-m01-rc01.sfo.example.io` | A port group reachable from NSX Manager (B.3) |
| Route Controller node 2 (Distributed VXLAN / EVPN only) | `sfo-m01-rc02.sfo.example.io` | Same; two nodes unless it is a lab |
| Avi Controller cluster FQDN (optional) | `sfo-m01-avi01.sfo.example.io` | VM Mgmt subnet — the 3 controller nodes are **IP-only** (no DNS records). **Must resolve BEFORE the deploy** — field-confirmed; the wizard has no VIP-address input and reaches the VIP through this record. Also decide a separate **Cluster Name**, a distinct wizard field from this FQDN |
| License Hub appliance FQDN (optional — 2.0) | `sfo-lichub01.sfo.example.io` | VM Mgmt subnet — deliberately **not** `lic`, which is already the **License Server** stem above; the two are unrelated appliances, see `prerequisites.md` → License Hub |
| License Hub Kafka FQDN (optional — 2.0) | `sfo-lichub01-kafka.sfo.example.io` | Same subnet — resolves to the **second** IP in the Kafka IP pool, field-confirmed; NSX connects to the Kafka broker through this record |
| Supervisor API FQDN (optional — per Supervisor-enabled WLD) | `sfo-w01-super01.sfo.example.io` | WLD mgmt network — points at the control plane's **floating IP** (or the LB VIP); FQDN login is required, see `prerequisites.md` → vSphere Supervisor |
| Log Management VIP (optional) | `sfo-vcflogs01.sfo.example.io` | VM Mgmt subnet — a discrete IP **outside** the services-runtime block; the wizard takes only this FQDN, and the integrated LB answers on its IP. Create A + PTR **before** the deploy. The 6+ worker nodes come from the runtime block and need IPs, not FQDNs |

### DNS settings checklist

- [ ] Forward + reverse zones for the parent domain
- [ ] Forward + reverse zones for any child / site domains (e.g. `sfo.example.io`)
- [ ] Dynamic updates: **Nonsecure and secure**
- [ ] Zone replication scope: **All DNS servers in this forest**
- [ ] Every FQDN unique; every PTR present
- [ ] No CNAME for any VCF appliance hostname (must be A)
- [ ] All FQDNs **lowercase** (required for the fleet-services family; recommended everywhere)
- [ ] **No `.local`** for the fleet-services family, Identity Broker, VCF Automation or the Supervisor. If the existing domain is `.local`, use the split-domain design above: a second RFC-compliant zone, both zones resolvable, both in the search domains

---

## D. NTP

| #    | FQDN                          | Resolves to    | Notes                                       |
| ---- | ----------------------------- | -------------- | ------------------------------------------- |
| A-1  | `ntpserver.sfo.example.io`    |                | A-record, source #1                         |
| A-2  | `ntpserver.sfo.example.io`    |                | A-record, source #2 (same name, round-robin)|
| CN-1 | `ntp.sfo.example.io`          | CNAME → above  | This is what goes in every appliance        |
| A-3  | `ntp0.sfo.example.io`         |                | Optional, direct mgmt of source #1          |
| A-4  | `ntp1.sfo.example.io`         |                | Optional, direct mgmt of source #2          |

- Sources must sync to **different** upstream NTP (avoid common-mode failure).
- AD DCs configured to sync to the same external sources.
- Two NTP entries on every appliance (use the CNAME and a backup A-record).
- The VCF Installer accepts a **maximum of 3 NTP servers** at bring-up.

---

## E. Active Directory

| Item                          | Value                                          |
| ----------------------------- | ---------------------------------------------- |
| AD forest root                | e.g. `example.io`                              |
| Site/child domain             | e.g. `sfo.example.io` (or N/A)                 |
| DC FQDNs                      |                                                |
| LDAPS port reachable          | Y/N                                            |
| Service account for SSO bind  | DN + password owner                            |
| SDDC admin group              | DN                                             |
| SDDC operator group           | DN                                             |
| SDDC viewer group             | DN                                             |
| Users to pre-create           | per *Active Directory Inputs* sheet            |

> TechDocs: AD is bound fleet-wide via the VCF Identity Broker —
> [Configure an Identity Provider](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/fleet-management/what-is/setting-up-sso/cofigure-vmware-cloud-foundation-identity-provider.html);
> prep details + gotchas in [`prerequisites.md`](prerequisites.md#identity-source-for-the-vcf-identity-broker).

---

## F. Certificates

| Item                       | Value                                            |
| -------------------------- | ------------------------------------------------ |
| Internal CA type           | **Microsoft CA** or **OpenSSL** (fleet cert management). External CA is **CSR-based only** — VCF won't import an externally-created cert+key |
| CA root + intermediate CRT | Path / how delivered                             |
| CSR submission method      | Web Enrollment (basic auth) / DCE-RPC / Other    |
| Template name              | e.g. `VMware`                                    |
| Wildcard allowed?          | Y/N (workbook expects per-host SAN certs)        |

> TechDocs: [Configure a Certificate Authority for VMware Cloud Foundation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/fleet-management/certificate-management-9-0/configure-a-certificate-authority_9-0.html)
> — CA prerequisites (Microsoft CA Web Enrollment / OpenSSL) in `prerequisites.md`.

---

## G. SMTP / SFTP / Proxy

| Service       | FQDN / IP                | Port | Notes                                        |
| ------------- | ------------------------ | ---- | -------------------------------------------- |
| SMTP relay    |                          |  25  | Allowlist mgmt subnet                        |
| SFTP backup   |                          |  22  | Account + path for NSX / SDDC Mgr backups    |
| Proxy (opt.)  |                          | 443  | Only if online depot needs proxy             |

---

## Sign-off

Once **A–G** are filled and signed by the network/AD/PKI owners, move on to
`02-intake.md` to capture platform-side answers (hosts, sizing,
passwords). The intake doc references this page rather than asking the same
questions twice.
