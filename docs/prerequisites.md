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

- [IP allocation + DNS (A/PTR)](https://vcf-planning.hollebollevsan.nl/templates/ip-dns-plan.csv) — per-appliance FQDN / IP, assigned by the architect from the network team's subnets in the VLAN plan (create **both** forward A and reverse PTR); duplicate the block per workload domain, add AZ2 hosts if stretched
- [VLAN / subnet plan](https://vcf-planning.hollebollevsan.nl/templates/vlan-subnet-plan.csv) — VLAN, subnet, gateway, MTU + minimum IP count per traffic type
- [NTP / AD / CA](https://vcf-planning.hollebollevsan.nl/templates/ntp-ad-ca-plan.csv) — NTP sources, AD domain/accounts/groups, CA + cert template
- [BGP peering](https://vcf-planning.hollebollevsan.nl/templates/bgp-peering-plan.csv) — Edge/ToR AS, peer IPs, BFD (MD5 optional)
- [Firewall request](https://vcf-planning.hollebollevsan.nl/templates/firewall-request-plan.csv) — deployment-critical flows (source / destination / port / purpose) for the security team; see [`07-firewall-ports.md`](07-firewall-ports.md)

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
  Both pools are entered as **contiguous start–end ranges inside one subnet**
  (see the deploy-wizard table below), so they need a **free, unbroken block** —
  scattered spare addresses in an otherwise-used subnet will not do.
- **Two FQDNs for the instance, on top of the installer's own — and they are
  pinned to the service IP pool.** The installer appliance needs an FQDN
  (below), and the **License Hub instance** it deploys asks for an **Instance
  FQDN** (it errors *"Instance FQDN is required"*) and a **Messaging FQDN**.
  Both take *"253 characters max, alphanumeric name with hyphens allowed"*.
  Neither is a free-standing record — TechDocs is explicit about which address
  each one resolves to:

  | FQDN | Purpose | Maps to |
  | ---- | ------- | ------- |
  | **Instance FQDN** | *"the FQDN to use for accessing the License Hub instance from a browser or in an API call"* | *"the **first** IP address in the service IP pool"* |
  | **Messaging FQDN** | *"used by the internal components of the License Hub instance"* | *"the **second** IP address in the service IP pool"* |

  *"You must configure DNS with this mapping either before or after deploying
  the instance"* — for both. So the **service pool's first two addresses are
  spoken for**, and the DNS records cannot be written until the pool range is
  fixed. Order the work that way: agree the subnet → fix the two pool ranges →
  then request A + PTR for the first two service-pool addresses.

> **Three things here cannot be changed after deployment — get them right the
> first time.** TechDocs, verbatim: the **Instance Name** — *"This name cannot
> be changed after deployment"* (and *"cannot contain uppercase letters or
> special characters, and the length cannot exceed 32 characters"*); the
> **Instance FQDN** — *"This FQDN cannot be changed after deployment"*; and the
> **Storage Policy** — *"You cannot change the storage policy after
> deployment"*. Add the **node and service IP pools**, immutable for the same
> reason, and this appliance has an unusually long list of one-way doors for
> something deployed Day-N. A rename or a re-IP means a redeploy.

> **Encrypted storage policies are not supported — check this before you pick a
> cluster.** TechDocs: *"VM encrypted storage policy is not supported"* and
> *"You cannot use third-party encryption solutions."* A site whose management
> cluster defaults to an encryption-enabled storage policy (or runs third-party
> VM encryption) has to provide a non-encrypted policy for this instance —
> and since the policy is also immutable, that is a deploy-time decision, not
> something to fix afterwards.
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
  registration is automatic and licenses are polled **every 15 minutes**, and the
  traffic is **two-way in purpose** — TechDocs: *"License usage report is
  consolidated and provided to the Avi Cloud Console **every 24 hours**."*
  **Disconnected** (air-gapped) mode uses file-based registration and a
  **manual license file import every six months**.
- **You download the software yourself — it is not in the VCF depot.** Verified
  2026-07-22. The **Broadcom Support Portal**, under **vDefend Security Services
  Platform** (5.1.2 at the time of writing), carries **two** files and you need
  **both**:

  | File | What it is | Size |
  | ---- | ---------- | ---- |
  | `VMware-Security-Services-Platform-Installer-<version>.ova` | The **SSP Installer** appliance — deploy this first | **~5.0 GB** |
  | `License-Hub-<version>.tar` | The **License Hub installation package** — *uploaded to* the SSP Installer, which then deploys License Hub | **~4.5 GB** |

  Neither comes through the **Fleet Depot Service** or the offline depot in
  [`09-binary-depot.md`](09-binary-depot.md) — that machinery is VCF-component
  scoped. Take the two files from the **same release page** as a matched pair
  (their build numbers differ within a release), and keep the portal's **SHA2 /
  MD5** — a 5 GB OVA hand-carried on removable media is exactly when a checksum
  earns its keep.

> **Air-gapped: three things to carry, not one.** The `.ova`, the `.tar`
> (**~9.5 GB** together) **and** the six-monthly license file. The recurring
> commitment below is only the last of those — the first two also have to reach
> an isolated site before anything can be deployed at all.

- **What the SSP Installer OVA asks for.** Field-observed 2026-07-22. A plain
  *Deploy OVF Template* on a **single vNIC**, IP allocation **Static – Manual**,
  IPv4. Have these ready before you start (`*` = required):

  | Group | Fields |
  | ----- | ------ |
  | Application | GRUB root password; GRUB menu timeout (default `4`); **`sysadmin`\***, **`admin`\***, **`audit`\*** passwords |
  | Network | **FQDN\*** — *"must contain a dot character"*; **IPv4 address\***; **netmask\***; default gateway |
  | DNS | **DNS server list\*** (space-separated, **max 3**); domain search list |
  | Services | NTP server list; **Enable SSH** (**off** by default) |

  - **It needs a real FQDN**, unlike VCF Operations for Networks — so plan an
    A + PTR record for it in Step 1, not just an IP.
  - **Four passwords to capture at deploy time**, three of them mandatory.
  - **Only the first three DNS servers are used** — *"all other will be
    ignored"*, silently. If the site standard hands out four or more resolvers,
    decide which three, rather than letting the order decide.
  - **NTP is not marked required — treat it as required anyway.** This is a
    licensing and security appliance; clock skew breaks certificate validation
    and token exchange, and the platform is gated on NTP regardless.
  - **Storage: 396 GB thick, but only ~7 GB thin** (5.0 GB download). The 400 GB
    in the table above is the thick figure.

> **The password rule is stricter than the rest of the platform — check your
> generator.** Verbatim, for `sysadmin` / `admin` / `audit`: *"Min of 12
> characters… ≥1 lower case letter… ≥1 upper case letter… ≥1 number digit… ≥1
> special char… At least five different characters… No dictionary words… No
> palindromes… No monotonic character sequence (more than 4 monotonic characters
> are not allowed)"*. That is well beyond the min-8 rule other fleet components
> accept. Worse, *"password strength validation will occur during **VM boot**"* —
> so a non-compliant password **deploys successfully** and then forces a change
> at first login (`sysadmin` gets a change-password prompt; for `admin`/`audit`
> you log into the SSPI UI as `admin` and use **User Management**) rather than
> failing in the wizard where you typed it.

- **Uploading the License Hub package — there is a URL option.** Once the
  installer is up, the `.tar` is loaded under **Package Management**, which
  tracks packages as *in use* / *not in use* (a package stays **Not in use**
  until an instance consumes it). The **Upload a License Hub Package** dialog:
  *"The License Hub package is available for download from the Broadcom
  Downloads site. Once downloaded, it can be uploaded directly to the platform
  using the **local file** option or by providing the **locally hosted URL**."*
  For a **~4.5 GB** file the URL path is the friendlier one — stage the `.tar`
  on an internal web server and let the appliance pull it, instead of pushing it
  through a browser session over a slow or long-haul link. In an air-gapped
  enclave the file is usually already sitting on an internal host anyway.

- **What the License Hub deploy wizard asks for.** Field-observed 2026-07-22
  (SSP Installer `5.1.2`). *Deploy an Instance | License Hub* runs
  **Configure → Pre-Checks → Deploy**, with Configure split into three steps:

  | Step | Fields |
  | ---- | ------ |
  | **1. Define Instance and Required FQDN(s)** | **Version\*** (dropdown — the uploaded package; *"If no version is available, click Upload to upload a package"*); **Instance Name\*** (*"32 characters max, all lowercase, alphanumeric name with hyphens allowed"* — **immutable**); Deployment (fixed: `License Hub`); **Instance FQDN\*** (→ 1st service-pool IP, **immutable**); **Messaging FQDN** (→ 2nd service-pool IP); **User Passwords\*** (a **SET** sub-dialog — see the two-layer note below) |
  | **2. Select vCenter Parameters** | **vCenter connection\*** (pick an existing one or **ADD NEW CONNECTION**); **Data Center\***; **Cluster\***; **Storage Policy\*** (**immutable**; **no VM-encrypted policy**); **Content Library & VM Datastore\***; Resource Pool (**optional** — *"No selection creates a new pool by default"*); **Reserve Resource** (toggle, **Activated** by default — *"required for a production environment"*) |
  | **3. Configure Connectivity Options** | **DVS\*** + **Port Group\*** (a **distributed** port group); **Subnet\*** (CIDR, e.g. `10.1.1.0/24`); **Default Gateway\***; **Node IP Pool\*** (range, e.g. `10.1.1.4-10.1.1.15`); **Service IP Pool\*** (range, e.g. `10.1.1.16-10.1.1.24`); **NTP Server(s)** (up to **5**, comma-separated, **IP or FQDN**); **DNS Server(s)** (up to **5**, comma-separated, **IP only**); **Search Domain** (one) |

  - **It needs a distributed port group** — the wizard asks for a **DVS** and a
    port group on it. A vSphere Standard Switch is not an option, which matters
    if the licensing appliances were going to land on a management network that
    is not on the vDS.
  - **A content library datastore is required**, and the same picker covers the
    VM datastore. The installer stages the instance through a content library,
    so that datastore needs room beyond the running VMs' footprint.
  - **Resource Pool is optional, but it creates one anyway**, and **Reserve
    Resource is on by default and TechDocs calls it *"required for a production
    environment"*** — so the instance lands with **reservations**, and turning
    them off to squeeze it in is not a supported production shortcut. Check the
    footprint against management-cluster admission-control headroom **before**
    deploying.

> **Two different DNS limits, and two different password rules — one product,
> two layers.** The **installer OVA** takes at most **3 DNS servers** (extras
> silently ignored) and enforces the strict min-12 rule above. The **deployed
> instance** takes up to **5 DNS servers** and enforces a *different, simpler*
> password rule, verbatim: *"At least 15 characters in length, and no more than
> 128 characters… At least 1 lowercase, 1 uppercase, 1 numeric character and 1
> special character"* — **no** dictionary / palindrome / monotonic-run checks,
> but a **higher minimum**. The practical consequence: **a password that passes
> the OVA can still be rejected by the instance wizard.** Users seen in that
> dialog: `admin`, `audit` (it scrolls — there may be more). Pick one password
> pattern of **15+ characters** that satisfies the strict OVA rules, and it
> clears both layers.
>
> **TechDocs and the product disagree on the instance minimum — believe the
> product.** The deploy-configuration page states *"Minimum length: 12"*, while
> the shipping `5.1.2` dialog states *"At least 15 characters in length"*
> (field-observed 2026-07-22). A 12–14 character password planned from the
> documentation will be **rejected at the wizard**. The 15+ pattern above is
> the safe answer either way, which is why it is written that way here.

- **The Pre-Checks tab is the product's own pre-flight list — read it as your
  checklist.** Field-observed 2026-07-22: **9 pre-checks**, all re-runnable from
  a **RERUN PRE-CHECK** button, so a failure is fixed and retried in place
  rather than by restarting the wizard.

  | Pre-check | What it reported |
  | --------- | ---------------- |
  | Check SSPI basic infra | *"SSPI infra is healthy and Licensing validations passed"* |
  | Check vCenter | *"Verified vCenter access, cluster, datacenter, datastore, portgroup, **CPU and memory**"* |
  | Check compatibility | *"Complete Licensing compatibility check."* |
  | Check content library datastore | *"Datastore check appears to be satisfactory."* |
  | Check Storage Policy | *"The storage policy '…' appears to be satisfactory."* |
  | Check network configuration | *"The network configuration appears to be satisfactory."* |
  | Check fqdn domain | *"Domain check appears to be satisfactory."* |
  | Check NTP configuration | *"NTP check completed successfully."* |
  | Check network reachability | *"Verified **NodePool IP** network reachability."* |

  Worth noting what that list implies: **cluster CPU and memory are validated**
  (so the reservation footprint is checked, not just accepted), and both the
  **FQDN/domain** and the **node-pool IPs** are tested before anything is built.
  TechDocs permits the DNS records *"either before or after deploying the
  instance"* — but with a domain pre-check in the way, having DNS in place
  **first** is the path of least resistance.

- **What the deploy itself does — 4 steps, ~28 tasks.** Once started:
  **vCenter Configuration** (6 tasks — it begins by **creating a content
  library**, which is what that datastore is for), **Workload Cluster** (**18
  tasks** — the bulk of the run; the instance comes up as a cluster, which is
  why it is controller + worker rather than one appliance), **Security
  Platform** (3) and **Metrics** (1). TechDocs gives **no expected duration**.

- **If it fails mid-run, there are three controls and they do different
  things.** Verbatim:

  | Control | What it does |
  | ------- | ------------ |
  | **Stop Deployment** | *"Halts the ongoing deployment so that you can fix the error. **This action does not undo any previous deployments.**"* |
  | **Update & Redeploy** | *"Start the ongoing deployment after resolving an error. **The deployment starts from the point it was stopped.**"* |
  | **Cleanup** | *"Removes all the previous deployment tasks."* |

  So the normal recovery is **Stop → fix → Update & Redeploy**, which *resumes*
  rather than restarting — **Cleanup** is the heavier option that discards the
  work so far. Stopping alone leaves everything already built in place.

> **A vCenter outage mid-deploy is the bad failure — and the escape hatch is
> ugly.** TechDocs, verbatim: *"If the deployment fails because VMware vCenter
> becomes unavailable during the deployment, and you navigate to the Configure
> screen, the option to reset the configurations might not be available. This is
> expected behavior because some resources have been created on the VMware
> vCenter server. To resolve the issue, clean up the deployment before resetting
> the configurations. **If the VMware vCenter server is not recoverable,
> uninstall SSP Installer and deploy a new one.**"* Two practical consequences:
> **Cleanup before reset**, in that order — and don't run this deploy during a
> window when vCenter is being patched or restarted.

- **After it completes.** Wait for the instance to report **Healthy** (if it
  does not, TechDocs points at **Troubleshooting Diagnostic**), click **Done**,
  then reach the hub through the **Instance FQDN & IP** link and log in *"using
  the credentials you specified in the Configure step"* — the `admin` / `audit`
  passwords from the SET dialog, so they need to be recorded at planning time,
  not invented at the wizard. **Back up the SSP Installer** at this point;
  TechDocs raises it as a step here rather than leaving it to a backup policy.
  **Instance Management** is where you *"edit configurations, reset passwords,
  or delete the instance"* afterwards — note **delete**, which is the only
  answer to the immutable fields above.

> **NSX firewall exclusion list — the licensing appliance can be blocked by the
> product it licenses.** TechDocs, verbatim: *"If the License Hub VMs are
> running in an NSX overlay network, NSX VLAN segments, and security-enabled
> port groups, add the License Hub VMs to a firewall exclusion list."* The
> documentation **does not say why**. Since License Hub exists to license
> **vDefend**, and vDefend is the distributed firewall doing the blocking, this
> is worth raising with whoever owns DFW policy **before** the deploy — see
> [`07-firewall-ports.md`](07-firewall-ports.md).

> **Air-gapped: the six-month import is a recurring commitment.** If the site
> has no internet path — the same site that needs the offline depot in
> [`09-binary-depot.md`](09-binary-depot.md) — someone must carry a fresh
> license file in **twice a year, forever**. Give it a named owner and a
> calendar reminder at deployment time, not at first expiry.

TechDocs:
[License Hub for vDefend and Avi](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/security-modernization/vdefend-lateral-security/security-services-platform-for-vmware-cloud-foundation/license-hub-for-vdefend-and-avi/license-hub-for-vmware-vdefend-and-vmware-avi-load-balancer.html)
(the VCF 9.1 design blueprint — sizing, endpoint scale, modes) ·
[Deploying License Hub](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/security-services-platform/5-1/licensing-overview/deploying-license-hub.html)
(SSP 5.1 — the deploy procedure) ·
[Configure a License Hub Deployment](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/security-services-platform/5-1/licensing-overview/deploying-license-hub/steps-to-deploy-a-license-hub-instance/configure-a-license-hub-deployment.html)
(the field-by-field reference for the wizard above — FQDN-to-pool mapping, the
immutable fields, the storage-policy restriction).

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
- **The certificate pass is a bulk operation — but it must be staggered.**
  Field-verified 2026-07-22 on a real deployment. In **VCF Operations → Fleet Management →
  Certificates** you tick multiple components in the list and act on them
  together: `Generate CSRs`, `Download CSRs`, `Replace With Configured CA
  Certificate`, `Import Certificates` (plus *Renew Certificates* and *Replace
  With Imported Certificates*). Progress is reported per batch as an *n/total*
  counter, and the UI notes changes may take some time to appear after the task
  reports success. Three planning consequences:
  - **Generate before replace.** The *Replace With Configured CA Certificate*
    dialog states *"Last generated Certificate Signing Requests (CSRs) will be
    used for generating certificate(s)"* — the replace consumes the **most
    recently generated** CSRs rather than issuing fresh ones. Regenerate if the
    component's SANs/FQDN changed since the last generate, or you will sign a
    stale request.
  - **Do not fire batches in parallel.** The dialog carries a mandatory
    acknowledgement behind this caution: *"Each certificate rotation can trigger
    automated retrust operations across dependent components. To avoid system
    instability, wait for any current or ongoing batch operations to be
    completed before starting the next."* So the change window budgets **fewer,
    larger batches with a settling wait between them** — not one sweeping
    fleet-wide action, and not many small ones fired concurrently.
  - **The CA burst is real.** A batch submits every selected CSR at once. On a
    Microsoft CA, confirm the issuing template does **not** require manual
    approval — an approval-gated template turns a bulk generate into a stalled
    queue rather than an error.
  - **A failure does not stop the batch.** Field-verified 2026-07-22: when one
    component's replacement failed, the remaining ones **kept progressing**. A
    batch is therefore **partial-success by design** — it will not halt and wait
    for you. The *n/total* counter is the only signal that something did not
    land (`5/6` means one failed), so **read the final count and open the task
    list**, rather than treating "the batch finished" as "the fleet is
    certified". Re-run the failed components as their own small batch once the
    current one has settled, and verify per component at the end of the pass.
  - **The CSR dialog ships with Broadcom's placeholders — replace them.**
    Field-observed 2026-07-22: *Generate CSR* pre-fills Organization
    **`Broadcom`**, Organizational Unit **`vcfms`**, Country **United States of
    America**, State **`CA`**, Locality **`Palo Alto`**, and defaults **Key Size
    to 2048**. Easy to click straight past — and then wrong in every certificate
    you issue. Agree the subject fields with whoever owns the CA (they may be
    enforced by the template anyway) and confirm **2048** meets the site's crypto
    policy before generating in bulk.
  - **`DNS/FQDN SAN` is a required field.** Even for components deployed
    IP-only — VCF Operations for Networks is the example (see
    [`05-day2-deployments.md` §B.2](05-day2-deployments.md)) — so every component
    you intend to certify needs a resolvable name planned in Step 1. For a
    multi-node/clustered appliance the dialog requires *"FQDNs and IPs of **all**
    nodes"*.
  - **NSX Manager: watch for a backup running concurrently.** Field-observed
    2026-07-22 — the one failure in a batch was an **NSX Manager**, with an NSX
    **backup in progress** at the time. The working theory (**not confirmed**) is
    that the rotation *triggers* a backup itself and does not wait long enough
    for it to finish before proceeding. Either way the mitigation is the same:
    **check that no NSX backup is running or scheduled** in the window, and give
    NSX Manager its own batch rather than bundling it with a long run of ESX
    hosts. If it fails, re-run it alone once the backup has completed.
- The certificate list also carries an **Auto-renewal Status** column. In a
  freshly deployed 9.1 fleet the entries observed were **Deactivated** — treat
  auto-renewal as something you opt into, and check expiry ownership rather than
  assuming the fleet renews itself.
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
| `vcsa.telemetry.broadcom.com`   | CEIP telemetry                                 | SDDC Manager, VCF Operations, VCF Operations HCX                   |
| `scapi.telemetry.broadcom.com`  | CEIP telemetry                                 | SDDC Manager, all VCF services runtime instances                   |
| `vcf.broadcom.com`              | Licensing                                      | VCF Operations                                                     |
| `auth.esp.vmware.com`           | Update Manager Download Service (UMDS)         | SDDC Manager, VCF Download Tool                                    |
| `api.prod.nsxti.vmware.com`     | IDS/IPS advanced threat prevention (VMware vDefend) — **only if vDefend IDS/IPS is enabled; not part of the VCF SKU** | NSX Manager |

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

> **Two notes on the newer rows.** The three **CEIP** endpoints
> (`vcsa.vmware.com`, `vcsa.telemetry.broadcom.com`,
> `scapi.telemetry.broadcom.com`) are **distinct destinations, not
> alternatives** — allowlist all three if telemetry is on. The
> `api.prod.nsxti.vmware.com` row applies **only when vDefend IDS/IPS is in
> scope** (it is not part of the base VCF SKU); a fleet without vDefend
> threat-prevention can drop it.

## Sign-off

Confirm in writing that **all** items above are green before the
intake meeting (Step 2) — the **Bring-up** ones because they stop the
deployment, the **Day-N** ones because a gap found on the day you need them
costs the same time, just later. If anything is amber/red, capture the owner,
target date, and risk before starting the workbook.
