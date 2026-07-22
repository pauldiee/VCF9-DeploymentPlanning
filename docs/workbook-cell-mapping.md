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
Broadcom's row shifts** — which is why they're the stable reference if you
script against the workbook: populate these `input_*` / `*_chosen` named
ranges and VCF.JSONGenerator consumes them directly.

### Intake → named range (management domain) — first cut

Maps each management-domain intake ID to the workbook **named range(s)** it
populates. `{a,b}` = brace expansion of a name family; per-AZ names show `az1`
and gain an `az2` twin (on *Configure Management Domain*) when `A13` = stretched.
**First cut — validate before wiring a generator.** Sources: the module's
`input*` / `*chosen` read logic + a full defined-names export of the pinned 9.1
workbook.

| Intake | Named range(s) |
| ------ | -------------- |
| A1 | `vcf_version_chosen` |
| A2 | `mgmt_domain_deployment_type_chosen` |
| A3 | `mgmt_domain_chosen` |
| A4 | `sizing_vcf_deployment_model_chosen` |
| A5 | `sizing_vcf_deployment_size_chosen` (drives `mgmt_{set,vcenter,nsxt,vcfops}_appliance_size_chosen`) |
| A6 | `mgmt_domain_existing_{vcenter,nsx_manager,vcf_operations}_chosen` |
| A7 | `mgmt_principal_storage_chosen` |
| A8 | `mgmt_cl01_vsan_data_in_transit_chosen` |
| A9 | `mgmt_cl01_vsan_ftt_chosen` |
| A10 | `mgmt_nsx_overlay_transit_gateway_chosen` |
| A11 | `mgmt_dual_stack_networking_chosen` |
| A12 | `mgmt_vcf_management_network_chosen` |
| A13 | `mgmt_stretched_cluster_chosen` |
| A14 | — implicit (which `input_mgmt_az1_host{1..16}_*` are filled) |
| A15 | — implicit (which `input_wld*` / cluster blocks are filled; see the Deploy Workload Domain / Deploy Cluster sheets) |
| A16 | `mgmt_ceip_status_chosen` |
| A17 | `mgmt_domain_ops_automation_later_chosen`, `mgmt_domain_vcf_automation_later_chosen` |
| B1 | `input_mgmt_az1_mgmt_{vlan,mtu,gateway_cidr}` |
| B2 | `input_mgmt_az1_mgmt_vm_{vlan,mtu,gateway_cidr}` |
| B3 | `input_mgmt_az1_vcf_mgmt_{vlan,mtu,gateway_cidr}` |
| B4 | `input_flt_vcfms_node_pool_{start,end}_ip` |
| B5 | `input_flt_auto_node_pool_{start,end}_ip` |
| B6 | `input_mgmt_az1_vmotion_{vlan,mtu,gateway_cidr,pool_start_ip,pool_end_ip}` |
| B7 | `input_mgmt_az1_vsan_{vlan,mtu,gateway_cidr,pool_start_ip,pool_end_ip}` |
| B8 | `input_mgmt_az1_host_overlay_{vlan,mtu,gateway_cidr,pool_start_ip,pool_end_ip}`; `mgmt_host_overlay_addressing_chosen` |
| B9 | `input_mgmt_az1_edge_overlay_{vlan,mtu,cidr,gateway_ip,mask,pool_start_ip,pool_end_ip}` |
| B10 | `input_mgmt_az1_uplink01_{vlan,mtu,cidr,gateway_ip}`, `input_mgmt_az1_en{1,2}_uplink01_interface_cidr`, `input_mgmt_az1_tor1_peer_{ip,asn}` |
| B11 | `input_mgmt_az1_uplink02_{vlan,mtu,cidr,gateway_ip}`, `input_mgmt_az1_en{1,2}_uplink02_interface_cidr`, `input_mgmt_az1_tor2_peer_{ip,asn}` |
| B12 | `input_mgmt_en_asn` |
| B13 | `input_mgmt_az1_tor{1,2}_peer_asn` |
| B14 | `input_mgmt_az1_tor{1,2}_peer_bgp_password` |
| B15 | `mgmt_en0{1,2}_bfd_chosen` |
| B16 | — (no named range; route policy is out of the JSON) |
| B17 | — (no named range; only the addressing-mode `*chosen`) |
| B18 | `input_sftp_server{,_port,_protocol,_backup_dir,_passphrase,_sshfingerprint}` |
| B19 | `mgmt_internet_proxy{,_type,_auth}_chosen`, `input_mgmt_internet_proxy_{address,port,email,password}` |
| B20 | `input_mgmt_az1_dtgw_{vlan,gateway_cidr}` |
| B22 | — (no named range; extra Tier-0 BGP neighbor) |
| C1/C2 | `input_region_ad_parent_{fqdn,netbios}`, `input_region_ad_child_{fqdn,netbios}` |
| C3 | — no mgmt range; DC FQDNs only for the Identity Broker (deployed at bring-up, AD binding configured Day-N): `input_flt_vidb_{primary,secondary}_domain_controller{,_port}` |
| C5 | `input_child_svc_vsphere_ad_{user,password}`, `input_child_svc_nsx_ad_{user,password}` |
| C6 | `input_gg_vcf_{admins,operators,viewers}_group` (+ `input_gg_{vc,nsx}_*_group`) |
| C7 | `input_region_dns{1,2}_ip` |
| C8 | `input_parent_dns_zone` |
| C10 | `input_region_ntp{1,2}_server` |
| D1 | `mgmt_signed_certs_chosen` |
| D2 | `input_certificate_authority_{fqdn,name}`, `input_ca_administrator_{username,password}` |
| D3 | `input_ca_{country,state,locality,organization,organization_unit,email_address,algorithm,key_size}` |
| D4 | `input_ca_template_name` |
| D5/D6 | — no named range (SAN auto-derived from FQDNs; validity not captured) |
| E1 | `input_vcf_instance_name` |
| E2 | `input_mgmt_sddc_domain` |
| E3 | `input_mgmt_az1_host{1..16}_{fqdn,mgmt_ip}` |
| E4 | `input_esxi_root_password` |
| E6 | `input_mgmt_vc_{fqdn,ip}` |
| E7 | `input_flt_def_sddc_mgr_fqdn`; `sddc_mgr_{fqdn,ip}` |
| E8 | `input_mgmt_nsxt_vip_{fqdn,ip}`, `input_mgmt_nsxt_mgr{a,b,c}_{fqdn,ip}` |
| E9 | `input_xreg_vrops_node{a,b,c}_{fqdn,ip}`, `input_xreg_vrops_virtual_{fqdn,ip}` |
| E10 | `input_xreg_vra_virtual_{fqdn,ip}`, `input_flt_auto_sr_fqdn` |
| E11 | `input_mgmt_az1_en{1,2}_{fqdn,mgmt_cidr}` |
| E12 | `input_mgmt_datacenter`, `input_mgmt_cl01_cluster`, `input_mgmt_cl01_vds0{1,2,3}_name`, `input_mgmt_cl01_az1_{mgmt,mgmt_vm,vcf_mgmt,vmotion,vsan}_pg` |
| E14 | `input_flt_lc_{fqdn,ip}` (License), `input_flt_vidb_vip_{fqdn,ip}` + `input_flt_ic_{fqdn,ip}` (Identity Broker / Cloud Proxy), `input_flt_sr_{fqdn,ip}` |
| F2 | `input_flt_def_administrator_vsphere_local_password` |
| F3 | `input_vcenter_root_password` |
| F4 | `sddc_mgr_{vcf,root,admin_local}_password` |
| F5 | — no named range (only NSX **Edge** passwords exist, F8; mgmt NSX Manager appliance passwords not captured) |
| F6 | `input_xreg_vrops_{admin,root}_password` |
| F7 | `input_xreg_vra_admin_password` |
| F8 | `input_mgmt_nsxt_en_{admin,root}_password` |
| F10 | `input_sftp_server_passphrase` |

**Validated.** Resolved: `C8` → `input_parent_dns_zone`; `D1`–`D4` → the
`input_ca_*` / `input_certificate_authority_*` block on *Configure Management
Domain*. **Confirmed absent (no named range):** `C3` DC FQDNs (only the Identity
Broker Day-N `input_flt_vidb_*` fields exist), `D5`/`D6` (cert SAN auto-derives
from the FQDNs; validity not captured), `F5` mgmt NSX Manager appliance passwords
(only Edge `input_mgmt_nsxt_en_*`), `B16` (route policy), `B17` (DHCP scope),
`B22` (extra BGP neighbor). **Day-2 (`B21`/`E15`)** live on the *Deploy Fleet
Management Day-N* sheet — the network fields there are `input_xreg_*` /
`input_flt_auto_*`; the placement/method *Select Option* cells are not named
ranges. Some passwords live on *Value Reference Tables* (`sddc_mgr_*`), not an
`input_*` name.

### Intake → named range (workload domain, section H) — first cut

The `input_wld_*` set is a **single** workload domain (not per-WLD-numbered) and
mirrors the mgmt-domain layout (`input_wld_az1_*`, `az2`, `cl01`, `nsxt`,
`supvr`, …). Fill it **per WLD** — repeat the block for each. Same conventions as
above (`az1`/brace notation; `az2` twins when stretched). First cut — validate
before wiring a generator.

| Intake | Named range(s) |
| ------ | -------------- |
| H1 | `input_wld_sddc_domain` (name); deployment type — no distinct `*chosen` found (see the *Deploy Workload Domain* sheet) |
| H2 | `input_wld_vc_{fqdn,ip}`, `input_wld_sso_domain_name` |
| H3 | shared vs new `wld_bf_nsx_existing_chosen`; size `wld_nsxt_appliance_size_chosen`; nodes `input_wld_nsxt_mgr{a,b,c}_{fqdn,ip}`; VIP `input_wld_nsxt_vip_{fqdn,ip}` |
| H4 | connectivity `wld_cl01_nsxt_deployent_type_chosen`; Distributed: `input_wld_az1_dtgw_{vlan,gateway_cidr}`, VNAs `input_wld_vna{a,b}_{fqdn,ip,cidr}` |
| H5 | enable `wld_supervisor_chosen`; `input_wld_supvr_{name,api_server_fqdn,ip_address_range,nsx_project,vpc_connectivity_profile,cp_storage_policy,mgmt_dns_server,mgmt_ntp_server}` |
| H6 | `wld_principal_storage_chosen`, `wld_cl01_vsan_ftt_chosen`, `wld_cl01_vsan_dedupe_compression_chosen`, `input_wld_cl01_vsan_datastore` |
| H7 | `input_wld_cl01_cluster`, `input_wld_cl01_image_name`, `input_wld_az1_host{1..16}_{fqdn,mgmt_ip}` |
| H8 | `input_wld_az1_{mgmt,vmotion,vsan}_{vlan,mtu,gateway_cidr,pool_start_ip,pool_end_ip}` |
| H9 | `input_wld_cl01_vds0{1,2,3}_name`; `wld_cl01_vds_profile_chosen` |
| H10 | `input_wld_az1_host_overlay_{vlan,mtu,cidr,gateway_ip,pool_start_ip,pool_end_ip,uplink_profile_name}` |
| H11 | `wld_stretched_cluster_chosen`; per-AZ twins `input_wld_az2_*`; witness `input_wld_witness_{fqdn,ip,cluster,dns1_ip,dns2_ip}` |
| H12 | `input_wld_bf_vc_root_password`, `input_wld_administrator_vsphere_local_password`, `input_wld_esx_root_password`, `input_wld_bf_nsxt_{admin,audit,root}_password`, `input_wld_nsxt_en_{admin,root}_password` |

**Not mapped (out of scope for a core WLD):** optional-solution prefixes —
`input_srm_*` / `input_wld_vrms_*` (Site Recovery / DR), `input_ccm_*`
(Cross-Cloud Mobility), `input_cbr_*` (Cloud-Based Ransomware), `input_k8s_*` /
`input_vvs_*` — populate only if those solutions are in use.

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
| B8     | Host Overlay Network           | VLAN ID / Gateway CIDR / IP Assignment (TEP): IP Pool (recommended) or DHCP / IP address Range From / To |
| B20    | VPC Gateway Connectivity       | VLAN ID / Gateway CIDR IPv4 Address (Distributed only) |
| E6     | vCenter                        | FQDN / IP                                            |
| E7     | SDDC Manager                   | FQDN / IP                                            |
| E8     | NSX Manager                    | VIP FQDN / VIP IP / Node 1..3 FQDN+IP                |
| E9     | VCF Operations                 | Primary / Replica / Data node FQDN; Load Balancer FQDN (optional) |
| E10    | VCF Automation                 | VCF Automation FQDN; VCF services runtime FQDN (Automation's **own** runtime — the *VCF Management Services* section has a **same-labelled** fleet field → `E14`) |
| E14    | VCF Management services        | Cloud Proxy / License Server / Identity Broker / VCF services runtime FQDN (**fleet** runtime — distinct from the same-labelled field in the *VCF Automation* section → `E10`) |
| F1–F7  | Passwords                      | Per appliance                                        |

## Sheet: Configure Management Domain

| Intake | Sheet section            | Field label                              |
| ------ | ------------------------ | ---------------------------------------- |
| C1–C2  | Identity Sources         | Domain name / type                       |
| C3     | Identity Sources         | Domain controller FQDN(s)                |
| C4     | Identity Sources         | — (no workbook field — LDAPS reachability is a prerequisite check; see `prerequisites.md`) |
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
| E16    | AVI Load Balancer {SDDC} | Version / Edge Cluster form factor / Admin Password / Node 1–3 IP Address / Cluster VIP / Cluster FQDN / Cluster Name — **only the Cluster FQDN needs DNS** (nodes + VIP are IP-only fields). The section holds **one** controller set; a fleet with more than one **NSX instance** needs a set each (`prerequisites.md` → Avi Load Balancer) and the workbook has nowhere to put the second — capture it in the Step 1 plan |
| E17    | —                        | — (**no workbook fields**: License Hub is deployed from the **SSP Installer**, outside the P&P workbook's scope — capture its ~9 IPs (two contiguous pools), its **3 FQDNs** (installer + instance + messaging) and the connected/disconnected mode in the Step 1 plan / intake instead) |

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
covers extra Ops / Automation nodes and federation driven by the platform
roadmap (intake **A15**), captured in a follow-up session.

| ID     | Sheet field / table                    | Field label                                          |
| ------ | -------------------------------------- | ---------------------------------------------------- |
| A17    | Fleet Components Deployment — Select Option | Deploy scope (Exclude / Deploy VCF Operations and Automation / Deploy VCF Automation) + Identity Broker + per-component Include/Exclude |
| E15    | Fleet Components Deployment — Select Option | Network placement (Shared / Dedicated Management Network / NSX Overlay Segment / NSX VLAN Segment) + deploy method; Installation Type (New / Import 8.x appliance) |
| B21    | localRegionNetwork / xRegionNetwork    | networkName / subnetMask / gateway; ipPool #1–5; Cluster Cidr (default 198.18.0.0/15) |
| E10    | VCF Automation Deployment              | VCF Automation FQDN; VCF services runtime FQDN (Automation's **own** runtime — not the `E14` fleet field with the same label); Node Prefix; IP addresses |
| E9     | VCF Operations Deployment              | Primary / Replica / Data node FQDN + IP; Load Balancer FQDN + IP; appliance size |
| E14    | Cloud Proxy / License Server / Identity Broker | FQDN + IP per appliance; Identity Broker provider + user/group provisioning |
| —      | Deploy Log management                  | Log Management FQDN; node size; replica count; cluster VIP (sheet section label; a legacy "Deploy VCF Operations for Logs" TechDocs-link cell also remains on the sheet) |
| —      | Deploy VCF Operations for Networks     | Platform + Collector node VM name / IP; deployment size; dual-stack |
| E16    | —                                      | — (Avi inputs live in the *AVI Load Balancer {SDDC}* section of **Configure Management Domain** — see that table above; sizing rows in *Management Domain Sizing*) |
| F11    | —                                      | — (Avi controller `admin` / VCF Ops admin passwords — password manager only; no workbook field) |
