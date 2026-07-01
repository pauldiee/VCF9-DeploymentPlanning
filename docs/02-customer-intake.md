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

---

## B. Network team

> Owner: network engineering. 60 min. Refer to Step 1 plan for raw values.

| # | Question                                                       | Sheet      |
|---|----------------------------------------------------------------|------------|
|B1 | ESX Mgmt: VLAN, MTU=1500, IPv4 gateway CIDR                    | `[MGMT]`   |
|B2 | VM Mgmt: VLAN, MTU=1500, IPv4 gateway CIDR                     | `[MGMT]`   |
|B3 | VCF Mgmt (if separate): VLAN, MTU, gateway CIDR                | `[MGMT]`   |
|B4 | VCF Management Services IP range — `/28` (12, min) to `/27` (30); lives inside the VM Mgmt subnet | `[MGMT]`   |
|B5 | VCF Automation IP range — 5 IPs, allocate a `/29`; inside the VM Mgmt subnet | `[MGMT]`   |
|B6 | vMotion: VLAN, MTU=9000, gateway CIDR, host IP range           | `[MGMT]`   |
|B7 | vSAN: VLAN, MTU=9000, gateway CIDR, host IP range              | `[MGMT]`   |
|B8 | ESX Host Overlay: VLAN, MTU=9000, gateway CIDR; DHCP or static?| `[MGMT]`   |
|B9 | NSX Edge Overlay: VLAN, MTU=9000, gateway CIDR, IP range       | `[CFG-M]`  |
|B10| NSX Edge Uplink-01: VLAN, /29 or /30, edge IP, ToR peer IP     | `[CFG-M]`  |
|B11| NSX Edge Uplink-02: VLAN, /29 or /30, edge IP, ToR peer IP     | `[CFG-M]`  |
|B12| Customer NSX Edge AS number                                    | `[CFG-M]`  |
|B13| ToR-A / ToR-B AS numbers                                       | `[CFG-M]`  |
|B14| BGP MD5 password (per peer)                                    | `[CFG-M]`  |
|B15| BFD on edge uplinks? (recommended)                             | `[CFG-M]`  |
|B16| Routes to advertise / receive?                                 | `[CFG-M]`  |
|B17| DHCP scope details for ESX Host Overlay (if DHCP)              | `[MGMT]`   |
|B18| SFTP host, port, account, target path                          | `[CFG-M]`  |
|B19| Proxy (only if online depot needs it): FQDN, port, auth?       | `[MGMT]`   |
|B20| VPC Gateway external network (only if `A10` = Distributed): VLAN, gateway CIDR | `[MGMT]`   |

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
|D1 | Internal CA type (MS Enterprise / OpenSSL / Other)             | `[CFG-M]` |
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
|E7 | SDDC Manager FQDN + IP                                         | `[MGMT]`  |
|E8 | NSX Manager VIP FQDN + IP, plus 3 node FQDNs + IPs             | `[MGMT]`  |
|E9 | VCF Operations — 3 analytics node FQDNs+IPs (primary/replica/data); optional load-balancer VIP FQDN+IP for HA | `[MGMT]`  |
|E10| VCF Automation — appliance/cluster FQDN+IP + VCF services-runtime FQDN; nodes come from the `/29` range (`B5`) | `[MGMT]`  |
|E11| NSX Edge node 1 / 2 FQDNs + IPs                                | `[CFG-M]` |
|E12| Cluster / vDS / DPG naming conventions                         | `[MGMT]`  |
|E13| WLD: name, hosts, networks (repeat block from `[WLD]` sheet)   | `[WLD]`   |
|E14| VCF fleet/services FQDNs new in 9.x — Cloud Proxy, License Server, Identity Broker, VCF services runtime (each needs A+PTR+IP) | `[MGMT]`  |

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

## Closing

When every section above has answers, the workbook can be filled in one
sitting. Cross-reference `workbook-cell-mapping.md` to know exactly which
cell each answer goes into.
