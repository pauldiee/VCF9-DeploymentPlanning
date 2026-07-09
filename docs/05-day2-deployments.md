# Day-2 / Day-N Fleet Deployments

Not every fleet component has to go in at bring-up. In VCF 9 the management
domain comes up first, and a set of fleet components can be deployed **later**
as Day-2 (Day-N) operations, driven by VCF Operations fleet lifecycle. VCF
Automation in particular is commonly **skipped at bring-up and deployed Day-N**.

This page captures the planning decisions for those Day-2 deployments so the
networking, DNS, and IP prep is ready *before* the deployment runs — the same
"lock it first" idea as the Step 1 network plan. It maps to the workbook's
*Deploy Fleet Management Day-N* sheet.

> Placeholders below use Rainpole-style values (`sfo.example.io`,
> `10.11.x.x`). Replace consistently. This is a planning checklist, not a
> step-by-step deployment guide — follow the Broadcom deployment guidance for
> the actual procedure.

---

## A. Decision gate — what goes in Day-2 vs. at bring-up?

| # | Question                                                            | Notes                                                                 |
| - | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
|D1 | Which fleet components are deployed at bring-up vs. Day-N?           | **VCF Operations, VCF Management Services, the Cloud Proxy and the License Server are bring-up** — the Installer deploys them automatically. VCF Automation can be deferred; Log Management, Operations for Networks & Identity Broker are often Day-N |
|D2 | Reuse an existing VCF Operations (fleet already has one)?           | VCF Operations itself is deployed **at bring-up** (deployment-plan epic E5, `06-deployment-plan.md`). `useExistingDeployment` connects an **additional** VCF instance to the fleet's existing Ops — no new appliances |
|D3 | Deployment **method** for VCF Automation?                           | Via **SDDC Manager API**, or via **VCF Operations** — see D            |
|D4 | Network placement: Shared Mgmt / Dedicated Mgmt / NSX Overlay Segment / NSX VLAN Segment? | Four options — see C; NSX Overlay needs an Edge cluster + transit gateway |
|D5 | Every Day-2 appliance has forward + reverse DNS and a reserved IP?  | Fleet Day-2 workflows run a synthetic check that must pass             |

Size the footprint of whatever you choose here on the
[sizing tool](https://pauldiee.github.io/VCF9-DeploymentPlanning/tools/mgmt-sizing/)
(`04-sizing.md`) — the Day-2 components are the same optional components the
sizer models.

---

## B. The deployable set

Each of these can be added Day-N from the *Deploy Fleet Management Day-N* sheet.
Capture an FQDN + reserved IP for every appliance (nodes listed), plus the
network placement from section C.

| Component                     | Appliances / nodes                                             | Notes                                                        |
| ----------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------ |
| **VCF Operations**            | Primary, Replica, Data nodes (+ a **VIP** only if an external LB fronts the cluster — see B.1) | **Reuse / additional-instance case only** — a fleet's first VCF Operations is deployed **at bring-up** (see D2); `useExistingDeployment` connects an additional instance to it |
| **Cloud Proxy** (Ops collector)| One or more collector appliances                              | **Additional collectors only** — a unified cloud proxy is configured **by default at bring-up** by the VCF Installer. Stays on the VLAN / VM-mgmt side (`localRegion`) even for NSX-overlay placement |
| **License Server**            | One appliance                                                  | **Additional license server only** — the first one is deployed **automatically at bring-up**. Tied to VCF Operations |
| **VCF Automation**            | VCF Automation appliance(s) + **VCF services runtime** nodes   | Two deployment methods — see D. Needs a node **cluster CIDR** |
| **Identity Broker**           | One appliance                                                  | Plus identity provider (AD/LDAP), user/group provisioning     |
| **Log Management** (formerly *VCF Operations for Logs* — renamed in 9.1) | Services-runtime **worker nodes** (6 IPs, +2 per extra replica — **allocated from the services-runtime block**) + cluster VIP (**integrated** LB — not external) | Node size + replica count (size it in `04-sizing.md`); size the Step 1 runtime block `/27` to absorb them |
| **VCF Operations for Networks**| Platform node + Collector node                                | Optional dual-stack (IPv4 / IPv6)                             |

### B.1 — VCF Operations load balancer is **external, never served by VCF**

This trips people up, so plan it up front. The VCF Operations analytics cluster
(Primary / Replica / Data) is reached two ways, and **only one of them involves a
load balancer**:

- **No load balancer (default).** There is **no built-in floating or cluster IP**
  for VCF Operations — you reach the cluster directly on the **node FQDNs**.
  Nothing extra to provision. Most deployments use this.
- **Load-balancer VIP (optional).** If you want a real load balancer in front of
  the analytics nodes, **VCF does not deploy or manage one for VCF Operations** —
  you must bring your own **external load balancer** (e.g. F5, or a *standalone*
  Avi/NSX ALB instance you run yourself). The load balancer is **never served
  from VCF**; VCF only records the VIP it points at. Per
  [Broadcom TechDocs](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/design/vmware-cloud-foundation-concepts/vcf-operations.html)
  both the HA and Continuous Availability models *"support an optional external
  load balancer."*

When you do use an external LB, plan for:

- an **extra IP + FQDN** for the VIP (on top of the per-node FQDNs/IPs), and
- **certificate SAN coverage** — every cluster node FQDN **and** the load-balancer
  FQDN must be in the certificate's Subject Alternative Names.

Where the setting lives: the *Deploy Management Domain* and *Deploy Fleet
Management Day-N* sheets carry an **optional "Load Balancer FQDN"** (+ IP) for
VCF Operations — leaving it empty means no LB (node FQDNs only); filling it is
the switch that says an external LB fronts the cluster. Decide it before you
request certificates (the SAN list depends on it).

> **Don't confuse this with Log Management.** The Log Management cluster has an
> **integrated** load balancer (its VIP is handled internally) — that one is not
> external. Nor is it the platform's own **Avi/NSX ALB**, which VCF *can* deploy
> and lifecycle-manage for **tenant / workload** load balancing — that is a
> different service from the LB that fronts VCF Operations itself.

---

## C. Network placement — the four options

This is the decision behind the "VCF Automation on a VPC network" question — but
the sheet does **not** offer a VPC. It offers four placements, and they line up
with the Broadcom design library's four *fleet-level components* network models
([Fleet-Level Components Networking Detailed Design](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/fleet-level-components-networking-detailed-design.html))
and the [custom-networking deployment guidance](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/deploying-vcf-operations-and-vcf-automation-on-custom-networking.html):

| Placement (Day-N sheet)          | Design-library model                              | Where components land + key requirements                                                          |
| -------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Shared Management Network**    | Shared VLAN                                       | All fleet components on the **same** vDS port group as vCenter / NSX / SDDC Manager; VCF Automation from the `/29` (intake `B5`). Simplest, no new network. **No logical isolation** (NSX DFW can help); **not suited for DR** — failover testing unsupported. Multi-AZ: stretch the VLAN. |
| **Dedicated Management Network** | Dedicated VLAN                                    | Fleet components on a **separate, dedicated** vDS port group / VLAN — create it first. **Cloud Proxy stays on the VM-mgmt network.** Physical firewall can secure it; for DR/stretched the VLAN must be routable across AZs/regions (IP mobility). |
| **NSX Overlay Segment**          | Dedicated VLAN **+** NSX Overlay Segment (hybrid) | VCF management **services** on a VLAN; **VCF Operations, Automation, Ops-for-Networks, License Server** on an NSX **overlay** (Geneve) segment; **Cloud Proxy stays on VM-mgmt**. Needs an **NSX Edge cluster + Tier-0** (BGP to physical, advertise segments), a **Tier-1** linked to it, and the segment on the management overlay transport zone. |
| **NSX VLAN Segment**             | (VLAN-backed NSX segment)                          | Fleet components on an NSX **VLAN-backed** segment (NSX-managed, no overlay/Edge routing).          |

There is no NSX VPC option — placement is one of the four above. The design
library adds a fifth, DR-oriented model — *Dedicated VLAN + NSX **Stretched**
Overlay Segment* — which stretches the overlay via **NSX Federation** with a
**Global Manager** (primary/secondary) so VCF Operations keeps its IP on
region failover (no DNS repoint); see the design library's
[stretched NSX overlay segment model](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/fleet-level-components-networking-detailed-design/fleet-level-components-on-stretched-nsx-overlay-segment-model.html).

The point of the non-shared options is to **separate user-facing networks from
management networks** for regulatory / security requirements.

**Common prerequisites** (all placements): the initial VCF fleet / instance
deployment is complete; component binaries downloaded to VCF Installer; load
balancer deployed if used; every appliance FQDN resolves to a **unique** IP
(dual-stack: both A and AAAA). The **NSX Overlay** path additionally needs the
Edge cluster, Tier-0 (BGP), Tier-1, and overlay segment above; the **Dedicated**
path needs the dedicated port group + VLAN created first.

For any non-shared placement, the sheet splits the network into `localRegion`
(the VLAN side — Ops collectors / Cloud Proxy) and `xRegion` (Ops + Automation),
and asks for:

| Field         | Example / value                                    | Notes                                             |
| ------------- | -------------------------------------------------- | ------------------------------------------------- |
| networkName   | `xregion-vcfa-net`                                 | Overlay-segment / network name                    |
| subnet mask   | `255.255.255.0`                                    | Segment subnet                                    |
| gateway       | `10.11.40.1`                                       | Segment gateway                                   |
| IP pool       | `10.11.40.11 – .20` (5+)                           | Node IP pool (5+ addresses)                       |
| cluster CIDR  | `198.18.0.0/15` (default; or `240.0.0.0/15` / `250.0.0.0/15`) | VCF Automation **internal** services-runtime node network |
| DNS (A + PTR) | `sfo-vcfa01.sfo.example.io`                        | Forward + reverse for every appliance             |

> The **cluster CIDR** is the VCF Automation services-runtime *internal* node
> network — pick one of the sheet's reserved ranges (`198.18.0.0/15` default)
> and keep it distinct from every routed subnet in the Step 1 plan.

---

## D. VCF Automation — deployment method

The Day-N sheet's method dropdown ("Select Option") offers three choices;
capture which one, as they ask for different inputs:

| Option (verbatim from the sheet)         | Deploys                         | Key inputs                                                   |
| ---------------------------------------- | ------------------------------- | ------------------------------------------------------------ |
| **Exclude**                              | Nothing (not deployed Day-2)    | —                                                            |
| **Deploy VCF Operations and Automation** | Both, via **SDDC Manager API**  | `localRegion` + `xRegion` networks, IP pools, cluster CIDR   |
| **Deploy VCF Automation**                | Just Automation, via **VCF Operations** | Installation type (**New** or **Import 8.x appliance**), VCF instance, VCF services-runtime nodes CIDR, FQDNs |

Both deploy paths need: VCF Automation FQDN, VCF services-runtime FQDN, node
prefix, the node IP pool, and the admin password. Decide the method and the
network placement (section C) together.

---

## E. DNS / IP checklist (additive to Step 1)

On top of `01-network-dns-plan.md`, for every Day-2 appliance you deploy:

- [ ] Forward (A) + reverse (PTR) DNS for each node / VIP FQDN
- [ ] Reserved IP outside any DHCP scope
- [ ] If NSX Overlay: Edge cluster + centralized transit gateway + Tier-1 (Active/Standby) and the segment exist
- [ ] VCF services-runtime **cluster CIDR** does not overlap any Step 1 subnet
- [ ] Passwords captured with the other fleet credentials (intake section F)
- [ ] The synthetic check prerequisites (DNS/NTP/reachability) are in place

---

## F. Ownership matrix

| Area                                             | Owner               | Sign-off |
| ------------------------------------------------ | ------------------- | -------- |
| Which components Day-2 vs bring-up (A)            | Architect           |          |
| Network placement (Shared / Dedicated / NSX Overlay / NSX VLAN) (C) | Network + Architect |          |
| Non-shared network CIDR, gateway, pools (C)      | Network             |          |
| VCF Automation method (D)                        | Platform + Architect|          |
| Day-2 FQDNs + PTR records (E)                    | AD/DNS/NTP          |          |
| Appliance passwords (E)                          | Platform / Security |          |

---

## Sign-off

Once A–F are filled and signed, feed the results back into the single-AZ
planning docs and the workbook:

- Day-2 FQDNs + IPs → the DNS section of `01-network-dns-plan.md`
- Non-shared placement network → the VLAN/subnet table in `01-network-dns-plan.md`
- Decisions + method → intake `A17` / `E15` / `B21` in `02-intake.md`
- All values → the *Deploy Fleet Management Day-N* sheet (see
  `workbook-cell-mapping.md`)
