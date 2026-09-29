# Cluster Expansion Runbook — adding hosts to an existing cluster

> Closes #314. Companion to
> [`24-cluster-creation.md`](24-cluster-creation.md) (a **new** cluster) and
> [`22-stretch-execution.md`](22-stretch-execution.md) (stretching an
> existing cluster across AZs — a different operation from what's here).
> This doc covers adding hosts to an **existing, non-stretched** cluster to
> grow its capacity.

The documented **click-path** for this operation runs through the **vSphere
Client**, same as `24-cluster-creation.md` (Create SDDC Cluster) and
`23-workload-domain-creation.md` (Add workload domain, from **VCF
Operations**) — **none of the three runbooks in this set use SDDC Manager's
own UI as the primary route**, which is deprecated in VCF 9 (see
`CLAUDE.md`). Broadcom's own page notes *"you can instead perform this
task using the SDDC Manager UI"* as a still-working alternative during the
deprecation window, but does not document that alternative's click path —
treat the vSphere Client flow below as the supported, documented UI route.

**The underlying SDDC Manager API is fully reference-documented**, though
(`PATCH /v1/clusters/{clusterId}` with `ClusterExpansionSpec`), and it's the
only documented path to a handful of options the vSphere Client wizard
doesn't expose at all — see §3 below.

---

## The sequence, end to end

```
network pool has room  →  commission the host  →  add it (vSphere Client)
      (manual)                (manual)              Actions > Add Hosts
```

---

## 1. Manual — before you add anything

> **Cluster converged or imported with NFS 4.1, iSCSI, FCoE or NVMe-oF as
> principal storage?** §1–§3 don't apply: those hosts can't be commissioned.
> Go to [§5](#5-converged--imported-clusters-on-converge-only-storage).

- **The host must match the existing cluster's configuration**: same
  principal storage type, and — per Broadcom — *"the ESX host to be added
  matches the configuration of the ESX hosts already in the SDDC cluster."*
  **Different NIC enumeration is allowed** (a host doesn't need vmnic0/1 in
  the identical physical slot), but the storage type must match exactly.
- If this cluster's NSX Host Overlay uses a **static IP pool**, confirm it
  **has enough free addresses** for the hosts you're adding before you
  start — the wizard does not grow the pool for you.
- Image and commission the host into SDDC Manager first (same network pool
  as the existing cluster) — use
  [**VCFHostPreparation**](https://github.com/pauldiee/VCFHostPreparation)
  to prep and commission quickly. It must show as **unassigned** and
  **active** in the Hosts inventory.
- **vSAN stretched clusters cannot use a shared vDS** — if this cluster is
  stretched, don't route this expansion through a vDS-reuse path meant for
  non-stretched clusters.
- **9.1.1+ vDS limits still apply**: adding a host to a cluster on a shared
  vDS keeps you under 128 vDS per vCenter / 16 per ESX host — same ceiling
  as `24-cluster-creation.md`'s vDS-reuse rules.

## 2. Add the host — vSphere Client

1. Browse to the vSphere cluster in the vSphere Client inventory.
2. Select the cluster → **Actions → Add Hosts → Add Unassigned Hosts**.
3. Select the commissioned host(s) to add → **Next**.
4. Review the proposed switch/network configuration → **Next**.
5. Review host, switch configuration, and license details → **Finish**.

What the wizard automates for you, by storage type:

- **NFS and vVols** (**vVols deprecated as of VCF/VVF 9.0** — see
  `02-intake.md` `H6`) — storage is auto-configured and mounted; no manual
  datastore steps.
- **VMFS on FC** — storage is **not** automatic: you handle zoning,
  mounting the volume, and datastore creation yourself before or alongside
  the host add.
- **Any type** — uplinks are assigned and the host is connected to the
  cluster's vDS (shared or otherwise) automatically.

## 3. Add the host — API (scripted alternative)

`PATCH /v1/clusters/{clusterId}` carrying a `ClusterExpansionSpec`,
validated first via `POST /v1/clusters/{clusterId}/validations` — same
validate-then-submit pattern as the other three runbooks.

### Building the JSON by hand

- **Cluster ID.** `GET /v1/clusters`, copy the `id` of the cluster you're
  expanding.
- **Host ID(s).** `GET /v1/hosts` with `status=UNASSIGNED_USEABLE`, copy the
  `id` for each commissioned host from §1 above.

Trimmed example (1 host) — field names verified against the
[VCF API reference](https://developer.broadcom.com/xapis/vmware-cloud-foundation-api/latest/data-structures/ClusterExpansionSpec/)'s
`ClusterExpansionSpec`:

```json
{
  "hostSpecs": [
    {
      "id": "<host ID>",
      "licenseKey": "<ESXi license key, or omit with deployWithoutLicenseKeys>",
      "hostNetworkSpec": {
        "vmNics": [
          { "id": "vmnic0", "vdsName": "sfo-w01-cl01-vds01", "uplink": "uplink1" },
          { "id": "vmnic1", "vdsName": "sfo-w01-cl01-vds01", "uplink": "uplink2" }
        ],
        "networkProfileName": "sfo-w01-cl01-network-profile01"
      }
    }
  ],
  "networkSpec": {
    "nsxClusterSpec": { "...": "cluster-expansion-specific NSX config — ClusterExpansionNsxSpec, same idea as the stretch/creation runbooks' nsxClusterSpec but its own type" },
    "networkProfiles": [ "<ClusterExpansionNetworkProfile — same idea as networkProfiles elsewhere, its own type>" ]
  },
  "deployWithoutLicenseKeys": true
}
```

Field-by-field, the parts specific to expansion:

- **`hostSpecs[]`** — 1-64 hosts per call (`minItems: 1`, `maxItems: 64`).
  Same `hostNetworkSpec.vmNics[]` shape as the creation/stretch/
  domain-creation specs: mirror the existing cluster's vmnic-to-vDS mapping
  exactly, or the host fails to join.
- **`networkSpec`** is `ClusterExpansionNetworkSpec` — a **distinct type**
  from the `NetworkSpec` used by `ClusterCreationSpec`/`DomainCreationSpec`,
  even though `nsxClusterSpec` and `networkProfiles` mean the same thing
  conceptually. Don't assume the exact field names from
  `23-workload-domain-creation.md` §5 carry over unchanged — check the
  linked reference for this call specifically before submitting.
- **`witnessSpec`** / **`witnessTrafficSharedWithVsanTraffic`** /
  **`vsanNetworkSpecs`** (not shown above) — **only relevant if this
  cluster is stretched**, which §1's precondition list already rules out for
  this runbook (*"vSAN stretched clusters cannot use a shared vDS"*). If
  you're expanding a **stretched** cluster instead, use
  `22-stretch-execution.md`'s field-by-field breakdown of the equivalent
  fields on `clusterStretchSpec` as your reference for these three.
- **`interRackExpansion`** — *"Is inter-rack cluster expansion (L2
  non-uniform/L3 vs. L2 uniform). Required for clusters with NSX Edge
  Cluster."* Set this if the hosts you're adding sit in a different
  rack/L2 segment than the cluster's existing hosts and this cluster hosts
  an NSX Edge cluster — easy to miss because nothing in the vSphere Client
  wizard surfaces this concept at all.
- **`deployWithoutLicenseKeys`** — same field and guidance as the other
  three runbooks: leave `true` unless you specifically want the call to
  hard-fail on a missing license key.
- **`forceHostAdditionInPresenceofDeadHosts`** /
  **`skipThumbprintValidation`** — both **deprecated, no effect when used**
  per the API reference; don't rely on either even though they still appear
  in the spec.

## 4. Acceptance

- Host shows **connected** in the cluster, matching build/patch level to
  its cluster-mates.
- Storage healthy: for VMFS, the datastore you manually zoned/mounted is
  visible and consumed by the new host; for NFS/vVols, auto-mounted and
  visible.
- If a static TEP IP pool was used: the new host received an address from
  it, not from overflow/DHCP fallback.

## 5. Converged / imported clusters on converge-only storage

Everything above assumes a principal storage type that **host
commissioning** understands: vSAN, NFS, VMFS on FC or vVol. A cluster that
was **converged** (management domain) or **imported** (workload domain) with
**NFS 4.1, iSCSI, FCoE or NVMe over Fabrics** (TCP, FC, RDMA) as principal
storage doesn't fit that path. The commission wizard has no storage type to
choose for it. So the §1 → §2 flow (commission → Add Unassigned Hosts) is
**not** the route for these clusters. Why these storage types end up
converge-only, and the other trade-offs, is in
[`prerequisites.md` → Principal storage](prerequisites.md#converge--import-only-options-and-their-drawbacks).

Broadcom's route: *"for day 2 operations other than LCM such as host
commissioning, adding hosts or clusters, removing hosts or clusters, first
perform these operations in the respective vCenter and then run the 'Sync
Inventory' operation"*
([KB 416270](https://knowledge.broadcom.com/external/article/416270)).
[KB 405095](https://knowledge.broadcom.com/external/article/405095/unable-to-add-or-decommission-esxi-hosts.html)
explains why the SDDC Manager path fails on these clusters (*"Cluster is
marked as imported. This operation is not allowed on imported clusters"*,
or an Add Host wizard whose **Next** stays greyed out at *"Selected
resources: 0 Cores, 0 GB Memory, 0 GB Storage"*), and gives the manual
route: add the host in the vSphere Client, *"ensuring configuration
consistency (NTP, VMK, networking, NSX, storage)"*. Each of those five is
yours to get right, because nothing in VCF configures them for this host.

```
build host to match  →  storage by hand  →  add in vCenter  →  NSX + image  →  VCF picks it up
   (manual)              (manual, per type)    (vSphere Client)   (verify)        (9.0: Sync Inventory)
```

### 5.1 Build the host to match the cluster

Same checks as §1, plus what converge itself requires:

- **Same ESX build as the cluster's vLCM image.** Converge requires
  image-managed clusters (*"Clusters using baselines for lifecycle
  management"* are not supported), so the host has to be compliant with
  that image. Install the same build, and remediate against the cluster
  image after adding it if vCenter reports drift.
- **Same NIC layout and count.** Hosts with more vmnics than their
  cluster-mates can't use the extras: *"1 or more of those VMNICs will be
  unusable due to the requirements to maintain a uniform host image"*
  ([KB 442933](https://knowledge.broadcom.com/external/article/442933/steps-for-adding-new-host-to-workload-do.html)).
- **Static VMkernel IPs** for management, vMotion and storage.
  *"Dynamically allocated VMkernel IP addresses"* are on the converge
  not-supported list.
- **NTP, DNS (A + PTR, lowercase FQDN), syslog and the ESX root password**
  set the same way as on the existing hosts.
  [VCFHostPreparation](https://github.com/pauldiee/VCFHostPreparation)
  covers the host-level basics, but stop short of commissioning.

### 5.2 Configure the principal storage by hand

The host must see the **same** datastore as its cluster-mates **before**
it joins, over the same kind of path. Per type (vSphere 9.0 Storage docs):

| Storage type | On the new host | On the array / fabric |
| ------------ | --------------- | --------------------- |
| **iSCSI** | Enable the software iSCSI adapter; create one VMkernel per pNIC (1:1) on the storage port groups and **bind** them to the adapter ([port binding](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-0/vsphere-storage/configuring-iscsi-and-iser-adapters-and-storage-with-esxi/configure-port-binding-for-iscsi-and-iser-on-esxi.html)); add the same dynamic/static targets and CHAP settings as the other hosts; rescan | Add the new host's **IQN** to the initiator group / LUN masking. With port binding, *"make sure that all target portals are reachable from all VMkernel ports"* or sessions fail |
| **NVMe/TCP, NVMe/RDMA** | VMkernel binding on the storage NICs, then [add the software NVMe over TCP / RDMA adapter](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-0/vsphere-storage/about-vmware-nvme-storage/configuring-nvme-over-rdma-roce-v2-on-esxi/add-software-nvme-over-rdma-or-nvme-over-tcp-adapters.html) and discover / connect the controllers. RDMA also needs [lossless Ethernet](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-0/vsphere-storage/about-vmware-nvme-storage/requirements-for-vmware-nvme-storage/requirements-for-vmware-nvme-storage.html) | Add the host's **host NQN** to the subsystem's allowed hosts. NVMe/TCP does **not** support LACP / port-channel on the host links; multipathing does the HA |
| **NVMe/FC, FCoE** | HBA / CNA with the same firmware + driver as the cluster-mates | **Zoning** + masking of the new host's WWPNs / host NQN, as for VMFS on FC in §1 |
| **NFS 4.1** | Mount with the **same server IP list** (session-trunking multipathing) and the **same security mode** as the other hosts; for Kerberos, join the host to AD and set the NFS Kerberos credentials first ([Create an NFS 4.1 Datastore](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-0/vsphere-storage/working-with-datastores-in-vsphere-storage-environment/nfs-datastore-concepts-and-operations-in-vsphere-environment/configuring-the-nfs-datastore/configuring-the-nfs-datastor-0.html)) | Add the new host's storage VMkernel IP(s) to the export policy. AUTH_SYS and Kerberos can't be mixed on one shared NFS 4.1 datastore |

Then check it: the datastore appears on the new host with the **same name
and backing device / share**, all expected paths are up
(`esxcli storage nmp device list` for SCSI/NVMe devices), and MTU is
correct end to end (`vmkping -I <vmkX> -s 8972 -d <target-ip>` for jumbo).

> Don't let the new host bring **another** datastore that its cluster-mates
> can also see (a stray NFS v3 mount, a shared VMFS LUN). VCF picks the
> principal datastore by type priority (*"vSAN, NFS v3, VMFS, NFS 4.1,
> iSCSI, vVols"*), and a newly common higher-priority datastore is not what
> you want it to find.

### 5.3 Add the host in the vSphere Client

1. In the cluster's vCenter: **cluster → Actions → Add Hosts** (the plain
   vCenter wizard: FQDN, root credentials, certificate). **Not** *Add
   Unassigned Hosts*, which lists only commissioned hosts.
2. Add the host to the **cluster's vDS** and migrate its VMkernels to the
   matching distributed port groups (management, vMotion, the storage
   VMkernels from §5.2), with the same uplink assignment as its cluster-mates.
3. **NSX:** if the cluster has an NSX **transport node profile** attached,
   NSX prepares the host itself: *"When you move an unprepared host into a
   cluster applied with a transport node profile, NSX automatically prepares
   the host as a transport node"*
   ([Transport Node Profiles](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/advanced-network-management/administration-guide/host-transport-nodes/preparing-esxi-hosts-as-transport-nodes/transport-node-profile.html)).
   Check it reaches **Success** in NSX (*System → Fabric → Hosts*) and got a
   TEP address. If no profile is attached, prepare the host in NSX to match
   the others.
4. **vLCM:** check the host is **compliant** with the cluster image; if
   not, remediate it (maintenance mode) before putting workloads on it.
5. Exit maintenance mode.

### 5.4 Let VCF pick it up

- **9.0:** run **Sync Inventory**: *VCF Operations → Inventory → VCF
  Instances → (domain) → Actions → Sync Inventory*
  ([KB 405095](https://knowledge.broadcom.com/external/article/405095/unable-to-add-or-decommission-esxi-hosts.html),
  [KB 425835](https://knowledge.broadcom.com/external/article/425835/synchronizing-vcenter-manual-changes-wit.html)).
  Skip it and *"lifecycle management in VCF Operations will be blocked for
  these hosts and clusters"*
  ([KB 416270](https://knowledge.broadcom.com/external/article/416270)).
  The CLI alternative on SDDC Manager is `vcf_brownfield.py sync
  --domain-name '<domain-name>'` in
  `/opt/vmware/vcf/domainmanager/scripts/vcf-import-tool` (KB 405095).
- **9.1:** KB 416270: *"As of version 9.1 running 'Sync Inventory' in the
  VCF Operations console is no longer required."* Still check that the host
  shows up under the domain in VCF Operations before you call it done.
  KB 405095 (which covers 9.x generally) still lists the sync, so running it
  is a harmless fallback if the host doesn't appear.
- **Root password:** VCF Operations' Password Management console doesn't
  manage imported hosts' ESX passwords. If you need the credential in SDDC
  Manager, [KB 388859](https://knowledge.broadcom.com/external/article/388859)
  (`addEsxiRoot.py`) adds it.

### 5.5 Removing a host again

Same principle, reversed. KB 405095's manual steps: maintenance mode → move
the host to the **datacenter level** in vCenter → remove NSX from it (*NSX →
System → Fabric → Hosts → Standalone/Other Nodes*) → disconnect and remove
from inventory → on 9.0, **Sync Inventory**. Then remove the host's
initiator / NQN / IP from the array's access list.

> TechDocs + KB-sourced, not yet field-verified in this repo.
