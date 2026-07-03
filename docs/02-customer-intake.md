# Step 2 — Customer Intake (role-based)

Use this after the Step 1 network/DNS plan is signed off. Questions are
grouped by **who owns the answer**, so you can send the right section to the
right team and run shorter, more focused conversations.

Every question is tagged with the workbook sheet it feeds, so transferring
answers is mechanical (see `workbook-cell-mapping.md`).

Legend:

- `[MGMT]` → *Deploy Management Domain* sheet
- `[CFG-M]` → *Configure Management Domain* sheet
- `[WLD]` → *Deploy Workload Domain* sheet
- `[CFG-W]` → *Configure Workload Domain* sheet
- `[CLU]` → *Deploy Cluster* sheet
- `[SIZE]` → *Management Domain Sizing* sheet
- `[PLAN]` → *VCF & VVF Planning* sheet
- `[DAYN]` → *Deploy Fleet Management Day-N* sheet

---

## A. Architect / Project decisions

> Owner: solution architect (you + customer lead). 30 min.

| # | Question                                                                            | Sheet     | Default suggestion          |
|---|-------------------------------------------------------------------------------------|-----------|-----------------------------|
|A1 | VCF version to deploy                                                               | `[PLAN]`  | **9.1.0.0**                 |
|A2 | Operation                                                                           | `[PLAN]`  | Deploy a new VCF fleet      |
|A3 | First or additional VCF instance?                                                   | `[PLAN]`  | First instance              |
|A4 | Deployment model: 3-node HA vs. single-node?                                        | `[MGMT]`  | **HA (Three-node)**         |
|A5 | Appliance size: Small / Medium / Large?                                             | `[MGMT]`  | **Medium** (verify in `[SIZE]`)|
|A6 | Existing vCenter to import? VCF Ops? VCF Auto?                                      | `[MGMT]`  | All No (greenfield)         |
|A7 | Storage option: vSAN-ESA / vSAN-OSA / NFS / FC?                                     | `[MGMT]`  | **vSAN-ESA**                |
|A8 | vSAN Data-in-Transit encryption?                                                    | `[MGMT]`  | Off (perf cost; turn on if compliance requires) |
|A9 | Failures To Tolerate (FTT)?                                                         | `[MGMT]`  | 1                           |
|A10| VPC Gateway: Distributed connectivity vs. Centralized?                              | `[MGMT]`  | **Centralized** (configured post-bringup) |
|A11| Dual-stack (IPv4 + IPv6)?                                                           | `[MGMT]`  | IPv4 only unless requirement|
|A12| Separate VCF mgmt network from VM mgmt network?                                     | `[MGMT]`  | Use VM mgmt network         |
|A13| Multiple Availability Zones (stretched)? → if **Yes**, work `03-multi-az-prep.md` | `[MGMT]`  | No (single AZ)              |
|A14| Number of management hosts (4–16)                                                   | `[MGMT]`  | 4                           |
|A15| Number of WLDs at GA, plus number of clusters in each                               | `[WLD]`   | 1 WLD, 1 cluster            |
|A16| CEIP (telemetry) on?                                                                | `[MGMT]`  | On                          |
|A17| Which fleet components at bring-up vs. **Day-2**? (VCF Automation, Ops for Logs/Networks) → `05-day2-deployments.md` | `[DAYN]`  | VCF Automation Day-2         |

---

## B. Network team

> Owner: network engineering. 60 min. Refer to Step 1 plan for raw values.

| # | Question                                                       | Sheet      |
|---|----------------------------------------------------------------|------------|
|B1 | ESX Mgmt: VLAN, MTU=1500, IPv4 gateway CIDR                    | `[MGMT]`   |
|B2 | VM Mgmt: VLAN, MTU=1500, IPv4 gateway CIDR                     | `[MGMT]`   |
|B3 | VCF Mgmt (if separate): VLAN, MTU, gateway CIDR                | `[MGMT]`   |
|B4 | VCF Management Services IP range — `/28` (12, min) to `/27` (30); lives inside the VM Mgmt subnet | `[MGMT]`   |
|B5 | VCF Automation IP range — 5 IPs, allocate a `/29`; inside the VM Mgmt subnet (Shared-Network placement; other placements see `B21`) | `[MGMT]`   |
|B6 | vMotion: VLAN, MTU=9000, gateway CIDR, host IP range           | `[MGMT]`   |
|B7 | vSAN: VLAN, MTU=9000, gateway CIDR, host IP range              | `[MGMT]`   |
|B8 | ESX Host Overlay: VLAN, MTU=9000, gateway CIDR; static TEP pool (recommended) or DHCP? If static: pool range | `[MGMT]`   |
|B9 | NSX Edge Overlay: VLAN, MTU=9000, gateway CIDR, IP range       | `[CFG-M]`  |
|B10| NSX Edge Uplink-01: VLAN, /29 or /30, edge IP, ToR peer IP     | `[CFG-M]`  |
|B11| NSX Edge Uplink-02: VLAN, /29 or /30, edge IP, ToR peer IP     | `[CFG-M]`  |
|B12| Customer NSX Edge AS number                                    | `[CFG-M]`  |
|B13| ToR-A / ToR-B AS numbers                                       | `[CFG-M]`  |
|B14| BGP MD5 password (per peer) — **optional**, only if BGP authentication is enabled | `[CFG-M]`  |
|B15| BFD on edge uplinks? (recommended)                             | `[CFG-M]`  |
|B16| Routes to advertise / receive?                                 | `[CFG-M]`  |
|B17| DHCP scope details for ESX Host Overlay (if DHCP)              | `[MGMT]`   |
|B18| SFTP host, port, account, target path                          | `[CFG-M]`  |
|B19| Proxy (only if online depot needs it): FQDN, port, auth?       | `[MGMT]`   |
|B20| VPC Gateway external network (only if `A10` = Distributed): VLAN, gateway CIDR | `[MGMT]`   |
|B21| Day-2 fleet network (if not Shared Mgmt): placement (Dedicated Mgmt / NSX Overlay Segment / NSX VLAN Segment) + networkName, subnet, gateway, IP pool, VCF Automation cluster CIDR → `05-day2-deployments.md` | `[DAYN]`  |
|B22| Public / upstream peering (optional) — needed? If so: peer AS, peer IP, MD5, advertised/received prefixes; own uplink subnet if not sharing the Edge uplinks → `01-network-dns-plan.md` §B | `[CFG-M]`  |

---

## C. AD / DNS / NTP team

> Owner: Windows / identity / DNS admin. 30 min.

| # | Question                                                       | Sheet     |
|---|----------------------------------------------------------------|-----------|
|C1 | AD forest root domain name                                     | `[CFG-M]` |
|C2 | Site / child domain (if any)                                   | `[CFG-M]` |
|C3 | DC FQDNs (at least two)                                        | `[CFG-M]` |
|C4 | LDAPS reachable from VM Mgmt subnet?                           | `[CFG-M]` |
|C5 | SSO bind service account (DN + password owner)                 | `[CFG-M]` |
|C6 | SDDC admin / operator / viewer AD group DNs                    | `[CFG-M]` |
|C7 | DNS server #1 / #2 IP addresses                                | `[MGMT]`  |
|C8 | Default DNS suffix for VCF (e.g. `sfo.example.io`)             | `[MGMT]`  |
|C9 | Confirmation: every FQDN from `01-network-dns-plan.md` has A+PTR| Prereq   |
|C10| NTP source #1 / #2 FQDNs (and CNAME wrapper)                   | `[MGMT]`  |
|C11| AD DCs syncing to the same NTP sources                         | Prereq    |

---

## D. PKI / certificate team

> Owner: CA admin. 20 min.

| # | Question                                                       | Sheet     |
|---|----------------------------------------------------------------|-----------|
|D1 | Internal CA type — **Microsoft CA** or **OpenSSL** (fleet cert management); external CA is CSR-based only (VCF won't import an externally-created cert+key) | `[CFG-M]` |
|D2 | CA root + intermediate certificate (PEM)                       | `[CFG-M]` |
|D3 | CSR submission method (Web Enrollment / other)                 | `[CFG-M]` |
|D4 | Template name to issue VMware certs                            | `[CFG-M]` |
|D5 | SAN policy: per-host SAN or wildcard?                          | `[CFG-M]` |
|D6 | Cert validity period and renewal owner                         | `[CFG-M]` |

---

## E. Platform / virtualization team

> Owner: VMware/platform engineer. 60 min.

| # | Question                                                       | Sheet     |
|---|----------------------------------------------------------------|-----------|
|E1 | VCF instance name (≥3 chars, e.g. `San Francisco`)             | `[MGMT]`  |
|E2 | Management domain name (e.g. `sfo-m01`)                        | `[MGMT]`  |
|E3 | ESXi host FQDNs (Host #1 .. Host #N)                           | `[MGMT]`  |
|E4 | ESXi root password (single password, all hosts)                | `[MGMT]`  |
|E5 | ESXi host iLO/iDRAC inventory (out-of-band, separate doc)      | Prereq    |
|E6 | vCenter FQDN + IP                                              | `[MGMT]`  |
|E7 | SDDC Manager FQDN + IP — the **VCF Installer** is deployed with this IP+FQDN (on a mgmt host) and becomes SDDC Manager | `[MGMT]`  |
|E8 | NSX Manager VIP FQDN + IP, plus 3 node FQDNs + IPs             | `[MGMT]`  |
|E9 | VCF Operations — 3 analytics node FQDNs+IPs (primary/replica/data). Default cluster address is a **floating IP** (no LB). A **load-balancer VIP** is optional and, if used, must be an **external LB (never provided by VCF)** — capture the VIP FQDN+IP and put every node FQDN **+ the LB FQDN** in the cert SAN → `05-day2-deployments.md` B.1 | `[MGMT]`  |
|E10| VCF Automation — appliance/cluster FQDN+IP + VCF services-runtime FQDN; nodes come from the `/29` range (`B5`), or the non-shared placement network (`B21`) | `[MGMT]`  |
|E11| NSX Edge node 1 / 2 FQDNs + IPs                                | `[CFG-M]` |
|E12| Cluster / vDS / DPG naming conventions                         | `[MGMT]`  |
|E13| Any VI Workload Domains at GA? → capture each in **section H** below | `[WLD]`   |
|E14| VCF fleet/services FQDNs new in 9.x — Cloud Proxy, License Server, Identity Broker, VCF services runtime (each needs A+PTR+IP); several may be Day-2 → `05-day2-deployments.md` | `[MGMT]`  |
|E15| VCF Automation Day-2 deployment: **method** (SDDC Manager API vs. via VCF Operations) + **network placement** (Shared Mgmt / Dedicated Mgmt / NSX Overlay Segment / NSX VLAN Segment) → `05-day2-deployments.md` | `[DAYN]`  |
|E16| **Avi Load Balancer** (only if Supervisor / Automation-HA / tenant LB): controller size (Small / Large / XLarge), 3 controller node FQDNs+IPs + cluster VIP FQDN+IP (VM Mgmt subnet, A+PTR) → `prerequisites.md` | Prereq    |

---

## F. Security / passwords

> Owner: customer security lead. 15 min.

Capture in a password manager — not in this file. The intake just confirms
**who owns each password** so it's available on deploy day.

| # | Component                              | Owner | Sheet     |
|---|----------------------------------------|-------|-----------|
|F1 | ESXi `root`                            |       | `[MGMT]`  |
|F2 | vCenter `administrator@vsphere.local`  |       | `[MGMT]`  |
|F3 | vCenter `root`                         |       | `[MGMT]`  |
|F4 | SDDC Manager `vcf` / `root` / `admin`  |       | `[MGMT]`  |
|F5 | NSX Manager `admin` / `audit` / `root` |       | `[MGMT]`  |
|F6 | VCF Operations admin                   |       | `[MGMT]`  |
|F7 | VCF Automation admin                   |       | `[MGMT]`  |
|F8 | NSX Edge `admin` / `audit` / `root`    |       | `[CFG-M]` |
|F9 | SSO bind account                       |       | `[CFG-M]` |
|F10| Backup encryption passphrase           |       | `[CFG-M]` |
|F11| Avi controller `admin` / VCF Ops admin (break-glass) — only if Avi LB in scope |       | Prereq    |

Password policy: minimum 15 chars, mix of upper/lower/digit/special; no spaces.
VMware appliances reject `<` `>` `&` `'` `"` in some fields — avoid them.

---

## G. Depot / binaries

> Owner: project manager / customer ops. 10 min.

| # | Question                                                       | Sheet     |
|---|----------------------------------------------------------------|-----------|
|G1 | Online or offline depot?                                       | `[MGMT]`  |
|G2 | Download Service ID (online only)                              | `[MGMT]`  |
|G3 | Activation Code (online only)                                  | `[MGMT]`  |
|G4 | Offline depot FQDN + port (offline only)                       | `[MGMT]`  |
|G5 | Proxy required? (FQDN, port, auth)                             | `[MGMT]`  |

---

## H. Workload Domain / Cluster

> Owner: VMware / platform engineer. **Repeat the whole block per VI Workload
> Domain**, and the cluster rows (H7–H11) **per additional cluster**. Skip
> entirely if the deployment is management-domain-only at GA. New VLANs/subnets
> per WLD come from Step 1 (`01-network-dns-plan.md`).

> **Sizing gotcha:** a WLD's **vCenter (1 IP) and NSX Manager cluster (3 nodes +
> VIP = 4 IPs)** land on the **management** VM Management subnet, not the WLD's
> own networks. Every extra WLD therefore consumes **5 more IPs** on the mgmt
> VM Mgmt `/24` — account for it in the Step 1 carve-out.

WLD-level:

| # | Question                                                                                  | Sheet   |
|---|-------------------------------------------------------------------------------------------|---------|
|H1 | WLD name (e.g. `sfo-w01`) + deployment type (full deployment with cluster)                 | `[WLD]` |
|H2 | WLD vCenter FQDN + IP, SSO domain (e.g. `sfo-w01.local`). vCenter IP is on the **mgmt VM Mgmt** subnet | `[WLD]` |
|H3 | NSX Manager: new instance or shared? If new — 3 node FQDNs+IPs + cluster VIP FQDN+IP (all on the **mgmt VM Mgmt** subnet) | `[WLD]` |
|H4 | NSX connectivity: **Centralized** or **Distributed**? If Distributed — external VLAN + gateway CIDR + 2 Virtual Network Appliance FQDNs/IPs (on the ESX Mgmt network) | `[WLD]` |
|H5 | Enable **vSphere Supervisor**? (requires centralized edge gateway; needs Service CIDR + control-plane IP range) | `[WLD]` |
|H6 | Principal storage: vSAN-ESA / vSAN-OSA / VMFS-on-FC / NFS / vVols; storage-policy FTT      | `[WLD]` |

Cluster-level (repeat per cluster):

| # | Question                                                                                  | Sheet   |
|---|-------------------------------------------------------------------------------------------|---------|
|H7 | Cluster name (e.g. `sfo-w01-cl01`), image, host FQDNs (3–16)                               | `[CLU]` |
|H8 | Per-cluster networks (own VLANs/subnets): ESX Mgmt (MTU 1500), vMotion (9000), vSAN (9000), Host Overlay TEP (9000, static pool); optional vSAN Storage Client / Storage Cluster networks | `[CLU]` |
|H9 | vDS layout: one vDS for all traffic, or separate secondary/tertiary vDS (e.g. dedicated vSAN / overlay). MTU 9000, 2 uplinks, LACP? | `[CLU]` |
|H10| NSX host overlay: TEP VLAN + static IP-pool CIDR/range, uplink profile, transport zones    | `[CLU]` |
|H11| **Stretched cluster?** If multi-AZ, work `03-multi-az-prep.md` — witness, AZ2 host networks, fault-domain mapping, per-AZ overlay | `[CLU]` |
|H12| WLD password owners: WLD vCenter SSO / root, NSX `admin` / `audit` / `root`                | `[WLD]` |

---

## TechDocs references

Authoritative Broadcom pages behind the biggest intake decisions:

- **A1–A17 (scope & models):** [VCF 9.1 Planning and Preparation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation.html) — the workbook's TechDocs companion
- **A10 / H4 (Centralized vs Distributed connectivity):** [Set up Centralized Connectivity with Edge Clusters](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/advanced-network-management/administration-guide/setting-up-network-connectivity/setting-up-centralized-connectivity-with-edge-clusters.html)
- **B8 / H10 (Host Overlay TEP pools):** [Create an IP Pool for Tunnel Endpoint IP Addresses](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/advanced-network-management/transport-zones-and-transport-nodes/create-an-ip-pool-for-tunnel-endpoint-ip-addresses.html)
- **C7–C9 / E6–E14 (FQDNs & IPs):** [VCF Components FQDNs and IP addresses](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/vcf-components-fqdns-and-ip-addresses.html)
- **C1–C6 (identity):** [Configure an Identity Provider](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/fleet-management/what-is/setting-up-sso/cofigure-vmware-cloud-foundation-identity-provider.html)
- **D1–D6 (certificates):** [Managing Certificates in VMware Cloud Foundation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/fleet-management/certificate-management-9-0.html)
- **H5 (vSphere Supervisor):** [vSphere Supervisor Platform](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsphere-supervisor-installation-and-configuration.html)
- **H11 (stretched clusters):** [Stretching vSAN Clusters](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/stretching-clusters.html)

---

## Closing

When every section above has answers, the workbook can be filled in one
sitting. Cross-reference `workbook-cell-mapping.md` to know exactly which
cell each answer goes into.
