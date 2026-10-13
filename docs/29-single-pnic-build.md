# Single-pNIC Hosts — Build Guide

Some hosts reach VCF with **one physical NIC as ESX sees it**. That can be a
lab box with a single port. In production it is usually a converged or blade
platform that presents one vNIC per host and handles redundancy in the
fabric (Cisco UCS fabric failover and similar). Broadcom supports it, but
nothing in the default flow is built for it: the VCF Installer's vDS profiles
all assume two uplinks, and the workbook says the build is **API-only**.

This guide walks a single-pNIC build end to end: bring-up of the management
domain from a JSON spec, the known validation snags, the post-bring-up
clean-up, and the workload-domain, cluster and expansion hosts that come
later.

This guide targets **VCF 9.1**. It's the step-by-step companion to the
single-uplink note in
[`prerequisites.md`](prerequisites.md#management-domain), which covers
*whether* to do it. Read that first. The short version: if your fabric can
present **two** vNICs per host, do that instead, and skip this guide.

> **Evidence level:** TechDocs-, KB- and API-reference-sourced (read
> verbatim), plus William Lam's community posts where credited. **Not lab- or
> field-verified in this repo yet.** The JSON fragments match the 9.1.1 API
> schemas field for field, but no single-uplink spec in this guide has been
> run through a live Installer validation. Two Broadcom KBs on this topic
> contradict the product docs or have been withdrawn;
> [§2](#2-what-supported-means--the-sources-and-where-they-disagree) has the
> timeline.

---

## The sequence, end to end

1. [Confirm single pNIC is the right call](#1-confirm-single-pnic-is-the-right-call)
2. [What "supported" means — the sources and where they disagree](#2-what-supported-means--the-sources-and-where-they-disagree)
3. [Prepare the hosts and the fabric](#3-prepare-the-hosts-and-the-fabric)
4. [Build the bring-up JSON spec](#4-build-the-bring-up-json-spec)
5. [Deploy from the JSON spec](#5-deploy-from-the-json-spec)
6. [Validation snags you may hit](#6-validation-snags-you-may-hit)
7. [After bring-up](#7-after-bring-up)
8. [Later hosts: workload domains, clusters, expansion](#8-later-hosts-workload-domains-clusters-expansion)

---

## 1. Confirm single pNIC is the right call

| Situation | Use this guide? |
| --------- | --------------- |
| Fabric can present **two** vNICs per host (on UCS: one pinned to fabric A, one to fabric B, *without* fabric failover) | **No.** Use two vNICs: the normal 2-pNIC layout, Installer wizard and default profiles, failover visible in ESX. |
| Fabric presents **one** vNIC with fabric-level failover, and that's a fixed platform constraint | Yes |
| Lab / home lab with one port per host | Yes. Expect NFS to be the hard part ([§6](#6-validation-snags-you-may-hit)). |
| Hosts have two or more pNICs and you only *want* to cable one | **No.** That's a host with no redundancy at all; there's nothing in the fabric to fail over to. |

Decide **before** bring-up and apply it to every host in the domain. Hosts
added later must match the layout
([§8](#8-later-hosts-workload-domains-clusters-expansion)).

**Principal storage:** vSAN is the easier pairing. NFS on one pNIC has two
known failure modes during bring-up ([§6](#6-validation-snags-you-may-hit)).

---

## 2. What "supported" means — the sources and where they disagree

The sources don't agree with each other. Here they are in date order, so
you can see what each one says and how current it is:

| Date | Source | What it says |
| ---- | ------ | ------------ |
| 2025-06 / 2025-07 (VCF 9.0) | William Lam, [Deploying VCF 9.0 on a single ESXi host](https://williamlam.com/2025/06/deploying-vcf-9-0-on-a-single-esxi-host.html) and [Workaround for single NIC using NFS storage with VCF 9.0](https://williamlam.com/2025/07/workaround-for-single-nic-using-nfs-storage-with-vcf-9-0.html) | Single NIC works for VCF 9.0 in a lab, especially with vSAN. With NFS, the Installer moves the only uplink to the vDS and leaves the NFS VMkernel stranded on `vSwitch0`. |
| 9.1 workbook, v1.9.1.001 (pinned in `reference/`) | P&P workbook, NIC rows for the management **and** VI workload domain | *"Single NIC is supported with API Only"* |
| Published 2026-05-21; **withdrawn** (404 on 2026-10-13) | KB 441194, *VCF 9.1 Deployment Fails: NFS Datastore Configuration Validation Fails on ESXi Hosts with a Single pNIC* ([archived copy, 2026-06-11](http://web.archive.org/web/20260611100122/https://knowledge.broadcom.com/external/article/441194/vcf-91-deployment-fails-nfs-datastore-co.html)) | *"the built-in validation check in VCF 9.1 expects multiple physical NICs for redundancy purposes. If it detects only a single pNIC configuration, it incorrectly flags the setup as invalid"*. It gave an Installer property to skip the NFS check. |
| Published 2026-05-26 | [KB 441799](https://knowledge.broadcom.com/external/article/441799), *VCF 9.x Deployment Validation Fails With VCmanager Found Less Than Two Uplinks* | Fewer than two pNICs on the management vDS is *"violating the VCF minimum requirement"*; fix is to list two. |
| Last Updated 2026-10-12 | TechDocs 9.1, [Commission Hosts](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/host-management/commission-hosts.html) | *"Hosts can have a single physical NIC or multiple physical NICs."* |

How to read this:

- **The product docs and the workbook say supported, API-only.** That's the
  basis for this guide.
- **KB 441799 is not a reliable source for 9.x.** It tells you to use
  *"VMware Cloud Builder"*, which VCF 9 doesn't have (the VCF Installer
  replaced it), and to edit a `vmnics` array in `networkSpecs`/`hostSpecs`,
  which is the 5.x spec shape, not the 9.x `dvsSpecs[].vmnicsToUplinks`. If
  you hit its error message, see [§6](#6-validation-snags-you-may-hit).
- **KB 441194 is gone.** Don't treat its bypass as current Broadcom guidance.
  It's here because you may meet it in older notes, and because the problem
  it described may still exist.

---

## 3. Prepare the hosts and the fabric

Everything from [`prerequisites.md`](prerequisites.md) still applies. On top
of that:

1. **One uplink on `vSwitch0`.** Install ESX with the single vmnic
   (normally `vmnic0`) as the uplink of `vSwitch0`, management VMkernel
   `vmk0` on it. This is the standard pre-bring-up state; nothing special.
   [VCFHostPreparation](https://github.com/pauldiee/VCFHostPreparation)
   automates the imaging.
2. **Every VLAN on that one link.** All traffic shares the single port:
   management, VM management, vMotion, vSAN or NFS, NSX host TEP, and, if
   Edge nodes will run on these hosts, both Edge uplink VLANs. Trunk all of
   them to the port (or vNIC) before bring-up. With one pNIC there is no
   second link to pin anything to.
3. **MTU 9000 end to end on that link.** Same rule as normal, but now one
   mismatch breaks vMotion, vSAN/NFS and overlay at once. Test from the host
   for each VMkernel you can already create, e.g.
   `vmkping -I vmk0 -s 8972 -d <gateway-or-peer>`.
4. **Fabric failover detects upstream failures.** Failover now happens below
   ESX, where vCenter and NSX can't see it. On UCS, the vNIC's network control
   policy must keep *Action on Uplink Fail = Link Down* (the default). The
   details and citation are in the
   [`prerequisites.md` single-uplink note](prerequisites.md#management-domain).
   VCF doesn't validate this, so check it and record the result.
5. **NFS principal storage only:** pre-create the NFS path on the first host
   exactly as in
   [`prerequisites.md` → NFS v3](prerequisites.md#nfs-v3-only-if-in-scope).
   With one pNIC, put the NFS VMkernel on its **own VLAN** (William Lam: it
   *"must reside in its own dedicated VLAN"*, not shared with ESX
   management), and expect the snags in [§6](#6-validation-snags-you-may-hit).

---

## 4. Build the bring-up JSON spec

Per the workbook, single NIC is *API Only*: you deploy with
**Deploy Using JSON Spec** in the VCF Installer, not the wizard. Start from
Broadcom's example spec, linked from
[Use a JSON Specification File to Deploy VMware Cloud Foundation or vSphere Foundation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/use-a-json-specification-to-deploy-vmware-cloud-foundation-or-vmware-vsphere-foundation.html)
([example02](https://techdocs.broadcom.com/content/dam/broadcom/techdocs/us/en/dita/vmware/vcf/vcf-90/installation/resources/domainSpec-sfo-m01-example02.json)).
Fill everything **except** networking from your workbook as usual. Then
change two blocks.

Field names and enums below come from the
[VCF Installer API 9.1.1 reference](https://developer.broadcom.com/xapis/vcf-installer-api/9.1.1/data-structures/DvsSpec/)
(`DvsSpec`, `VmnicToUplink`, `TeamingSpec`, `SddcNetworkSpec`).

### 4.1 `dvsSpecs`: one vDS, one uplink, everything on it

Broadcom's example has three vDSes with two vmnics each. Collapse them into
**one** vDS that carries every network and the NSX host switch, with a single
vmnic-to-uplink mapping:

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

- **`networks`**: for NFS principal storage, replace `VSAN` with `NFS`.
- **`vmnicsToUplinks`**: exactly one entry. The `id` must be the vmnic
  that's on `vSwitch0` today on **every** host.
- **`nsxTeamings`**: `FAILOVER_ORDER` with one active uplink and no standby.
  The uplink name here must match the one in `vmnicsToUplinks`. A mismatch
  is a known validation failure, even on two-NIC builds
  ([VCF Installer 9.0 known issues](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/release-notes/vmware-cloud-foundation-90-release-notes/component-specific/vcf-installer-90-known-issues.html)).
  `activeUplinks` is required with `minItems: 1`; `LOADBALANCE_SRCID` with
  one uplink has nothing to balance across.
- `hostSwitchOperationalMode` is left out on purpose. The 9.1.1 reference
  says it is *"Applicable only for the VI Workload Domains"*.

### 4.2 `networkSpecs`: point every port group at `uplink1`

Each `networkSpecs[]` entry (MANAGEMENT, VM_MANAGEMENT, VMOTION, VSAN or NFS)
gets the same teaming:

```json
{
  "networkType": "VMOTION",
  "subnet": "10.11.12.0/24",
  "gateway": "10.11.12.1",
  "vlanId": 1112,
  "mtu": 9000,
  "includeIpAddressRanges": [
    { "startIpAddress": "10.11.12.101", "endIpAddress": "10.11.12.116" }
  ],
  "teamingPolicy": "failover_explicit",
  "activeUplinks": ["uplink1"],
  "standbyUplinks": [],
  "portGroupKey": "sfo-m01-cl01-vds01-pg-vmotion"
}
```

- **`teamingPolicy`**: `failover_explicit` (*Use explicit failover order*)
  is in the 9.1.1 enum. The default is `loadbalance_loadbased`, and
  Broadcom's example sets that with two active uplinks. Don't leave
  `uplink2` in any `activeUplinks` list: that uplink doesn't exist on this
  vDS.
- **`portGroupKey`**: for NFS, this must match the port group you
  pre-created on `vSwitch0` letter for letter
  ([KB 446573](https://knowledge.broadcom.com/external/article/446573/vcf-installer-prevalidation-fails-at-nfs.html)).

### 4.3 Check before you upload

- `grep -c uplink2 <spec>.json` returns **0**.
- Every `activeUplinks` / `standByUplinks` value is `uplink1` or empty.
- `vmnicsToUplinks` has one entry, and that vmnic exists on every host
  (`esxcli network nic list`).
- NSX `transportVlanId` (host TEP VLAN) is trunked on the single port
  ([§3](#3-prepare-the-hosts-and-the-fabric)).

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

| Symptom | What it is | What to do |
| ------- | ---------- | ---------- |
| *"VCmanager Found less than two uplinks for the DVS"* | [KB 441799](https://knowledge.broadcom.com/external/article/441799)'s error. The KB's fix (add a second vmnic) defeats the point, and the KB itself looks unreliable ([§2](#2-what-supported-means--the-sources-and-where-they-disagree)). | Don't add a phantom vmnic. Open a support case citing [Commission Hosts (9.1)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/host-management/commission-hosts.html) and the workbook's *"Single NIC is supported with API Only"*. |
| NFS: *"NFS datastore mount failed on host <hostname>: An error occurred during host configuration"* at **NFS Datastore Configuration** | Withdrawn KB 441194 said the 9.1 check wrongly expects multiple pNICs. | First rule out the ordinary causes in [KB 446573](https://knowledge.broadcom.com/external/article/446573/vcf-installer-prevalidation-fails-at-nfs.html): port group name, MTU on `vSwitch0`, array export ACL. If NFS demonstrably works from every host (`vmkping` + mounted datastore) and the check still fails, raise it with Broadcom support. The withdrawn KB's workaround was an Installer property, `validation.disable.nfs.configuration.connectivity.check=true` in `/etc/vmware/vcf/domainmanager/application.properties`, followed by a `domainmanager` restart. Because Broadcom pulled the KB, only use it if support tells you to. |
| NFS datastore drops **during** bring-up, after the uplink moves to the vDS | The Installer migrated `vmnic0` to the vDS but left the NFS VMkernel on `vSwitch0`, which now has no uplink. Documented on 9.0 by William Lam; not confirmed fixed in 9.1. | In vCenter, migrate the NFS VMkernel to the NFS port group on the vDS (*Migrate Networking* on the vDS), confirm the datastore is back, then **retry** the deployment in the Installer; it resumes where it stopped ([Lam](https://williamlam.com/2025/07/workaround-for-single-nic-using-nfs-storage-with-vcf-9-0.html)). |

---

## 7. After bring-up

### 7.1 Silence the HA redundancy warning

Every host reports `Host <xxx> currently has no management network
redundancy`. Broadcom says it *"can be safely ignored"*, and to suppress it,
*"set the VMware HA advanced option das.ignoreRedundantNetWarning to true and
reconfigure VMware HA on that host"*
([KB 317612](https://knowledge.broadcom.com/external/article/317612/network-redundancy-message-when-configur.html);
its click-paths are from older vSphere clients). In the vSphere Client:

1. Select the cluster → **Configure** → **vSphere Availability** → **Edit**
   → **Advanced Options** → **Add**: `das.ignoreRedundantNetWarning` =
   `true` → **OK**.
2. For each host: right-click → **Reconfigure for vSphere HA**.

Do this per cluster, including every workload-domain cluster built later on
single-pNIC hosts.

### 7.2 Verify the layout

- **vDS**: one vDS, uplink count 1, `vmnic0` on `uplink1` on every host
  (vSphere Client → vDS → **Configure** → **Topology**).
- **NSX**: each host's transport node is **Up**, with one TEP and tunnels up
  (NSX Manager → **System** → **Fabric** → **Hosts**).
- **No `uplink2` leftovers**: no port group has a standby or unused uplink
  set that doesn't exist.

### 7.3 Test fabric failover before go-live

ESX can't see this failover, so prove it from outside, in a maintenance
window:

1. Start a continuous `vmkping` from one host's `vmk0` to another host, and
   one between two hosts' TEPs (`vmkping ++netstack=vxlan -I vmk10 <peer-tep>`,
   assuming `vmk10` is the TEP VMkernel; check the vmk number with
   `esxcli network ip interface list`). If NFS, also watch the datastore.
2. Fail fabric A the way it would fail in real life: its uplinks to the core
   first (this tests *Link Down* on upstream loss), then the whole fabric
   path.
3. Expect a short loss, then recovery on fabric B, with no HA isolation
   events. Repeat for fabric B.

Record the result with the fabric's network control policy. It is the only
evidence the design's redundancy works.

---

## 8. Later hosts: workload domains, clusters, expansion

The workbook's VI workload domain row also says *"Single NIC is supported
with API Only"*. Plan the API path for every later build on single-pNIC
hosts. The runbooks are the same as for two-NIC hosts; only the network
fragments change.

**Commissioning** is unchanged: Commission Hosts explicitly allows a single
NIC. Use the same network pool rules as
[`23-workload-domain-creation.md`](23-workload-domain-creation.md).

**Keep the layout uniform.** A host with *more* vmnics than its cluster-mates
can't use the extras: *"1 or more of those VMNICs will be unusable due to the
requirements to maintain a uniform host image"*
([KB 442933](https://knowledge.broadcom.com/external/article/442933/steps-for-adding-new-host-to-workload-do.html)).
Mixing single- and dual-pNIC hosts in one cluster gets you the worst of both.

### 8.1 The SDDC Manager API fragments

Workload domain creation (`DomainCreationSpec`), cluster creation
(`ClusterCreationSpec`) and expansion (`ClusterExpansionSpec`) all use the
same three shapes. Field names are from the
[SDDC Manager API 9.1.1 reference](https://developer.broadcom.com/xapis/sddc-manager-api/9.1.1/data-structures/PortgroupSpec/)
(`VmNic`, `PortgroupSpec`, `UplinkProfile`, `TeamingSpec`):

**Per host**: one vmnic in `hostSpecs[].hostNetworkSpec.vmNics`:

```json
"hostNetworkSpec": {
  "vmNics": [
    { "id": "vmnic0", "vdsName": "sfo-w01-cl01-vds01", "uplink": "uplink1" }
  ],
  "networkProfileName": "sfo-w01-cl01-network-profile01"
}
```

**Per port group**: `networkSpec.vdsSpecs[].portGroupSpecs[]`, one active
uplink:

```json
{
  "name": "sfo-w01-cl01-vds01-pg-vmotion",
  "transportType": "VMOTION",
  "teamingPolicy": "failover_explicit",
  "activeUplinks": ["uplink1"],
  "standByUplinks": []
}
```

**NSX uplink profile**: `nsxClusterSpec.uplinkProfiles[]`, `FAILOVER_ORDER`
with one active uplink:

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
Cluster*, *Add Unassigned Hosts*): the workbook says single NIC is
API-only, and this repo hasn't tested whether the wizards accept a
one-uplink host. Validate through the API first. If you do find a wizard
that works, record the VCF version.

### 8.2 After each build

Repeat [§7.1](#71-silence-the-ha-redundancy-warning) (HA option) for each
new cluster, and [§7.2](#72-verify-the-layout) (verification) for each new
cluster or host. Repeat the fabric test
([§7.3](#73-test-fabric-failover-before-go-live)) when hosts land on a
fabric or chassis you haven't tested yet.

---

## Sources

- TechDocs 9.1: [Commission Hosts](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/host-management/commission-hosts.html) (single NIC supported; Last Updated 2026-10-12)
- TechDocs 9.1: [Use a JSON Specification File to Deploy VMware Cloud Foundation or vSphere Foundation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/use-a-json-specification-to-deploy-vmware-cloud-foundation-or-vmware-vsphere-foundation.html) and its [example spec](https://techdocs.broadcom.com/content/dam/broadcom/techdocs/us/en/dita/vmware/vcf/vcf-90/installation/resources/domainSpec-sfo-m01-example02.json)
- API: [VCF Installer API 9.1.1 — DvsSpec](https://developer.broadcom.com/xapis/vcf-installer-api/9.1.1/data-structures/DvsSpec/), [SddcNetworkSpec](https://developer.broadcom.com/xapis/vcf-installer-api/9.1.1/data-structures/SddcNetworkSpec/), [TeamingSpec](https://developer.broadcom.com/xapis/vcf-installer-api/9.1.1/data-structures/TeamingSpec/)
- API: [SDDC Manager API 9.1.1 — PortgroupSpec](https://developer.broadcom.com/xapis/sddc-manager-api/9.1.1/data-structures/PortgroupSpec/), [UplinkProfile](https://developer.broadcom.com/xapis/sddc-manager-api/9.1.1/data-structures/UplinkProfile/), [VmNic](https://developer.broadcom.com/xapis/sddc-manager-api/9.1.1/data-structures/VmNic/)
- KB: [317612](https://knowledge.broadcom.com/external/article/317612/network-redundancy-message-when-configur.html) (HA redundancy warning), [442933](https://knowledge.broadcom.com/external/article/442933/steps-for-adding-new-host-to-workload-do.html) (uniform NIC layout), [446573](https://knowledge.broadcom.com/external/article/446573/vcf-installer-prevalidation-fails-at-nfs.html) (NFS pre-validation), [441799](https://knowledge.broadcom.com/external/article/441799) (contradicts TechDocs, see §2), 441194 (withdrawn; [archived copy](http://web.archive.org/web/20260611100122/https://knowledge.broadcom.com/external/article/441194/vcf-91-deployment-fails-nfs-datastore-co.html))
- William Lam: [Deploying VCF 9.0 on a single ESXi host](https://williamlam.com/2025/06/deploying-vcf-9-0-on-a-single-esxi-host.html), [Workaround for single NIC using NFS storage with VCF 9.0](https://williamlam.com/2025/07/workaround-for-single-nic-using-nfs-storage-with-vcf-9-0.html)
- Cisco: [HyperFlex and the Network Control Policy](https://www.cisco.com/c/en/us/support/docs/hyperconverged-infrastructure/hyperflex-hx-data-platform/215030-hyperflex-and-the-network-control-policy.html) (*Action on Uplink Fail*)
- P&P workbook v1.9.1.001 (`reference/`): *"Single NIC is supported with API Only"*
