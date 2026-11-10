# Host Commissioning — Build Guide

Before an ESX host can go into a new workload domain, a new cluster or an
existing cluster, it has to be **commissioned**: added to the VCF instance's
global inventory as a free host. TechDocs: *"Adding ESX hosts to the global
inventory is called commissioning. You must commission ESX hosts before you can
use them to create a new workload domain or add them to an existing VCF
domain."*

This page covers that one step end to end: preparing the host, commissioning
it from the vSphere Client, through the SDDC Manager API or with a script,
checking the result, decommissioning and recommissioning, and the failures you
are most likely to hit. The runbooks that consume commissioned hosts point
here:
[`23-workload-domain-creation.md`](23-workload-domain-creation.md),
[`24-cluster-creation.md`](24-cluster-creation.md),
[`25-cluster-expansion.md`](25-cluster-expansion.md) and
[`22-stretch-execution.md`](22-stretch-execution.md).

Hosts for the **management domain at bring-up** are not commissioned: the VCF
Installer takes them straight from the deployment spec (see
[`35-bringup-json.md`](35-bringup-json.md)). Hosts for clusters on **NFS 4.1,
iSCSI, FCoE or NVMe over Fabrics** can't be commissioned at all; see
[§1.3](#13-pick-the-storage-type-per-host).

> **Evidence level:** TechDocs 9.1 (*Commission ESX Hosts*, *Decommission ESX
> Hosts*, *Network Pool Management*, all last updated 2026-11-09), the SDDC
> Manager API 9.1.1 reference, the configmax tool and Broadcom KBs, read
> verbatim on 2026-11-10. The `SDDCAdmins` fix (KB 415254) is
> **field-verified 2026-10-22**; `administrator@vsphere.local` as the
> break-glass account (§1.5) is **field-verified 2026-11-10**. The *Commission Hosts* wizard in the vSphere
> Client (§2: the pages and fields of *Host Addition and Validation*) is
> **lab-verified 2026-11-10**. Everything else on this page is
> **not lab- or field-verified in this repo**.

---

## The sequence, end to end

```
network pool  →  prepare each host  →  commission  →  check: Unassigned Hosts
 (once)          (DNS, cert, disks)     (UI, API or      / UNASSIGNED_USEABLE
                                         script)
```

1. [Prepare: network pool, host, storage type, access](#1-prepare)
2. [Commission in the vSphere Client](#2-commission-in-the-vsphere-client)
3. [Commission through the SDDC Manager API](#3-commission-through-the-sddc-manager-api)
4. [Scripted: VCFHostPreparation](#4-scripted-vcfhostpreparation)
5. [Check the result](#5-check-the-result)
6. [Decommission and recommission](#6-decommission-and-recommission)
7. [Common failures](#7-common-failures)

---

## 1. Prepare

### 1.1 The network pool comes first

TechDocs lists it as a host prerequisite: *"A network pool must be created and
available before host commissioning."* and *"The network pool must support the
storage type you select for a host (vSAN, vSAN ESA, vSAN Storage Client, NFS,
VMFS on FC, vVols)."* Every host is bound to one pool when you commission it,
and the pool hands out the vMotion and storage VMkernel addresses: *"you only
need to enter an IP address manually for the vmk0 management interface.
Network pools automatically assign static IP addresses to vSAN, NFS, iSCSI,
and vMotion VMkernel ports."*

Which networks the pool needs, from
[Network Pool Management](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/host-management/about-network-pools.html):

| Storage being used | Required networks in the pool |
| ------------------ | ----------------------------- |
| vSAN | vMotion and vSAN |
| vSAN compute | vMotion and vSAN |
| vSAN storage (formerly vSAN Max) | vMotion, vSAN, vSAN Storage Client |
| NFS | vMotion and NFS |
| vSAN and NFS | vMotion, vSAN, and NFS |
| VMFS on FC | vMotion only, or vMotion and NFS |
| vVols on FC / iSCSI / NFS (deprecated) | vMotion only or vMotion and NFS / vMotion and iSCSI / vMotion and NFS |

- Size each range for every host that will use the pool, plus growth. The
  default pool created at bring-up belongs to the management domain; TechDocs:
  *"To create a workload domain with hosts in a different layer-2 network than
  the management domain, you must create a new network pool. Also, if you want
  to use external NFS or VMFS on FC storage, you must create a new network
  pool."*
- In 9.1 the storage and vMotion networks can be IPv6: *"You cannot mix IP
  versions for the same traffic type within a cluster."*
- Where the pool's networks come from (VLAN, MTU, gateway, range per network):
  intake `H8` and [`23-workload-domain-creation.md` §1](23-workload-domain-creation.md#1-manual--network-prep).
  For a stretched cluster's second AZ:
  [`22-stretch-execution.md` §2](22-stretch-execution.md#2-manual--build-the-az2-network-pool-then-commission-the-hosts).
- To see existing pools and their ranges: vSphere Client → *Global Inventory
  Lists → Hosts → Network Pools*, or `GET /v1/network-pools`.

### 1.2 Prepare each host

Install a supported ESX build, then work through Broadcom's
[Preparing ESX Hosts for VCF or vSphere Foundation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation.html).
The Commission ESX Hosts page then checks these criteria, quoted from TechDocs
9.1 (grouped here):

| Area | What TechDocs requires |
| ---- | ---------------------- |
| **DNS and name** | *"Has both forward and reverse lookup entries (FQDN) configured on the DNS server."* *"Host name must be same as the FQDN."* In the wizard, *"The host FQDN must match the host name (including capitalization) provided during DNS configuration."* |
| **Certificate** | *"Self-signed certificate regenerated based on FQDN of host."* ESX generates its certificate at install time, before the hostname is set, so its CN is `localhost.localdomain`; set the FQDN (`esxcli system hostname set --fqdn=…`), run `/sbin/generate-certificates`, reboot ([Regenerate the Self-Signed Certificate on the ESX Hosts](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation/regenerate-the-self-signed-certificate-on-esx-hosts.html), which runs this *"After you have configured the NTP"*). External-CA hosts: see [§1.4](#14-certificates-follow-the-management-domain) |
| **NICs** | *"Hosts can have a single physical NIC or multiple physical NICs. For hosts with multiple physical NICs, only one can be connected to a standard switch, and the NIC must support all management traffic."* *"Management IP address is configured on a VMkernel interface connected to the Management Network on the standard switch."* The **9.0** page also says *"All physical NICs must have a minimum speed of 10 Gbps"*; the 9.1 page no longer lists that line |
| **Gateway** | *"Host is configured with an appropriate gateway. The gateway must be part of the management subnet."* |
| **Disks** | *"All disk partitions on HDD and SSD are deleted."* For vSAN: *"SSD disks or NVMe disks without pre-existing disk partitions must be available with each host"* (Create a New Workload Domain). A host that was in a vSAN cluster before needs its disks wiped: [§6.2](#62-recommission-a-former-vsan-host) |
| **Hardware** | Certified on the Broadcom Compatibility Guide for the storage type, *"Host has the drivers and firmware versions specified in the VMware Hardware Compatibility Guide"*, *"Hardware health status is healthy without any errors."* |
| **ESX build** | *"A supported version of ESX is installed on the host."* For a new workload domain: *"If the hosts in the management domain have an express patch applied, the hosts for the new workload domain must be imaged with the same express patch."* (Create a New Workload Domain) |

NTP is part of the same host preparation (and the order matters: NTP before
the certificate). Plan the servers in
[`01-network-dns-plan.md`](01-network-dns-plan.md).

**Single pNIC, or a management vNIC that's the only uplink on `vSwitch0`:**
commissioning is the same, the domain/cluster build afterwards is API-only.
See [`29-single-pnic-build.md` §8](29-single-pnic-build.md#8-later-hosts-workload-domains-clusters-expansion)
and the single-uplink note in [`prerequisites.md`](prerequisites.md#management-domain).

### 1.3 Pick the storage type per host

The storage type is chosen **per host at commission time** and decides where
the host can go. TechDocs:

- *"Hosts that use vSAN storage can only be used with vSAN-based clusters."*
- *"Hosts that are commissioned for vSAN HCI with ESA enabled can only be used
  for vSAN ESA clusters."*
- *"Hosts that are commissioned for vSAN HCI without ESA enabled can only be
  used for vSAN OSA clusters."*
- *"Hosts that are commissioned for vSAN Storage (formerly vSAN Max) can only
  be used for vSAN storage clusters (a subset of vSAN ESA)."*
- *"Hosts that are commissioned for vSAN Compute Cluster can only be used for
  vSAN compute clusters."*
- NFS, VMFS on FC and vVols hosts likewise only go into clusters of that type.

| You want | UI choice | JSON / API value |
| -------- | --------- | ---------------- |
| vSAN OSA | vSAN → vSAN HCI, ESA off | `VSAN` |
| vSAN ESA | vSAN → vSAN HCI, ESA on | `VSAN_ESA` |
| vSAN storage cluster (vSAN Max) | vSAN → vSAN Storage | `VSAN_MAX` |
| vSAN compute cluster | vSAN → vSAN Compute Cluster | `VSAN_REMOTE` |
| NFS v3 | NFS | `NFS` |
| VMFS on FC | VMFS on FC | `VMFS_FC` |
| vVols (deprecated since 9.0) | vVol + protocol FC / iSCSI / NFS | `VVOL` + `vvolStorageProtocolType` |

Values from the wizard's JSON template description (*"VSAN, VSAN_REMOTE,
VSAN_ESA, VSAN_MAX, NFS, VMFS_FC, VVOL"*, *"Use VSAN_REMOTE for a vSAN compute
cluster. Use VSAN_MAX for a vSAN storage cluster."*). Write them in
**uppercase**: a lowercase `vsan_esa` makes the API validation fail with an
HTTP 500 ([KB 453788](https://knowledge.broadcom.com/external/article/453788), VCF 9.x).

**OSA or ESA is your decision, not something the host can tell you.** A fresh
host has unclaimed disks, so nothing on it says which architecture you intend
(VCFHostPreparation's README makes the same point: *"vSAN OSA vs ESA cannot
be auto-detected"*). Decide per cluster in the design, and commission every
host of that cluster with the same value; a host commissioned with the wrong
one has to be decommissioned and commissioned again ([§6](#6-decommission-and-recommission)).

Per type, before you commission:

- **VMFS on FC:** *"the hosts must have supported FC cards (Host Bus Adapters)
  and drivers installed and configured … The VMFS datastore must be mounted on
  all the hosts before commissioning."* Without a VMFS-6 datastore on the LUN
  the hosts don't show up later in the domain/cluster wizard's host list
  ([KB 432318](https://knowledge.broadcom.com/external/article/432318/commissioned-hosts-are-not-visible-durin.html),
  VCF 9.x). Zoning and the datastore: [`prerequisites.md` → VMFS on Fibre Channel](prerequisites.md#vmfs-on-fibre-channel-only-if-in-scope).
- **vVols (deprecated):** FC: *"all ESX hosts have access to the FC array"*;
  NFS: the hosts *"must be able to reach the NFS server from the NFS network
  assigned in the IP pool"*; iSCSI: *"the iSCSI software initiator must be
  enabled on each ESXi host and the VASA provider URL must be listed as the
  dynamic target."* Add the VASA provider to the inventory before you create
  the domain or cluster.
- **vSAN ESA on disks that aren't ESA-certified:** *"With VMware Cloud
  Foundation 9.0.1 and later, you can use non-certified ESA disks during vSAN
  ESA cluster configuration for proof-of-concept purposes only"*
  ([KB 408300](https://knowledge.broadcom.com/external/article/408300); see
  [§7](#7-common-failures)).

**Can't be commissioned: NFS 4.1, iSCSI, FCoE, NVMe over Fabrics.** The
wizard has no storage type for them. Clusters on those types are built in
vCenter and imported; their hosts are added in vCenter, not commissioned
([KB 405095](https://knowledge.broadcom.com/external/article/405095/unable-to-add-or-decommission-esxi-hosts.html)).
The route is
[`25-cluster-expansion.md` §5](25-cluster-expansion.md#5-converged--imported-clusters-on-converge-only-storage);
why those types are converge-only is in
[`prerequisites.md` → Principal storage](prerequisites.md#converge--import-only-options-and-their-drawbacks).

### 1.4 Certificates follow the management domain

TechDocs: *"If you used ESX hosts with certificates generated by an external
CA for deployment, hosts used for expanding VCF domains or for creating
workload domains must also use certificates generated by an external CA."*
([Configure ESX Hosts with Signed Certificates](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation/configure-esxi-hosts-with-signed-certificates.html)).
Get this wrong and validation fails with *"Host SSL certificate is not trusted
by SDDC Manager"*; [§7](#7-common-failures) has both fixes from
[KB 415767](https://knowledge.broadcom.com/external/article/415767/host-commission-fails-during-validation.html).

### 1.5 Who can commission, and from where

**Console.** TechDocs documents commissioning in the **vSphere Client**; the
SDDC Manager UI (deprecated in VCF 9) is the documented fallback. There is no
commissioning wizard in VCF Operations: the *Commission Hosts* wizard lives in
the vSphere Client (management domain vCenter), **lab-verified 2026-11-10**. TechDocs 9.0
and 9.1 both: *"To perform this task in the vSphere
Client, you must have access to the management domain vCenter, or your VCF
Instance must be configured with VCF SSO and vCenter linking. … As an
alternative, you can perform this task using the SDDC Manager UI"*. Linking:
[Linking vCenter Instances in VCF Operations](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/linking-vcenter-systems-in-vmware-cloud-foundation-operations.html);
fleet SSO: [`12-sso-configuration.md`](12-sso-configuration.md).

**Role.** "Access" means an **ADMIN** role in SDDC Manager. Without it,
*Hosts → Unassigned Hosts* and *Network Pools* in the vSphere Client show
*"Authorization Error : Unauthorized access. There is a restriction with the
page you are trying to reach and it cannot be displayed."* *Assigned Hosts*
still works, and being a vCenter administrator isn't enough. SDDC Manager's
`/var/log/vmware/vcf/commonsvcs/vcf-commonsvcs.log` shows
`PERMISSION_NOT_FOUND`.

**Fallback: `administrator@vsphere.local`.** The management vCenter's own
`administrator@vsphere.local` always has access to *Unassigned Hosts* and the
*Commission Hosts* wizard. Use it as the break-glass account when a named
user hits the error, then fix that user's access with the table below.
**Field-verified 2026-11-10.**

Pick the fix by who is logged in:

| Who / where | Fix | Source |
| --- | --- | --- |
| **Domain user** (e.g. AD), management vCenter | Management vCenter: *Administration → Single Sign On → Users and Groups → Groups → `SDDCAdmins` → Add Members*. Add the user, or better a group it belongs to. Log out and back in | [KB 415254](https://knowledge.broadcom.com/external/article/415254/failed-to-load-host-details-error-under.html) (VCF 9.x); **field-verified 2026-10-22** |
| **VCF SSO user with vCenter linking**: the error, or *Add Hosts* asks you to log in to another management vCenter whose *Global Inventory* stays blank | Give the user the **ADMIN** role in **each** SDDC Manager of the linked environment. The KB's path is the SDDC Manager UI as `administrator@vsphere.local`: *Administration → Single Sign On → + USER OR GROUP* → pick the user → **ADMIN** → ADD. That console is deprecated in VCF 9, but it's the documented route | [KB 440968](https://knowledge.broadcom.com/external/article/440968/unassigned-hosts-page-fails-to-load-or-r.html) (VCF 9.x) |
| **VCF SSO user**: the views are simply **missing**, and password management shows *"Cannot convert a Symbol value to a string"* | Not a permission problem: the SAML token is too large for SDDC Manager's nginx (`400 Request Header Or Cookie Too Large` in `vsphere_client_virgo.log`). The workaround enlarges nginx's header buffers on SDDC Manager | [KB 425591](https://knowledge.broadcom.com/external/article/425591/unassigned-hosts-and-network-pools-not-v.html) (9.0.x) |
| The same message in **VCF Operations** (*Fleet Management → Lifecycle*) | The VMware Cloud Foundation adapter is in a warning collection state. Stop and start its collection | [KB 447493](https://knowledge.broadcom.com/external/article/447493/authorization-error-unauthorized-access.html) (VCF Operations 9.0.2) |

The first two rows are the same gap reached by different routes: neither user
has an ADMIN role in SDDC Manager. That `SDDCAdmins` maps to ADMIN is
inferred, not stated by Broadcom.

**Limits per VCF instance** (configmax, SDDC Manager 9.1.0, checked live
2026-11-10): **50** hosts per commission operation (*Per VCF Instance → Hosts
in a Commission Operation*), **10** concurrent commission operations
(*Concurrent Operations → ESXi Host Commission*); the same 50 / 10 for
decommission (*Hosts in a Decommission Operation*, *ESXi Host
Decommission*). TechDocs: *"You can also run
multiple commission hosts tasks at the same time."*

---

## 2. Commission in the vSphere Client

TechDocs 9.1
[Commission ESX Hosts](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/host-management/commission-hosts.html)
(the 9.0 page has the same click path):

1. *"In the vSphere Client, click Global Inventory Lists → Hosts →
   Unassigned Hosts."*
2. Click **Commission Hosts**.
3. On the **Checklist** page, review the prerequisites (§1) and confirm by
   clicking **Select All**, then **Proceed**.
4. The wizard has two pages, **Host Addition and Validation** and
   **Review** (lab-verified 2026-11-10). Under **Add Hosts**, choose **Add
   new** (one host at a time) or **Import** (many hosts from a JSON file; the
   template is the *JSON* link in the page text *"You can either choose to add
   host one at a time or download JSON template and perform bulk
   commission."*):
   - **Add new** fields: **Host FQDN**; **Storage Type** (vSAN, NFS, VMFS on
     FC, or vVol). For vSAN, the **vSAN Type** (vSAN HCI, vSAN Storage, or
     vSAN Compute Cluster) and, for vSAN HCI, whether to use **ESA**. For
     vVol, the protocol (FC, iSCSI or NFS). **Network Pool Name** (drop-down);
     **User Name** and **Password** (the host's root credentials). Click
     **Add**, and repeat for the next host.
   - **Import:** download the JSON template from the link, fill in per host the
     FQDN, root user name and password, storage type (§1.3 table), network
     pool name and, for vVols only, the protocol; **Browse** to the file and
     **Upload**.
5. The hosts appear under **Hosts Added** (columns *FQDN*, *Network Pool*,
   *Confirm FingerPrint*, *Validation Status*; lab-verified). *"Verify that the server
   fingerprint is correct for each host and then activate the Confirm All
   Finger Prints toggle."* Compare against a value you read from the host
   yourself rather than clicking through: a wrong fingerprint means you are
   not talking to the host you think. This repo hasn't verified which of the
   host's fingerprints (SSL or SSH) the wizard displays.
6. Click **Validate All**. *"Each host is marked as Valid or Invalid. For
   invalid hosts, you can correct the problem and validate again, or select
   the host and click Remove to proceed with commissioning the valid hosts."*
7. Click **Next**.
8. **Skip failed hosts during commissioning**: *"This setting is enabled by
   default. When enabled, hosts that fail are skipped and commissioning
   continues on the remaining hosts."*
9. Click **Commission**.

**Validate vs commission.** *Validate All* only checks; nothing is added to
the inventory until *Commission*. The commission task then validates and
commissions each host again: *"After you specify host details and select the
network pool to associate the hosts with, the platform validates and
commissions each host."*

What the task does to the host, per TechDocs:

- *"the platform temporarily activates SSH on the host in order to retrieve
  the host key. After it retrieves the host key, the platform deactivates SSH
  on the host."*
- *"Multiple VMkernels are created to test the vMotion network. If MAC address
  filtering is enabled on your physical infrastructure, this may cause issues
  such as vMotion network connectivity validation failure."*

When it finishes, *"The commissioned hosts are added to the Unassigned Hosts
table."*

---

## 3. Commission through the SDDC Manager API

Validate first, then commission, with the same body. Endpoints from the
[SDDC Manager API 9.1.1 reference — Hosts](https://developer.broadcom.com/xapis/sddc-manager-api/9.1.1/hosts/)
(the same paths exist in the 9.0 and 9.1 references):

| Step | Call | Returns |
| ---- | ---- | ------- |
| Token | `POST /v1/tokens` | Bearer token (as in [`21-config-artifacts.md`](21-config-artifacts.md)) |
| Pool ID | `GET /v1/network-pools` | `id` of the pool from §1.1 |
| Validate | `POST /v1/hosts/validations` | `202`, a `Validation` with `id`, `executionStatus`, `resultStatus`, `validationChecks[]` |
| Poll validation | `GET /v1/hosts/validations/{id}` | same object; wait for `executionStatus: COMPLETED`, then read `resultStatus` |
| Commission | `POST /v1/hosts` | `202`, a `Task` (type `HOST_COMMISSION`); `Location: /v1/tasks/{id}` |
| Poll task | `GET /v1/tasks/{id}` | `status` until `SUCCESSFUL` or `FAILED` |
| Check | `GET /v1/hosts?status=UNASSIGNED_USEABLE` | the new hosts with their `id` |

`POST /v1/hosts/validations/commissions` is marked **Deprecated** in the 9.1.1
reference; use `POST /v1/hosts/validations`.

The body is an **array** of
[`HostCommissionSpec`](https://developer.broadcom.com/xapis/sddc-manager-api/9.1.1/data-structures/HostCommissionSpec/),
one entry per host:

```json
[
  {
    "fqdn": "sfo01-w01-esx01.sfo.rainpole.io",
    "username": "root",
    "password": "<ESX root password>",
    "storageType": "VSAN_ESA",
    "networkPoolId": "<network pool ID>",
    "networkPoolName": "sfo-w01-np01"
  },
  {
    "fqdn": "sfo01-w01-esx02.sfo.rainpole.io",
    "username": "root",
    "password": "<ESX root password>",
    "storageType": "VSAN_ESA",
    "networkPoolId": "<network pool ID>",
    "networkPoolName": "sfo-w01-np01"
  }
]
```

Field by field (9.1.1 reference):

- **`fqdn`, `username`, `password`, `storageType`, `networkPoolId`** —
  required. `networkPoolName` is optional; the pool is bound by **ID**.
- **`storageType`** — the schema lists *"VSAN, VSAN_ESA, VSAN_REMOTE, VSAN_MAX,
  NFS, NFS41, VMFS_FC, VVOL, VMFS, FC"*. The extra values (`NFS41`, `VMFS`,
  `FC`) appear in the schema, but TechDocs' commission procedure offers only
  the seven in §1.3. Stick to those; this repo hasn't tested the others.
- **`vvolStorageProtocolType`** — `ISCSI`, `NFS` or `FC`; vVols only.
- **`sshThumbprint`, `sslThumbprint`** — optional: *"SSH thumbprint of the
  host"*, *"SSL thumbprint of the host"*. This is the API's counterpart of the
  wizard's fingerprint confirmation.
- **`skipHclCompatibilityPrecheck`** — optional: *"This option bypasses vSAN
  ESA HCL validation during host commissioning. Set this flag only when hosts
  lack vSAN ESA certified disks or when SDDC Manager cannot verify disk
  status. (Using vSAN ESA certified disk(s) is recommended.)"*

The file holds root passwords: treat it as a secret, and don't commit it.

**Where to run it without a script:** VCF Operations' API Explorer. TechDocs
(in the stretch procedure): *"Log in to VCF Operations. In the navigation
pane, click Developer Center APIs & SDKs. Click the API Explorer link on the
SDDC Manager API."*

**Decommission** is the reverse: `DELETE /v1/hosts` with an array of
`HostDecommissionSpec` (`[ { "fqdn": "…" } ]`), returning a
`HOST_DECOMMISSION` task.

---

## 4. Scripted: VCFHostPreparation

[**VCFHostPreparation**](https://github.com/pauldiee/VCFHostPreparation)
(Paul van Dieen) wraps §1.2 and §3 in two PowerShell scripts. Background and a
walkthrough: the blog post
[Automating ESXi host preparation for VCF 9 with PowerShell](https://www.hollebollevsan.nl/automating-esxi-host-preparation-for-vcf-9-with-powershell/).
Run them in order:

1. **`HostPrep.ps1`** reads a text file of host FQDNs and, per host, checks
   forward and reverse DNS, sets and checks NTP, sets
   `Config.HostAgent.ssl.keyStore.allowSelfSigned`, detects the storage type,
   regenerates the certificate when its CN doesn't match the FQDN (offering to
   fix a host still called `localhost.localdomain` first), and can reset the
   root password to a VCF 9 compliant value. `-WipeDisk` clears old
   partitions on vSAN hosts ([§6.2](#62-recommission-a-former-vsan-host));
   `-DryRun` and `-WhatIfReport` change nothing. Output: an HTML report with
   each host's SHA256 thumbprint and a commissioning CSV.
2. **`Commission-VCFHosts.ps1`** reads that CSV, asks for the SDDC Manager,
   the network pool and the root password, runs `POST /v1/hosts/validations`
   (with an HTML validation report; it stops on a failure), then `POST
   /v1/hosts`, polls the task, and lists each host's SDDC Manager ID.
   `-ValidateOnly` stops after validation.

The storage type is the one manual step. `HostPrep.ps1` writes `VMFS_FC` when
it finds an FC HBA, `NFS` when an NFS datastore is mounted, and `VSAN`
otherwise. **Edit the CSV's `StorageType` column to `VSAN_ESA` (or `VVOL`)
before running `Commission-VCFHosts.ps1`**: it sends the value as is.

Requirements and all parameters are in the repo's README.

---

## 5. Check the result

- **vSphere Client:** *Global Inventory Lists → Hosts → Unassigned Hosts*
  lists the new hosts
  ([View ESX Host Inventory](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/host-management/view-host-inventory.html)).
- **API:** `GET /v1/hosts?status=UNASSIGNED_USEABLE` returns them, with the
  `id` that the domain, cluster, expansion and stretch specs ask for. The
  other states are `ASSIGNED` and `UNASSIGNED_UNUSEABLE`. Filter further with
  `storageType=` or `networkpoolId=` to check a host landed with the right
  type in the right pool.
- **Progress or failure detail:** VCF Operations → *Fleet Management →
  Tasks*, or `GET /v1/tasks/{id}`.

Then go back to the runbook you came from:
[23](23-workload-domain-creation.md) (new domain),
[24](24-cluster-creation.md) (new cluster),
[25](25-cluster-expansion.md) (add to a cluster) or
[22](22-stretch-execution.md) (stretch).

---

## 6. Decommission and recommission

### 6.1 Decommission

From [Decommission ESX Hosts](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/host-management/decommission-hosts.html):
*"The hosts that you want to decommission must not be assigned to a VCF
domain. If a host is assigned to a VCF domain, you must remove it from the VCF
domain before you can decommission it."* So remove the host from its cluster
first, then:

1. *"In the vSphere Client, click Global Inventory Lists → Hosts →
   Unassigned Hosts."*
2. Select one or more hosts and click **Decommission Selected Hosts**.
3. **Skip failed hosts during decommissioning** (on by default).
4. Click **Confirm**.

API: `DELETE /v1/hosts` ([§3](#3-commission-through-the-sddc-manager-api)).

If a decommission doesn't complete, SDDC Manager can keep the host's record,
and a later commission of the same FQDN fails (*"Host(s) already present in
inventory"*, [§7](#7-common-failures)).

### 6.2 Recommission a former vSAN host

**Re-image when the host was in a domain.** TechDocs: *"If the decommissioned
host was previously part of a VCF domain, you must re-image it before
commissioning it again and adding it to a VCF domain. If the decommissioned
host was not part of a VCF domain, you do not have to re-image it before
commissioning it again."* The same applies to moving a host between domains:
*"the host must be decommissioned, re-imaged, and commissioned before it is
added to the workload domain"*
([KB 414650](https://knowledge.broadcom.com/external/article/414650), VCF 5.x
and 9.x). Commissioning is also where you correct a wrong storage type
(OSA vs ESA).

**Wipe the old vSAN partitions.** A reinstall doesn't necessarily clear the
data disks, and leftover vSAN partitions fail validation with *"vSAN Partition
found on the host, needs clean-up"*
([KB 399567](https://knowledge.broadcom.com/external/article/399567/unable-to-add-the-host-to-sddc-manager-f.html)).
First make sure *"the host is not part of any active vSAN cluster and does not
contain any active objects"* (same KB). Then either:

- **Host Client:** *Storage → Devices* → the vSAN-eligible device →
  *Actions → Clear partition table*, for each device (KB 399567), or
- **ESX shell:** `vdq -i` lists the disks; ESA hosts first need
  `esxcli vsan storagepool remove -u <device UUID>` per device and
  `esxcli vsan cluster leave` (KB 399567), or
- **Scripted:** `.\HostPrep.ps1 -WipeDisk` (add `-DryRun` to see first). Per
  its README it runs only for hosts detected as `VSAN`, always excludes the
  boot disk, asks Y/N per host, unmounts VMFS on the target disks and runs
  `partedUtil mklabel <device> gpt` over SSH.

Wiping is destructive: check the device list before you confirm.

---

## 7. Common failures

Logs: commission and validation errors land in
`/var/log/vmware/vcf/operationsmanager/operationsmanager.log` on SDDC Manager
(per the KBs below).

| Symptom | Cause and fix | Source |
| ------- | ------------- | ------ |
| *"Authorization Error : Unauthorized access"* on *Unassigned Hosts* / *Network Pools* | No ADMIN role in SDDC Manager; see the table in [§1.5](#15-who-can-commission-and-from-where) | KB 415254 (**field-verified**), KB 440968, KB 425591, KB 447493 |
| *"Host SSL certificate is not trusted by SDDC Manager"* (`SDDC_TRUST_HOST_SSL_CERT_FAILED`) | The host has a default certificate while the management hosts use external-CA certificates. Bring-up with external certs: replace the new host's certificate with an external one, then commission. Default at bring-up, external later: switch the ESX certificate mode in vCenter to `vmca`, commission, switch back | [KB 415767](https://knowledge.broadcom.com/external/article/415767/host-commission-fails-during-validation.html) (VCF 5.2.x, 9.x) |
| *"Unable to get the Host Fingerprint, verify ESXi host connectivity or credentials or SSH"* | SSH unavailable, a firewall between SDDC Manager and the host, or a certificate CN that's the short name. Check the CN with `openssl s_client -connect <host-fqdn>:443 -showcerts` from SDDC Manager; fix the FQDN and regenerate the certificate (§1.2) | [KB 388823](https://knowledge.broadcom.com/external/article/388823/esxi-host-commission-from-sddc-manager-f.html) (VCF 9.0.x) |
| *"vSphere standard switch vSwitch0 must have only one NIC as Uplink"* | More than one NIC on `vSwitch0`; the KB names a NIC below 10 Gbps as the cause. Leave one uplink on `vSwitch0` (§1.2); you can remove the failing host and commission the rest | [KB 412127](https://knowledge.broadcom.com/external/article/412127/vsphere-standard-switch-vswitch0-must-ha.html) (VCF 9) |
| *"vSAN Partition found on the host, needs clean-up"* | Old vSAN partitions or an ESA storage pool on the disks; wipe them ([§6.2](#62-recommission-a-former-vsan-host)) | [KB 399567](https://knowledge.broadcom.com/external/article/399567/unable-to-add-the-host-to-sddc-manager-f.html) |
| `VSAN_ESA_HOST_NOT_HCL_COMPATIBLE`, or *"Failed to validate vSAN HCL status"* with vSAN ESA | The disks can't be verified as vSAN ESA certified against SDDC Manager's HCL. Check the HCL data on SDDC Manager is current; for a proof of concept on non-certified disks, KB 408300's property `vsan.esa.sddc.managed.disk.claim=true` in `/etc/vmware/vcf/operationsmanager/application.properties`, or the API's `skipHclCompatibilityPrecheck` | [KB 408300](https://knowledge.broadcom.com/external/article/408300) (9.0.1+, 9.1.x) |
| `Http failure response for …/ui/api/v1/hosts/prechecks: 500 OK` with *"Failed to validate vSAN HCL status"* on a JSON import | The storage type is in lowercase (`vsan_esa`); write it in uppercase | [KB 453788](https://knowledge.broadcom.com/external/article/453788) (VCF 9.x) |
| *"Host(s) already present in inventory, validation failed"* after re-imaging | An earlier decommission was incomplete and left the FQDN in the SDDC Manager database. The fix is a database clean-up: **open a Broadcom support request** | [KB 424242](https://knowledge.broadcom.com/external/article/424242/esx-host-commissioning-validation-fails.html) (VCF 9.x) |
| *"[Applicable to skipped ESXi Hosts]Perform set of validations for current workflow"* | The guardrail check can't reach NSX Manager by name. Fix forward **and** reverse DNS for the NSX Manager FQDN, as resolved from SDDC Manager, VCF Operations and vCenter | [KB 423908](https://knowledge.broadcom.com/external/article/423908/host-commission-workflow-in-vcf-9-fails.html) (VCF 9.x) |
| The ping test from SDDC Manager to the host's management network fails (for example, ICMP blocked between them) | 9.1 and later can skip the test: `validation.disable.ping.connectivity.check=true` in `/etc/vmware/vcf/operationsmanager/application.properties`, then `systemctl restart operationsmanager` | [KB 432391](https://knowledge.broadcom.com/external/article/432391) (VCF 5.2.3, 9.1+) |
| vMotion network connectivity validation fails | The commission creates *"Multiple VMkernels … to test the vMotion network"*; MAC address filtering on the physical network can block them. Also check the pool's vMotion VLAN, MTU and gateway | TechDocs Commission ESX Hosts |
| Commissioned **VMFS_FC** hosts missing from the domain/cluster wizard (*"No suitable hosts available"*) | No VMFS-6 datastore on the presented LUN; create it on the hosts and refresh the wizard | [KB 432318](https://knowledge.broadcom.com/external/article/432318/commissioned-hosts-are-not-visible-durin.html) (VCF 9.x) |
| Host on an imported cluster: *"Cluster is marked as imported. This operation is not allowed on imported clusters"* | Converge-only storage; don't commission, add in vCenter | [KB 405095](https://knowledge.broadcom.com/external/article/405095/unable-to-add-or-decommission-esxi-hosts.html), [`25` §5](25-cluster-expansion.md#5-converged--imported-clusters-on-converge-only-storage) |

KB 408300 and KB 432391 change SDDC Manager's validation behaviour. Use them
for what the KB describes, not to push an unsupported host through.

---

## Sources

- TechDocs 9.1: [Commission ESX Hosts](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/host-management/commission-hosts.html), [Decommission ESX Hosts](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/host-management/decommission-hosts.html), [Network Pool Management](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/host-management/about-network-pools.html), [View ESX Host Inventory](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/host-management/view-host-inventory.html) (all last updated 2026-11-09, read 2026-11-10)
- TechDocs 9.0: [Commission ESX Hosts](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/building-your-private-cloud-infrastructure/host-management/commission-hosts.html) (same click path; adds the 10 Gbps line)
- TechDocs 9.1: [Preparing ESX Hosts for VCF or vSphere Foundation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation.html), [Regenerate the Self-Signed Certificate on the ESX Hosts](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/preparing-esx-hosts-for-vmware-cloud-foundation-or-vmware-vsphere-foundation/regenerate-the-self-signed-certificate-on-esx-hosts.html), [Create a New Workload Domain](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/working-with-workload-domains/deploy-a-vi-workload-domain-using-the-sddc-manager-ui.html) (express patch, vSAN disks)
- API: [SDDC Manager API 9.1.1 — Hosts](https://developer.broadcom.com/xapis/sddc-manager-api/9.1.1/hosts/), [HostCommissionSpec](https://developer.broadcom.com/xapis/sddc-manager-api/9.1.1/data-structures/HostCommissionSpec/), [Validate Host Commission Spec](https://developer.broadcom.com/xapis/sddc-manager-api/9.1.1/v1/hosts/validations/post/), [Commission Hosts](https://developer.broadcom.com/xapis/sddc-manager-api/9.1.1/v1/hosts/post/), [Decommission Hosts](https://developer.broadcom.com/xapis/sddc-manager-api/9.1.1/v1/hosts/delete/), [Get Hosts](https://developer.broadcom.com/xapis/sddc-manager-api/9.1.1/v1/hosts/get/)
- configmax: [SDDC Manager 9.1.0](https://configmax.broadcom.com/guest?vmwareproduct=SDDC%20Manager&release=9.1.0) (*Hosts in a Commission Operation* 50, *ESXi Host Commission* 10 concurrent; same for decommission), checked live 2026-11-10
- KB: [399567](https://knowledge.broadcom.com/external/article/399567/unable-to-add-the-host-to-sddc-manager-f.html), [405095](https://knowledge.broadcom.com/external/article/405095/unable-to-add-or-decommission-esxi-hosts.html), [408300](https://knowledge.broadcom.com/external/article/408300), [412127](https://knowledge.broadcom.com/external/article/412127/vsphere-standard-switch-vswitch0-must-ha.html), [414650](https://knowledge.broadcom.com/external/article/414650), [415254](https://knowledge.broadcom.com/external/article/415254/failed-to-load-host-details-error-under.html), [415767](https://knowledge.broadcom.com/external/article/415767/host-commission-fails-during-validation.html), [423908](https://knowledge.broadcom.com/external/article/423908/host-commission-workflow-in-vcf-9-fails.html), [424242](https://knowledge.broadcom.com/external/article/424242/esx-host-commissioning-validation-fails.html), [425591](https://knowledge.broadcom.com/external/article/425591/unassigned-hosts-and-network-pools-not-v.html), [432318](https://knowledge.broadcom.com/external/article/432318/commissioned-hosts-are-not-visible-durin.html), [432391](https://knowledge.broadcom.com/external/article/432391), [440968](https://knowledge.broadcom.com/external/article/440968/unassigned-hosts-page-fails-to-load-or-r.html), [447493](https://knowledge.broadcom.com/external/article/447493/authorization-error-unauthorized-access.html), [453788](https://knowledge.broadcom.com/external/article/453788), [388823](https://knowledge.broadcom.com/external/article/388823/esxi-host-commission-from-sddc-manager-f.html)
- Tool: [VCFHostPreparation](https://github.com/pauldiee/VCFHostPreparation) (`HostPrep.ps1` 4.4.0, `Commission-VCFHosts.ps1` 3.1.4); blog post: [Automating ESXi host preparation for VCF 9 with PowerShell](https://www.hollebollevsan.nl/automating-esxi-host-preparation-for-vcf-9-with-powershell/)
- Lab: *Commission Hosts* wizard in the vSphere Client, screenshot of *Host Addition and Validation*, 2026-11-10
