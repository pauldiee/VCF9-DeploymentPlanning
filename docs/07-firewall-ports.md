# Firewall Dependencies & Ports

VCF 9.1 has hundreds of component-to-component flows. **This page does not list
them all** — the full, version-accurate matrix lives in the two authoritative
tools below. What this page gives you is the **curated set of cross-zone flows
that block a deployment if they are missed** — the ones the firewall /
security team must open *before and during* bring-up — grouped the way a firewall
team thinks (by zone, not by component).

> **Get the exhaustive, current list from a tool — don't hand-maintain it:**
> - **[Coscia's VCF Planner](https://vcfplanning.lcoscia.fr/)** — includes a
>   browsable **Ports & Protocols matrix (1,083 entries)**; friendlier to filter
>   than the vendor portal.
> - **[Broadcom Ports & Protocols portal](https://ports.broadcom.com/network-diagrams/VMware-Cloud-Foundation)** —
>   vendor-authoritative: select your VCF components and it generates the complete
>   source → destination → port list.
>
> Use those for the definitive per-component detail; use this page to make sure
> the **deployment-critical** flows are on the firewall team's change request.
> Grab the [firewall-request template](https://pauldiee.github.io/VCF9-DeploymentPlanning/templates/firewall-request-plan.csv) (CSV) to hand them.

Ports below are the well-known/high-confidence ones; where a flow's exact port
varies by component, the flow is named and the specifics are left to the tools
above.

---

## A. Prerequisite services — management → shared infrastructure

These are the classic bring-up blockers: if DNS/NTP/AD/CA/depot aren't reachable
from the management network, bring-up fails.

| Source | Destination | Port(s) | Proto | Purpose |
| ------ | ----------- | ------- | ----- | ------- |
| Management subnets | DNS servers | 53 | TCP/UDP | Forward + reverse resolution |
| Management subnets | NTP servers | 123 | UDP | Time sync (must be in sync) |
| Management subnets | AD domain controllers | 88, 389, 636, 3268/3269 | TCP/UDP | Kerberos, LDAP/LDAPS, Global Catalog |
| Management subnets | Certificate Authority | 443 (+ CA-specific) | TCP | Certificate enrollment / signing |
| Management subnets | Software depot | 443 | TCP | Binary / bundle download (online or local depot) |

### A.1 Outbound public URLs — online depot / licensing / CEIP

The concrete allowlist behind the "Software depot" row, from the TechDocs
[Public URLs list](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/public-urls-required-for-vmware-cloud-foundation.html)
(full per-URL source breakdown in [`prerequisites.md`](prerequisites.md)).
All outbound TCP 443 — via the egress proxy if one is in path (intake `G5`).
Air-gapped: only the **VCF Download Tool** host needs these.

| Source | Destination | Port(s) | Proto | Purpose |
| ------ | ----------- | ------- | ----- | ------- |
| VCF Installer, SDDC Manager, vCenter, VCF Operations, depot services runtime, VCF Download Tool | `dl.broadcom.com`, `eapi.broadcom.com`, `vvs.broadcom.com`, `vsanhealth.vmware.com`, `projects.packages.broadcom.com` | 443 | TCP | Online depot binaries, compatibility + vSAN HCL data |
| SDDC Manager, VCF services runtime instances | `vcsa.vmware.com` | 443 | TCP | CEIP telemetry |
| VCF Operations | `vcf.broadcom.com`, `eapi.broadcom.com` | 443 | TCP | Licensing |
| SDDC Manager, VCF Download Tool | `auth.esp.vmware.com` | 443 | TCP | Update Manager Download Service (UMDS) |
| Cloud Proxy | `eapi.broadcom.com` | 443 | TCP | Cloud Proxy connectivity |

## B. Admin / management access — jump host → management

| Source | Destination | Port(s) | Proto | Purpose |
| ------ | ----------- | ------- | ----- | ------- |
| Jump / bastion host | vCenter, SDDC Manager, NSX Manager, VCF Operations | 443 | TCP | Admin UIs / APIs |
| Jump / bastion host | ESXi hosts, appliances | 22 | TCP | SSH (as needed) |
| Jump / bastion host | ESXi hosts | 902 | TCP | Host management / console |

## C. NSX fabric & north-south — Edge ↔ ToR

| Source | Destination | Port(s) | Proto | Purpose |
| ------ | ----------- | ------- | ----- | ------- |
| NSX Edge nodes | ToR switches | 179 | TCP | BGP peering |
| NSX Edge nodes | ToR switches | 3784/3785 | UDP | BFD (if enabled) |

## D. Multi-AZ / stretched — inter-AZ + witness

Only if the cluster is stretched (see `03-multi-az-prep.md`).

| Source | Destination | Port(s) | Proto | Purpose |
| ------ | ----------- | ------- | ----- | ------- |
| AZ1 ⇄ AZ2 (per-AZ networks) | AZ1 ⇄ AZ2 | vSAN / vMotion / overlay | — | Stretched cluster data + overlay (routed between AZs) |
| ESX-Management (AZ1 & AZ2) | Witness site | vSAN witness traffic | TCP | Witness traffic rides the ESX-Management VMkernel (WTS); route to the 3rd site (≤ 200 ms) |

## E. Fleet — Operations, Cloud Proxy, License Server, syslog

> Cloud Proxy and the (first) License Server are deployed **automatically at
> bring-up** in 9.1 — open these flows *before* bring-up, not as a Day-2
> follow-up.

| Source | Destination | Port(s) | Proto | Purpose |
| ------ | ----------- | ------- | ----- | ------- |
| Collected endpoints / Cloud Proxy | VCF Operations | 443, 4505, 4506 | TCP | Operations collection; Telegraf app monitoring (9.1) |
| Management components | vCenter (syslog) | **1514** | TCP | Syslog — **9.1 change: use 1514 (TLS); plain 514 is blocked** |
| Fleet appliances | VCF Operations / License Server | 443 | TCP | Fleet management, licensing |
| Jump / bastion host, VCF Operations | Avi Controller VIP + nodes | 443 | TCP | Avi controller UI / API (only if Avi LB in scope) |
| Avi Service Engines | Avi Controllers | 8443 | TCP | SE ↔ controller secure channel (full Avi matrix: see the tools above) |

> **9.1 gotchas worth flagging to the firewall team:**
> - **Syslog moved 514 → 1514.** vCenter 9.1 blocks the unencrypted 514; syslog
>   must use **1514 (TLS)** — [Broadcom KB 430675](https://knowledge.broadcom.com/external/article/430675/vcenter-server-syslog-messages-are-not-r.html).
>   The full vCenter port list is on TechDocs:
>   [Required Ports for vCenter](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vcenter-installation-and-setup/deploying-the-vcenter-server-appliance/vcenter-server-appliance-requirements/required-ports-for-vcenter-server.html).
> - **Cloud Proxy** needs **443, 4505, 4506** for Telegraf-based app monitoring.
> - **License Server** requires an FQDN/IP **outside** the VCF services-runtime
>   range (IPv4 only) — a routing/reachability point, not just a port.

---

## Using this with the toolkit

- The [firewall-request template](https://pauldiee.github.io/VCF9-DeploymentPlanning/templates/firewall-request-plan.csv)
  turns the above into a fill-in change request (source zone / destination /
  port / protocol / direction / purpose / status) for the security team.
- These flows are gated in `prerequisites.md` (core services reachable) and
  surface in the deployment plan (witness routing, depot, License Server, Cloud
  Proxy).
- For anything not listed here, generate the exact ports from Coscia's Ports &
  Protocols matrix or the Broadcom portal above — **do not** treat this page as
  the complete list.
