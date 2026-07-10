# Prerequisites — Gate Before Any Workbook Inputs

This list mirrors the **Prerequisite Checklist** sheet of the official
workbook. If any item is RED for your environment, fix it before spending a single
meeting on the rest of the workbook — every later answer depends on these.

> Authoritative source: the Broadcom [VCF 9.1 Planning and Preparation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation.html)
> doc set (the workbook's TechDocs companion). Sections below link the specific
> pages where they exist.

## Fillable planning templates (download)

Blank CSV sheets to capture the prereq plan, then transfer into the P&P workbook
or [Coscia's planner](https://vcfplanning.lcoscia.fr/). Each opens in Excel; the
IP/DNS template's **Intake ID** column maps back to
[`workbook-cell-mapping.md`](workbook-cell-mapping.md) (the other templates
reference intake IDs in their notes where relevant).

The IP/VLAN sheets hand off in a fixed order:

1. **Network team** fills the **VLAN / subnet plan** — VLANs, subnets, gateways,
   MTU, and the usable range inside each subnet.
2. **Architect** fills the **IP allocation + DNS plan**, assigning each FQDN + IP
   from those ranges (if the organization runs a central IPAM, request the
   addresses there instead of self-picking — the architect still compiles the
   sheet).
3. **AD/DNS team** creates the forward **A** and reverse **PTR** records from the
   filled IP/DNS plan.

- [IP allocation + DNS (A/PTR)](https://pauldiee.github.io/VCF9-DeploymentPlanning/templates/ip-dns-plan.csv) — per-appliance FQDN / IP, assigned by the architect from the network team's subnets in the VLAN plan (create **both** forward A and reverse PTR); duplicate the block per workload domain, add AZ2 hosts if stretched
- [VLAN / subnet plan](https://pauldiee.github.io/VCF9-DeploymentPlanning/templates/vlan-subnet-plan.csv) — VLAN, subnet, gateway, MTU + minimum IP count per traffic type
- [NTP / AD / CA](https://pauldiee.github.io/VCF9-DeploymentPlanning/templates/ntp-ad-ca-plan.csv) — NTP sources, AD domain/accounts/groups, CA + cert template
- [BGP peering](https://pauldiee.github.io/VCF9-DeploymentPlanning/templates/bgp-peering-plan.csv) — Edge/ToR AS, peer IPs, BFD (MD5 optional)
- [Firewall request](https://pauldiee.github.io/VCF9-DeploymentPlanning/templates/firewall-request-plan.csv) — deployment-critical flows (source / destination / port / purpose) for the security team; see [`07-firewall-ports.md`](07-firewall-ports.md)

> **Data hygiene:** these are **blank** templates. A **filled** copy holds
> real, sensitive data (IPs, DNS names, AS numbers) — store it in a secure
> location, **not** in a public or shared repository.

## Hardware

### Management Domain

| Item              | Minimum                                                                       | Notes                                                  |
| ----------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| Host count        | **2** (Simple deployment, NFS/FC) / **3** (Simple, vSAN) / **4** (High Availability) | HA with 4 hosts is the production baseline (Rainpole example); the workbook offers **16 host slots**. The *Management Domain Sizing* sheet computes the exact minimum for your component set — the 9.1 HA baseline needs **4** (see `04-sizing.md`) |
| CPU               | VCG-supported                                                                 | VCG: <https://compatibilityguide.broadcom.com>. vSphere 9 counts a **16-core/CPU minimum** for licensing (even if the socket has fewer); size on **physical** cores, keep vCPU:pCPU **≤ 2:1** |
| Memory            | ~1 TB per host (Rainpole reference, 4 hosts, single-host failure tolerance)   | The 9.1 mgmt fleet is **larger** than earlier VCF (see note below) — **always** confirm via *Management Domain Sizing* sheet |
| Boot storage      | M.2/SATADOM/SSD — **NOT SD cards** (legacy)                                   |                                                        |
| vSAN-OSA cache    | All-flash, ~1.2 TB raw per host, two disk groups (~600 GB cache/group)        | Skip if vSAN-ESA / NFS / FC. 32 GB host RAM needed to support the max disk groups |
| vSAN-OSA capacity | All-flash, ~12.5 TB raw per host, two disk groups (~6.25 TB/group)            | Skip if vSAN-ESA / NFS / FC                            |
| vSAN-ESA          | ~12.5 TB raw per host, e.g. 4× 3.2 TB NVMe SSDs                               | Recommended for new builds                             |
| NICs              | Min 1× 10 GbE + 1× 1 GbE BMC; 25 GbE **recommended** for vSAN-ESA             | Plan **2× pNICs** as the normal route — the Installer's vDS profiles assume it (Default profile = one NSX-enabled vDS for **all** traffic, 2 uplinks, `vmnic0`/`vmnic1`; the custom switch configuration also supports **VDS LAG** uplinks). Hosts *can* run [a single pNIC](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/host-management/commission-hosts.html), but single-NIC bring-up is **API-only** (JSON spec) per the workbook |

> **Two easy-to-miss gate checks:** disks intended for vSAN must have **no
> existing partitions** (the workbook repeats this on every storage row — a
> classic bring-up validation failure), and all management-domain hosts must
> come from a **single hardware vendor**
> ([Preparing ESX Hosts for VCF or vSphere Foundation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation.html)).

> **9.1 management footprint is bigger.** Even with most optional fleet
> components excluded, the management domain runs ~12 appliances / ~120 vCPU,
> because 9.1 deploys a baseline **VCF services runtime** (3 control + 3 worker
> nodes) alongside vCenter, the 3-node NSX Manager cluster and SDDC Manager. It
> grows further with VCF Operations, VCF Automation, Log Management and the
> License Server. Don't reuse a VCF 4.x/5.x host spec — resize on the
> *Management Domain Sizing* sheet against the components you're actually
> deploying.

### Workload Domain

Same shape as Management Domain. Minimum **3 hosts**, 4+ recommended for prod.
VI workload domains support up to **64 pNICs per host**.

> TechDocs: [Preparing ESX Hosts for VCF or vSphere Foundation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation.html)
> covers the ESX install + basic host configuration this gate expects. The
> hardware minimums themselves (all pNICs ≥ 10 GbE, vSAN hosts certified on the
> [compatibility guide](https://compatibilityguide.broadcom.com)) come from the
> workbook's *Prerequisite Checklist*, not that page.

## Network

| Requirement                         | Why                                                                  |
| ----------------------------------- | -------------------------------------------------------------------- |
| **Jumbo frames** (MTU 9000)         | Required on vSAN, vMotion, ESX Host Overlay, NSX Edge Overlay, NFS. Overlay (GENEVE) needs MTU **≥ 1600** minimum, **1700 recommended** (headroom for GENEVE header growth), ≥ 9000 for optimal throughput — [MTU guidance](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/advanced-network-management/transport-zones-and-transport-nodes/mtu-guidance.html) |
| **BGP** adjacency + AS numbers      | Dynamic routing NSX Edge ↔ ToR — **only with NSX Centralized Connectivity / Edge clusters** (intake `A10`); the Distributed model needs no BGP peering. [Set up Centralized Connectivity with Edge Clusters](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/advanced-network-management/setting-up-network-connectivity/setting-up-centralized-connectivity-with-edge-clusters.html) |
| **ECMP** on Edge↔ToR uplinks        | NSX Edge multipath — same scope as BGP: **Centralized Connectivity only** |
| **vDS teaming**                     | vSphere Distributed Switch teaming for uplink load-balancing + failover — profiles + algorithms are chosen in the [Installer wizard](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/deploy-a-new-vcf-fleet-or-a-new-vcf-instance.html) |
| **VLANs** per traffic type          | See `01-network-dns-plan.md`                                         |
| **External load balancer** (only if fronting VCF Operations with a VIP) | VCF **never** provides the LB for VCF Operations — bring your own (F5, standalone Avi/NSX ALB, …). Skip it and you reach the cluster via the node FQDNs directly (no built-in cluster/floating IP). See `05-day2-deployments.md` B.1 |
| **Stretched networks** (multi-AZ)   | VM-mgmt stretched across AZ1↔AZ2; Uplink01/02 + Edge Overlay stretched **only when NSX Centralized connectivity**; routing between AZ1/AZ2 ESXi-mgmt subnets. See `03-multi-az-prep.md` |

> Source: the workbook's *Prerequisite Checklist* → *Network Requirements*
> block — every row above mirrors it except the VLAN and load-balancer rows,
> which are this guide's additions. TechDocs 9.1 links inline where a page
> exists; the ECMP and stretched wording has no standalone TechDocs page and is
> anchored on the workbook itself.

## Avi Load Balancer (only if in scope)

Needed when **Avi is the chosen load balancer** for any of these: **vSphere
Supervisor** on a workload domain (then the controller cluster must exist
**before activation** — but Supervisor also runs **without Avi**, via the
NSX / VPC networking paths' built-in load balancer or the **Foundation Load
Balancer**), a **VCF Automation HA cluster** VIP (an external LB also works),
or tenant/workload load balancing. Deployed **Day-2 from VCF Operations** into
the management domain — vCenter and NSX must already be configured. Prepare up
front:

- **4 IPs + FQDNs on the VM Management network**: 3 controller nodes + the
  **cluster VIP**. The VIP FQDN must be **registered in DNS and resolve to the
  cluster VIP** (A + PTR for all four, like every other appliance).
- **Controller size**: Small / Large / XLarge (the deploy wizard's tiers). Size
  it in `04-sizing.md` — note the workbook's Avi disk figures diverge from the
  NSX ALB controller ladder.
- **Two strong passwords** (password manager, owners in intake `F11`): the
  controller **admin** and the **VCF Ops admin** (break-glass) accounts.
- Firewall: admin access to the controller UI/API (443) and the Service
  Engine ↔ controller secure channel — see [`07-firewall-ports.md`](07-firewall-ports.md) §E.

> Not the same thing as the **external load balancer for VCF Operations**
> (see the Network table above and `05-day2-deployments.md` B.1) — that one is
> never served by VCF. TechDocs:
> [Deploy Avi Load Balancer from VCF Operations](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/avi-load-balancer/avi-load-balancer-vmware-cloud-foundation/9-1/build-and-deploy-avi-91/deploy-avi-load-balancer-from-vcf-operations.html).
> The P&P workbook has **no Avi input fields** — only sizing rows — so capture
> these values in the Step 1 plan / intake instead.

## Active Directory

- Supported OS: Windows Server 2019 or 2022.
- Parent domain (forest root) reachable from SDDC components.
- Bind / service accounts and admin groups pre-created **before** install: the
  AD bind accounts you plan for vSphere / NSX, the **Identity Broker bind
  account** (see below), and the **admin groups** you will map to VCF roles —
  capture them in the intake (section C, e.g. `C5`).
- AD DCs reachable from every management component.

> **Workbook gotcha:** the *Active Directory Inputs* tab that the workbook's
> own prereq row points at is **hidden** in the 9.1 workbook (v1.9.1.001) and
> still carries VCF 4.x/5.x-era content — Workspace ONE Access and Aria Suite
> Lifecycle groups, old Aria product names, HCX/HRM service accounts,
> `VMw@re1!` reference passwords. Unhide it for the `svc-*` / `gg-*` **naming
> convention** only; the actual 9.1 account set is the short list above.

### Identity source for the VCF Identity Broker

VCF 9 federates fleet-wide SSO through the **VCF Identity Broker** (deployed and
configured Day-2 — deployment plan **E8**, stories **8.3** deploy / **8.4**
fleet SSO). Prepare the AD-over-LDAP
identity source up front; it has specific inputs and well-known gotchas.

**What to prepare:**

- **Bind / service account** — a dedicated AD account with read access to the base DN.
  If you use the **Global Catalog**, it must also have read on the **TGGAU**
  (Token-Groups-Global-And-Universal) attribute.
- **Base DN** (e.g. `dc=example,dc=com`), a **Base Group DN** (required to sync
  groups), and optionally a **Base User DN**.
- **LDAPS root CA certificate** in **PEM** format (with the `BEGIN CERTIFICATE` /
  `END CERTIFICATE` lines) if you use an encrypted connection (recommended).
- **Domain controllers** — a primary (and a secondary for failover), or DNS
  auto-discovery via **SRV records**; reachable on 389/636 (see [`07-firewall-ports.md`](07-firewall-ports.md)).
- **Groups to sync**, including the group you will map to the **admin** role.

**Common gotchas:**

- **Login is the domain UPN (`user@domain.com`), *not* the email address** — even
  when the email is synced, users must sign in with the domain UPN (Broadcom
  KB 393150). Trips up organisations where the email suffix differs from the UPN suffix.
- **Global Catalog syncs only *universal* groups** — local/global groups won't
  appear until converted to universal, and the bind account needs the **TGGAU** read
  permission.
- **The LDAPS certificate must be PEM** (with `BEGIN`/`END CERTIFICATE` lines) — a
  missing or wrong-format root CA breaks the encrypted connection.
- **Single Base Group DN** — to sync groups spread across OUs, set the base group
  DN **high enough** to cover them all; a too-narrow DN silently misses the admin group.
- **Nested groups** — enable **Sync Nested Group** if admin membership comes via
  nested groups, or those members won't sync.
- **Sync runs weekly** by default — a service-account **password expiry or lockout**
  will quietly stop group updates.

> Other supported identity sources: **OpenLDAP**, and external IdPs — **Microsoft
> Entra ID** (OIDC / SAML) and **AD FS**. Those need different prep; see Broadcom's
> [Configure an Identity Provider](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/fleet-management/what-is/setting-up-sso/cofigure-vmware-cloud-foundation-identity-provider.html)
> (per-IdP sub-pages) and [Configure Active Directory as an Identity Provider
> Using AD/LDAP](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/fleet-management/what-is/setting-up-sso/cofigure-vmware-cloud-foundation-identity-provider/configure-vmware-cloud-foundation-identity-provider-for-ad-ldap(2).html)
> on TechDocs. These are deliberately the **9.0** pages — the 9.1 doc set does
> not republish the SSO setup section, so 9.0 is the newest published version.

## Host Overlay TEP addressing (static IP pool recommended)

How each host gets its GENEVE tunnel-endpoint (TEP) IPs on the **ESX Host
Overlay** VLAN. Either way, size for at least `nodes × pNICs` IPs plus growth —
e.g. a 4-node cluster × 2 pNICs = 8 IPs minimum.

- **Recommended: static IP pool** — entered directly in the VCF Installer at
  bring-up (and per cluster in the workload-domain wizard). No external DHCP
  service to build, monitor, or keep alive; and in stretched (multi-AZ) designs
  no per-AZ DHCP scope per TEP subnet. The P&P workbook's own *Deploy
  Management Domain* sample uses **IP Pool** for the *IP Assignment (TEP)*
  field.
- **Alternative: DHCP scope** on the ESX Host Overlay VLAN — fully supported,
  same sizing rule; use it when the network team already operates DHCP on that
  VLAN and prefers central address management.

> Broadcom TechDocs accepts either for the prerequisite — *"a static IP pool
> or a DHCP server configured and advertising IP addresses on the … NSX host
> overlay (Host TEP) VLAN"* ([Create a New Workload Domain](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/working-with-workload-domains/deploy-a-vi-workload-domain-using-the-sddc-manager-ui.html)).
> TEP IP pools can also be created per cluster after bring-up
> ([Create an IP Pool for Tunnel Endpoint IP Addresses](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/advanced-network-management/transport-zones-and-transport-nodes/create-an-ip-pool-for-tunnel-endpoint-ip-addresses.html)).

## DNS

- Forward + reverse zones for every FQDN in the *Deploy Management Domain*,
  *Deploy Workload Domain* and *Deploy Cluster* sheets. **All A and PTR records
  present *before* deploy.**
- **Every FQDN and IP unique** — each FQDN must resolve to a unique, currently
  **unassigned** IP address (workbook + the FQDN inventory page below).
- Create **every FQDN lowercase** — TechDocs requires it for the fleet-services
  family ("Do not use capital letters in the FQDN"), and creating all records
  lowercase avoids the trap entirely — see the Step 1 plan
  ([`01-network-dns-plan.md`](01-network-dns-plan.md) §C).
- Dynamic updates: Nonsecure and secure.
- Replication scope: all DNS servers in the forest.
- Two DNS servers configured on every appliance.
- One **CNAME** wrapping the two NTP A-records for round-robin (see below).
- The authoritative per-component FQDN/IP inventory is in Broadcom TechDocs:
  [VCF Components FQDNs and IP addresses](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/vcf-components-fqdns-and-ip-addresses.html)
  (9.1 Planning and Preparation).

## NTP

- Two external time sources per site (radio/GPS, upstream NTP, or NTP served
  by the ToR switches / physical routers).
- Two A-records pointing at the two sources.
- One CNAME (e.g. `ntp.sfo.rainpole.io`) → A-record name for round-robin HA.
- The two external servers themselves synced to **different upstreams**
  (healthy NTP dispersion).
- Optional: per-server A-records (e.g. `ntp0` / `ntp1`) for direct management
  of the individual sources.
- AD domain controllers synced to the same external NTP.
- Different time sources for different fault domains / sites.

> Source: the workbook's *Prerequisite Checklist* → *NTP* block (incl. the
> A-record/CNAME construction). Host-side setup: TechDocs
> [Configure NTP on the ESX Hosts](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation/configure-ntp-on-vmware-cloud-foundation-hosts.html).

## SMTP

- Mail relay reachable from each SDDC component (alerting).
- Restrict relay to SDDC management IP range(s).
- The consumer is **VCF Operations' outbound Standard Email plug-in** (alert
  notifications), configured Day-2 with exactly these values — TechDocs:
  [Configure Email Alert Plug-in Settings](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vvs/9-X/configure-email-alert-plugin-settings-for-vrealize-operations-manager.html).

## Certificate Authority

- VCF 9.1 fleet certificate management (**VCF Operations → Fleet Management →
  Certificates → Configure CA for Fleet**) offers two CA types: **Microsoft CA**
  or **OpenSSL**. It's a single fleet-level setting — there is **no separate
  Microsoft-only restriction for "management" vs "instance"** components.
- **External / third-party CA is CSR-based only:** VCF generates the **CSR**, you
  sign it on your CA, and import the **signed certificate**. The **private key
  never leaves VCF** — you **cannot import a certificate that was created entirely
  outside VCF** (VCF does not accept an externally-generated private key).
- **Microsoft CA:** must support **Basic authentication**; recommended Windows
  Server 2019/2022 with the `Certificate Authority` + `Certificate Authority Web
  Enrollment` roles (Web Enrollment on the same host as the CA role). The full
  four-step prep (roles, basic auth, certificate template, least-privilege
  service account) is TechDocs [Prepare Your Microsoft Certificate Authority to
  Allow VMware Cloud Foundation to Manage Certificates](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/certificate-management-9-0/configure-a-certificate-authority_9-0/prepare-your-certificate-authority-to-enable-sddc-manger-to-manage-certificates-9-0.html).
- **Have ready for the Configure-CA wizard** (Microsoft CA): the CA server URL
  (`https://<ca-fqdn>/certsrv`), the **least-privileged service account** +
  password, and the **issuing certificate template** name.
- **OpenSSL:** configured on the appliance with the org details (Common Name,
  Country, Locality, Organization, OU, State) — no external prerequisites.
- TechDocs walk-throughs: [Configure a Certificate Authority for VMware Cloud
  Foundation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/certificate-management-9-0/configure-a-certificate-authority_9-0.html)
  and the umbrella [Managing Certificates in VMware Cloud
  Foundation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/certificate-management-9-0.html)
  section.

## SFTP backup target

- SFTP target (TCP **22**) reachable from the VCF management network — SDDC
  Manager, NSX Manager, vCenter **and** the fleet components — VCF Automation
  plus the VCF management services (Log Management, Identity Broker, Software
  Depot, fleet/SDDC lifecycle, real-time metrics, Salt) — all back up to it.
- Service account + write path pre-created (e.g. `svc-vcf-bck` → `/backups/`).
- The external SFTP server must support **256-bit ECDSA and 2048-bit RSA SSH
  keys**.
- A **backup encryption passphrase** chosen and stored in a password manager
  with a named owner — it is **required during restore**; a lost passphrase
  makes every backup on the target useless.
- Placed **outside the management domain it protects** — a backup target that
  dies with the platform is not a backup.

> Build guidance (what backs up and how often, placement, a hardened chrooted
> OpenSSH worked example, gotchas) + references:
> [`08-backup-and-depot.md`](08-backup-and-depot.md) §A. TechDocs:
> [File-Based Backups for SDDC Manager, NSX Manager and vCenter](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/backup-and-restore-of-cloud-foundation/file-based-backups-for-sddc-manager-and-vcenter-server.html)
> and [Configure SFTP Backup Target in VCF Operations](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/backup-and-restore-of-cloud-foundation/configure-sftp-backup-target-in-vmware-cloud-foundation-operations.html).
> Note the workbook's own SFTP row is stale here — it still says NSX + SDDC
> Manager "configured through SDDC Manager"; in 9.1 the fleet-wide target is
> set in **VCF Operations** and covers the components listed above.

## Jump host

The machine the whole deployment is driven from. It must exist **before** day
one and survive independently of the platform it deploys — don't place it on
the cluster being built (or on storage that depends on it).

- **Routed access** to: ESXi mgmt, VM mgmt, VCF mgmt, and the internet (binary
  downloads, if the online depot is used).
- **Modern browser** — VCF Installer UI, vCenter, NSX Manager, VCF Operations.
- **OVF Tool** — deploys the VCF Installer appliance OVA.
- **SSH client** — PuTTY, or the OpenSSH client built into Windows 10+ /
  Windows Server 2019+ (appliance console work on the VCF Installer, SDDC
  Manager, vCenter).
- **SFTP/SCP client** — WinSCP (or plain `scp`/`sftp`) for moving bundles,
  certificates, and log collections on and off appliances.
- **PowerShell 7 + VCF PowerCLI** — needed if you build a
  [custom ESX ISO](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation/create-a-custom-esx-iso-image-using-vmware-powercli.html)
  (vendor add-ons / async drivers), and generally useful for day-2 automation.
- **Excel** — for the P&P workbook itself.
- **Verification tools** — `nslookup` / `Resolve-DnsName` for the DNS gate and
  `w32tm` (Windows) / `ntpdate -q` (Linux) for the NTP gate, run from the same
  network vantage point the appliances will use.

## Binaries

| File                                                | Source                                          |
| --------------------------------------------------- | ----------------------------------------------- |
| `VCF-SDDC-Manager-Appliance-9.1.x.0.xxxxxxxx.iso`   | support.broadcom.com                            |
| `VMware-VirtualSAN-Witness-x.x.x-xxxxxxxx.ova`      | support.broadcom.com (only if multi-AZ / vSAN stretched) |

Everything else comes through the **depot** — decide online vs offline early
(intake `G1`), because the offline path means building infrastructure:

- **Online depot** — VCF Installer and the fleet talk to the Broadcom depot
  directly; have the **Download Service ID + Activation Code** ready (intake
  `G2`/`G3`) and outbound 443 per the Public URLs table below. Generating the
  download credential requires the **Product Administrator** role on the
  Broadcom support-portal site — arrange it early (see
  [`08-backup-and-depot.md`](08-backup-and-depot.md) §B). TechDocs:
  [Connect VCF Installer to Broadcom or an Offline Depot and Download Binaries](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/downloading-binaries-to-the-vcf-installer-appliance/connect-to-an-online-depot-to-download-binaries.html).
- **Offline depot** (air-gapped) — the **VCF Download Tool** is the only
  supported method in 9.1; you also need a web server (**≥ 1 TB** disk,
  HTTPS) to serve the downloaded depot store. TechDocs:
  [Download Binaries to an Offline Depot by Using the VCF Download Tool](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/lifecycle-management/binary-management-for-vmware-cloud-foundation/download-bundles-to-an-offline-depot.html).

> Build guidance (depot web server setup, Download Tool commands, transfer +
> connect steps, using the tool standalone to pre-stage binaries) + references:
> [`08-backup-and-depot.md`](08-backup-and-depot.md) §B.

## Public URLs (online functionality)

Everything online in VCF 9.1 — depot downloads, licensing, compatibility /
vSAN HCL data, CEIP — talks to a short list of public URLs, all **outbound
TCP 443**. Hand this table to the firewall team as-is, and if egress goes
through a proxy (intake `G5`), have these allowlisted on it. Source:
[Public URLs Required for Online Functionalities](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/public-urls-required-for-vmware-cloud-foundation.html)
(earlier versions: KB 327186).

| Destination URL                 | Purpose                                        | Needed by (source components)                                      |
| ------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| `dl.broadcom.com`               | Binaries download                              | VCF Installer, vCenter, VCF Operations, VCF Download Tool, depot services runtime |
| `eapi.broadcom.com`             | Binaries, vSAN HCL data, licensing, Cloud Proxy connectivity | VCF Installer, SDDC Manager, vCenter, VCF Operations, Cloud Proxy, VCF Download Tool, depot services runtime |
| `vvs.broadcom.com`              | Binaries, compatibility data, vSAN HCL data    | VCF Installer, SDDC Manager, VCF Download Tool, depot services runtime |
| `vsanhealth.vmware.com`         | Binaries, vSAN HCL data                        | VCF Installer, SDDC Manager, vCenter, VCF Download Tool, depot services runtime |
| `projects.packages.broadcom.com`| Binaries for Supervisor services and VCF services | Depot services runtime                                            |
| `vcsa.vmware.com`               | CEIP telemetry                                 | SDDC Manager, all VCF services runtime instances                   |
| `vcf.broadcom.com`              | Licensing                                      | VCF Operations                                                     |
| `auth.esp.vmware.com`           | Update Manager Download Service (UMDS)         | SDDC Manager, VCF Download Tool                                    |

> **Air-gapped?** The platform itself then needs none of these — but the
> machine running the **VCF Download Tool** still does, from wherever it runs.
> Plan that host's outbound access (or proxy allowlist) as part of this gate.

## Sign-off

Confirm in writing that **all** items above are green before the
intake meeting (Step 2). If anything is amber/red, capture the owner, target
date, and risk before starting the workbook.
