# Step 1 — Network / DNS / NTP / AD Plan (one page)

Lock this **before** filling any other workbook page. If you only have time
for one meeting with the network + AD/PKI teams, run it on this
page. Everything in the workbook flows from these decisions.

> **Prefer a spreadsheet?** Download the blank [fillable planning templates](https://pauldiee.github.io/VCF9-DeploymentPlanning/docs/prerequisites/#fillable-planning-templates-download)
> (IP/DNS, VLAN/subnet, NTP/AD/CA, BGP) — capture the plan in CSV, then transfer to the workbook or Coscia's planner.
> For the firewall flows these networks depend on, see [Firewall & Ports](07-firewall-ports.md).

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
| 11| VPC Gateway external (optional)|         | `/24`             |                       | 9000 |                  | External / north-south network for the Distributed Transit Gateway. Only when VPC Gateway = **Distributed** (intake `A10`); the Centralized model is configured post-bringup |
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
| Edge Overlay | Edge TEPs               | `.11–.20`                  |

> **TEP addressing:** prefer a **static IP pool**, entered in the VCF Installer —
> no external DHCP dependency, and no per-AZ scopes in stretched designs. Per
> [Broadcom TechDocs](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/building-your-private-cloud-infrastructure/working-with-workload-domains/deploy-a-vi-workload-domain-using-the-sddc-manager-ui.html)
> either a static IP pool or a DHCP server on the Host Overlay VLAN satisfies
> the prerequisite; pools can also be created per cluster later
> ([Create an IP Pool for Tunnel Endpoint IP Addresses](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/advanced-network-management/transport-zones-and-transport-nodes/create-an-ip-pool-for-tunnel-endpoint-ip-addresses.html)).

**VM Management subnet — the crowded one.** A VCF 9.1 management domain packs a
lot onto this network: ~30–48 IPs. Size it generously (a `/24` is normal — do
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
| NSX Edge nodes (if deployed)    | 2          |             | Mgmt-domain edge cluster; matches `en01`/`en02` in the DNS table below    |
| VCF Automation                  | 5          | `/29`       | Active nodes + buffer for node redeploy / rolling upgrade; allocate a contiguous `/29` (5 IPs) |
| VCF management-services runtime | 12–30      | `/28`–`/27` | Dedicated contiguous block: `/28` = 12 (minimum), `/27` = 30 (recommended) — the headroom absorbs Day-N **Log Management** and **real-time metrics** worker nodes (rows below) |
| Avi Controller cluster (optional)| 4         |             | 3 controller nodes + cluster VIP — only if Avi is the chosen LB (e.g. Supervisor LB choice / Automation HA / tenant LB); see `prerequisites.md` |
| VCF Operations for Networks (optional) | 2 (+2 if Large) |  | Platform node + collector node — lands here when the Day-2 placement is the **Shared Management Network** (a **Large** platform is a 3-node cluster: +2); see `05-day2-deployments.md` |
| VCF Operations for Logs (optional) | — (from runtime block) | | Day-N Log Management: 1 FQDN + 6 IPs, +2 per additional replica — **allocated from the services-runtime block above**, not extra subnet IPs (TechDocs FQDN/IP list); size the block `/27` if Logs is planned. See `05-day2-deployments.md` |
| Real-time metrics (optional)    | — (from runtime block) | | Day-N: 6 IPs, **also allocated from the services-runtime block** (TechDocs FQDN/IP list) |
| Identity Broker                 | —          |             | FQDN only — served from the services-runtime block above, no extra VM Mgmt IP |
| **Approx. total**               | **~30–48** |             | A `/24` VM Mgmt subnet leaves ample room (+4 if the Avi LB is in scope, +2–4 if Ops for Networks shares this subnet; Log Management / real-time metrics come out of the runtime block — size it `/27`) |

> **Separate internal networks — keep off the VM Mgmt subnet.** The VCF services
> runtime uses an *internal* container CIDR, `198.18.0.0/15` by default
> (change to `240.0.0.0/15` or `250.0.0.0/15` if it clashes) — and **VCF
> Automation uses the same kind of internal cluster CIDR, with the same default
> and alternatives** (the *cluster CIDR* captured in intake `B21`; see
> `05-day2-deployments.md` section D). These are internal to the platform, not
> routed appliance IPs — just make sure the blocks do not overlap anything you
> actually route.

---

## B. BGP plan

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

---

## C. DNS

### Two DNS servers (resolver IPs to put into appliances)

| #   | FQDN / hostname           | IPv4         |
| --- | ------------------------- | ------------ |
| 1   |                           |              |
| 2   |                           |              |

### Required A + PTR records (Mgmt Domain — minimum)

Every FQDN below needs **both** an A and a PTR. Add WLD/cluster hosts in the
same shape.

| Role               | Sample FQDN                          | IP source            |
| ------------------ | ------------------------------------ | -------------------- |
| ESXi host 1..N     | `sfo01-m01-r01-esx0N.sfo.example.io` | ESX Mgmt subnet      |
| vCenter            | `sfo-m01-vc01.sfo.example.io`        | VM Mgmt subnet       |
| NSX Manager VIP    | `sfo-m01-nsx01.sfo.example.io`       | VM Mgmt subnet       |
| NSX Manager node 1 | `sfo-m01-nsx01a.sfo.example.io`      | VM Mgmt subnet       |
| NSX Manager node 2 | `sfo-m01-nsx01b.sfo.example.io`      | VM Mgmt subnet       |
| NSX Manager node 3 | `sfo-m01-nsx01c.sfo.example.io`      | VM Mgmt subnet       |
| SDDC Manager       | `sfo-vcf01.sfo.example.io`           | VM Mgmt subnet       |
| VCF Operations VIP | `sfo-vcfops01.sfo.example.io`        | VM Mgmt subnet       |
| VCF Operations node 1–3 | `sfo-vcfops01{a,b,c}.sfo.example.io` | VM Mgmt subnet    |
| Cloud Proxy        | `sfo-cp01.sfo.example.io`            | VM Mgmt subnet       |
| License Server     | `sfo-lic01.sfo.example.io`           | VM Mgmt subnet       |
| Identity Broker    | `sfo-idb01.sfo.example.io`           | services-runtime block |
| VCF Automation VIP | `sfo-vcfauto01.sfo.example.io`       | VM Mgmt subnet       |
| NSX Edge 1         | `sfo-m01-en01.sfo.example.io`        | VM Mgmt subnet       |
| NSX Edge 2         | `sfo-m01-en02.sfo.example.io`        | VM Mgmt subnet       |
| Avi Controller VIP (optional) | `sfo-m01-avi01.sfo.example.io` | VM Mgmt subnet   |
| Avi Controller node 1–3 (optional) | `sfo-m01-avi01{a,b,c}.sfo.example.io` | VM Mgmt subnet |
| VCF Ops for Networks platform (optional) | `sfo-vcfopsnet01.sfo.example.io` | VM Mgmt subnet (or the Day-2 placement network) |
| VCF Ops for Networks collector (optional) | `sfo-vcfopsnet01c.sfo.example.io` | VM Mgmt subnet (or the Day-2 placement network) |
| VCF Ops for Logs VIP (optional) | `sfo-vcflogs01.sfo.example.io` | services-runtime block (integrated LB; the 6+ worker nodes need IPs, not FQDNs) |

### DNS settings checklist

- [ ] Forward + reverse zones for the parent domain
- [ ] Forward + reverse zones for any child / site domains (e.g. `sfo.example.io`)
- [ ] Dynamic updates: **Nonsecure and secure**
- [ ] Zone replication scope: **All DNS servers in this forest**
- [ ] Every FQDN unique; every PTR present
- [ ] No CNAME for any VCF appliance hostname (must be A)

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
