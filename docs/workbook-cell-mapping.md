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
| E6     | vCenter                        | FQDN / IP                                            |
| E7     | SDDC Manager                   | FQDN / IP                                            |
| E8     | NSX Manager                    | VIP FQDN / VIP IP / Node 1..3 FQDN+IP                |
| E9     | VCF Operations                 | VIP FQDN / IP                                        |
| E10    | VCF Automation                 | VIP FQDN / IP                                        |
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
| E11    | NSX — Edges              | Edge node 1 / 2 FQDN + IP                |
| F8     | NSX — Edges              | admin / audit / root passwords           |
| F9     | Identity Sources         | SSO bind password                        |
| F10    | Backups                  | Backup encryption passphrase             |
| B18    | Backups                  | SFTP host / port / account / path        |

## Sheet: Deploy Workload Domain / Deploy Cluster

Same field labels as the Mgmt Domain equivalents — repeat per WLD / cluster
using values from intake question **E13** and the per-cluster section of
`01-network-dns-plan.md`.

## Sheet: Deploy Fleet Management Day-N

Day-N additions (extra Ops / Automation nodes, federation, etc.) — driven by
intake question **A15** and customer roadmap, captured in a follow-up session.
