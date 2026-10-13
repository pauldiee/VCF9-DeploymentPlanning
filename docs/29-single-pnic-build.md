# Single-pNIC Builds — Build Guide

Sometimes part of a VCF host's networking runs over **one physical NIC as ESX
sees it**. Usually that's the **management network**: a converged or blade
platform (Cisco UCS and similar) gives the host one vNIC for `vmk0` and
handles its redundancy in the fabric, while everything else runs on normal
dual-uplink vNICs. Less often, it's the whole host: a lab box with one port,
or a platform that presents a single vNIC for all traffic.

Either way, the default flow isn't built for it. The VCF Installer's vDS
profiles put two uplinks on every vDS, and the workbook says single NIC is
**API-only**. This guide covers the build end to end: three worked layouts,
the bring-up JSON for each, the known validation snags, the post-bring-up
clean-up, and the workload-domain, cluster and expansion hosts that come
later.

This guide targets **VCF 9.1**. It's the step-by-step companion to the
single-uplink note in
[`prerequisites.md`](prerequisites.md#management-domain), which covers
*whether* to do it. The short version: if the fabric can present **two**
vNICs where you planned one (one pinned to each fabric, *without* fabric
failover), do that instead, and you don't need this guide.

> **Evidence level:** TechDocs-, KB- and API-reference-sourced (read
> verbatim), plus community posts where credited. **Not lab- or
> field-verified in this repo yet.** The JSON fragments match the 9.1.1 API
> schemas field for field, but no layout in this guide has been run through a
> live Installer validation. Two Broadcom KBs on this topic contradict the
> product docs or have been withdrawn;
> [§2](#2-what-supported-means--the-sources-and-where-they-disagree) has the
> timeline.

---

## The sequence, end to end

1. [Pick your layout](#1-pick-your-layout)
2. [What "supported" means — the sources and where they disagree](#2-what-supported-means--the-sources-and-where-they-disagree)
3. [Prepare the hosts and the fabric](#3-prepare-the-hosts-and-the-fabric)
4. [Build the bring-up JSON spec](#4-build-the-bring-up-json-spec) — one worked example per layout
5. [Deploy from the JSON spec](#5-deploy-from-the-json-spec)
6. [Validation snags you may hit](#6-validation-snags-you-may-hit)
7. [After bring-up](#7-after-bring-up)
8. [Later hosts: workload domains, clusters, expansion](#8-later-hosts-workload-domains-clusters-expansion)

---

## 1. Pick your layout

The three worked examples below are all **management domain, VCF 9.1**,
Rainpole-style values. The ESX view is what matters: a UCS vNIC with fabric
failover is one `vmnicN` to ESX.

| Example | ESX sees | Single-uplink vDS carries | Dual-uplink vDS(es) carry | Principal storage |
| ------- | -------- | ------------------------- | ------------------------- | ----------------- |
| **A — management on one pNIC** | 3 vmnics | `vmk0` (MANAGEMENT) + appliance VMs (VM_MANAGEMENT) | vMotion, vSAN, NSX host TEP | vSAN |
| **B — management on one pNIC, storage separated** | 5 vmnics | `vmk0` (MANAGEMENT) only | vds02: appliance VMs, vMotion, NSX host TEP · vds03: NFS | NFS v3 |
| **C — whole host on one pNIC** | 1 vmnic | everything | — | vSAN (NFS possible, see [§6](#6-validation-snags-you-may-hit)) |

How they differ in practice:

- **A and B** keep host-level teaming for all the heavy traffic. Only the
  management path depends on the fabric's failover. That's the usual reason
  for this design: the management vNIC gets fabric failover, everything else
  gets two vNICs, one per fabric.
- **Where appliance VMs live** (`VM_MANAGEMENT`) is your call. In **A** they
  share the single-uplink vDS with `vmk0`, so vCenter, NSX Manager, SDDC
  Manager and VCF Operations also depend on fabric failover. In **B** they
  sit on a dual-uplink vDS, and only the hosts' own management VMkernels
  ride the single uplink.
- **The vSphere HA warning** depends on storage. With vSAN, HA talks over
  the vSAN network, so A has nothing to warn about. With NFS (B) or no vSAN at
  all (C without vSAN), HA uses the management network and warns. See
  [§7.1](#71-the-vsphere-ha-redundancy-warning).
- **C** has no teaming anywhere at the host and is where the NFS snags in
  [§6](#6-validation-snags-you-may-hit) bite hardest. It's a lab layout
  unless the platform genuinely can't give you a second vNIC.

Decide **before** bring-up and apply it to every host in the domain. Hosts
added later must match
([§8](#8-later-hosts-workload-domains-clusters-expansion)).

---

## 2. What "supported" means — the sources and where they disagree

The sources don't agree with each other. Here they are in date order, so
you can see what each one says and how current it is:

| Date | Source | What it says |
| ---- | ------ | ------------ |
| 2025-06 / 2025-07 (VCF 9.0) | William Lam, [Deploying VCF 9.0 on a single ESXi host](https://williamlam.com/2025/06/deploying-vcf-9-0-on-a-single-esxi-host.html) and [Workaround for single NIC using NFS storage with VCF 9.0](https://williamlam.com/2025/07/workaround-for-single-nic-using-nfs-storage-with-vcf-9-0.html) | Whole-host single NIC works for VCF 9.0 in a lab, especially with vSAN. With NFS, the Installer moves the only uplink to the vDS and leaves the NFS VMkernel stranded on `vSwitch0`. |
| 9.1 workbook, v1.9.1.001 (pinned in `reference/`) | P&P workbook, NIC rows for the management **and** VI workload domain | *"Single NIC is supported with API Only"* |
| Published 2026-05-21; **withdrawn** (404 on 2026-10-13) | KB 441194, *VCF 9.1 Deployment Fails: NFS Datastore Configuration Validation Fails on ESXi Hosts with a Single pNIC* ([archived copy, 2026-06-11](http://web.archive.org/web/20260611100122/https://knowledge.broadcom.com/external/article/441194/vcf-91-deployment-fails-nfs-datastore-co.html)) | *"the built-in validation check in VCF 9.1 expects multiple physical NICs for redundancy purposes. If it detects only a single pNIC configuration, it incorrectly flags the setup as invalid"*. It gave an Installer property to skip the NFS check. |
| Published 2026-05-26 | [KB 441799](https://knowledge.broadcom.com/external/article/441799), *VCF 9.x Deployment Validation Fails With VCmanager Found Less Than Two Uplinks* | Fewer than two pNICs on *"the Management Domain Distributed Virtual Switch (DVS)"* is *"violating the VCF minimum requirement"*; fix is to list two. |
| Last Updated 2026-10-12 | TechDocs 9.1, [Commission Hosts](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/host-management/commission-hosts.html) | *"Hosts can have a single physical NIC or multiple physical NICs. For hosts with multiple physical NICs, only one can be connected to a standard switch, and the NIC must support all management traffic."* |

How to read this:

- **The product docs and the workbook say supported, API-only.** TechDocs
  even describes the multi-NIC case (examples A and B): one NIC on the
  standard switch carrying management, the rest unassigned until bring-up.
  That's the basis for this guide. Neither source says in so many words
  that a *one-uplink vDS* is fine on a host that has other NICs. That's the
  gap KB 441799 falls into.
- **KB 441799 is the snag most likely to hit examples A and B**, because it's
  about the management vDS specifically. But it's not a reliable source for
  9.x. It tells you to use *"VMware Cloud Builder"*, which VCF 9 doesn't have
  (the VCF Installer replaced it), and to edit a `vmnics` array in
  `networkSpecs`/`hostSpecs`, which is the 5.x spec shape, not the 9.x
  `dvsSpecs[].vmnicsToUplinks`. If you hit its error, see
  [§6](#6-validation-snags-you-may-hit).
- **KB 441194 is gone.** Don't treat its bypass as current Broadcom guidance.
  It's here because you may meet it in older notes, and because the problem
  it described may still exist.

---

## 3. Prepare the hosts and the fabric

Everything from [`prerequisites.md`](prerequisites.md) still applies. On top
of that:

1. **Only the management vmnic on `vSwitch0`.** Install ESX with the
   management vmnic (normally `vmnic0`) as the only uplink of `vSwitch0`,
   `vmk0` on it. In examples A and B, leave every other vmnic **unassigned**.
   Commission Hosts: *"only one can be connected to a standard switch"*. The
   Installer claims them for the vDSes during bring-up.
   [VCFHostPreparation](https://github.com/pauldiee/VCFHostPreparation)
   automates the imaging.
2. **Same vmnic numbering on every host.** The bring-up spec maps vmnics by
   name (`vmnic0`, `vmnic1`, …) for all hosts at once. Check that the
   management vNIC enumerates as the same `vmnicN` everywhere
   (`esxcli network nic list`; compare MACs to the fabric's vNIC
   definitions). On UCS, vNIC placement order drives this.
3. **VLANs on the right links.** The management VLAN goes to the
   single-uplink vNIC. Every other VLAN goes to the vNICs of the vDS that
   carries it (in C, everything goes to the one link). Don't forget the NSX
   host TEP VLAN and, if Edge nodes will run here, both Edge uplink VLANs.
4. **MTU.** Same rules as normal. In C one mismatch breaks vMotion, vSAN/NFS
   and overlay at once. Test from the host for each VMkernel you can already
   create, e.g. `vmkping -I vmk0 -s 1472 -d <gateway>` for a 1500 management
   network.
5. **Fabric failover detects upstream failures** (single-uplink vNIC only).
   Failover now happens below ESX, where vCenter and NSX can't see it. On UCS,
   the vNIC's network control policy must keep *Action on Uplink Fail = Link
   Down* (the default). The details and citation are in the
   [`prerequisites.md` single-uplink note](prerequisites.md#management-domain).
   VCF doesn't validate this, so check it and record the result.
6. **NFS principal storage** (example B, or C with NFS): pre-create the NFS
   path on the first host exactly as in
   [`prerequisites.md` → NFS v3](prerequisites.md#nfs-v3-only-if-in-scope).
   B uses TechDocs' *"NFS on its own vDS"* layout: a separate standard switch
   on the first host with the NFS vmnics, matching `vds03` in the spec. That's
   a documented first-host exception to the one-NIC-on-a-standard-switch
   rule. In C, the NFS VMkernel must be on its **own VLAN** (William Lam: it
   *"must reside in its own dedicated VLAN"*, not shared with ESX
   management).

---

## 4. Build the bring-up JSON spec

Per the workbook, single NIC is *API Only*: you deploy with
**Deploy Using JSON Spec** in the VCF Installer, not the wizard. The wizard's
predefined vDS profiles put two uplinks on every vDS. This repo hasn't
tested whether its custom switch configuration accepts a one-uplink vDS.

Start from Broadcom's example spec, linked from
[Use a JSON Specification File to Deploy VMware Cloud Foundation or vSphere Foundation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/use-a-json-specification-to-deploy-vmware-cloud-foundation-or-vmware-vsphere-foundation.html)
([example02](https://techdocs.broadcom.com/content/dam/broadcom/techdocs/us/en/dita/vmware/vcf/vcf-90/installation/resources/domainSpec-sfo-m01-example02.json),
three vDSes with two vmnics each). Fill everything **except** networking from
your workbook as usual. Then replace `dvsSpecs` with your example's version
below, and set the teaming in each `networkSpecs[]` entry
([§4.4](#44-networkspecs-teaming-per-network)).

Field names and enums are from the
[VCF Installer API 9.1.1 reference](https://developer.broadcom.com/xapis/vcf-installer-api/9.1.1/data-structures/DvsSpec/)
(`DvsSpec`, `VmnicToUplink`, `TeamingSpec`, `SddcNetworkSpec`). Rules that
apply to every example:

- **Uplink names are per vDS.** `uplink1` on `vds01` and `uplink1` on
  `vds02` are different uplinks; the names can repeat.
- **A vmnic belongs to exactly one vDS.** Listing one twice fails validation
  ([KB 416114](https://knowledge.broadcom.com/external/article/416114/vcf-90-installer-validation-failed-with.html)).
- **`nsxTeamings` uplink names must match that vDS's `vmnicsToUplinks`.**
  A mismatch is a known validation failure, even on standard builds
  ([VCF Installer 9.0 known issues](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/release-notes/vmware-cloud-foundation-90-release-notes/component-specific/vcf-installer-90-known-issues.html)).
  `activeUplinks` is required, `minItems: 1`.
- **`hostSwitchOperationalMode` is left out.** The 9.1.1 reference says it
  is *"Applicable only for the VI Workload Domains"*.

### 4.1 Example A — management on one pNIC, vSAN

`vmnic0` = management vNIC (fabric failover); `vmnic1` / `vmnic2` = one vNIC
per fabric.

```json
"dvsSpecs": [
  {
    "dvsName": "sfo-m01-cl01-vds01",
    "networks": ["MANAGEMENT", "VM_MANAGEMENT"],
    "mtu": 1500,
    "vmnicsToUplinks": [
      { "id": "vmnic0", "uplink": "uplink1" }
    ]
  },
  {
    "dvsName": "sfo-m01-cl01-vds02",
    "networks": ["VMOTION", "VSAN"],
    "mtu": 9000,
    "nsxtSwitchConfig": {
      "transportZones": [
        { "name": "overlay-tz-sfo-m01-nsx01", "transportType": "OVERLAY" },
        { "name": "nsx-vlan-transportzone",   "transportType": "VLAN" }
      ]
    },
    "vmnicsToUplinks": [
      { "id": "vmnic1", "uplink": "uplink1" },
      { "id": "vmnic2", "uplink": "uplink2" }
    ],
    "nsxTeamings": [
      { "policy": "LOADBALANCE_SRCID", "activeUplinks": ["uplink1", "uplink2"], "standByUplinks": [] }
    ]
  }
]
```

- `vds01` has no `nsxtSwitchConfig` and no `nsxTeamings`: it's a plain vDS,
  and NSX lives on `vds02`. Broadcom's example02 does the same with its
  non-NSX vDSes.
- `vds01` MTU 1500 is enough for management. Use 9000 if your standard is
  9000 everywhere.

### 4.2 Example B — management on one pNIC, NFS on its own vDS

`vmnic0` = management vNIC; `vmnic1` / `vmnic2` = general dual pair;
`vmnic3` / `vmnic4` = storage dual pair. Appliance VMs move off the
single-uplink vDS.

```json
"dvsSpecs": [
  {
    "dvsName": "sfo-m01-cl01-vds01",
    "networks": ["MANAGEMENT"],
    "mtu": 1500,
    "vmnicsToUplinks": [
      { "id": "vmnic0", "uplink": "uplink1" }
    ]
  },
  {
    "dvsName": "sfo-m01-cl01-vds02",
    "networks": ["VM_MANAGEMENT", "VMOTION"],
    "mtu": 9000,
    "nsxtSwitchConfig": {
      "transportZones": [
        { "name": "overlay-tz-sfo-m01-nsx01", "transportType": "OVERLAY" },
        { "name": "nsx-vlan-transportzone",   "transportType": "VLAN" }
      ]
    },
    "vmnicsToUplinks": [
      { "id": "vmnic1", "uplink": "uplink1" },
      { "id": "vmnic2", "uplink": "uplink2" }
    ],
    "nsxTeamings": [
      { "policy": "LOADBALANCE_SRCID", "activeUplinks": ["uplink1", "uplink2"], "standByUplinks": [] }
    ]
  },
  {
    "dvsName": "sfo-m01-cl01-vds03",
    "networks": ["NFS"],
    "mtu": 9000,
    "vmnicsToUplinks": [
      { "id": "vmnic3", "uplink": "uplink1" },
      { "id": "vmnic4", "uplink": "uplink2" }
    ]
  }
]
```

- **Splitting `MANAGEMENT` and `VM_MANAGEMENT` across vDSes** is allowed by
  the schema (`networks` is free per vDS), but Broadcom's examples always
  keep them together. Treat it as the least-tested part of this example, and
  fall back to A's grouping if validation objects.
- **NFS first host:** the pre-created standard switch for NFS must use the
  same vmnics (`vmnic3`/`vmnic4`), and its port group name must match
  `vds03`'s NFS `portGroupKey` ([§3](#3-prepare-the-hosts-and-the-fabric)
  step 6).

### 4.3 Example C — whole host on one pNIC

`vmnic0` is the only vmnic. Everything, including NSX, goes on one vDS with
one uplink:

```json
"dvsSpecs": [
  {
    "dvsName": "sfo-m01-cl01-vds01",
    "networks": ["MANAGEMENT", "VM_MANAGEMENT", "VMOTION", "VSAN"],
    "mtu": 9000,
    "nsxtSwitchConfig": {
      "transportZones": [
        { "name": "overlay-tz-sfo-m01-nsx01", "transportType": "OVERLAY" },
        { "name": "nsx-vlan-transportzone",   "transportType": "VLAN" }
      ]
    },
    "vmnicsToUplinks": [
      { "id": "vmnic0", "uplink": "uplink1" }
    ],
    "nsxTeamings": [
      { "policy": "FAILOVER_ORDER", "activeUplinks": ["uplink1"], "standByUplinks": [] }
    ]
  }
]
```

- **`nsxTeamings`**: `FAILOVER_ORDER` with one active uplink and no
  standby. `LOADBALANCE_SRCID` with one uplink has nothing to balance
  across.
- For NFS instead of vSAN, replace `VSAN` with `NFS` in `networks`, and read
  [§6](#6-validation-snags-you-may-hit) first.

### 4.4 `networkSpecs`: teaming per network

Every `networkSpecs[]` entry names the uplinks **of the vDS that carries that
network**. A network on a **single-uplink vDS** gets one active uplink and
explicit failover:

```json
{
  "networkType": "MANAGEMENT",
  "subnet": "10.11.11.0/24",
  "gateway": "10.11.11.1",
  "vlanId": 1111,
  "mtu": 1500,
  "teamingPolicy": "failover_explicit",
  "activeUplinks": ["uplink1"],
  "standbyUplinks": [],
  "portGroupKey": "sfo-m01-cl01-vds01-pg-esx-mgmt"
}
```

A network on a **dual-uplink vDS** keeps Broadcom's default
(`"teamingPolicy": "loadbalance_loadbased"`, `"activeUplinks": ["uplink1",
"uplink2"]`), as in example02.

| Network | Example A | Example B | Example C |
| ------- | --------- | --------- | --------- |
| MANAGEMENT | single (`vds01`) | single (`vds01`) | single |
| VM_MANAGEMENT | single (`vds01`) | dual (`vds02`) | single |
| VMOTION | dual (`vds02`) | dual (`vds02`) | single |
| VSAN / NFS | dual (`vds02`) | dual (`vds03`) | single |

- **`teamingPolicy`**: `failover_explicit` is in the 9.1.1 enum (*Use
  explicit failover order*). Never put `uplink2` on a network whose vDS has
  only `uplink1`.
- **`portGroupKey`** (NFS): must match the port group you pre-created on the
  first host letter for letter
  ([KB 446573](https://knowledge.broadcom.com/external/article/446573/vcf-installer-prevalidation-fails-at-nfs.html)).

### 4.5 Check before you upload

- Each vmnic appears in exactly one `vmnicsToUplinks`, and exists with that
  name on **every** host.
- For each `networkSpecs[]` entry, every uplink in `activeUplinks` /
  `standbyUplinks` exists on the vDS that carries it ([§4.4](#44-networkspecs-teaming-per-network) table).
- The NSX host TEP VLAN (`nsxtSpec.transportVlanId`) is trunked to the vNICs
  of the vDS with `nsxtSwitchConfig`.
- Example C only: `grep -c uplink2 <spec>.json` returns **0**.

---

## 5. Deploy from the JSON spec

From the TechDocs procedure (*"Use a JSON Specification File…"*, linked
above):

1. Log in to the VCF Installer at `https://<installer_appliance_FQDN>` as
   `admin@local`.
2. Click **Deploy Using JSON Spec** and upload the file.
3. Review the **Summary** and **JSON Preview**, then **Next**.
4. Review the validation. *"You can modify and reupload the JSON
   specification file"* for errors; acknowledge warnings you have reviewed.
5. **Deploy**, and watch the Tasks panel. A failed task can be fixed and
   retried.

> **Installer version.** As of its 2026-10-12 update, the 9.1 page lists a
> prerequisite: *"Verify that you deployed VCF Installer version 9.1.1 or
> later."* Use a 9.1.1+ Installer for the JSON path.

---

## 6. Validation snags you may hit

| Symptom | Applies to | What it is | What to do |
| ------- | ---------- | ---------- | ---------- |
| *"VCmanager Found less than two uplinks for the DVS"* | A, B, C | [KB 441799](https://knowledge.broadcom.com/external/article/441799)'s error, about the management vDS. The KB's fix (add a second vmnic) defeats the point, and the KB itself looks unreliable ([§2](#2-what-supported-means--the-sources-and-where-they-disagree)). | Don't add a phantom vmnic. Open a support case citing [Commission Hosts (9.1)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/host-management/commission-hosts.html) and the workbook's *"Single NIC is supported with API Only"*. If you can make the fabric present a second management vNIC instead, that removes the problem. |
| *"Failed to validate connectivity of VMOTION network"* (or VSAN) | C | The connectivity check doesn't cope with a vmnic still in use by `vSwitch0`: *"if the active vmnic is already in use by the VSS(vSwitch0), then the validation will fail"* ([KB 437248](https://knowledge.broadcom.com/external/article/437248/91-vcf-installer-fails-on-vmotion-networ.html), 9.0 and 9.1). In C, vMotion and vSAN share `vmnic0`, which is on `vSwitch0` during validation. | First prove vMotion/vSAN connectivity by hand (`vmkping` with the right MTU). The KB's skip is `validation.disable.network.connectivity.check=true` in `/etc/vmware/vcf/domainmanager/application.properties` plus `systemctl restart domainmanager`. The KB words it for SDDC Manager; for bring-up the same file is on the Installer appliance. A and B don't hit this: their vMotion and vSAN vmnics are free during validation. |
| NFS: *"NFS datastore mount failed on host <hostname>: An error occurred during host configuration"* at **NFS Datastore Configuration** | C with NFS (possibly B) | Withdrawn KB 441194 said the 9.1 check wrongly expects multiple pNICs. | First rule out the ordinary causes in [KB 446573](https://knowledge.broadcom.com/external/article/446573/vcf-installer-prevalidation-fails-at-nfs.html): port group name, MTU on the standard switch, array export ACL. If NFS demonstrably works from every host (`vmkping` + mounted datastore) and the check still fails, raise it with Broadcom support. The withdrawn KB's workaround was `validation.disable.nfs.configuration.connectivity.check=true` in the same properties file, plus a `domainmanager` restart. Because Broadcom pulled the KB, only use it if support tells you to. |
| NFS datastore drops **during** bring-up, after the uplink moves to the vDS | C with NFS | The Installer migrated `vmnic0` to the vDS but left the NFS VMkernel on `vSwitch0`, which now has no uplink. Documented on 9.0 by William Lam; not confirmed fixed in 9.1. | In vCenter, migrate the NFS VMkernel to the NFS port group on the vDS (*Migrate Networking* on the vDS), confirm the datastore is back, then **retry** the deployment in the Installer; it resumes where it stopped ([Lam](https://williamlam.com/2025/07/workaround-for-single-nic-using-nfs-storage-with-vcf-9-0.html)). |

---

## 7. After bring-up

### 7.1 The vSphere HA redundancy warning

HA flags a host when *"the host is not configured with redundant networks
for the networks used by HA"*. Which networks those are depends on vSAN:
*"if vSAN is enabled, HA will use the networks configured for vSAN"*
([KB 313261](https://knowledge.broadcom.com/external/article?legacyId=2033250),
formerly 2033250; Duncan Epping: *"with vSAN, the management network is not
used for communication between the hosts but the vSAN network is used"*,
[Yellow Bricks, 2017](https://www.yellow-bricks.com/2017/11/08/vsphere-ha-heartbeat-datastores-isolation-address-vsan/)).
The KB's wording dates from vSphere 5.5; nothing newer contradicts it, but it
isn't verified on 9.1 here.

| Example | HA network | Expect the warning? |
| ------- | ---------- | ------------------- |
| A (vSAN on dual-uplink vDS) | vSAN, redundant | **No** |
| B (NFS) | management, single uplink | **Yes** |
| C with vSAN | vSAN, single uplink | **Yes** |
| C with NFS | management, single uplink | **Yes** |

Where it appears, the host shows `Host <xxx> currently has no management
network redundancy`. Broadcom says it *"can be safely ignored"*, and to
suppress it, *"set the VMware HA advanced option
das.ignoreRedundantNetWarning to true and reconfigure VMware HA on that
host"*
([KB 317612](https://knowledge.broadcom.com/external/article/317612/network-redundancy-message-when-configur.html);
its click-paths are from older vSphere clients). In the vSphere Client:

1. Select the cluster → **Configure** → **vSphere Availability** → **Edit**
   → **Advanced Options** → **Add**: `das.ignoreRedundantNetWarning` =
   `true` → **OK**.
2. For each host: right-click → **Reconfigure for vSphere HA**.

Do this per cluster, including every workload-domain cluster built later on
the same layout. Suppressing the warning doesn't add redundancy. The
fabric test in [§7.3](#73-test-fabric-failover-before-go-live) is what
proves it.

### 7.2 Verify the layout

- **vDSes**: each matches the spec. The single-uplink vDS has uplink count
  1, the same vmnic on `uplink1` on every host, and no port group with a
  standby or unused uplink that doesn't exist (vSphere Client → vDS →
  **Configure** → **Topology**).
- **NSX**: each host's transport node is **Up**, with its TEP(s) on the
  intended vDS and tunnels up (NSX Manager → **System** → **Fabric** →
  **Hosts**).
- **`vSwitch0`** is gone or empty: no VMkernel left behind (C with NFS, see
  [§6](#6-validation-snags-you-may-hit)).

### 7.3 Test fabric failover before go-live

ESX can't see the single-uplink vNIC's failover, so prove it from outside,
in a maintenance window:

1. Start a continuous ping from a jump host to several hosts' `vmk0` and to
   vCenter. In A and C, the appliance VMs ride the same path, so include NSX
   Manager and SDDC Manager. In C, also run a host-to-host TEP ping:
   `vmkping ++netstack=vxlan -I vmk10 <peer-tep>` (check the TEP's vmk
   number with `esxcli network ip interface list`).
2. Fail fabric A the way it would fail in real life: its uplinks to the
   core first (this tests *Link Down* on upstream loss), then the whole
   fabric path.
3. Expect a short loss, then recovery on fabric B, with no HA isolation
   events and no hosts disconnecting from vCenter. Repeat for fabric B.

Record the result with the fabric's network control policy. It's the only
evidence that the management path is redundant.

---

## 8. Later hosts: workload domains, clusters, expansion

The workbook's VI workload domain row also says *"Single NIC is supported
with API Only"*. Examples A and B also need more than one vDS, which on its
own already means the API for a workload domain
([`23-workload-domain-creation.md` §5](23-workload-domain-creation.md#5-create-the-domain--api-lacp-no-cluster-or-scripted)).
Plan the API path for every later build on these layouts. The runbooks are
the same as for any host; only the network fragments change.

**Commissioning** is unchanged: Commission Hosts covers single- and
multi-NIC hosts. Prepare the hosts as in [§3](#3-prepare-the-hosts-and-the-fabric)
(management vmnic on `vSwitch0`, the rest unassigned).

**Keep the layout uniform.** A host with *more* vmnics than its cluster-mates
can't use the extras: *"1 or more of those VMNICs will be unusable due to the
requirements to maintain a uniform host image"*
([KB 442933](https://knowledge.broadcom.com/external/article/442933/steps-for-adding-new-host-to-workload-do.html)).
Don't mix layouts within a cluster.

### 8.1 The SDDC Manager API fragments

Workload domain creation (`DomainCreationSpec`), cluster creation
(`ClusterCreationSpec`) and expansion (`ClusterExpansionSpec`) use the same
three shapes. Field names are from the
[SDDC Manager API 9.1.1 reference](https://developer.broadcom.com/xapis/sddc-manager-api/9.1.1/data-structures/PortgroupSpec/)
(`VmNic`, `PortgroupSpec`, `UplinkProfile`, `TeamingSpec`). Shown for
example A:

**Per host**: `hostSpecs[].hostNetworkSpec.vmNics`, every vmnic mapped to its
vDS and uplink:

```json
"hostNetworkSpec": {
  "vmNics": [
    { "id": "vmnic0", "vdsName": "sfo-w01-cl01-vds01", "uplink": "uplink1" },
    { "id": "vmnic1", "vdsName": "sfo-w01-cl01-vds02", "uplink": "uplink1" },
    { "id": "vmnic2", "vdsName": "sfo-w01-cl01-vds02", "uplink": "uplink2" }
  ],
  "networkProfileName": "sfo-w01-cl01-network-profile01"
}
```

**Per port group**: `networkSpec.vdsSpecs[].portGroupSpecs[]`. Port groups
on the single-uplink vDS get one active uplink:

```json
{
  "name": "sfo-w01-cl01-vds01-pg-esx-mgmt",
  "transportType": "MANAGEMENT",
  "teamingPolicy": "failover_explicit",
  "activeUplinks": ["uplink1"],
  "standByUplinks": []
}
```

Port groups on the dual-uplink vDS keep two active uplinks, as in
[`23-workload-domain-creation.md`](23-workload-domain-creation.md).

**NSX uplink profile**: `nsxClusterSpec.uplinkProfiles[]` describes the vDS
that carries NSX. In A and B that's a dual-uplink vDS, so it's a normal
two-uplink profile. Only in C does it become `FAILOVER_ORDER` with one
active uplink:

```json
{
  "name": "sfo-w01-cl01-uplink-profile01",
  "teamings": [
    { "policy": "FAILOVER_ORDER", "activeUplinks": ["uplink1"], "standByUplinks": [] }
  ],
  "transportVlan": 1214
}
```

Where they go:

| Build | Runbook | Call |
| ----- | ------- | ---- |
| New workload domain | [`23-workload-domain-creation.md` §5](23-workload-domain-creation.md#5-create-the-domain--api-lacp-no-cluster-or-scripted) | `POST /v1/domains/validations` → `POST /v1/domains` |
| New cluster in an existing domain | [`24-cluster-creation.md`](24-cluster-creation.md) | `POST /v1/clusters/validations` → `POST /v1/clusters` |
| Add hosts to a cluster | [`25-cluster-expansion.md`](25-cluster-expansion.md) | `POST /v1/clusters/{id}/validations` → `PATCH /v1/clusters/{id}` |

**The vSphere Client wizards** (*Create Workload Domain*, *Create SDDC
Cluster*, *Add Unassigned Hosts*): the workbook says single NIC is API-only,
and this repo hasn't tested whether the wizards accept a one-uplink vDS.
Validate through the API first. If you find a wizard that works, record the
VCF version.

### 8.2 After each build

Repeat [§7.1](#71-the-vsphere-ha-redundancy-warning) (HA option, where the
table says it applies) for each new cluster, and
[§7.2](#72-verify-the-layout) (verification) for each new cluster or host.
Repeat the fabric test ([§7.3](#73-test-fabric-failover-before-go-live))
when hosts land on a fabric or chassis you haven't tested yet.

---

## Sources

- TechDocs 9.1: [Commission Hosts](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/host-management/commission-hosts.html) (single- and multi-NIC hosts; Last Updated 2026-10-12)
- TechDocs 9.1: [Use a JSON Specification File to Deploy VMware Cloud Foundation or vSphere Foundation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/use-a-json-specification-to-deploy-vmware-cloud-foundation-or-vmware-vsphere-foundation.html) and its [example spec](https://techdocs.broadcom.com/content/dam/broadcom/techdocs/us/en/dita/vmware/vcf/vcf-90/installation/resources/domainSpec-sfo-m01-example02.json)
- API: [VCF Installer API 9.1.1 — DvsSpec](https://developer.broadcom.com/xapis/vcf-installer-api/9.1.1/data-structures/DvsSpec/), [SddcNetworkSpec](https://developer.broadcom.com/xapis/vcf-installer-api/9.1.1/data-structures/SddcNetworkSpec/), [TeamingSpec](https://developer.broadcom.com/xapis/vcf-installer-api/9.1.1/data-structures/TeamingSpec/)
- API: [SDDC Manager API 9.1.1 — PortgroupSpec](https://developer.broadcom.com/xapis/sddc-manager-api/9.1.1/data-structures/PortgroupSpec/), [UplinkProfile](https://developer.broadcom.com/xapis/sddc-manager-api/9.1.1/data-structures/UplinkProfile/), [VmNic](https://developer.broadcom.com/xapis/sddc-manager-api/9.1.1/data-structures/VmNic/)
- KB: [313261](https://knowledge.broadcom.com/external/article?legacyId=2033250) (HA advanced options; which networks HA uses with vSAN), [317612](https://knowledge.broadcom.com/external/article/317612/network-redundancy-message-when-configur.html) (HA redundancy warning), [416114](https://knowledge.broadcom.com/external/article/416114/vcf-90-installer-validation-failed-with.html) (vmnic on two vDSes), [437248](https://knowledge.broadcom.com/external/article/437248/91-vcf-installer-fails-on-vmotion-networ.html) (vMotion/vSAN connectivity check with a vmnic on `vSwitch0`), [442933](https://knowledge.broadcom.com/external/article/442933/steps-for-adding-new-host-to-workload-do.html) (uniform NIC layout), [446573](https://knowledge.broadcom.com/external/article/446573/vcf-installer-prevalidation-fails-at-nfs.html) (NFS pre-validation), [441799](https://knowledge.broadcom.com/external/article/441799) (contradicts TechDocs, see §2), 441194 (withdrawn; [archived copy](http://web.archive.org/web/20260611100122/https://knowledge.broadcom.com/external/article/441194/vcf-91-deployment-fails-nfs-datastore-co.html))
- William Lam: [Deploying VCF 9.0 on a single ESXi host](https://williamlam.com/2025/06/deploying-vcf-9-0-on-a-single-esxi-host.html), [Workaround for single NIC using NFS storage with VCF 9.0](https://williamlam.com/2025/07/workaround-for-single-nic-using-nfs-storage-with-vcf-9-0.html)
- Duncan Epping: [vSphere HA heartbeat datastores, the isolation address and vSAN](https://www.yellow-bricks.com/2017/11/08/vsphere-ha-heartbeat-datastores-isolation-address-vsan/) (2017)
- Cisco: [HyperFlex and the Network Control Policy](https://www.cisco.com/c/en/us/support/docs/hyperconverged-infrastructure/hyperflex-hx-data-platform/215030-hyperflex-and-the-network-control-policy.html) (*Action on Uplink Fail*)
- P&P workbook v1.9.1.001 (`reference/`): *"Single NIC is supported with API Only"*
