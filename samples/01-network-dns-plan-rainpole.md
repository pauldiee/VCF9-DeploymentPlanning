# Worked example — Step 1 plan (Rainpole)

A **filled** version of [`01-network-dns-plan.md`](../docs/01-network-dns-plan.md) for a
single-AZ management domain, using the classic **Rainpole** reference values
(`sfo` / `rainpole.io`, `10.11.x.x`) that ship in the Broadcom workbook. Use it
to see what "done" looks like before you fill the blank template for a real
deployment.

> Illustrative only. Example values, no real data. The blank templates in `docs/` use
> `example.io`; this worked example uses `rainpole.io` to match the workbook.
> Passwords are never captured here (they live in a password manager).

Site code `sfo`, instance `m01`, rack `r01`.

---

## A. VLAN / Subnet plan

| #  | Traffic                          | VLAN | CIDR (IPv4)      | MTU  | Gateway       | Notes                                   |
| -- | -------------------------------- | ---- | ---------------- | ---- | ------------- | --------------------------------------- |
| 1  | ESX Management                   | 1111 | `10.11.11.0/24`  | 1500 | `10.11.11.1`  | Host mgmt VMKs; the VCF Installer must reach this network (it lives on VM Management) |
| 2  | VM Management                    | 1110 | `10.11.10.0/24`  | 1500 | `10.11.10.1`  | The crowded one (see carve-out)         |
| 3  | VCF Management (optional)        | 1199 | `10.11.99.0/24`  | 1500 | `10.11.99.1`  | Not used in this example                |
| 4  | vMotion                          | 1112 | `10.11.12.0/24`  | 9000 | `10.11.12.1`  | Jumbo                                   |
| 5  | vSAN                             | 1113 | `10.11.13.0/24`  | 9000 | `10.11.13.1`  | Jumbo (vSAN-ESA)                        |
| 6  | ESX Host Overlay (TEP)           | 1114 | `10.11.14.0/24`  | 9000 | `10.11.14.1`  | Jumbo; static TEP pool                  |
| 7  | NSX Edge Overlay (TEP)           | 1119 | `10.11.19.0/24`  | 9000 | `10.11.19.1`  | Jumbo                                   |
| 8  | NSX Edge Uplink-01               | 1117 | `10.11.17.0/24`  | 9000 | `10.11.17.1`  | To ToR-A; BGP peer                      |
| 9  | NSX Edge Uplink-02               | 1118 | `10.11.18.0/24`  | 9000 | `10.11.18.1`  | To ToR-B; BGP peer                      |
| 10 | NFS (optional)                   | 1115 | `10.11.15.0/24`  | 9000 | `10.11.15.1`  | Not used (principal storage = vSAN)     |
| 11 | VPC Gateway external (Distributed) | 1198 | `10.11.98.0/24` | 9000 | `10.11.98.1`  | Only if VPC Gateway = Distributed       |
| 12 | Public / upstream peering uplink | —    | —                | —    | —             | Not used (no distinct public peering)   |

### IP range carve-out — VM Management `10.11.10.0/24`

| Component                       | IP(s)                | Notes                                    |
| ------------------------------- | -------------------- | ---------------------------------------- |
| DNS servers                     | `.4`, `.5`           | Resolvers                                |
| VCF Operations cloud proxy      | `.12`                |                                          |
| SDDC Manager                    | `.13`                | Also the VCF Installer FQDN              |
| License Server                  | `.14`                | Tied to VCF Operations; outside the services-runtime block |
| VCF Operations VIP              | `.21`                | Load balancer (HA)                       |
| VCF Automation services runtime | `.24`                |                                          |
| VCF Management Services runtime | `.32–.47`            | CIDR-aligned `/28` block (`10.11.10.32/28`) — fits the 12-node minimum; plan a `/27` instead if Day-2 Log Management / real-time metrics are in scope |
| VCF Automation nodes            | `.56–.63`            | CIDR-aligned `/29` block (`10.11.10.56/29`); 3 node IPs + 2 redeploy/rolling-update buffer |
| VCF Operations analytics        | `.52`, `.53`, `.54`  | Primary / replica / data                 |
| vCenter                         | `.70`                |                                          |
| NSX Manager                     | `.71` (VIP), `.72–.74` | VIP + 3 nodes                          |
| NSX Edge node mgmt              | `.75`, `.76`         | `sfo-m01-en01` / `en02`                  |
| VCF Operations for Networks     | `.77`, `.78`         | Day-2, optional — platform + collector (a **Large** platform is a 3-node cluster: reserve 2 more) |
| Log Management                  | — (runtime block)    | Day-2, optional — 1 FQDN + 6 IPs (+2 per extra replica), **allocated from the services-runtime block**; needs the `/27` variant of the block above |
| Real-time metrics               | — (runtime block)    | Day-2, optional — 6 IPs, also from the services-runtime block |
| Identity Broker                 | —                    | FQDN only — IP served from the services-runtime block (`.32–.47`) |

Host-facing ranges: ESX Mgmt hosts `10.11.11.101–.116`, vMotion `10.11.12.101–.116`,
vSAN `10.11.13.101–.116`, Host Overlay TEP pool `10.11.14.101–.132`, Edge Overlay
TEP `10.11.19.2–.5`.

---

## B. BGP plan

| Item                     | Value                          |
| ------------------------ | ------------------------------ |
| Edge cluster / T0        | `sfo-m01-ec01` / `sfo-m01-ec01-t0-gw01` |
| NSX Edge AS (your side)  | `65101`                        |
| ToR-A / ToR-B AS         | `65111` (both)                 |
| Uplink-01 (VLAN 1117)    | edge `10.11.17.2` / `.3`, peer `10.11.17.10` |
| Uplink-02 (VLAN 1118)    | edge `10.11.18.2` / `.3`, peer `10.11.18.10` |
| BGP MD5 password         | (per peer — password manager)  |
| BFD                      | Enabled                        |
| ECMP                     | Yes                            |

---

## C. DNS — required A + PTR records (management domain)

| Role               | FQDN                                 | IP            |
| ------------------ | ------------------------------------ | ------------- |
| ESXi host 1..16    | `sfo01-m01-r01-esx0N.sfo.rainpole.io`| `10.11.11.10N`|
| vCenter            | `sfo-m01-vc01.sfo.rainpole.io`       | `10.11.10.70` |
| NSX Manager VIP    | `sfo-m01-nsx01.sfo.rainpole.io`      | `10.11.10.71` |
| NSX Manager node a/b/c | `sfo-m01-nsx01{a,b,c}.sfo.rainpole.io` | `10.11.10.72–.74` |
| SDDC Manager       | `sfo-vcf01.sfo.rainpole.io`          | `10.11.10.13` |
| VCF Operations LB VIP (optional — external LB only) | `flt-ops01.rainpole.io` | `10.11.10.21` |
| VCF Ops nodes      | `flt-ops01{a,b,c}.rainpole.io`       | `10.11.10.52–.54` |
| VCF Ops cloud proxy| `sfo-cp01.sfo.rainpole.io`           | `10.11.10.12` |
| License Server     | `flt-ls01.rainpole.io`               | `10.11.10.14` |
| VCF Automation     | `flt-auto01.rainpole.io`             | (from `/29`)  |
| Identity Broker    | `flt-idb01.rainpole.io`              | (services runtime block) |
| VCF services runtime | `sfo-sr01.sfo.rainpole.io`         | `10.11.10.10` |
| Fleet components   | `flt-fc01.rainpole.io`               | `10.11.10.20` |
| Instance components | `sfo-ic01.sfo.rainpole.io`          | `10.11.10.11` |
| Log Management VIP | `flt-logs01.rainpole.io`             | (services-runtime block; Day-2, optional — integrated LB, worker nodes need IPs only) |
| NSX Edge 1 / 2     | `sfo-m01-en0{1,2}.sfo.rainpole.io`   | `10.11.10.75` / `.76` |

DNS search domains: `sfo.rainpole.io`, `rainpole.io`. Every FQDN needs both an A
and a PTR record. Ops for Networks platform + collector (Day-2, optional) need
**IPs only** (e.g. `10.11.10.77` / `.78`) — no DNS records.

---

## D. NTP

| FQDN                        | Resolves to        | Notes                     |
| --------------------------- | ------------------ | ------------------------- |
| `ntpserver.sfo.rainpole.io` | source #1 IP       | A-record                  |
| `ntpserver.sfo.rainpole.io` | source #2 IP       | A-record (round-robin)    |
| `ntp.sfo.rainpole.io`       | CNAME → above      | Put this in every appliance |

Individual sources kept on different networks / fault domains.

---

## E. Active Directory & F. Certificates

| Item                 | Value                                    |
| -------------------- | ---------------------------------------- |
| AD forest root       | `rainpole.io`                            |
| Site / child domain  | `sfo.rainpole.io`                        |
| Domain controller    | `rpl-ad01.rainpole.io`                   |
| Internal CA type     | Microsoft Enterprise CA                  |
| CA server URL        | `https://rpl-ad01.rainpole.io/certsrv`   |
| CA CSR method        | Web Enrollment (Basic auth)              |
| Certificate template | `VMware`                                 |
| CA service account   | `svc-vcf-ca`                             |

---

Ready to build the real thing? Copy [`01-network-dns-plan.md`](../docs/01-network-dns-plan.md)
and replace every Rainpole value with your own. Then run the role-based
[`02-intake.md`](../docs/02-intake.md).
