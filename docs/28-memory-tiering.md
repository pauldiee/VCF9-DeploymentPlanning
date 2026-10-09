# Memory Tiering over NVMe — Build Guide

Memory Tiering adds memory capacity to an ESX host by using a **local NVMe
device as a second, slower memory tier** behind DRAM. The ESX kernel keeps
hot pages in DRAM (**Tier 0**) and moves cold VM pages to NVMe (**Tier 1**);
the guest OS never sees the difference. The usual reason to turn it on is
consolidation: more VMs per host without buying more DIMMs.

It is **off by default** and is set **per cluster** (vSphere Configuration
Profiles) or **per host** (`esxcli memtier`). It is a vSphere feature, so it
lives on the **vSphere Client**, not in VCF Operations or the VCF Installer.
VCF Operations adds a dashboard and a What-If analysis for it ([§7](#7-monitoring)).

This guide targets **VCF 9.1**. 9.1 reworked the feature substantially
(software mirroring, automatic partitioning, cluster-level config, the new
`esxcli memtier` namespace); the differences from 9.0 are summarised in [§10](#10-if-you-are-still-on-90).

> **Evidence level:** TechDocs-sourced (the 9.1 [*Memory Tiering over NVMe*][td-main]
> section, read verbatim), plus Broadcom's VCF blog and community posts where
> credited. **Not lab- or field-verified in this repo yet.** One item is
> explicitly unverified: how the 9.1 bring-up treats a spare NVMe device
> ([§3.3](#33-vcf-bring-up-and-workload-domain-creation--unverified)).

---

## The sequence, end to end

1. [Is it a fit?](#1-is-it-a-fit)
2. [Pick and size the NVMe device](#2-pick-and-size-the-nvme-device)
3. [Keep it out of vSAN](#3-keep-the-device-out-of-vsan)
4. [Enable it](#4-enable-memory-tiering), then add [redundancy, encryption and per-VM control](#5-redundancy-encryption-and-per-vm-control)
5. [Monitor it](#7-monitoring)

---

## 1. Is it a fit?

Memory Tiering helps hosts that are **full but not busy**: a lot of memory
allocated, little of it actively used at any one time.

- **The target profile.** [TechDocs][td-assess]: *"Memory Tiering is appropriate for
  environments where memory consumption is high (more than 50% allocated
  across all VMs), but active memory usage ... remains low (less than 50% of
  total DRAM)."* Most workloads keep **10–30 %** of memory active.
- **The hard rule: active memory must fit in DRAM.** [TechDocs][td-cap]: *"Ensure that
  active memory usage on the ESX host has not exceeded 50% of the DRAM
  capacity at any point."* Measure this on today's hosts (vCenter host
  performance charts, *Active* vs *Consumed*) before you buy anything.
- **CPU must have headroom.** Tiering lets you place more VMs; if CPU is
  already the bottleneck, it won't buy you consolidation
  ([Duncan Epping, FAQ](https://www.yellow-bricks.com/2026/07/16/memory-tiering-considerations-and-frequently-asked-questions/)).
- **Nothing tiers below ~80 % DRAM consumption.** [TechDocs][td-best]: *"Cold pages
  start to get tiered to NVMe when the host memory consumption reaches
  around the 80% threshold of the DRAM capacity."* The threshold is fixed and
  can't be tuned.
- **Don't combine it with memory overcommit.** [TechDocs][td-best], verbatim: *"Do not
  use memory overcommit when Memory Tiering is activated."*
- **Build the business case in VCF Operations (9.1).** Its **What-If**
  analysis models the effect of enabling Memory Tiering and the savings
  ([VCF blog, 9.1 enhancements](https://blogs.vmware.com/cloud-foundation/2026/05/07/advanced-memory-tiering-enhancements-in-vmware-cloud-foundation-9-1/)).

**Worked example (from [TechDocs][td-best]).** A 1 TB host at 80 % consumed / 20 %
active gets a 1 TB NVMe tier and twice the VMs. Consumed becomes 1.6 TB,
active becomes 400 GB, which is still under 50 % of the 1 TB DRAM, so the
workloads are expected to perform normally.

> **Stretched clusters:** tiering does not account for the headroom a
> stretched cluster keeps for an AZ failure. Those clusters often run at or
> below 50 % consumption, so the 80 % trigger may rarely be reached
> ([Duncan Epping, FAQ](https://www.yellow-bricks.com/2026/07/16/memory-tiering-considerations-and-frequently-asked-questions/)).

---

## 2. Pick and size the NVMe device

### 2.1 Device requirements

| Requirement | Detail |
| --- | --- |
| **Device class** | TechDocs: *"must be of a drive similar to vSAN cache (Mixed Use with 3 DWPD)."* On the [Broadcom Compatibility Guide](https://compatibilityguide.broadcom.com), search **vSAN SSD** and filter: Device Type **NVMe**, Endurance Class **D (≥ 7300 TBW)**, Performance Class **F or G**, DWPD **3 or higher**. |
| **Local only** | *"NVMe devices cannot be over fabric or Ethernet."* Check the server manual for the slot with the best bandwidth and the least PCIe contention. |
| **Dedicated** | The whole device is for tiering only: no vSAN, no boot, no local datastore. An already-claimed vSAN cache or data disk can't be used until it's removed from vSAN ([§3](#3-keep-the-device-out-of-vsan)). |
| **Clean** | Delete every existing partition first ([KB 323144](https://knowledge.broadcom.com/external/article/323144)). In 9.1 the tier partition itself is created **automatically**. |
| **No hot-plug** | Hot-plug and *prepare to remove* aren't supported for a tiering device. Deactivate tiering on the host (maintenance mode) before you pull it. |
| **Not self-encrypting** | SEDs aren't supported yet ([Duncan Epping, FAQ](https://www.yellow-bricks.com/2026/07/16/memory-tiering-considerations-and-frequently-asked-questions/)). Use the built-in encryption instead ([§5.3](#53-encryption)). |

**OEM drive picking** ([TechDocs][td-best] gives the recipe per vendor):

- **Dell:** pick a *Mixed Use* Enterprise NVMe drive (e.g. *"1.6 TB
  Enterprise NVMe Mixed Use AG Drive U.2 with carrier"*). [TechDocs][td-best] notes this
  *"may require selecting a different pair of NVMe drives for Memory Tiering
  than those used for vSAN in a ReadyNode configuration."*
- **HPE:** in the ProLiant SSD Selector, SSD Workload **Mixed Use**,
  interface **NVMe Mainstream/High Performance**, and *Endurance DWPD* ≥ 3.
- **Lenovo:** Mixed Use, 3 DWPD, Enterprise-class (e.g. ThinkSystem P5620 /
  7450 / CD8P / PM1745 Mixed Use), see
  [Lenovo Press LP2288](https://lenovopress.lenovo.com/lp2288-implementing-memory-tiering-over-nvme-using-vmware-esxi-90).

### 2.2 Sizing — the DRAM:NVMe ratio

- **Default 1:1.** The tier equals the DRAM size, so the host shows **2×** its
  DRAM. [TechDocs][td-best]: *"In general, NVMe sizes must be at least as large as the
  DRAM of the system."*
- **Hard cap 4 TB** per tier partition. If the device is smaller than DRAM,
  the device size wins.
- **The ratio is a setting**, `tier_size_pct`: NVMe tier as a percentage of
  DRAM. The Configuration Profile accepts **1–400**; [TechDocs][td-config] recommends the
  default **100** for performance. Lower it (50 = 2:1, 25 = 4:1) for
  latency-sensitive estates or a higher active-memory share.
- **Unused device capacity isn't wasted.** The drive cycles through all its
  cells, which helps endurance ([Duncan Epping, FAQ][faq]).

The NVMe used is *the smaller of* the ratio and the partition size ([TechDocs][td-params]
table, excerpt):

| DRAM | Ratio | NVMe partition | NVMe used |
| --- | --- | --- | --- |
| 256 GB | 1:1 (default) | 512 GB | 256 GB |
| 256 GB | 2:1 | 128 GB | 128 GB |
| 1 TB | 4:1 | 4 TB | 256 GB |
| 2 TB | 4:1 | 2 TB | 512 GB |

> **Plan the second drive now.** For redundancy ([§5.1](#51-redundancy-software-mirroring-or-hardware-raid)), 9.1 mirrors the tier
> in software across **two** NVMe devices per host; the mirror must be **the
> same size or larger** than the primary. Ordering one drive per host and
> adding the second later means another maintenance window per host.

---

## 3. Keep the device out of vSAN

vSAN and Memory Tiering can run on the **same cluster**, but never on the
**same device**: *"Do not mix the same physical NVMe drive for NVMe tiering
and vSAN."* The catch is that the tiering drive is, by definition, a drive
vSAN considers eligible.

### 3.1 New vSAN cluster (vSphere Client)

[TechDocs][td-vsan] gives two ways to keep a device free when enabling vSAN by hand:

- **Approach 1, add the drive later:** enable vSAN and claim its disks, then
  **turn off *vSAN Managed Disk Claim*** so new eligible disks aren't
  auto-claimed, *then* insert the tiering NVMe and enable tiering on it.
- **Approach 2, claim manually:** in the vSAN wizard turn off *vSAN Managed
  Disk Claim*, finish **without claiming any disks**, then *Configure → vSAN
  → Disk Management → Claim Unused Disks for vSAN* and select every data
  disk **except** the tiering device.

### 3.2 Existing vSAN cluster (reclaim a device)

[TechDocs][td-vsan] approach 3: *Configure → vSAN → Disk Management*, select the
device, **Remove Disk** with **Full data migration**, run **Go To Pre-Check**,
then **Remove**. Only reclaim a device that meets [§2.1](#21-device-requirements), and confirm the
cluster can afford the capacity. TechDocs links the vSAN OSA / ESA device
removal procedures from the
[Activate Memory Tiering with vSAN](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vsphere-resource-management/memory-tiering-over-nvme/enabling-memory-tiering-with-vsan.html)
page; Broadcom's
[Design & Sizing Part 4: vSAN Compatibility](https://blogs.vmware.com/cloud-foundation/2025/12/16/nvme-memory-tiering-design-and-sizing-on-vmware-cloud-foundation-9-part-4/)
walks the whole reclaim.

### 3.3 VCF bring-up and workload-domain creation — unverified

Broadcom's 9.0-era design blog says *"In VCF 9, deployment has no workflow
to claim devices for Memory Tiering"* and that vSAN **auto-claims** eligible
devices during deployment, so a greenfield build may swallow the tiering
drive and you'd reclaim it by hand
([Part 4](https://blogs.vmware.com/cloud-foundation/2025/12/16/nvme-memory-tiering-design-and-sizing-on-vmware-cloud-foundation-9-part-4/)).
**Whether the 9.1 VCF Installer and the workload-domain wizard still do this
has not been verified here.**

The safe path until it is: **leave the tiering NVMe out of the hosts (or
disabled in the BIOS) during bring-up / domain creation**, turn off *vSAN
Managed Disk Claim* on the new cluster afterwards, then add the drive and
enable tiering. That is [TechDocs][td-vsan] Approach 1 ([§3.1](#31-new-vsan-cluster-vsphere-client)) applied after VCF built
the cluster. The fallback is [§3.2](#32-existing-vsan-cluster-reclaim-a-device).

---

## 4. Enable Memory Tiering

**Before you start (all methods):**

- Every host needs a compatible, clean NVMe device ([§2](#2-pick-and-size-the-nvme-device)), and no **Intel
  Optane PMem** or **NVDIMM-N** persistent memory.
- Every enable, disable or reconfigure needs **maintenance mode**. The
  cluster method handles that itself, host by host; with `esxcli` you do it.
  No reboot is needed in 9.1.
- VMs must be vMotion-compatible, because hosts are evacuated in turn.
- The cluster should be managed by a **single image** with **vSphere
  Configuration Profiles** ([TechDocs][td-config] lists this even for the `esxcli` host
  path).

### 4.1 Cluster level — Configuration Profiles (recommended)

vSphere Client → cluster → **Configure → Desired State → Configuration**:

1. On the **Draft** tab, select **esx → memtier**, click **nvme**, then
   **Configure Settings**.
2. Set **enable** to **True**.
3. **device:** click *View host-specific details*, add each host by BIOS
   UUID (*Show unconfigured hosts* → **Select**), and pick its NVMe device.
   Alternatively paste the device's **Location** path from *host → Configure
   → Storage → Storage Devices → Properties*.
4. **mirror_device** (optional, [§5.1](#51-redundancy-software-mirroring-or-hardware-raid)): same per host, a **different** device.
5. **encryption** (optional, [§5.3](#53-encryption)): **True**. Default **False**.
6. **tier_size_pct:** leave **100** unless [§2.2](#22-sizing--the-dramnvme-ratio) says otherwise.
7. **Save**, then apply and remediate. Per Broadcom's
   [9.1 configuration blog](https://blogs.vmware.com/cloud-foundation/2026/05/19/more-memory-less-effort-configuring-memory-tiering-in-vcf-9-1/),
   remediation puts each host in maintenance mode, migrates its VMs, creates
   the partition, applies the settings and exits maintenance mode, one host
   at a time.

The setting applies to every host in the cluster unless you add host
overrides. To change it later: same path, **Edit**. To remove it: select the
nvme configuration and **Delete**.

### 4.2 Host level — `esxcli memtier`

With the host in maintenance mode:

```shell
# find candidate devices
esxcli memtier device list

# enable on one device
esxcli memtier enable -d <device_1>

# enable with a software mirror
esxcli memtier enable -d <device_1,device_2>

# enable with encryption, tier = 50 % of DRAM
esxcli memtier enable -d <device_1> -c t -r 50

# change the ratio afterwards (here 4:1)
esxcli memtier config set --tier-size-pct 25
```

> 9.1 moved everything under the single `esxcli memtier` namespace; older
> posts that use other namespaces describe 9.0
> ([Duncan Epping](https://www.yellow-bricks.com/tag/memory-tiering/)).

### 4.3 Verify

- **Cluster:** *Summary* → **Memory** card shows the Tier 0 / Tier 1 split
  and how many hosts are tiered. *Hosts* tab → *Manage Columns* →
  **Memory Tiering** shows "Software" on tiered hosts.
- **Host:** *Summary* → **Memory** card, or:

```shell
esxcli memtier config get   # Enable: True = configured
esxcli memtier status get   # Status: Disabled while Enable is True = activation failed; check logs/alarms
```

---

## 5. Redundancy, encryption and per-VM control

### 5.1 Redundancy: software mirroring or hardware RAID

Without redundancy, a tiering-device failure behaves like a failed DIMM for
the VMs that have pages on it ([§8](#8-when-an-nvme-tiering-device-fails)). Two options:

- **Software mirroring (9.1, recommended by [TechDocs][td-config] over hardware RAID).**
  Two NVMe devices per host, mirrored by ESX at the same partition and block;
  reads go round-robin across the pair ([Duncan Epping, FAQ][faq]). The mirror must
  be the same size as the primary or larger. No RAID controller needed.
  - Add a mirror later: `esxcli memtier config set -d "old-device, new-mirror-device"`
  - Replace the primary: `esxcli memtier config set --devices=<new-device>,<old-mirror-device>`
  - Drop the mirror: `esxcli memtier config set -d "old-device-1"`
- **Hardware RAID.** Supported: NVMe behind a Tri-Mode controller or Intel
  VROC, presented as one logical device. Mind vSAN: ESA doesn't support RAID
  controllers, so keep the tiering RAID set separate from vSAN devices
  ([Design & Sizing Part 2](https://blogs.vmware.com/cloud-foundation/2025/11/18/nvme-memory-tiering-design-and-sizing-on-vmware-cloud-foundation-9-part-2/)).

### 5.2 Excluded VMs and per-VM opt-out

ESX keeps these VM types **entirely in DRAM** automatically. In 9.1 they can
power on on a tiered host (some couldn't in 9.0); they just don't tier:

- Low Latency VMs, Confidential VMs, Fault Tolerant VMs and large VMs
  ([TechDocs][td-profiles]), and passthrough VMs, whose reservations are then DRAM-backed
  ([Duncan Epping, FAQ][faq]).
- **Nested-virtualisation VMs.** The one exception is **VBS** (Virtualization-
  Based Security) VMs, which you can opt in with `sched.mem.enableNestedTiering
  = TRUE`. [Duncan Epping][faq] (2026-07-16) adds *"this should be used for testing
  purposes only."* The [9.1 launch blog][blog-91] (2026-05-07) said nested VMs
  *"participate in tiering just like any other workload"*; the later [TechDocs][td-profiles]
  page (last updated 2026-09-29) and [Duncan's FAQ][faq] both describe the opt-in
  instead, so follow those.
- **VMs over 512 GB *and* 64 vCPUs** may see degraded performance. [TechDocs][td-profiles]:
  disable tiering for them and give them a full memory reservation.

To opt a VM out yourself: power it off, *Edit Settings → Advanced
Parameters*, add `sched.mem.enableTiering = FALSE`, and on *Virtual
Hardware → Memory* tick **Reserve all guest memory (All locked)**. The
reservation is **mandatory**: without it the VM can end up in the host swap
file, which is slower than the NVMe tier.

> **Each opted-out VM shrinks the tier's DRAM share.** [TechDocs][td-fail] example:
> 1 TB DRAM + 1 TB NVMe, two 200 GB VMs fully reserved and opted out, leaves
> 600 GB of DRAM for 1 TB of NVMe, an effective **0.6:1**, which can slow the
> remaining tiered VMs. Size the ratio with the opted-out VMs counted.

### 5.3 Encryption

Tiered pages are **not encrypted by default**. Two scopes:

- **Host** (all VMs; maintenance mode): `esxcli memtier config set --encryption true`,
  or *encryption = True* in the Configuration Profile.
- **Per VM** (powered off): advanced parameter `sched.mem.EncryptTierNVMe = TRUE`.

No KMS or Native Key Provider is needed: each host generates its own AES-XTS
256-bit key, and pages are decrypted before vMotion, which uses its own
encrypted channel
([Design & Sizing Part 2](https://blogs.vmware.com/cloud-foundation/2025/11/18/nvme-memory-tiering-design-and-sizing-on-vmware-cloud-foundation-9-part-2/)).
This is separate from VM encryption.

---

## 6. Operating it: vMotion, DRS, HA, host features

- **vMotion takes 1.5–2× longer** (tiered pages are read back from NVMe
  first) with almost no impact on the running VM. On the destination, pages
  start in DRAM and tier again if that host is tiered.
- **DRS** evaluates active memory when the target host is tiered, and
  clusters can mix tiered and non-tiered hosts.
- **Memory reservations** can be backed by DRAM *and* NVMe; the host sees one
  pool.
- **Turning tiering off shrinks the cluster.** [TechDocs][td-config]: *"if an overcommitted
  cluster has insufficient memory, VMs might fail to power on."* Size HA
  failover capacity knowing that tiered capacity disappears with a host, and
  that disabling tiering for maintenance removes it on purpose.
- **Not supported on a tiered host:** **Quick Boot**, and **suspend to
  memory** (suspend to disk and snapshots are fine).
- **Large pages** are disabled on VMs when tiering is enabled; tiering works
  at 4 KB granularity ([Duncan Epping, FAQ][faq]).
- **Overhead:** kernel memory is never tiered; CPU cost is about **an eighth
  of a core** on smaller hosts ([TechDocs][td-best]).

---

## 7. Monitoring

- **vCenter 9.1:** host and cluster **Memory** cards show tier breakdown,
  consumed per tier and consumed vs active. The *Advanced* memory performance
  chart has **Memory Read/Write Bandwidth** per tier, also per VM: *write* =
  cold pages going to NVMe, *read* = pages fetched back.
- **When to worry.** [TechDocs][td-assess]: *"If NVMe read bandwidth exceeds 200 MB/s,
  begin monitoring device latencies."* Broadcom saw read latency below
  200 µs at ~400 MB/s on one device class and closer to 300 µs on others.
- **Device health (9.1):** *host → Monitor → Memory Tiering* has a health
  report with the SMART metrics that matter for tiering. The alarm *"NVMe
  Memory Tiering device is not healthy"* carries no detail itself; open the
  report. William Lam suggests planning a replacement when **Available Spare**
  reaches **10 %**
  ([post](https://williamlam.com/2026/09/quick-tip-improved-nvme-tiering-device-health-monitoring-in-vcf-9-1.html)).
  From the CLI: `esxcli system health report get -r vmw.memTierHealth`.
- **Per-VM tiering stats:** `memstats -r vmtier-stats` (fields `name`,
  `memSize`, `active`, `tier1Target`, `tier1Consumed`).
- **VCF Operations 9.1:** a Memory Tiering dashboard and the What-If
  analysis. In **VCF Operations 9.0.x** the NVMe-tier latency and bandwidth
  metrics are not collected
  ([KB 434852](https://knowledge.broadcom.com/external/article/434852/monitoring-memory-tiering-metrics-in-vmw.html));
  use vCenter and `memstats` there.

---

## 8. When an NVMe tiering device fails

TechDocs ([NVMe Failure Scenarios](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vsphere-resource-management/memory-tiering-over-nvme/nvme-failure-scenarios-for-memory-tiering.html)),
for a host **without** a mirror:

- VMs that only use DRAM keep running.
- VMs with pages on the failed device keep running **until they touch one of
  those pages**; then the VM powers off. With **vSphere HA** enabled, the
  restart policy brings it back on another host. No dedicated failover host
  is needed.
- **Maintenance mode after the failure is manual** in 9.1 (vSphere Client,
  `esxcli`, or an OEM plug-in such as OpenManage / OneView configured to do
  it). Replace the device, then reconfigure ([§5.1](#51-redundancy-software-mirroring-or-hardware-raid) or [§4](#4-enable-memory-tiering)).

With a software mirror or hardware RAID-1, the VM keeps running on the
surviving device.

---

## 9. Known issues

| Symptom | Cause / fix |
| --- | --- |
| Some RHEL 8 VMs never use the NVMe tier (`tier1Consumed` = 0) | Usually by design: Linux keeps page-cache pages warm, the host isn't past ~80 %, or a VM setting blocks tiering (latency sensitivity *High*, full reservation, `vhv.enable`, `sched.mem.enableTiering = FALSE`). [KB 448305](https://knowledge.broadcom.com/external/article/448305/rhel-8-virtual-machines-do-not-utilize-m.html) |
| VCF Operations shows no NVMe-tier latency/bandwidth | VCF Operations 9.0.x gap. [KB 434852](https://knowledge.broadcom.com/external/article/434852/monitoring-memory-tiering-metrics-in-vmw.html) |
| `config get` says enabled, `status get` says Disabled | Activation failed; check host logs and alarms ([TechDocs][td-config]). |
| VMs misbehave on **AMD Ryzen** (consumer) CPUs with tiering on | Homelab-only CPU quirk with a workaround; EPYC/Xeon unaffected. [William Lam](https://williamlam.com/2025/06/nvme-tiering-with-amd-ryzen-cpu-workaround-for-vcf-9-0.html) |

---

## 10. If you are still on 9.0

Per Broadcom's
[9.1 enhancements blog](https://blogs.vmware.com/cloud-foundation/2026/05/07/advanced-memory-tiering-enhancements-in-vmware-cloud-foundation-9-1/),
9.0 differs from this guide in these ways:

- **No software mirroring**; NVMe redundancy needs hardware RAID (Tri-Mode or
  Intel VROC).
- **The tier partition is created by hand**, and configuration is per host
  with older `esxcli` commands rather than `esxcli memtier` or a cluster
  Configuration Profile; enabling needed a reboot.
- **Some VM profiles can't power on** on a tiered host: security,
  low-latency and FT VMs ([9.1 blog][blog-91]), and nested-virtualisation VMs
  ([William Lam](https://williamlam.com/2025/06/nvme-tiering-with-nested-virtualization-in-vcf-9-0.html)).
- **VCF Operations 9.0.x** lacks the tier metrics ([KB 434852](https://knowledge.broadcom.com/external/article/434852/monitoring-memory-tiering-metrics-in-vmw.html)).

Use the
[9.0 TechDocs section](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-0/vsphere-resource-management/memory-tiering-over-nvme.html)
for 9.0 procedures.

---

## References

**Broadcom TechDocs (vSphere 9.1, *vSphere Resource Management*):**
[Memory Tiering over NVMe](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vsphere-resource-management/memory-tiering-over-nvme.html) ·
[Capacity Planning Considerations](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vsphere-resource-management/memory-tiering-over-nvme/capacity-planning-considerations.html) ·
[VM Profiles and Performance](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vsphere-resource-management/memory-tiering-over-nvme/capacity-planning-considerations/virtual-machine-types-and-performance-with-memory-tiering.html) ·
[Configuration Parameters](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vsphere-resource-management/memory-tiering-over-nvme/capacity-planning-considerations/host-memory-size.html) ·
[Assessing Workloads](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vsphere-resource-management/memory-tiering-over-nvme/capacity-planning-considerations/assessing-customer-workloads-for-memory-tiering.html) ·
[Memory Tiering Configuration](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vsphere-resource-management/memory-tiering-over-nvme/memory-tiering-configuration.html) ·
[Activate Memory Tiering with vSAN](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vsphere-resource-management/memory-tiering-over-nvme/enabling-memory-tiering-with-vsan.html) ·
[Considerations and Best Practices](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vsphere-resource-management/memory-tiering-over-nvme/memory-tiering-considerations-and-best-practices.html) ·
[NVMe Failure Scenarios](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vsphere-resource-management/memory-tiering-over-nvme/nvme-failure-scenarios-for-memory-tiering.html)

**Broadcom VCF blog:**
[Configuring Memory Tiering in VCF 9.1](https://blogs.vmware.com/cloud-foundation/2026/05/19/more-memory-less-effort-configuring-memory-tiering-in-vcf-9-1/) ·
[Advanced Memory Tiering Enhancements in VCF 9.1](https://blogs.vmware.com/cloud-foundation/2026/05/07/advanced-memory-tiering-enhancements-in-vmware-cloud-foundation-9-1/) ·
[NVMe Memory Tiering Design and Sizing series](https://blogs.vmware.com/cloud-foundation/vcf-advanced-memory-tiering/) (Dave Morera; Parts
[2](https://blogs.vmware.com/cloud-foundation/2025/11/18/nvme-memory-tiering-design-and-sizing-on-vmware-cloud-foundation-9-part-2/),
[3](https://blogs.vmware.com/cloud-foundation/2025/12/02/nvme-memory-tiering-design-and-sizing-on-vmware-cloud-foundation-9-part-3/),
[4](https://blogs.vmware.com/cloud-foundation/2025/12/16/nvme-memory-tiering-design-and-sizing-on-vmware-cloud-foundation-9-part-4/)) ·
[Memory Tiering Performance in VCF 9.0 (white paper)](https://www.vmware.com/docs/memtier-vcf9-perf)

**Community:**
Duncan Epping — [Considerations and FAQ](https://www.yellow-bricks.com/2026/07/16/memory-tiering-considerations-and-frequently-asked-questions/),
[Are my memory pages tiered?](https://www.yellow-bricks.com/2025/12/18/playing-around-with-memory-tiering-are-my-memory-pages-tiered) ·
William Lam — [NVMe tiering device health in 9.1](https://williamlam.com/2026/09/quick-tip-improved-nvme-tiering-device-health-monitoring-in-vcf-9-1.html) ·
[Lenovo Press LP2288](https://lenovopress.lenovo.com/lp2288-implementing-memory-tiering-over-nvme-using-vmware-esxi-90)

**KBs:**
[323144](https://knowledge.broadcom.com/external/article/323144) (delete partitions) ·
[448305](https://knowledge.broadcom.com/external/article/448305/rhel-8-virtual-machines-do-not-utilize-m.html) (RHEL 8 not tiering) ·
[434852](https://knowledge.broadcom.com/external/article/434852/monitoring-memory-tiering-metrics-in-vmw.html) (VCF Operations 9.0.x metrics)

[td-main]: https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vsphere-resource-management/memory-tiering-over-nvme.html
[td-cap]: https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vsphere-resource-management/memory-tiering-over-nvme/capacity-planning-considerations.html
[td-profiles]: https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vsphere-resource-management/memory-tiering-over-nvme/capacity-planning-considerations/virtual-machine-types-and-performance-with-memory-tiering.html
[td-params]: https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vsphere-resource-management/memory-tiering-over-nvme/capacity-planning-considerations/host-memory-size.html
[td-assess]: https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vsphere-resource-management/memory-tiering-over-nvme/capacity-planning-considerations/assessing-customer-workloads-for-memory-tiering.html
[td-config]: https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vsphere-resource-management/memory-tiering-over-nvme/memory-tiering-configuration.html
[td-vsan]: https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vsphere-resource-management/memory-tiering-over-nvme/enabling-memory-tiering-with-vsan.html
[td-best]: https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vsphere-resource-management/memory-tiering-over-nvme/memory-tiering-considerations-and-best-practices.html
[td-fail]: https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/vsphere-resource-management/memory-tiering-over-nvme/nvme-failure-scenarios-for-memory-tiering.html
[faq]: https://www.yellow-bricks.com/2026/07/16/memory-tiering-considerations-and-frequently-asked-questions/
[blog-91]: https://blogs.vmware.com/cloud-foundation/2026/05/07/advanced-memory-tiering-enhancements-in-vmware-cloud-foundation-9-1/
