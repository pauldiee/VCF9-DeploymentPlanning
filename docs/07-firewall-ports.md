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
| **License Hub** (connected mode only) | `portal.pulse.broadcom.com` | 443 | TCP | **Avi Cloud Console** — registration, license assignment, usage reporting. Only if **vDefend** is in scope or **Avi uses on-prem licensing**. With Avi on **Cloud Licensing** there is no hub, but each **Avi Controller** then needs this same flow itself (directly or via its proxy). **Not on Broadcom's Public URLs list** — it will not appear in a proxy allowlist built from that page alone |

> **If the egress proxy does SSL inspection (TLS termination/re-signing),
> exclude `eapi.broadcom.com` and `vcf.broadcom.com` from inspection** — VCF
> Operations does not support an SSL-terminating proxy, and there is no
> client-side workaround. This is a rule for the proxy/security team's change
> request, same as the rest of this page; for VCF Operations' own Test
> Connection behavior, the Cloud Proxy Custom CA field, and the Docker
> Subnet CIDR gotcha, see
> [`27-vcf-operations-ha-cloud-proxy-vvf.md`](27-vcf-operations-ha-cloud-proxy-vvf.md#field-notes) —
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

### C.1 Overlay — host TEP ↔ host TEP ↔ Edge TEP

The host TEP VLAN and the Edge TEP VLAN are separate, routed subnets. Every
firewall, router ACL or switch policy **between** them must pass the overlay,
in both directions, between **all** host TEP and Edge TEP subnets (including
each AZ's TEP subnets in a stretched design):

| Source | Destination | Port(s) | Proto | Purpose |
| ------ | ----------- | ------- | ----- | ------- |
| Host TEPs ⇄ Edge TEPs, Host TEPs ⇄ Host TEPs | same (bidirectional) | 6081 | UDP | Geneve encapsulation — the overlay data itself |
| Host TEPs ⇄ Edge TEPs, Host TEPs ⇄ Host TEPs | same (bidirectional) | 3784 | UDP | BFD control — tunnel up/down detection |
| Host TEPs ⇄ Edge TEPs, Host TEPs ⇄ Host TEPs | same (bidirectional) | 4784 | UDP | BFD echo |
| Host TEPs ⇄ Edge TEPs | same (bidirectional) | ICMP echo, type 3 code 4, type 11 | ICMP | Path MTU discovery + troubleshooting (`vmkping`) |

Source: [KB 455157](https://knowledge.broadcom.com/external/article/455157/edge-to-host-transport-node-overlay-tunn.html)
(the KB names no NSX version — it states "VMware NSX" only — so treat it as
general NSX guidance, not 9.1-specific).

> **Why this is easy to miss:**
> - **Ping works, tunnels stay DOWN.** The KB's exact symptom: ICMP between
>   TEPs succeeds, BFD never completes, so the host ↔ Edge tunnels show
>   **DOWN**. A successful ping is not proof the firewall change is done.
> - **The Ports & Protocols portal hides part of it.** Filtering the
>   [portal](https://ports.broadcom.com/) on destination *Edge* (VCF 9.1, NSX)
>   shows *Host Transport Node → NSX Edge nodes, UDP 3784* but **not** Geneve
>   UDP 6081 or BFD echo UDP 4784 (checked 2026-11-05). Use the table above for
>   the TEP change request.
> - **Routing is required.** Without an inter-VLAN route between the host TEP
>   and Edge TEP subnets the tunnels never come up; don't put both on one
>   subnet either — with the Edge TEP on a host-switch segment in the host TEP
>   network, BFD stays down ([KB 428238](https://knowledge.broadcom.com/external/article/428238/nsx-bfd-session-remains-down-when-tep-en.html)).
> - **MTU has to hold across the routed hop, not just inside each VLAN.**
>   Overlay needs ≥ 1600, 1700 recommended (see [`prerequisites.md`](prerequisites.md));
>   an undersized router interface drops large packets silently — e.g. a
>   Supervisor cluster bootstrap failing with `SSL_ERROR_SYSCALL`
>   ([KB 429885](https://knowledge.broadcom.com/external/article/429885/cluster-bootstrap-fails-with-ssl_error_s.html)).
>   Set the Edge TEP MTU in NSX **Global Fabric Settings before** the Edges are
>   deployed — changing it afterwards does not update existing Edges' `fp-eth`
>   interfaces ([KB 422523](https://knowledge.broadcom.com/external/article/422523/unable-to-change-mtu-on-edge-fpeth-inter.html)).
> - **Keep TEP subnets out of vulnerability-scan scope.** Scan traffic aimed at
>   bare-metal Edge TEPs makes BFD flap ([KB 317750](https://knowledge.broadcom.com/external/article?articleNumber=317750)).
> - **The NSX gateway firewall can drop BFD too.** If Edge BFD counters stay at
>   0, check the Tier-0 uplink gateway firewall rules for the BFD ports (the KB
>   lists 3784, 9785 and 4784) — [KB 379112](https://knowledge.broadcom.com/external/article/379112).

**Verify after the change** ([KB 379112](https://knowledge.broadcom.com/external/article/379112)):

```text
# ESX: full-size, don't-fragment ping host TEP -> Edge TEP (1572 = max payload on a 1600 MTU path;
# use 1672 for 1700, 8972 for 9000)
# vmk10 = your host TEP vmkernel (check: esxcli network ip interface list)
vmkping -I vmk10 -S vxlan -d -s 1572 <edge-tep-ip>
nsxdp-cli bfd sessions list

# Edge (admin): VRF ID = the TUNNEL entry in "get logical-routers"
ping <host-tep-ip> source <edge-tep-ip> vrfid <id> size 1572 dfbit enable
get bfd-sessions
```

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
| SDDC Manager | Log Management (cluster VIP / nodes) | **9543** | TCP | Log agent on SDDC Manager → Log Management ingestion API over TLS — **only after the manual agent install** ([KB 396643](https://knowledge.broadcom.com/external/article/396643/deploy-and-configure-vcf-operations-for.html), see [`05` §B.6](05-day2-deployments.md#b6--log-management-does-not-collect-sddc-managers-own-logs)) |
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
> - **SDDC Manager → Log Management, TCP 9543.** On 9.0/9.1.0 SDDC Manager doesn't
>   forward its own logs out of the box (9.1.1 configures it from VCF Operations,
>   see [`05` §B.6](05-day2-deployments.md#b6--log-management-does-not-collect-sddc-managers-own-logs)). The agent is installed by hand
>   ([KB 396643](https://knowledge.broadcom.com/external/article/396643/deploy-and-configure-vcf-operations-for.html)),
>   and the script fails at its first step if 9543 is closed. Listed in the
>   [Ports and Protocols portal](https://ports.broadcom.com/view/) for SDDC Manager 9.1.0
>   (read from a 2026-09-23 capture). Log Management's full in/out flow list
>   (agents, ESX syslog 1514, the Cloud Proxy Log Forwarder, integrations), for
>   VCF and VVF: [`31-log-management.md` §6](31-log-management.md#6-firewall-flows).
> - **Cloud Proxy** needs **443, 4505, 4506** for Telegraf-based app monitoring.
> - **License Server** requires an FQDN/IP **outside** the VCF services-runtime
>   range (IPv4 only) — a routing/reachability point, not just a port.
> - **License Hub needs a DFW *exclusion*, not a rule** (only if vDefend is in
>   scope or Avi uses on-prem licensing — the separate License Hub appliance,
>   not the License Server above). TechDocs, verbatim: *"If the License Hub VMs are running in an NSX
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
> [`27-vcf-operations-ha-cloud-proxy-vvf.md`](27-vcf-operations-ha-cloud-proxy-vvf.md#field-notes) —
> the License Server flows in the table above (no outbound path to Broadcom
> at all) are the port-level fact; the proxy-configuration steps for that
> topology live with the rest of the proxy setup material in docs/09.

---

## F. Backups — everything → SFTP backup target

One port, **TCP 22 (SFTP)** into the backup target. The hard part is the
source list. **The Ports and Protocols portal doesn't help here:** queried
2026-10-21 (SDDC Manager, NSX, VCF Management Services 9.1.0 + 9.1.1,
Identity Broker, VCF Automation, VCF Operations), it lists **no SFTP backup
flow** for any of them. Its only backup-target rows are vCenter's. The rows
below come from field experience and inference, and each row says which.

| Source | Destination | Port | Proto | Purpose / basis |
| ------ | ----------- | ---- | ----- | --------------- |
| **Whole VCF Management Services runtime pool** (the 12–30 IP range) | SFTP backup target | 22 | TCP | Fleet backups (Fleet LCM, Identity Broker, the depot, Salt) and the wizard's validation. They connect from **changing internal addresses** anywhere in the pool, so allow the whole range. Field-observed, see [`08` §5](08-backup-target.md#the-clients-are-the-whole-services-runtime-block) |
| SDDC Manager | SFTP backup target | 22 | TCP | SDDC Manager's own backup |
| NSX Manager, **every node IP** | SFTP backup target | 22 | TCP | NSX pushes its own backups. Allow all nodes, not just the VIP. Our inference from how NSX backups work, not in the 9.1 listing |
| VCF Automation node `/29` (if deployed) | SFTP backup target | 22 | TCP | Automation runs on its **own** services runtime and IP range. Inference, not verified; cheaper to allow than to troubleshoot |
| vCenter (each instance) | SFTP backup target | 22 | TCP | Only if its VAMI file-based backup uses the same target. Listed in the portal (vCenter 9.1.0): *"Outbound SSH for File-Based Backup and Restore over SCP or SFTP"* |
| Jump host (optional) | SFTP backup target | 22 | TCP | Your own testing only. It is **not** the client, so a working test from here proves nothing about the rows above |

> **Not just the port.** The SFTP server must also offer a **superset** of SSH
> algorithms (FIPS and non-FIPS), because the clients above use different SSH
> stacks. Narrowing `sshd_config` to the FIPS set breaks some of them. See
> [`08` §2](08-backup-target.md#2-requirements-and-placement) and
> [§5](08-backup-target.md#the-clients-are-the-whole-services-runtime-block).

---

## G. HCX migration — legacy site ↔ VCF 9.1 (only if in scope)

> Only when workloads move in with VCF Operations HCX
> ([`38-hcx-migration.md`](38-hcx-migration.md)). The legacy side always starts
> the tunnels, so the inbound rules sit on the VCF 9.1 side. Full list:
> [Ports and Protocols](https://ports.broadcom.com/), product *VCF Operations HCX*
> (9.1.0 and 9.1.1 listings differ).

| Source | Destination | Port(s) | Proto | Purpose |
| ------ | ----------- | ------- | ----- | ------- |
| Legacy HCX Manager | VCF 9.1 HCX Manager | 443 | TCP | Site pairing |
| Legacy IX / NE (uplink) | VCF 9.1 IX / NE (uplink) | 4500 | UDP | Tunnels (IKEv2) |
| Legacy IX / NE | VCF 9.1 IX / NE | 4500-4628 → 4500 | UDP | Application Path Resiliency (optional) |
| HCX Manager (each side) | vCenter, NSX Manager, ESX | 443 | TCP | Integration, service mesh deployment |
| HCX Manager (each side) | ESX | 80, 902 | TCP | Service mesh deployment |
| HCX-IX | ESX vMotion IPs | 8000 | TCP | vMotion |
| ESX | HCX-IX | 902, 31031, 32032 | TCP | Migration and replication |
| VCF 9.1 HCX Manager | VCF Identity Broker, License Server | 443 | TCP | VCF SSO, licensing |
| Management workstations | HCX Manager (each side) | 443, 9443, 22 | TCP | UI, appliance management, SSH |

---

## H. Disaster recovery — protected site ↔ recovery site (only if in scope)

> Only with Protection and Recovery
> ([`39-protection-and-recovery.md`](39-protection-and-recovery.md)). Source:
> [Ports and Protocols](https://ports.broadcom.com/), products *Protection and
> Recovery* and *vSphere Replication* (9.1.0 and 9.1.1 listings identical,
> read 2026-11-04). Enhanced replication goes **ESX to ESX** across the sites.

| Source | Destination | Port(s) | Proto | Purpose |
| ------ | ----------- | ------- | ----- | ------- |
| Appliance (protected) | Appliance (recovery) | 443 | TCP | Site-to-site management |
| Appliance | Local and remote vCenter | 443 | TCP | Management |
| Local appliance | Remote appliance | 5480 | TCP | vSphere Replication management |
| ESX (protected site) | ESX (recovery site) | 32032 | TCP | Enhanced vSphere Replication traffic |
| ESX (protected site) | vSphere Replication server (recovery site) | 31031, 32032 | TCP | Legacy vSphere Replication traffic |
| vSphere Replication server (recovery) | ESX (recovery, same site) | 902 | TCP/UDP | Intra-site replication management |
| Appliance | vSphere Replication server / local vCenter | 8123 / 9084 | TCP | Intra-site management |
| Recovery-site appliance | Recovery-site ESX | 902, 443 | TCP | Internal services |
| Management workstations | Appliance | 443, 5480 | TCP | UI, appliance management |

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
- **Day-N, external-facing VCF Automation (Pattern 3):** the Transit Gateway
  firewall rules into the DMZ VPC live in
  [`19-securing-vcf-automation.md`](19-securing-vcf-automation.md#segregating-tenant-traffic-at-the-transit-gateway-pattern-3-tgw-gateway-firewall).
  They include VCFA's health and synthetic-check ports (TCP 8008, 22462,
  30005-30006, 30136) and the fleet manager's TCP 30000-30001 for upgrades,
  which matter once the TGW `default-deny` is enforced.
