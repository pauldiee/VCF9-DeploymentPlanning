# Customer Prerequisites — Gate Before Any Workbook Inputs

This list mirrors the **Prerequisite Checklist** sheet of the official
workbook. If any item is RED for the customer, fix it before spending a single
meeting on the rest of the workbook — every later answer depends on these.

## Fillable planning templates (download)

Blank CSV sheets to capture the prereq plan, then transfer into the P&P workbook
or [Coscia's planner](https://vcfplanning.lcoscia.fr/). Each opens in Excel; the
**Intake ID** column maps back to [`workbook-cell-mapping.md`](workbook-cell-mapping.md).

- [IP allocation + DNS (A/PTR)](https://pauldiee.github.io/VCF9-DeploymentPlanning/templates/ip-dns-plan.csv) — per-appliance FQDN / IP (create **both** forward A and reverse PTR); duplicate the block per workload domain, add AZ2 hosts if stretched
- [VLAN / subnet plan](https://pauldiee.github.io/VCF9-DeploymentPlanning/templates/vlan-subnet-plan.csv) — VLAN, subnet, gateway, MTU per traffic type
- [NTP / AD / CA](https://pauldiee.github.io/VCF9-DeploymentPlanning/templates/ntp-ad-ca-plan.csv) — NTP sources, AD domain/accounts/groups, CA + cert template
- [BGP peering](https://pauldiee.github.io/VCF9-DeploymentPlanning/templates/bgp-peering-plan.csv) — Edge/ToR AS, peer IPs, BFD (MD5 optional)
- [Firewall request](https://pauldiee.github.io/VCF9-DeploymentPlanning/templates/firewall-request-plan.csv) — deployment-critical flows (source / destination / port / purpose) for the security team; see [`07-firewall-ports.md`](07-firewall-ports.md)

> **Customer-data hygiene:** these are **blank** templates. A **filled** copy holds
> real, sensitive customer data (IPs, DNS names, AS numbers) — store it with the
> customer's secure engagement material, **not** in a public or shared repository.

## Hardware

### Management Domain

| Item              | Minimum                                                                       | Notes                                                  |
| ----------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| Host count        | 2 (NFS/FC), 3 (vSAN min), **4 recommended** for production HA                 | VCF supports 3-node vSAN WLDs; 4+ for prod             |
| CPU               | VCG-supported                                                                 | VCG: <https://compatibilityguide.broadcom.com>. vSphere 9 counts a **16-core/CPU minimum** for licensing (even if the socket has fewer); size on **physical** cores, keep vCPU:pCPU **≤ 2:1** |
| Memory            | ~1 TB per host (Rainpole reference, 4 hosts, single-host failure tolerance)   | The 9.1 mgmt fleet is **larger** than earlier VCF (see note below) — **always** confirm via *Management Domain Sizing* sheet |
| Boot storage      | M.2/SATADOM/SSD — **NOT SD cards** (legacy)                                   |                                                        |
| vSAN-OSA cache    | All-flash, ~1.2 TB raw per host, two disk groups (~600 GB cache/group)        | Skip if vSAN-ESA / NFS / FC. 32 GB host RAM needed to support the max disk groups |
| vSAN-OSA capacity | All-flash, ~12.5 TB raw per host, two disk groups (~6.25 TB/group)            | Skip if vSAN-ESA / NFS / FC                            |
| vSAN-ESA          | ~12.5 TB raw per host, e.g. 4× 3.2 TB NVMe SSDs                               | Recommended for new builds                             |
| NICs              | Min 1× 10 GbE + 1× 1 GbE BMC (single-NIC is API-only); **25 GbE for vSAN-ESA**| Up to 64 pNICs/host on VI WLD                          |

> **9.1 management footprint is bigger.** Even with most optional fleet
> components excluded, the management domain runs ~12 appliances / ~120 vCPU,
> because 9.1 deploys a baseline **VCF services runtime** (3 control + 3 worker
> nodes) alongside vCenter, the 3-node NSX Manager cluster and SDDC Manager. It
> grows further with VCF Operations, VCF Automation, Log Management and the
> License Server. Don't reuse a VCF 4.x/5.x host spec — resize on the
> *Management Domain Sizing* sheet against the components you're actually
> deploying.

### Workload Domain

Same shape as Management Domain. Minimum **3 hosts**, 4+ recommended for prod.

## Network

| Requirement                         | Why                                                                  |
| ----------------------------------- | -------------------------------------------------------------------- |
| **Jumbo frames** (MTU 9000)         | Required on vSAN, vMotion, ESX Host Overlay, NSX Edge Overlay, NFS. Overlay needs MTU **≥ 1600** (GENEVE) |
| **BGP** adjacency + AS numbers      | Dynamic routing in the SDDC (NSX Edge ↔ ToR)                         |
| **ECMP** on Edge↔ToR uplinks        | NSX Edge multipath                                                   |
| **vDS teaming**                     | vSphere Distributed Switch teaming for uplink load-balancing + failover |
| **VLANs** per traffic type          | See `01-network-dns-plan.md`                                         |
| **External load balancer** (only if fronting VCF Operations with a VIP) | VCF **never** provides the LB for VCF Operations — bring your own (F5, standalone Avi/NSX ALB, …). Skip it and Operations uses a floating IP. See `05-day2-deployments.md` B.1 |
| **Stretched networks** (multi-AZ)   | VM-mgmt stretched across AZ1↔AZ2; Uplink01/02 + Edge Overlay stretched **only when NSX Centralized connectivity**; routing between AZ1/AZ2 ESXi-mgmt subnets. See `03-multi-az-prep.md` |

## Active Directory

- Supported OS: Windows Server 2019 or 2022.
- Parent domain (forest root) reachable from SDDC components.
- Users + groups from the workbook's *Active Directory Inputs* tab pre-created.
- AD DCs reachable from every management component.

## DHCP (optional but easiest)

- Scope on the **ESX Host Overlay** VLAN: at least `nodes × pNICs` IPs.
  - Example: 4-node cluster × 2 pNICs = 8 IPs minimum.
- Alternative: static IP pool on the overlay TEP (configured in VCF Installer).

## DNS

- Forward + reverse zones for every FQDN in: Mgmt Domain, WLD, and Clusters
  tabs. **All A and PTR records present *before* deploy.**
- Dynamic updates: Nonsecure and secure.
- Replication scope: all DNS servers in the forest.
- Two DNS servers configured on every appliance.
- One **CNAME** wrapping the two NTP A-records for round-robin (see below).

## NTP

- Two external time sources per site (radio/GPS or upstream NTP).
- Two A-records pointing at the two sources.
- One CNAME (e.g. `ntp.sfo.rainpole.io`) → A-record name for round-robin HA.
- AD domain controllers synced to the same external NTP.
- Different time sources for different fault domains / sites.

## SMTP

- Mail relay reachable from each SDDC component (alerting).
- Restrict relay to SDDC management IP range(s).

## Certificate Authority

- Internal CA that can ingest CSRs from SDDC components and issue signed
  certificates.
- Microsoft Enterprise CA must support **Basic authentication**.
- Recommended: Windows Server 2019/2022 with `Certificate Authority` +
  `Certificate Authority Web Enrollment` roles.

## SFTP

- SFTP target reachable from SDDC Manager and NSX Manager for backups.
- Account + write path pre-created.

## Jump host

- VM or physical with **routed** access to: ESXi mgmt, VM mgmt, VCF mgmt,
  internet (for binary downloads if online depot is used).
- Browser + ovftool installed.

## Binaries

| File                                                | Source                                          |
| --------------------------------------------------- | ----------------------------------------------- |
| `VCF-SDDC-Manager-Appliance-9.1.x.0.xxxxxxxx.iso`   | support.broadcom.com                            |
| `VMware-VirtualSAN-Witness-x.x.x-xxxxxxxx.ova`      | support.broadcom.com (only if multi-AZ / vSAN stretched) |

## Sign-off

Customer to confirm in writing that **all** items above are green before the
intake meeting (Step 2). If anything is amber/red, capture the owner, target
date, and risk before starting the workbook.
