# Workbook Cell Mapping

Maps intake-doc question IDs (`A1`, `B7`, …) to the **section** and **field
label** inside the official VCF 9.1 Planning and Preparation Workbook. We
don't pin to spreadsheet coordinates (`P6` style) because Broadcom shifts
rows between workbook revisions — field labels are stable, coordinates are
not.

> Workbook reference: `reference/vcf-9.1-planning-and-preparation-workbook.xlsx`
> v1.9.1.001 (revision shown in sheet `VCF & VVF Planning`, cell P5).
> When Broadcom ships a new revision, replace the file under `reference/` and
> re-validate this mapping against the new sheet/field labels in the same
> commit.

## How the downstream tooling reads the workbook (named ranges)

**[VCF.JSONGenerator](https://github.com/vmware/powershell-module-for-vmware-cloud-foundation-jsongenerator)**
(see README *Related tools*) turns a filled workbook into VCF deployment JSON by
reading the workbook's **defined names (named ranges)** — not cells or labels.
Concretely it collects:

- every named range prefixed **`input*`** — the value fields (FQDN, IP, VLAN,
  CIDR, password, name, …). The pinned 9.1 workbook has **~2,338** of these.
- every named range suffixed **`*chosen`** — the dropdown selections
  (deployment model, sizes, include/exclude, …). **~465** in 9.1.

Names are structured by area — `input_mgmt_*`, `input_wld_*`, `input_cluster_*`,
`input_flt_*`, `input_xreg_*`, etc. (biggest sets: WLD ~1188, mgmt ~428, cluster
~218, fleet ~190). **Named ranges move with their cell, so they survive
Broadcom's row shifts** — which is why they're the stable target for a writer
tool. A future intake→workbook writer (issue #1) should populate these
`input_*` / `*_chosen` named ranges so VCF.JSONGenerator consumes them directly.

## Sheet: VCF & VVF Planning

| Intake | Sheet section            | Field label                              |
| ------ | ------------------------ | ---------------------------------------- |
| A1     | Version                  | VMware Cloud Foundation                  |
| A2     | Deployment Type          | Operation to be performed                |
| A3     | Deployment Type          | Instance to perform operation on         |

## Sheet: Management Domain Sizing

| Intake | Sheet section            | Field label                              |
| ------ | ------------------------ | ---------------------------------------- |
| A5     | Scale Options            | Size                                     |
| A4     | Scale Options            | Deployment model                         |

## Sheet: Deploy Management Domain

| Intake | Sheet section                  | Field label                                          |
| ------ | ------------------------------ | ---------------------------------------------------- |
| G1     | Depot Settings                 | Depot Type                                           |
| G4     | Depot Settings                 | Offline Depot - Hostname / Port                      |
| G2     | Depot Settings                 | Download Service ID                                  |
| G3     | Depot Settings                 | Activation Code                                      |
| G5     | Depot Settings                 | Enable Proxy Server / Proxy FQDN / Port / Auth       |
| A6     | Existing Components            | I have an existing VCF Operations / vCenter / Auto   |
| A4     | Scale Options                  | Deployment model                                     |
| A5     | Scale Options                  | Size                                                 |
| A12    | Network Options                | VM mgmt network / VCF mgmt network                   |
| A11    | Network Options                | Dual stack networking                                |
| A10    | Network Options — VPC Gateway  | Transit Gateway type                                 |
| A7     | Storage Options                | Storage Option                                       |
| A8     | Storage Options                | Activate vSAN Data-in-Transit encryption             |
| A9     | Storage Options                | Failures to Tolerate                                 |
| E1     | General Information            | VCF Instance Name                                    |
| E2     | General Information            | Management domain name                               |
| A16    | General Information            | Enable CEIP                                          |
| C8     | DNS                            | Default hostname DNS suffix                          |
| C7     | DNS                            | Server #1 / Server #2                                |
| C10    | NTP                            | Server #1 / Server #2                                |
| E4     | Hosts                          | ESX Root Password                                    |
| E3     | Hosts                          | Host #1..N FQDN                                      |
| B1     | Networks — ESX Management      | VLAN ID / MTU / IPv4 gateway (CIDR)                  |
| B2     | Networks — VM Management       | VLAN ID / MTU / IPv4 gateway (CIDR)                  |
| B3     | Networks — VCF Management      | VLAN ID / MTU / IPv4 gateway (CIDR)                  |
| B4     | VCF Management Services IP Range | IPv4 address Range From / To                       |
| B5     | VCF Automation IP Range        | IPv4 address Range From / To                         |
| B6     | vMotion Network                | VLAN / MTU / Gateway / Range From / To               |
| B7     | vSAN Network                   | VLAN / MTU / Gateway / Range From / To               |
| B8     | ESX Host Overlay Network       | VLAN / MTU / Gateway / DHCP or static                |
| B20    | VPC Gateway Connectivity       | VLAN ID / Gateway CIDR IPv4 Address (Distributed only) |
| E6     | vCenter                        | FQDN / IP                                            |
| E7     | SDDC Manager                   | FQDN / IP                                            |
| E8     | NSX Manager                    | VIP FQDN / VIP IP / Node 1..3 FQDN+IP                |
| E9     | VCF Operations                 | Primary / Replica / Data node FQDN; Load Balancer FQDN (optional) |
| E10    | VCF Automation                 | VCF Automation FQDN; VCF services runtime FQDN       |
| E14    | VCF Management services        | Cloud Proxy / License Server / Identity Broker / VCF services runtime FQDN |
| F1–F7  | Passwords                      | Per appliance                                        |

## Sheet: Configure Management Domain

| Intake | Sheet section            | Field label                              |
| ------ | ------------------------ | ---------------------------------------- |
| C1–C2  | Identity Sources         | Domain name / type                       |
| C3     | Identity Sources         | Domain controller FQDN(s)                |
| C5     | Identity Sources         | Bind user / password                     |
| C6     | Identity Sources         | Admin / operator / viewer groups         |
| D1–D6  | Certificate Authority    | CA settings, template, CSR method        |
| B9     | NSX — Edge Overlay       | VLAN / MTU / Gateway / IP range          |
| B10–B11| NSX — Edge Uplinks       | Uplink-01 / Uplink-02 VLAN, IPs, peers   |
| B12–B14| NSX — BGP                | Edge AS / Peer AS / MD5 password         |
| B15    | NSX — BGP                | BFD                                      |
| B16    | NSX — BGP                | Advertised / received routes             |
| B22    | NSX — BGP (optional)     | No dedicated cell — additional Tier-0 uplink / BGP neighbor for public peering, configured in NSX post-bringup; plan in `01-network-dns-plan.md` §B |
| E11    | NSX — Edges              | Edge node 1 / 2 FQDN + IP                |
| F8     | NSX — Edges              | admin / audit / root passwords           |
| F9     | Identity Sources         | SSO bind password                        |
| F10    | Backups                  | Backup encryption passphrase             |
| B18    | Backups                  | SFTP host / port / account / path        |

## Sheet: Deploy Workload Domain

| Intake | Sheet section                          | Field label                                          |
| ------ | -------------------------------------- | ---------------------------------------------------- |
| H1     | General Information                    | Workload Domain Name / Deployment Type               |
| H2     | vCenter                               | vCenter FQDN / SSO Domain Name                       |
| H3     | NSX Manager Appliances                 | Appliance 1–3 FQDN + IP / Cluster FQDN + Cluster IP  |
| H4     | Configure Network Connectivity        | Centralized / Distributed; VLAN / Gateway CIDR / Virtual Network Appliance 1–2 FQDN |
| H5     | vSphere Supervisor                     | Supervisor Name / Service CIDR / Control Plane IP Range |
| H6     | Storage                               | Storage Selection / Enable vSAN ESA / Storage Policy |
| H12    | Workload Domain Passwords              | vCenter SSO + root; NSX admin / audit                |

## Sheet: Deploy Cluster

Repeat per additional cluster. New VLANs/subnets per cluster come from
`01-network-dns-plan.md`.

| Intake | Sheet section                          | Field label                                          |
| ------ | -------------------------------------- | ---------------------------------------------------- |
| H7     | General / Host Selection               | Cluster Name / Image / Host FQDNs                    |
| H8     | Create Network Pool                    | ESX Mgmt / vMotion / vSAN / vSAN Storage Client networks (VLAN / MTU / Gateway / range) |
| H9     | Distributed Switch                     | Primary / Secondary / Tertiary vDS name / MTU / uplinks / LAG |
| H10    | Transport Zones / Transport Node Profile | Host Overlay TEP VLAN / Static IP Pool CIDR + range / Uplink Profile |
| H11    | Stretched Cluster                      | Witness host + VMkernel; AZ2 host networks; fault-domain mapping (see `03-multi-az-prep.md`) |

## Sheet: Deploy Fleet Management Day-N

Fleet components deployed after bring-up (Day-2 / Day-N). Planned in
`05-day2-deployments.md`; the table below maps its decisions to this sheet. Also
covers extra Ops / Automation nodes and federation driven by the customer
roadmap (intake **A15**), captured in a follow-up session.

| ID     | Sheet field / table                    | Field label                                          |
| ------ | -------------------------------------- | ---------------------------------------------------- |
| A17    | Fleet Components Deployment — Select Option | Deploy scope (Exclude / Deploy VCF Operations and Automation / Deploy VCF Automation) + Identity Broker + per-component Include/Exclude |
| E15    | Fleet Components Deployment — Select Option | Network placement (Shared / Dedicated Management Network / NSX Overlay Segment / NSX VLAN Segment) + deploy method; Installation Type (New / Import 8.x appliance) |
| B21    | localRegionNetwork / xRegionNetwork    | networkName / subnetMask / gateway; ipPool #1–5; Cluster Cidr (default 198.18.0.0/15) |
| E10    | VCF Automation Deployment              | VCF Automation FQDN; VCF services runtime FQDN; Node Prefix; IP addresses |
| E9     | VCF Operations Deployment              | Primary / Replica / Data node FQDN + IP; Load Balancer FQDN + IP; appliance size |
| E14    | Cloud Proxy / License Server / Identity Broker | FQDN + IP per appliance; Identity Broker provider + user/group provisioning |
| —      | Deploy VCF Operations for Logs         | Log Management FQDN; node size; replica count; cluster VIP |
| —      | Deploy VCF Operations for Networks     | Platform + Collector node VM name / IP; deployment size; dual-stack |
