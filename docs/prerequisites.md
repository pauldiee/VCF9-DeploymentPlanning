# Prerequisites — Gate Before Any Workbook Inputs

This list mirrors the **Prerequisite Checklist** sheet of the official
workbook. If any item is RED for your environment, fix it before spending a single
meeting on the rest of the workbook — every later answer depends on these.

> Authoritative source: the Broadcom [VCF 9.1 Planning and Preparation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation.html)
> doc set (the workbook's TechDocs companion). Sections below link the specific
> pages where they exist.

## When is each item needed?

Not everything here blocks bring-up. Every section below — and every row of the
[planning templates](#fillable-planning-templates-download), in their **When
needed** column — carries one of these four markers, using the same words in
both places so a filled template can be checked straight against this doc:

| Marker                     | Meaning                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| **Bring-up**               | Must be true **before the VCF Installer runs**. A miss here stops the deployment.            |
| **Bring-up (if in scope)** | Same gate, but only when you chose that option (BGP + the uplink VLANs under Centralized connectivity; the AZ2 networks when multi-AZ; the public URLs when anything is online). |
| **Day-N**                  | Needed **after** bring-up, when you configure or deploy that piece. Collect the inputs early anyway — a missing value doesn't stop bring-up, it stops the day you need it. |
| **Day-N (if in scope)**    | Only when that optional component is actually deployed — Avi, vSphere Supervisor, VCF Automation, Log Management, an external LB in front of VCF Operations, and the **NSX Edge cluster** and **vSAN witness**, both of which are built *after* bring-up (deployment plan E6 / E7). |

**The bring-up gate, at a glance** — the subset that must be green before the
Installer starts:

- [ ] **Management-domain hardware** — host count/spec, vSAN disks with **no
      existing partitions**, single hardware vendor
- [ ] **VLANs + MTU** — every traffic type, jumbo where required (overlay ≥ 1600)
- [ ] **Host Overlay TEP addressing** — static IP pool (recommended) or DHCP
- [ ] **BGP / ECMP to the ToRs** — *Centralized connectivity only*
- [ ] **DNS** — forward **A** *and* reverse **PTR** for every bring-up FQDN,
      lowercase, each resolving to a unique unassigned IP
- [ ] **NTP** — two sources, reachable and in sync
- [ ] **Binaries** — depot decision made (online / offline / manual transfer),
      credentials in hand, SDDC Manager ISO downloaded
- [ ] **Jump host** — routed access + OVF Tool
- [ ] **Active Directory** — reachable, accounts and groups pre-created
- [ ] **Public URLs / proxy allowlist** — if anything is online

Everything else in this document (workload-domain hardware, SMTP, the
Certificate Authority, the SFTP backup target, Avi, vSphere Supervisor, fleet
SSO) is **Day-N**: plan it now, but it will not hold up bring-up.

## Fillable planning templates (download)

Blank CSV sheets to capture the prereq plan, then transfer into the P&P workbook
or [Coscia's planner](https://vcfplanning.lcoscia.fr/). Each opens in Excel; the
IP/DNS template's **Intake ID** column maps back to
[`workbook-cell-mapping.md`](workbook-cell-mapping.md) (the other templates
reference intake IDs in their notes where relevant).

Every template carries a **When needed** column using the same four markers as
this document ([above](#when-is-each-item-needed)) — filter or sort on it to
see exactly what must be ready before the Installer runs, and hand the rest to
the teams that own it without holding up bring-up.

The IP/VLAN sheets hand off in a fixed order:

1. **Network team** fills the **VLAN / subnet plan** — VLANs, subnets, gateways,
   MTU, and the usable range inside each subnet.
2. **Architect** fills the **IP allocation + DNS plan**, assigning each FQDN + IP
   from those ranges (if the organization runs a central IPAM, request the
   addresses there instead of self-picking — the architect still compiles the
   sheet).
3. **AD/DNS team** creates the forward **A** and reverse **PTR** records from the
   filled IP/DNS plan.

- [IP allocation + DNS (A/PTR)](https://pauldiee.github.io/VCF9-DeploymentPlanning/templates/ip-dns-plan.csv) — per-appliance FQDN / IP, assigned by the architect from the network team's subnets in the VLAN plan (create **both** forward A and reverse PTR); duplicate the block per workload domain, add AZ2 hosts if stretched
- [VLAN / subnet plan](https://pauldiee.github.io/VCF9-DeploymentPlanning/templates/vlan-subnet-plan.csv) — VLAN, subnet, gateway, MTU + minimum IP count per traffic type
- [NTP / AD / CA](https://pauldiee.github.io/VCF9-DeploymentPlanning/templates/ntp-ad-ca-plan.csv) — NTP sources, AD domain/accounts/groups, CA + cert template
- [BGP peering](https://pauldiee.github.io/VCF9-DeploymentPlanning/templates/bgp-peering-plan.csv) — Edge/ToR AS, peer IPs, BFD (MD5 optional)
- [Firewall request](https://pauldiee.github.io/VCF9-DeploymentPlanning/templates/firewall-request-plan.csv) — deployment-critical flows (source / destination / port / purpose) for the security team; see [`07-firewall-ports.md`](07-firewall-ports.md)

> **Data hygiene:** these are **blank** templates. A **filled** copy holds
> real, sensitive data (IPs, DNS names, AS numbers) — store it in a secure
> location, **not** in a public or shared repository.

## Hardware

### Management Domain

*When needed: **Bring-up.*** The Installer validates the hosts it is given.

| Item              | Minimum                                                                       | Notes                                                  |
| ----------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| Host count        | **2** (Simple deployment, NFS/FC) / **3** (Simple, vSAN) / **4** (High Availability) | HA with 4 hosts is the production baseline (Rainpole example); the workbook offers **16 host slots**. The *Management Domain Sizing* sheet computes the exact minimum for your component set — the 9.1 HA baseline needs **4** (see `04-sizing.md`) |
| CPU               | VCG-supported                                                                 | VCG: <https://compatibilityguide.broadcom.com>. vSphere 9 counts a **16-core/CPU minimum** for licensing (even if the socket has fewer); size on **physical** cores, keep vCPU:pCPU **≤ 2:1** |
| Memory            | ~1 TB per host (Rainpole reference, 4 hosts, single-host failure tolerance)   | The 9.1 mgmt fleet is **larger** than earlier VCF (see note below) — **always** confirm via *Management Domain Sizing* sheet |
| Boot storage      | M.2/SATADOM/SSD — **NOT SD cards** (legacy)                                   |                                                        |
| vSAN-OSA cache    | All-flash, ~1.2 TB raw per host, two disk groups (~600 GB cache/group)        | Skip if vSAN-ESA / NFS / FC. 32 GB host RAM needed to support the max disk groups |
| vSAN-OSA capacity | All-flash, ~12.5 TB raw per host, two disk groups (~6.25 TB/group)            | Skip if vSAN-ESA / NFS / FC                            |
| vSAN-ESA          | ~12.5 TB raw per host, e.g. 4× 3.2 TB NVMe SSDs                               | Recommended for new builds                             |
| NICs              | Min 1× 10 GbE + 1× 1 GbE BMC; 25 GbE **recommended** for vSAN-ESA             | Plan **2× pNICs** as the normal route — the Installer's vDS profiles assume it (Default profile = one NSX-enabled vDS for **all** traffic, 2 uplinks, `vmnic0`/`vmnic1`; the custom switch configuration also supports **VDS LAG** uplinks). Hosts *can* run [a single pNIC](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/host-management/commission-hosts.html), but single-NIC bring-up is **API-only** (JSON spec) per the workbook |

> **Two easy-to-miss gate checks:** disks intended for vSAN must have **no
> existing partitions** (the workbook repeats this on every storage row — a
> classic bring-up validation failure), and all management-domain hosts must
> come from a **single hardware vendor**
> ([Preparing ESX Hosts for VCF or vSphere Foundation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation.html)).

> **9.1 management footprint is bigger.** Even with most optional fleet
> components excluded, the management domain runs ~12 appliances / ~120 vCPU,
> because 9.1 deploys a baseline **VCF services runtime** (3 control + 3 worker
> nodes) alongside vCenter, the 3-node NSX Manager cluster and SDDC Manager. It
> grows further with VCF Operations, VCF Automation, Log Management and the
> License Server. Don't reuse a VCF 4.x/5.x host spec — resize on the
> *Management Domain Sizing* sheet against the components you're actually
> deploying.

### Workload Domain

*When needed: **Day-N.*** Workload domains are built after bring-up (deployment
plan **E9**) — but order the hardware on the same lead time as the management
hosts.

Same shape as Management Domain. Minimum **3 hosts**, 4+ recommended for prod.
VI workload domains support up to **64 pNICs per host**.

> TechDocs: [Preparing ESX Hosts for VCF or vSphere Foundation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation.html)
> covers the ESX install + basic host configuration this gate expects. The
> hardware minimums themselves (all pNICs ≥ 10 GbE, vSAN hosts certified on the
> [compatibility guide](https://compatibilityguide.broadcom.com)) come from the
> workbook's *Prerequisite Checklist*, not that page.

## Network

| Requirement                         | When needed                | Why                                                                  |
| ----------------------------------- | -------------------------- | -------------------------------------------------------------------- |
| **Jumbo frames** (MTU 9000)         | **Bring-up**               | Required on vSAN, vMotion, ESX Host Overlay, NSX Edge Overlay, NFS. Overlay (GENEVE) needs MTU **≥ 1600** minimum, **1700 recommended** (headroom for GENEVE header growth), ≥ 9000 for optimal throughput — [MTU guidance](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/advanced-network-management/transport-zones-and-transport-nodes/mtu-guidance.html) |
| **BGP** adjacency + AS numbers      | **Bring-up (if in scope)** | Dynamic routing NSX Edge ↔ ToR — **only with NSX Centralized Connectivity / Edge clusters** (intake `A10`); the Distributed model needs no BGP peering. [Set up Centralized Connectivity with Edge Clusters](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/advanced-network-management/setting-up-network-connectivity/setting-up-centralized-connectivity-with-edge-clusters.html) |
| **ECMP** on Edge↔ToR uplinks        | **Bring-up (if in scope)** | NSX Edge multipath — same scope as BGP: **Centralized Connectivity only** |
| **vDS teaming**                     | **Bring-up**               | vSphere Distributed Switch teaming for uplink load-balancing + failover — profiles + algorithms are chosen in the [Installer wizard](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/deploy-a-new-vcf-fleet-or-a-new-vcf-instance.html) |
| **VLANs** per traffic type          | **Bring-up**               | See `01-network-dns-plan.md`                                         |
| **External load balancer** (only if fronting VCF Operations with a VIP) | **Day-N (if in scope)** | VCF **never** provides the LB for VCF Operations — bring your own (F5, standalone Avi/NSX ALB, …). Skip it and you reach the cluster via the node FQDNs directly (no built-in cluster/floating IP). See `05-day2-deployments.md` B.1 |
| **Stretched networks** (multi-AZ)   | **Bring-up (if in scope)** | VM-mgmt stretched across AZ1↔AZ2; Uplink01/02 + Edge Overlay stretched **only when NSX Centralized connectivity**; routing between AZ1/AZ2 ESXi-mgmt subnets. The networks must exist before the **stretch** step (deployment plan **E7**, after bring-up). See `03-multi-az-prep.md` |

> Source: the workbook's *Prerequisite Checklist* → *Network Requirements*
> block — every row above mirrors it except the VLAN and load-balancer rows,
> which are this guide's additions. TechDocs 9.1 links inline where a page
> exists; the ECMP and stretched wording has no standalone TechDocs page and is
> anchored on the workbook itself.

## Avi Load Balancer (only if in scope)

*When needed: **Day-N (if in scope)**.* Nothing here blocks bring-up.

Needed when **Avi is the chosen load balancer** for any of these: **vSphere
Supervisor** on a workload domain (then the controller cluster must exist
**before activation** — but Supervisor also runs **without Avi**, via the
NSX / VPC networking paths' built-in load balancer or the **Foundation Load
Balancer**), optionally **in front of VCF Automation** (never required — both
the single-node and HA models ship a **built-in L4 load balancer** that serves
the cluster VIP; Avi in front is a post-deployment addition for SSL
termination / keeping user access off the management network),
or tenant/workload load balancing. Deployed **Day-2 from VCF Operations**
(lifecycle-managed), with the served domain's vCenter and NSX already
configured. Per the
[Avi-for-VCF 9.1 requirements](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/avi-load-balancer/avi-load-balancer-vmware-cloud-foundation/9-1/build-and-deploy-avi-91/requirements-for-deploying-avi-load-balancer.html),
for Supervisor use the controller cluster **must be deployed before Supervisor
activation**.

> **Controllers are central, Service Engines are local.** The **Avi controllers
> always run in the management domain** — whichever domain they serve, including
> a Supervisor on a workload domain. That is the same pattern as a workload
> domain's vCenter and NSX Managers, which also run in the management domain
> (`04-sizing.md`'s workload-domain repeater). Only the **Service Engine VMs**
> are distributed: they run **per cluster**, in the workload domain.
>
> **A controller set is scoped to the NSX instance, not the workload domain:**
> workload domains that **share** an NSX instance share **one** controller set;
> a workload domain with its **own** NSX instance gets its **own** set. Count
> controller sets by NSX instance, and Service Engines by cluster.

Prepare up front:

- **4 IPs on the management domain's VM Management network, per controller set**
  (so **per NSX instance** — multiply if the fleet runs more than one): 3
  controller nodes + the **cluster VIP**.
- **One DNS record per set — the cluster FQDN**, with **A + PTR**, resolving to
  the **cluster VIP**. The **3 controller nodes and the VIP are IP-only**: the
  workbook's Avi section asks for them as plain IP fields and nothing resolves
  them by name, so don't ask the AD/DNS team for records that nothing consumes
  (`01-network-dns-plan.md` DNS table, intake `E16`, and
  [`workbook-cell-mapping.md`](workbook-cell-mapping.md) all say the same).
- **Controller size**: Small / Large / XLarge (the deploy wizard's tiers). Size
  it in `04-sizing.md` — note the workbook's Avi disk figures diverge from the
  NSX ALB controller ladder.
- **Two strong passwords** (password manager, owners in intake `F11`): the
  controller **admin** and the **VCF Ops admin** (break-glass) accounts.
- **Avi binaries in the depot** — 32.1.1 or higher must be available from the
  (online or offline) depot before VCF Operations can deploy the controller
  (see [`09-binary-depot.md`](09-binary-depot.md)).
- **A local content library** in the target vCenter for the **Service Engine**
  images, and a **Service Engine management network** (dedicated VLAN or
  overlay segment; SE management IPs via DHCP or a static IP pool in the
  controller). **Service Engines are always present per cluster** — every
  cluster Avi serves runs its own, with a **minimum of 2** for HA, so budget
  their footprint and management IPs **per cluster** in the workload domain,
  not once per fleet. The VIP source depends on the networking path (VDS:
  VIP/data network + IPAM profile; VPC: the VPC external IP blocks).
- Firewall: admin access to the controller UI/API (443) and the Service
  Engine ↔ controller secure channel — see [`07-firewall-ports.md`](07-firewall-ports.md) §E.

> Not the same thing as the **external load balancer for VCF Operations**
> (see the Network table above and `05-day2-deployments.md` B.1) — that one is
> never served by VCF. TechDocs:
> [Deploy Avi Load Balancer from VCF Operations](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/avi-load-balancer/avi-load-balancer-vmware-cloud-foundation/9-1/build-and-deploy-avi-91/deploy-avi-load-balancer-from-vcf-operations.html).
> The P&P workbook has **no Avi input fields** — only sizing rows — so capture
> these values in the Step 1 plan / intake instead.

## License Hub (only if vDefend or Avi is in scope)

*When needed: **Day-N (if in scope)**.* Nothing here blocks bring-up.

**License Hub** provides *"centralized license management and reporting for
VMware vDefend and VMware Avi subscription license files"* — it replaces the
traditional 25-character license keys with **digitally signed subscription
license files**. It is deployed from the **SSP Installer** (Security Services
Platform), and it is needed **only when vDefend or Avi is in scope**. Plain VCF
without either does not need it.

> **License Hub is not the License Server — and both exist.** The **License
> Server** is deployed **automatically at bring-up**, is tied to VCF Operations,
> and licenses the VCF fleet (deployment plan story 5.4). **License Hub** is a
> separate appliance set, deployed **Day-N from the SSP Installer**, licensing
> **vDefend + Avi**. They **coexist** — a fleet running Avi has both. Two
> similar names, two unrelated appliances: don't plan one and assume it covers
> the other.

- **~9 IPs on one subnet, in two pools** — **installer 1**, **controller +
  worker nodes 4**, **License Hub services 4**. The **node and service pools
  cannot be modified after deployment**, so size them for scale-out up front.
- **Three VMs, not one appliance** — an **installer**, a **controller** node and
  a **worker** node (it deploys as an SSP instance: one controller + one
  worker). Footprint:

  | Component | vCPU | Memory (GB) | Storage (GB) |
  | --------- | ---- | ----------- | ------------ |
  | Installer | 4    | 6           | 400          |
  | Controller| 2    | 8           | 155          |
  | Worker    | 4    | 16          | 255          |

- **Scale:** *"Total Endpoints Connected to a single License Hub instance =
  120, where Endpoints could be a mix of NSX Manager, vDefend Security Services
  Platform, Avi Controller."* One instance covers all but the largest fleets.
- **Connected or disconnected — decide with the depot decision (intake `G1`).**
  **Connected** mode needs live connectivity to the **Avi Cloud Console**;
  registration is automatic and licenses are polled **every 15 minutes**.
  **Disconnected** (air-gapped) mode uses file-based registration and a
  **manual license file import every six months**.

> **Air-gapped: the six-month import is a recurring commitment.** If the site
> has no internet path — the same site that needs the offline depot in
> [`09-binary-depot.md`](09-binary-depot.md) — someone must carry a fresh
> license file in **twice a year, forever**. Give it a named owner and a
> calendar reminder at deployment time, not at first expiry.

TechDocs:
[License Hub for vDefend and Avi](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/security-modernization/vdefend-lateral-security/security-services-platform-for-vmware-cloud-foundation/license-hub-for-vdefend-and-avi/license-hub-for-vmware-vdefend-and-vmware-avi-load-balancer.html)
(the VCF 9.1 design blueprint — sizing, endpoint scale, modes) ·
[Deploying License Hub](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/security-services-platform/5-1/licensing-overview/deploying-license-hub.html)
(SSP 5.1 — the deploy procedure).

## vSphere Supervisor (only if in scope)

*When needed: **Day-N (if in scope)**.*

Nothing here is needed at bring-up — the Supervisor is enabled **per workload
domain, Day-N** (intake `H5`, deployment plan E9). But activation asks for all
of it at once, and the workbook carries only **three** Supervisor fields
(name, Service CIDR, control-plane IP range), so collect the rest up front:

- **5 consecutive static IPs** for the Supervisor control plane on the
  management network — 3 control-plane VMs + 1 floating IP + 1 reserved for
  rolling updates. The workbook's "Control Plane IP Range" is this block.
- **Supervisor API FQDN + DNS record** — logging in by FQDN is required to
  avoid certificate issues; point the record at the **floating IP** (no load
  balancer) or the **load-balancer VIP**. Add it to the Step 1 DNS table.
- **Service CIDR** — private, unique per Supervisor (the default usually
  works; it must not overlap other Supervisors or the fleet networks).
- **Load balancer** — Supervisor activation requires one; pick per WLD
  (intake `H5`): the **built-in NSX/VPC LB** (no extra appliance), the
  **Foundation Load Balancer** (platform-packaged L4 active/passive pair, for
  VDS networking), or **Avi** — then the whole [Avi section above](#avi-load-balancer-only-if-in-scope)
  applies and must be **complete before activation**.
- **North-south connectivity — the hard prerequisite.** The workload domain's
  own NSX connectivity model (intake `H4`, chosen **per WLD**, independent of
  the management domain's) must be **built and up before activation**, along
  with its Supervisor-specific reservations:
  - **VCF Networking with VPC** (Distributed connectivity): the Distributed
    Transit Gateway + VNA cluster, a routable **external IP block**
    (north-south NAT / load-balancer VIPs, advertised upstream via BGP) and a
    **private transit gateway IP block** — in **9.1 this block must be a
    `/16`** (9.0 accepted a `/24`; with a `/24` in 9.1 the deployment never
    completes — see the references below).
  - **NSX segment networking** (Centralized connectivity): the Edge cluster +
    Tier-0 first, plus **ingress and egress CIDRs** for the Supervisor.
  - **VDS networking**: distributed port groups for the **workload
    network(s)** (one designated primary), on a **different subnet** than the
    Supervisor management network, plus the FLB or Avi from the LB bullet
    (a VDS-networking Supervisor has no built-in NSX load balancer).
- **Cluster readiness** — vSphere **DRS (fully automated) and HA** enabled on
  the target cluster(s); **storage policies** chosen for the control-plane
  VMs, ephemeral disks, and image cache.
- **Kubernetes content** — Supervisor services / VKS release binaries come
  from `projects.packages.broadcom.com` (already in the Public URLs table
  below); air-gapped sites must plan the offline content-library path.
- **Routing** — the Supervisor management network must reach vCenter and the
  ESX hosts' management vmkernel (Spherelet), and the workload network must
  reach the load-balancer VIPs.
- **Zones** — a three-zone Supervisor needs **≤ 100 ms** latency between the
  zone clusters (see [`03-multi-az-prep.md`](03-multi-az-prep.md) for the
  stretch/AZ groundwork).

> TechDocs: [vSphere Supervisor Platform](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsphere-supervisor-installation-and-configuration.html)
> (per-networking-path requirements pages) and
> [Requirements for Simplified Supervisor Deployment](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/vsphere-supervisor-installation-and-configuration/deploying-easy-supervisor/requirements-for-simplified-supervisor-deployment.html)
> (routing + FQDN-login requirements). The 9.1 `/16` transit-gateway change is
> lab-documented in
> [VCF 9.1 Home Lab Series Part 9 — Deploy Supervisor](https://vstellar.com/2026/06/vcf-9-1-home-lab-series-part-9-deploy-supervisor/)
> and the [VCF 9.1.x Ultimate Deployment Guide](https://blog.leaha.co.uk/2026/05/06/vcf-9-1-x-ultimate-deployment-guide/).

## Active Directory

*When needed: **Bring-up.*** The domain must be reachable and the accounts and
groups must exist before the deployment starts (deployment plan **E4** story
4.3). *Using* them for fleet SSO is Day-N — see the next section.

- Supported OS: Windows Server 2019 or 2022.
- Parent domain (forest root) reachable from SDDC components.
- Bind / service accounts and admin groups pre-created **before** install: the
  AD bind accounts you plan for vSphere / NSX, the **Identity Broker bind
  account** (see below), and the **admin groups** you will map to VCF roles —
  capture them in the intake (section C, e.g. `C5`).
- AD DCs reachable from every management component.

> **Workbook gotcha:** the *Active Directory Inputs* tab that the workbook's
> own prereq row points at is **hidden** in the 9.1 workbook (v1.9.1.001) and
> still carries VCF 4.x/5.x-era content — Workspace ONE Access and Aria Suite
> Lifecycle groups, old Aria product names, HCX/HRM service accounts,
> `VMw@re1!` reference passwords. Unhide it for the `svc-*` / `gg-*` **naming
> convention** only; the actual 9.1 account set is the short list above.

### Identity source for the VCF Identity Broker

*When needed: **Day-N.*** The broker ships at bring-up but is **configured**
Day-2 (deployment plan **E8** story 8.5) — collect these inputs early so that
day isn't spent chasing AD.

VCF 9 federates fleet-wide SSO through the **VCF Identity Broker**. The broker
itself is **deployed at bring-up** with the VCF Management Services (no opt-in;
its FQDN + services-runtime IP are part of the Step 1 plan) — what happens
Day-2 is its **configuration** (deployment plan **E8**, story **8.5** fleet
SSO). Prepare the AD-over-LDAP
identity source up front; it has specific inputs and well-known gotchas.

**What to prepare:**

- **Bind / service account** — a dedicated AD account with read access to the base DN.
  If you use the **Global Catalog**, it must also have read on the **TGGAU**
  (Token-Groups-Global-And-Universal) attribute.
- **Base DN** (e.g. `dc=example,dc=com`), a **Base Group DN** (required to sync
  groups), and optionally a **Base User DN**.
- **LDAPS root CA certificate** in **PEM** format (with the `BEGIN CERTIFICATE` /
  `END CERTIFICATE` lines) if you use an encrypted connection (recommended).
- **Domain controllers** — a primary (and a secondary for failover), or DNS
  auto-discovery via **SRV records**; reachable on 389/636 (see [`07-firewall-ports.md`](07-firewall-ports.md)).
- **Groups to sync**, including the group you will map to the **admin** role.

**Common gotchas:**

- **Login is the domain UPN (`user@domain.com`), *not* the email address** — even
  when the email is synced, users must sign in with the domain UPN (Broadcom
  KB 393150). Trips up organisations where the email suffix differs from the UPN suffix.
- **Global Catalog syncs only *universal* groups** — local/global groups won't
  appear until converted to universal, and the bind account needs the **TGGAU** read
  permission.
- **The LDAPS certificate must be PEM** (with `BEGIN`/`END CERTIFICATE` lines) — a
  missing or wrong-format root CA breaks the encrypted connection.
- **Single Base Group DN** — to sync groups spread across OUs, set the base group
  DN **high enough** to cover them all; a too-narrow DN silently misses the admin group.
- **Nested groups** — enable **Sync Nested Group** if admin membership comes via
  nested groups, or those members won't sync.
- **Sync runs weekly** by default — a service-account **password expiry or lockout**
  will quietly stop group updates.

> Other supported identity sources: **OpenLDAP**, and external IdPs — **Microsoft
> Entra ID** (OIDC / SAML) and **AD FS**. Those need different prep; see Broadcom's
> [Configure an Identity Provider](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/fleet-management/what-is/setting-up-sso/cofigure-vmware-cloud-foundation-identity-provider.html)
> (per-IdP sub-pages) and [Configure Active Directory as an Identity Provider
> Using AD/LDAP](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/fleet-management/what-is/setting-up-sso/cofigure-vmware-cloud-foundation-identity-provider/configure-vmware-cloud-foundation-identity-provider-for-ad-ldap(2).html)
> on TechDocs. These are deliberately the **9.0** pages — the 9.1 doc set does
> not republish the SSO setup section, so 9.0 is the newest published version.

## Host Overlay TEP addressing (static IP pool recommended)

*When needed: **Bring-up.*** The Installer asks for the pool (or expects DHCP)
while deploying the management domain.

How each host gets its GENEVE tunnel-endpoint (TEP) IPs on the **ESX Host
Overlay** VLAN. Either way, size for at least `nodes × pNICs` IPs plus growth —
e.g. a 4-node cluster × 2 pNICs = 8 IPs minimum.

- **Recommended: static IP pool** — entered directly in the VCF Installer at
  bring-up (and per cluster in the workload-domain wizard). No external DHCP
  service to build, monitor, or keep alive; and in stretched (multi-AZ) designs
  no per-AZ DHCP scope per TEP subnet. The P&P workbook's own *Deploy
  Management Domain* sample uses **IP Pool** for the *IP Assignment (TEP)*
  field.
- **Alternative: DHCP scope** on the ESX Host Overlay VLAN — fully supported,
  same sizing rule; use it when the network team already operates DHCP on that
  VLAN and prefers central address management.

> Broadcom TechDocs accepts either for the prerequisite — *"a static IP pool
> or a DHCP server configured and advertising IP addresses on the … NSX host
> overlay (Host TEP) VLAN"* ([Create a New Workload Domain](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/working-with-workload-domains/deploy-a-vi-workload-domain-using-the-sddc-manager-ui.html)).
> TEP IP pools can also be created per cluster after bring-up
> ([Create an IP Pool for Tunnel Endpoint IP Addresses](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/advanced-network-management/transport-zones-and-transport-nodes/create-an-ip-pool-for-tunnel-endpoint-ip-addresses.html)).

## DNS

*When needed: **Bring-up.*** The single most common cause of a failed bring-up
— **A *and* PTR must both resolve before the Installer runs**.

- Forward + reverse zones for every FQDN in the *Deploy Management Domain*,
  *Deploy Workload Domain* and *Deploy Cluster* sheets. **All A and PTR records
  present *before* deploy.**
- **Every FQDN and IP unique** — each FQDN must resolve to a unique, currently
  **unassigned** IP address (workbook + the FQDN inventory page below).
- Create **every FQDN lowercase** — TechDocs requires it for the fleet-services
  family ("Do not use capital letters in the FQDN"), and creating all records
  lowercase avoids the trap entirely — see the Step 1 plan
  ([`01-network-dns-plan.md`](01-network-dns-plan.md) §C).
- Dynamic updates: Nonsecure and secure.
- Replication scope: all DNS servers in the forest.
- Two DNS servers configured on every appliance.
- One **CNAME** wrapping the two NTP A-records for round-robin (see below).
- The authoritative per-component FQDN/IP inventory is in Broadcom TechDocs:
  [VCF Components FQDNs and IP addresses](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/vcf-components-fqdns-and-ip-addresses.html)
  (9.1 Planning and Preparation).

## NTP

*When needed: **Bring-up.*** Hosts and appliances must be **in sync** before
deployment — skew breaks certificate validation and cluster formation.

- Two external time sources per site (radio/GPS, upstream NTP, or NTP served
  by the ToR switches / physical routers).
- Two A-records pointing at the two sources.
- One CNAME (e.g. `ntp.sfo.rainpole.io`) → A-record name for round-robin HA.
- The two external servers themselves synced to **different upstreams**
  (healthy NTP dispersion).
- Optional: per-server A-records (e.g. `ntp0` / `ntp1`) for direct management
  of the individual sources.
- AD domain controllers synced to the same external NTP.
- Different time sources for different fault domains / sites.

> Source: the workbook's *Prerequisite Checklist* → *NTP* block (incl. the
> A-record/CNAME construction). Host-side setup: TechDocs
> [Configure NTP on the ESX Hosts](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation/configure-ntp-on-vmware-cloud-foundation-hosts.html).

## SMTP

*When needed: **Day-N.*** Alerting is configured in VCF Operations after
bring-up.

- Mail relay reachable from each SDDC component (alerting).
- Restrict relay to SDDC management IP range(s).
- The consumer is **VCF Operations' outbound Standard Email plug-in** (alert
  notifications), configured Day-2 with exactly these values — TechDocs:
  [Configure Email Alert Plug-in Settings](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vvs/9-X/configure-email-alert-plugin-settings-for-vrealize-operations-manager.html).

## Certificate Authority

*When needed: **Day-N.*** Bring-up runs on self-signed certificates; the
CA-signed replacement is done once the fleet exists (deployment plan **E6** 6.2
partial / **E8** 8.5 full). Have the CA **reachable and its template validated
before bring-up** anyway — the environment gate (E4 story 4.3) checks it, and a
missing template blocks the entire Day-2 certificate pass.

- VCF 9.1 fleet certificate management (**VCF Operations → Fleet Management →
  Certificates → Configure CA for Fleet**) offers two CA types: **Microsoft CA**
  or **OpenSSL**. It's a single fleet-level setting — there is **no separate
  Microsoft-only restriction for "management" vs "instance"** components.
- **External / third-party CA is CSR-based only:** VCF generates the **CSR**, you
  sign it on your CA, and import the **signed certificate**. The **private key
  never leaves VCF** — you **cannot import a certificate that was created entirely
  outside VCF** (VCF does not accept an externally-generated private key).
- **Microsoft CA:** must support **Basic authentication**; recommended Windows
  Server 2019/2022 with the `Certificate Authority` + `Certificate Authority Web
  Enrollment` roles (Web Enrollment on the same host as the CA role). The full
  four-step prep (roles, basic auth, certificate template, least-privilege
  service account) is TechDocs [Prepare Your Microsoft Certificate Authority to
  Allow VMware Cloud Foundation to Manage Certificates](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/certificate-management-9-0/configure-a-certificate-authority_9-0/prepare-your-certificate-authority-to-enable-sddc-manger-to-manage-certificates-9-0.html).
- **Have ready for the Configure-CA wizard** (Microsoft CA): the CA server URL
  (`https://<ca-fqdn>/certsrv`), the **least-privileged service account** +
  password, and the **issuing certificate template** name.
- **OpenSSL:** configured on the appliance with the org details (Common Name,
  Country, Locality, Organization, OU, State) — no external prerequisites.
- TechDocs walk-throughs: [Configure a Certificate Authority for VMware Cloud
  Foundation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/certificate-management-9-0/configure-a-certificate-authority_9-0.html)
  and the umbrella [Managing Certificates in VMware Cloud
  Foundation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/certificate-management-9-0.html)
  section.

## SFTP backup target

*When needed: **Day-N.*** The fleet-wide backup target is configured in VCF
Operations right after bring-up (deployment plan **E6** story 6.3) — build it
in parallel with the deployment, not after go-live.

- SFTP target (TCP **22**) reachable from the VCF management network — SDDC
  Manager, NSX Manager, vCenter **and** the fleet components — VCF Automation
  plus the VCF management services (Log Management, Identity Broker, Software
  Depot, fleet/SDDC lifecycle, real-time metrics, Salt) — all back up to it.
- Service account + write path pre-created (e.g. `svc-vcf-bck` → `/backups/`).
- The external SFTP server must support **256-bit ECDSA and 2048-bit RSA SSH
  keys**, with host key algorithms including one of `rsa-sha2-512` /
  `rsa-sha2-256` **and** one of `ecdsa-sha2-nistp256` / `nistp384` / `nistp521`.
- **FIPS is on by default in 9.x SDDC Manager and cannot be turned off**, so the
  FIPS-mode SSH requirements always apply: the server must also offer a KEX from
  `diffie-hellman-group-exchange-sha256` / `ecdh-sha2-nistp256` / `nistp384` /
  `nistp521`, and the MAC `hmac-sha2-256` (**not** only the
  `-etm@openssh.com` variant — a common hardening trap). Verify the handshake
  before registering the target: [`08-backup-target.md`](08-backup-target.md) §4.
- A **backup encryption passphrase** chosen and stored in a password manager
  with a named owner — it is **required during restore**; a lost passphrase
  makes every backup on the target useless.
- Placed **outside the management domain it protects** — a backup target that
  dies with the platform is not a backup.

> Build guidance (what backs up and how often, placement, a hardened chrooted
> OpenSSH worked example, gotchas) + references:
> [`08-backup-target.md`](08-backup-target.md). TechDocs:
> [File-Based Backups for SDDC Manager, NSX Manager and vCenter](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/backup-and-restore-of-cloud-foundation/file-based-backups-for-sddc-manager-and-vcenter-server.html)
> and [Configure SFTP Backup Target in VCF Operations](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/backup-and-restore-of-cloud-foundation/configure-sftp-backup-target-in-vmware-cloud-foundation-operations.html).
> Note the workbook's own SFTP row is stale here — it still says NSX + SDDC
> Manager "configured through SDDC Manager"; in 9.1 the fleet-wide target is
> set in **VCF Operations** and covers the components listed above.

## Jump host

*When needed: **Bring-up.*** Nothing starts without it.

The machine the whole deployment is driven from. It must exist **before** day
one and survive independently of the platform it deploys — don't place it on
the cluster being built (or on storage that depends on it).

- **Routed access** to: ESXi mgmt, VM mgmt, VCF mgmt, and the internet (binary
  downloads, if the online depot is used).
- **Modern browser** — VCF Installer UI, vCenter, NSX Manager, VCF Operations.
- **OVF Tool** — deploys the VCF Installer appliance OVA.
- **SSH client** — PuTTY, or the OpenSSH client built into Windows 10+ /
  Windows Server 2019+ (appliance console work on the VCF Installer, SDDC
  Manager, vCenter).
- **SFTP/SCP client** — WinSCP (or plain `scp`/`sftp`) for moving bundles,
  certificates, and log collections on and off appliances.
- **PowerShell 7 + VCF PowerCLI** — needed if you build a
  [custom ESX ISO](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation/create-a-custom-esx-iso-image-using-vmware-powercli.html)
  (vendor add-ons / async drivers), and generally useful for day-2 automation.
- **Excel** — for the P&P workbook itself.
- **Verification tools** — `nslookup` / `Resolve-DnsName` for the DNS gate and
  `w32tm` (Windows) / `ntpdate -q` (Linux) for the NTP gate, run from the same
  network vantage point the appliances will use.

## Binaries

*When needed: **Bring-up.*** The depot decision (`G1`) drives infrastructure —
an offline depot is a web server you have to build, so decide it early.

| File                                                | Source                                          |
| --------------------------------------------------- | ----------------------------------------------- |
| `VCF-SDDC-Manager-Appliance-9.1.x.0.xxxxxxxx.iso`   | support.broadcom.com                            |
| `VMware-VirtualSAN-Witness-x.x.x-xxxxxxxx.ova`      | support.broadcom.com (only if multi-AZ / vSAN stretched) |

Everything else comes through the **depot** — decide online, offline, or
manual transfer early (intake `G1`), because the offline path means building
infrastructure:

- **Online depot** — VCF Installer and the fleet talk to the Broadcom depot
  directly; have the **Download Service ID + Activation Code** ready (intake
  `G2`/`G3`) and outbound 443 per the Public URLs table below. Generating the
  download credential requires the **Product Administrator** role on the
  Broadcom support-portal site — arrange it early (see
  [`09-binary-depot.md`](09-binary-depot.md)). TechDocs:
  [Connect VCF Installer to Broadcom or an Offline Depot and Download Binaries](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/downloading-binaries-to-the-vcf-installer-appliance/connect-to-an-online-depot-to-download-binaries.html).
- **Offline depot** (air-gapped) — the **VCF Download Tool** is the only
  supported method in 9.1; you also need a web server (**≥ 1 TB** disk,
  HTTPS) to serve the downloaded depot store. TechDocs:
  [Download Binaries to an Offline Depot by Using the VCF Download Tool](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/lifecycle-management/binary-management-for-vmware-cloud-foundation/download-bundles-to-an-offline-depot.html).
- **Manual transfer** (one-off installs) — VCF Download Tool on any
  internet-connected machine, then copy + import the depot store on the VCF
  Installer appliance itself; no depot server, but Day-N patching needs
  repeat side-loads into the fleet Depot Service. TechDocs:
  [Manually Transfer Binaries to VCF Installer](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/downloading-binaries-to-the-vcf-installer-appliance/use-the-vmware-download-tool-to-download-binaries.html).

> Build guidance (depot web server setup, Download Tool commands, transfer +
> connect steps, using the tool standalone to pre-stage binaries) + references:
> [`09-binary-depot.md`](09-binary-depot.md).

## Public URLs (online functionality)

*When needed: **Bring-up (if in scope)**.* Only if something goes online — the
platform, or (air-gapped) the machine running the VCF Download Tool.

Everything online in VCF 9.1 — depot downloads, licensing, compatibility /
vSAN HCL data, CEIP — talks to a short list of public URLs, all **outbound
TCP 443**. Hand this table to the firewall team as-is, and if egress goes
through a proxy (intake `G5`), have these allowlisted on it. Source:
[Public URLs Required for Online Functionalities](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/public-urls-required-for-vmware-cloud-foundation.html)
(earlier versions: KB 327186).

| Destination URL                 | Purpose                                        | Needed by (source components)                                      |
| ------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| `dl.broadcom.com`               | Binaries download                              | VCF Installer, vCenter, VCF Operations, VCF Download Tool, depot services runtime |
| `eapi.broadcom.com`             | Binaries, vSAN HCL data, licensing, Cloud Proxy connectivity | VCF Installer, SDDC Manager, vCenter, VCF Operations, Cloud Proxy, VCF Download Tool, depot services runtime |
| `vvs.broadcom.com`              | Binaries, compatibility data, vSAN HCL data    | VCF Installer, SDDC Manager, VCF Download Tool, depot services runtime |
| `vsanhealth.vmware.com`         | Binaries, vSAN HCL data                        | VCF Installer, SDDC Manager, vCenter, VCF Download Tool, depot services runtime |
| `projects.packages.broadcom.com`| Binaries for Supervisor services and VCF services | Depot services runtime                                            |
| `vcsa.vmware.com`               | CEIP telemetry                                 | SDDC Manager, all VCF services runtime instances                   |
| `vcf.broadcom.com`              | Licensing                                      | VCF Operations                                                     |
| `auth.esp.vmware.com`           | Update Manager Download Service (UMDS)         | SDDC Manager, VCF Download Tool                                    |

> **Proxying these? The proxy must be reachable from the whole
> services-runtime node block, not just the depot/Ops IPs.** Allowlisting these
> URLs *on* the proxy is only half of it: the fleet also has to *reach* the
> proxy, and a fleet-side proxy precheck does a plain TCP (netcat) connect from a
> pod that can land on **any** VCF services-runtime node. Broadcom's documented
> access doesn't call this out, so the proxy port often gets opened only for the
> depot + VCF Operations IPs and the proxy config then fails to apply. Firewall
> the **whole node block** to the proxy port. Full writeup + how to read the
> precheck logs:
> [09-binary-depot.md §5](09-binary-depot.md#gotcha-the-precheck-is-a-netcat-test-from-the-whole-node-block--even-when-the-documented-access-is-in-place).

> **Air-gapped?** The platform itself then needs none of these — but the
> machine running the **VCF Download Tool** still does, from wherever it runs.
> Plan that host's outbound access (or proxy allowlist) as part of this gate.

## Sign-off

Confirm in writing that **all** items above are green before the
intake meeting (Step 2) — the **Bring-up** ones because they stop the
deployment, the **Day-N** ones because a gap found on the day you need them
costs the same time, just later. If anything is amber/red, capture the owner,
target date, and risk before starting the workbook.
