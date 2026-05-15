# Customer Prerequisites — Gate Before Any Workbook Inputs

This list mirrors the **Prerequisite Checklist** sheet of the official
workbook. If any item is RED for the customer, fix it before spending a single
meeting on the rest of the workbook — every later answer depends on these.

## Hardware

### Management Domain

| Item              | Minimum                                                                       | Notes                                                  |
| ----------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| Host count        | 2 (NFS/FC), 3 (vSAN min), **4 recommended** for production HA                 | VCF supports 3-node vSAN WLDs; 4+ for prod             |
| CPU               | VCG-supported                                                                 | Check <https://compatibilityguide.broadcom.com>        |
| Memory            | ~1 TB per host (Rainpole reference, 4 hosts, single-host failure tolerance)   | Confirm via *Management Domain Sizing* sheet           |
| Boot storage      | M.2/SATADOM/SSD — **NOT SD cards** (legacy)                                   |                                                        |
| vSAN-OSA cache    | All-flash, ~1.2 TB raw per host, two disk groups                              | Skip if vSAN-ESA / NFS / FC                            |
| vSAN-OSA capacity | All-flash, ~12.5 TB raw per host                                              | Skip if vSAN-ESA / NFS / FC                            |
| vSAN-ESA          | ~12.5 TB raw per host, e.g. 4× 3.2 TB NVMe SSDs                               | Recommended for new builds                             |
| NICs              | Min 1× 10 GbE + 1× 1 GbE BMC (single-NIC is API-only); **25 GbE for vSAN-ESA**| Up to 64 pNICs/host on VI WLD                          |

### Workload Domain

Same shape as Management Domain. Minimum **3 hosts**, 4+ recommended for prod.

## Network

| Requirement                         | Why                                                                  |
| ----------------------------------- | -------------------------------------------------------------------- |
| **Jumbo frames** (MTU 9000)         | Required on vSAN, vMotion, ESX Host Overlay, NSX Edge Overlay, NFS   |
| **BGP** adjacency + AS numbers      | Dynamic routing in the SDDC (NSX Edge ↔ ToR)                         |
| **ECMP** on Edge↔ToR uplinks        | NSX Edge multipath                                                   |
| **VLANs** per traffic type          | See `01-network-dns-plan.md`                                         |
| **Stretched networks** (MR only)    | VM-mgmt, Uplink01/02, Edge Overlay stretched across AZ1↔AZ2          |

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
| `VMware-VirtualSAN-Witness-x.x.x-xxxxxxxx.ova`      | support.broadcom.com (only if MR / vSAN stretched) |

## Sign-off

Customer to confirm in writing that **all** items above are green before the
intake meeting (Step 2). If anything is amber/red, capture the owner, target
date, and risk before starting the workbook.
