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
> Grab the [firewall-request template](https://vcf-planning.hollebollevsan.nl/templates/firewall-request-plan.csv) (CSV) to hand them.

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
| **License Hub** (connected mode only) | `portal.pulse.broadcom.com` | 443 | TCP | **Avi Cloud Console** — registration, license assignment, usage reporting. Only if **vDefend or Avi** is in scope. **Not on Broadcom's Public URLs list** — it will not appear in a proxy allowlist built from that page alone |

> **If the egress proxy does SSL inspection (TLS termination/re-signing),
> exclude `eapi.broadcom.com` and `vcf.broadcom.com` from inspection** — VCF
> Operations does not support an SSL-terminating proxy, and there is no
> client-side workaround. This is a rule for the proxy/security team's change
> request, same as the rest of this page; for VCF Operations' own Test
> Connection behavior, the Cloud Proxy Custom CA field, and the Docker
> Subnet CIDR gotcha, see
> [`09-binary-depot.md` §5.2–§5.3](09-binary-depot.md#52-ssl-inspecting-tls-terminating-proxies) —
> that's proxy *configuration* detail, which lives with the rest of the
> proxy setup material rather than the port tables here.

## B. Admin / management access — jump host → management

| Source | Destination | Port(s) | Proto | Purpose |
| ------ | ----------- | ------- | ----- | ------- |
| Jump / bastion host | vCenter, SDDC Manager, NSX Manager, VCF Operations | 443 | TCP | Admin UIs / APIs |
| Jump / bastion host | ESXi hosts, appliances | 22 | TCP | SSH (as needed) |
| Jump / bastion host | ESXi hosts | 902 | TCP | Host management / console |
| vCenter | ESXi hosts | 443 | TCP | Host management (vpxa) |
| vCenter ⇄ ESXi hosts | vCenter ⇄ ESXi hosts | 902 | TCP/UDP | Heartbeat, NFC file transfer |

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
| VCF Operations endpoint VM | VCF Operations Cloud Proxy | 443, 4505-4506, 8443 | TCP | Endpoint HTTPS, Salt control plane, Telegraf app monitoring |
| VCF Operations Cloud Proxy | VCF Operations cluster nodes | 443 | TCP | Cloud Proxy to cluster |
| VCF Operations Cloud Proxy | ESX management IPs | 443 | TCP | Cloud Proxy to ESXi hosts hosting endpoint VMs |
| Management workstations | VCF Operations cluster nodes | 443, 80, 22 | TCP | UI/API, HTTP redirect, admin SSH |
| VCF Operations cluster nodes | vCenter (Management IP) | 443 | TCP | vCenter integration |
| vCenter (Management IP) | License Server (Management IP) | 443 | TCP | License synchronization with vCenter |
| License Server (Management IP) | VCF Operations (Management IP) | 443 | TCP | License Server sends status updates to VCF Operations |
| Management components | vCenter (syslog) | **1514** | TCP | Syslog — **9.1 change: use 1514 (TLS); plain 514 is blocked** |
| Fleet appliances | VCF Operations / License Server | 443 | TCP | Fleet management, licensing |
| Jump / bastion host, VCF Operations | Avi Controller VIP + nodes | 443 | TCP | Avi controller UI / API (only if Avi LB in scope) |
| Avi Service Engines | Avi Controllers | 8443 | TCP | SE ↔ controller secure channel (full Avi matrix: see the tools above) |

> **VCF Operations and License Server, verified 2026-09-15 against the
> [Broadcom Ports and Protocols portal](https://ports.broadcom.com/view/)**
> (VCF release 9.1, `VCF Operations` + `VCF Management Services` products,
> 118 rows total). The table above pulls out the deployment-critical subset;
> notably the License Server flows (443 both directions, vCenter ⇄ License
> Server ⇄ VCF Operations) aren't documented anywhere else in this repo. The
> full 118-row set also covers VCF Operations Cloud Proxy internals (Gemfire,
> Postgres, ClickHouse), AD/DNS/NTP/SNMP/SMTP client flows, and Log Assist
> Worker flows to NSX/vCenter/ESXi/SDDC Manager — pull those from the portal
> directly rather than hand-copying them here, they change often.

> **9.1 gotchas worth flagging to the firewall team:**
> - **Syslog moved 514 → 1514.** vCenter 9.1 blocks the unencrypted 514; syslog
>   must use **1514 (TLS)** — [Broadcom KB 430675](https://knowledge.broadcom.com/external/article/430675/vcenter-server-syslog-messages-are-not-r.html).
>   The full vCenter port list is on TechDocs:
>   [Required Ports for vCenter](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vcenter-installation-and-setup/deploying-the-vcenter-server-appliance/vcenter-server-appliance-requirements/required-ports-for-vcenter-server.html).
> - **Cloud Proxy** needs **443, 4505, 4506** for Telegraf-based app monitoring.
> - **License Server** requires an FQDN/IP **outside** the VCF services-runtime
>   range (IPv4 only) — a routing/reachability point, not just a port.
> - **License Hub needs a DFW *exclusion*, not a rule** (only if vDefend or Avi
>   is in scope — the separate SSP-deployed appliance, not the License Server
>   above). TechDocs, verbatim: *"If the License Hub VMs are running in an NSX
>   overlay network, NSX VLAN segments, and security-enabled port groups, add
>   the License Hub VMs to a **firewall exclusion list**."* No reason is given.
>   This is the one entry on this page that is **not** a port to open — it is a
>   policy carve-out, and it has to come from whoever owns **vDefend DFW**
>   policy, so raise it with them rather than with the perimeter firewall team.
>   Do it **before** the deploy: the appliance being licensed by the product
>   that is filtering it is an awkward thing to debug afterwards. See
>   [`prerequisites.md`](prerequisites.md) → License Hub.

> **Proxying licensing traffic without a `VSP` (VVF / standalone VCF
> Operations)?** See
> [`09-binary-depot.md` §5.1](09-binary-depot.md#51-proxying-vcf-operations-without-a-vcf-management-services-runtime-vvf--standalone) —
> the License Server flows in the table above (no outbound path to Broadcom
> at all) are the port-level fact; the proxy-configuration steps for that
> topology live with the rest of the proxy setup material in docs/09.

---

## Using this with the toolkit

- The [firewall-request template](https://vcf-planning.hollebollevsan.nl/templates/firewall-request-plan.csv)
  turns the above into a fill-in change request (source zone / destination /
  port / protocol / direction / purpose / status) for the security team.
- These flows are gated in `prerequisites.md` (core services reachable) and
  surface in the deployment plan (witness routing, depot, License Server, Cloud
  Proxy).
- For anything not listed here, generate the exact ports from Coscia's Ports &
  Protocols matrix or the Broadcom portal above — **do not** treat this page as
  the complete list.
