# GPU Hosts (NVIDIA vGPU and Passthrough) — Build Guide

This guide gets NVIDIA GPUs in ESX hosts ready for workloads on **VCF 9.1**:
choosing how the GPU is shared, which licences that pulls in, checking the
card against **both** Broadcom's and NVIDIA's support lists, getting the
NVIDIA host driver into the cluster's vSphere Lifecycle Manager image, and
configuring the GPU devices on each host.

It stops where the platform is ready. What runs on top — deep learning VMs,
VKS clusters with GPUs, Private AI Services, VCF Automation catalog items —
is covered by Broadcom's
[VMware Private AI Foundation with NVIDIA][paif] documentation.

> **Evidence level:** sourced from Broadcom TechDocs (the
> [*VMware Private AI Foundation with NVIDIA 9.1*][paif-pdf] PDF, generated
> 2026-09-21, and the VCF 9.1 lifecycle pages), the Broadcom Compatibility
> Guide (queried 2026-10-16) and NVIDIA's vGPU documentation (pages last
> updated 2026-09-29). **Not lab- or field-verified in this repo yet.**
> NVIDIA ships vGPU releases often and Broadcom updates the compatibility
> guide constantly, so re-check both lists ([§3](#3-check-the-card-on-both-lists))
> on the day you order hardware.

---

## The sequence, end to end

1. [Pick the GPU mode](#1-pick-the-gpu-mode): passthrough, vGPU time-slicing, or vGPU MIG
2. [Line up the licences](#2-line-up-the-licences)
3. [Check the card on both lists](#3-check-the-card-on-both-lists)
4. [Pick the vGPU release and download it](#4-pick-the-vgpu-release-and-download-it)
5. [Enable SR-IOV in the BIOS](#5-enable-sr-iov-in-the-bios)
6. [Put the host driver into the cluster image](#6-put-the-host-driver-into-the-cluster-image) — **before** the workload domain or cluster is created
7. [Configure the GPU devices on each host](#7-configure-the-gpu-devices-on-each-host)
8. [NVIDIA licensing for the guests](#8-nvidia-licensing-for-the-guests) (vGPU only)
9. [Guest drivers](#9-guest-drivers)
10. [Validate](#10-validate)

Steps 1–4 are planning: they belong with the hardware order, because the
answers decide which card and which licences you buy.

---

## 1. Pick the GPU mode

| | **Passthrough** (Fixed / Dynamic DirectPath) | **vGPU, time-slicing** | **vGPU, MIG** (Multi-Instance GPU) |
| --- | --- | --- | --- |
| **What the VM gets** | A whole physical GPU, exclusively | A share of a GPU (a vGPU profile), scheduled in time slices | A hardware partition of a GPU |
| **NVIDIA host driver on ESX** | No | **Yes** — the vGPU host driver (Virtual GPU Manager) | **Yes** — plus MIG enabled per host |
| **NVIDIA AI Enterprise (NVAIE) licence** | **No** ([PAIF 9.1][paif-pdf]: *"exclusive access to GPU resources without the need for an NVIDIA AI Enterprise (NVAIE) license"*) | **Yes** | **Yes** |
| **SR-IOV in the BIOS** | Not required for the GPU | **Required** | **Required** |
| **Guest driver** | NVIDIA data center driver (public download) | NVIDIA vGPU guest driver, same release as the host driver | Same as time-slicing |
| **Host setting** | *DirectPath* → Fixed / Dynamic DirectPath | *Graphics* → **Shared Direct** | Shared Direct + MIG mode on |

Points that decide the choice:

- **SR-IOV is required for both vGPU modes.** [PAIF 9.1][paif-pdf]: *"SR-IOV is
  also required for both MIG and time-slicing modes of NVIDIA vGPU. For MIG, a
  vGPU is associated with a virtual function at boot time."*
- **MIG and NVIDIA NIMs don't mix.** [PAIF 9.1][paif-pdf]: *"You cannot use the
  MIG sharing mode for NVIDIA GPUs with NVIDIA NIMs."* If the AI team plans to
  run NIMs, plan time-slicing or passthrough on those GPUs.
- **vGPU VMs can vMotion** once a vCenter advanced setting is on
  ([§7.4](#74-allow-vmotion-of-vgpu-vms)).
- **One mode per GPU device**, set per host. Switching a host from MIG to
  passthrough means turning MIG off and removing the host driver
  ([§7.3](#73-mig)).

---

## 2. Line up the licences

Up to **three** licence layers apply. Name an owner for each before the
hardware arrives.

| Layer | When you need it | What it covers |
| --- | --- | --- |
| **VCF subscription** | Always | The platform. GPU metrics in vCenter and VCF Operations come with the VCF licence ([PAIF 9.1][paif-pdf]). |
| **VMware Private AI Foundation with NVIDIA add-on** | Only for the Private AI Foundation features | The Private AI setup in VCF Automation (catalog items for deep learning VMs and VKS clusters), PostgreSQL with pgvector in Data Services Manager, the deep learning VM image, the guided deployment workflow in the vSphere Client, and Private AI Services. Assigned to the **GPU-enabled workload domain**. Assigning it to the management domain is needed *"only to activate the guided deployment UI in the vSphere Client"* ([PAIF 9.1][paif-pdf]). |
| **NVIDIA AI Enterprise (NVAIE)** (or another NVIDIA vGPU licence) | **vGPU only** | [PAIF 9.1][paif-pdf]: *"an NVIDIA AI Enterprise (NVAIE) license that is required for the host driver VIB file on ESX hosts and the guest OS drivers."* Bought from NVIDIA, not Broadcom. |

- **NVIDIA's evaluation.** NVIDIA offers a free
  [90-day vGPU evaluation][nv-eval]. It needs a **corporate email address**,
  and the 90 days start when the activation key is redeemed in the NVIDIA
  Licensing Portal. NVIDIA's pages disagree on the concurrent-user cap (128 vs
  500), so check the evaluation page when you register.
### GPUs for VMs, or Private AI Foundation?

Steps 3–10 of this guide are the same either way. A **Private AI
Foundation** implementation adds, on top of plain GPUs for VMs
([PAIF 9.1][paif-pdf], *Deploy a Workload Domain*):

- the **add-on licence**, assigned to the GPU workload domain's vCenter —
  which only works once that vCenter is in a **vCenter Linking** group with the
  management vCenter;
- the workload domain's vCenter and NSX Manager connected to the **VCF
  Identity Broker** (fleet SSO);
- **at least 3 GPU hosts** in the initial cluster;
- its own setup workflow for what runs on top (deep learning VMs, VKS
  clusters with GPUs, Private AI Services, VCF Automation catalog items),
  which on a disconnected (dark) site means staging every artifact locally.
  That part isn't covered in this repo yet (tracked in
  [#408](https://github.com/pauldiee/VCF9-DeploymentPlanning/issues/408)).

Plain vGPU or passthrough for ordinary VMs needs none of that: VCF plus, for
vGPU, the NVIDIA licence.

- **Entitlement lag.** A new entitlement *"might not appear on the NVIDIA
  Licensing Portal dashboard page until 24 business hours"* after you first set
  your password ([NVIDIA quick start][nv-get]). Register early, not on build day.

---

## 3. Check the card on both lists

A GPU has to be supported **by Broadcom** (for this ESX release, in this
mode) **and by NVIDIA** (in the vGPU release you will install). The two lists
are maintained separately and **don't always agree**
([§3.4](#34-the-two-lists-disagree)).

### 3.1 Get the card's exact IDs

A model name isn't enough: the compatibility guide lists each card by its PCI
**VID / DID / SVID / SSID**. On a host that already runs ESX:

```shell
esxcli hardware pci list
```

Find the entries with **Vendor ID `0x10de`** (NVIDIA) and note the Device ID,
SubVendor ID and SubDevice ID. Before the hosts exist, ask the server vendor
for the same four values for the exact GPU part in the quote.

### 3.2 Broadcom Compatibility Guide

Search the [Broadcom Compatibility Guide][bcg] for your ESX release:

- **GPUs** program — filter *Releases* = **ESXi 9.1**, *Partner* = **NVIDIA**,
  and *Supported Passthrough Mode* = **NVIDIA vGPU** (or **DirectPath** for
  passthrough). Match on the four IDs from §3.1. Example:
  [NVIDIA L40S][bcg-l40s] (`10de:26b9`, SSID `18cf`), listed for vGPU and
  DirectPath on ESXi 9.1.
- **DirectPath GPUs and Accelerators** program, *Compute* = **AI/ML** — the list
  Private AI Foundation points to: *"verify in the Broadcom Compatibility Guide
  for GPUs and Accelerators for AI/ML Compute that the GPUs on your ESX hosts
  are supported for AI and machine learning use cases by Broadcom"*
  ([PAIF 9.1][paif-pdf]).
- **AI Ready Node (Server + GPU)** program — certified server + GPU
  combinations (ESXi 9.1, 9.0 and 8.0 U3 at the time of writing). Worth
  checking first when the server isn't bought yet.

### 3.3 NVIDIA vGPU support matrix (vGPU only)

NVIDIA's [product support matrix for VMware vSphere][nv-matrix] lists the
supported GPUs per vGPU release. Since vGPU 19.x it lists **VCF 9.1** and
**VCF 9.0** as their own platform rows, separate from *vSphere 8.0*:

| vGPU branch | VCF 9.0 / ESXi 9.0 | VCF 9.1 / ESXi 9.1 | Source |
| --- | --- | --- | --- |
| **18.x** (archived) | Since **18.3** | Not listed | [18.x release notes][nv-18] |
| **19.x** | Yes | Since **19.4** | [19.x matrix][nv-19] |
| **20.x** (current, R595, up to 20.2) | Yes | Yes | [20.x matrix][nv-matrix] |

Footnotes worth knowing ([20.x matrix][nv-matrix]):

- **RTX PRO 6000 Blackwell Server Edition** (incl. liquid-cooled) and **RTX
  PRO 4500 Blackwell Server Edition** need **VCF 9.0.1 or later** on the 9.0
  line.
- **20.x dropped** the Tesla M10, several Tesla V100 variants, and the Quadro
  RTX 6000 / RTX 8000. On VCF 9.1 those cards stay on 19.x at best.
- vGPU needs ESX licensed as **vSphere Foundation** (or vSphere Enterprise
  Plus), which VCF covers.
- 20.x adds **MIG-backed vGPUs for graphics** on vSphere 9 Update 1, and (20.2)
  **multiple MIG-backed vGPUs on the same physical GPU** on VCF 9.1 or later
  ([20.2 release notes][nv-whatsnew]).

### 3.4 The two lists disagree

Captured **2026-10-16**:

| Card | Broadcom Compatibility Guide, ESXi 9.1, *NVIDIA vGPU* | NVIDIA vGPU 20.x (current) |
| --- | --- | --- |
| Tesla M10 | Listed | **Dropped** |
| Tesla V100 / V100S | Listed | **Several variants dropped** |
| Tesla P4 / P6 / P40 / P100, M6 / M60 | Listed | Not checked here — look them up in the matrix of the branch you plan to run |

A card on Broadcom's list is **not** proof that NVIDIA's current vGPU release
supports it. For an older card, find the newest vGPU branch that supports
it **and** has a *VCF 9.1* package, and confirm that NVIDIA still supports
that branch.

---

## 4. Pick the vGPU release and download it

### 4.1 Which release

- **Use a release that ships a "NVIDIA vGPU for VCF 9.1" package**: 19.4 or
  later on the 19.x branch, or 20.x. Don't use the *vSphere 8.0* package on
  VCF 9.1.
- **Host and guest drivers come from the same release.** The host driver
  must be *"compatible with your VCF version"* ([PAIF 9.1][paif-pdf]), and the
  guest driver must match the host driver. Private AI Foundation's deep
  learning VM pins this too: the DLVM for 9.1 supports *"NVAIE 7.x vGPU host
  driver (580.x.x) and NVAIE 8.0 vGPU host driver (595.58.02)"*, and the 9.1.1
  DLVM *"NVAIE 8.0 and later versions of vGPU host drivers (595.x.x)"*
  ([PAIF 9.1][paif-pdf]). If you'll run DLVMs, pick a host driver inside that
  window.
- **For VKS clusters with GPUs**, the NVIDIA GPU Operator must be compatible
  with the cluster's Kubernetes version and with the host driver
  ([PAIF 9.1][paif-pdf]).

### 4.2 Where to download

| What | Where | Login |
| --- | --- | --- |
| **vGPU host driver** (Virtual GPU Manager, the ESX component) + vGPU guest drivers + license server software | **NVIDIA Licensing Portal**, reached from the NVIDIA Application Hub at [nvid.nvidia.com/dashboard][nv-hub] → *Software Downloads* → filter the table, click *Download* ([NVIDIA quick start][nv-get]). This is also the source TechDocs names: *"The VIB file of the NVIDIA vGPU host driver downloaded from https://nvid.nvidia.com/"* ([PAIF 9.1][paif-pdf]). | NVIDIA Enterprise account **with an entitlement** |
| **Same, for NVAIE subscribers** | The [NGC catalog][ngc]: the host driver is the [Virtual GPU Manager][ngc-vgm] resource (formerly *vGPU Host Driver*), downloaded with the NGC CLI ([NVAIE VMware deployment guide][nvaie-vmware]) | NGC org + API key, NVAIE subscription |
| **Data center driver** for passthrough guests | [nvidia.com/drivers][nv-drivers] | None — public |

Download the **offline bundle (ZIP)** for the host driver: that's what
vSphere Lifecycle Manager imports ([§6.1](#61-build-the-image-in-vcenter)).

---

## 5. Enable SR-IOV in the BIOS

For **vGPU** (time-slicing and MIG): enable SR-IOV in each host's BIOS/UEFI,
following the server vendor's documentation, and on the graphics devices
using the VMware Host Client ([PAIF 9.1][paif-pdf]). Do it during host
preparation, alongside the rest of the BIOS baseline, so it isn't a
maintenance-mode round per host later.

---

## 6. Put the host driver into the cluster image

VCF lifecycle-manages ESX through **vSphere Lifecycle Manager images**, so the
NVIDIA host driver goes **into the image** as a component — not hand-installed
on hosts and left there. Private AI Foundation lists *"A vSphere Lifecycle
Manager image with the VIB file of the vGPU host manager driver"* as a
requirement, and installs the driver by *"Add the VIB file of the driver to
the vSphere Lifecycle image for the cluster and remediate the hosts"*
([PAIF 9.1][paif-pdf]).

Do this **before** creating the workload domain or cluster, so you can select
the GPU image there.

> **Source conflict, dated:** the PAIF requirements still say the image must be
> *"available in SDDC Manager"* ([PAIF 9.1][paif-pdf], generated 2026-09-21).
> The VCF 9.1 lifecycle page (last updated 2026-10-15) says you *"create
> vSphere Lifecycle Manager images in the vSphere Client and then import them
> into a VCF Instance using VCF Operations"* ([Managing vLCM images][td-images]).
> The SDDC Manager UI is deprecated in VCF 9; follow the VCF Operations path
> below.

### 6.1 Build the image in vCenter

In the vSphere Client of a vCenter that runs the target ESX version:

1. **Import the NVIDIA offline bundle (ZIP) into the vSphere Lifecycle Manager
   depot.** [KB 425993][kb425993] gives the path as *Lifecycle Manager → Image
   Depot → Import Updates*, and prefers a ZIP offline bundle over an ISO.
2. **Create the image** in the image library
   ([Working with Image Library][td-imagelib]): the **ESX version from the VCF
   BOM** ([Import a vLCM image][td-import]), your vendor add-on and firmware as
   usual, and **add the NVIDIA host driver as a component**.

**Mixed clusters** (some hosts with GPUs, some without, or different GPU
generations) can use a **composite image**: one default image plus up to four
additional image definitions with the same base ESX version but their own
vendor add-on, firmware and components, assigned to hosts manually or by BIOS
vendor / model / OEM string / family rules ([Managing vLCM images][td-images]).
Clusters whose hosts all carry the same GPUs don't need this.

### 6.2 Import the image into the VCF Instance

[TechDocs][td-import]:

1. Log in to **VCF Operations** as an Administrator.
2. **Build → Lifecycle**, expand **VCF Instances**, select the instance.
3. **Image Management → Import Image**.
4. **Import from a vCenter** (pick the vCenter and the image) or **Import from
   a file** (JSON + ZIP, optional ISO, exported from the vSphere Client first).

### 6.3 Use the image

- **New workload domain or cluster:** select the GPU image in the creation
  wizard ([`23-workload-domain-creation.md`](23-workload-domain-creation.md),
  [`24-cluster-creation.md`](24-cluster-creation.md)). When you use the Private
  AI Foundation guided workflow, *"select hosts whose NVIDIA vGPU state is
  Ready"* ([PAIF 9.1][paif-pdf]).
- **Existing cluster:** add the component to the cluster's image and
  **remediate** the hosts ([PAIF 9.1][paif-pdf]).
- **Private AI Foundation minimum:** *"At least 3 GPU-enabled ESX hosts to
  include in the initial cluster of a workload domain"* ([PAIF 9.1][paif-pdf]).

**Upgrades:** a VCF upgrade moves ESX to a new image, so the NVIDIA component
has to move with it. Check the vGPU release still supports the target VCF
version ([§3.3](#33-nvidia-vgpu-support-matrix-vgpu-only)) and include a
matching host driver in the target image **before** you start the ESX upgrade.

---

## 7. Configure the GPU devices on each host

All in the **vSphere Client** of the workload domain's vCenter, per host
([PAIF 9.1][paif-pdf], *Configure NVIDIA vGPU or GPU Passthrough for AI
Workloads on the ESX Hosts*). Each change needs the host in **maintenance
mode and a restart**, so batch them per host.

### 7.1 vGPU: Shared Direct

1. Select the host → **Configure → Hardware → Graphics**.
2. Under **Host Graphics**, select a GPU device and click **Edit**.
3. Set **Device Type** = **Shared Direct**.
4. **vGPU Mode** (dual-purpose GPUs only): TechDocs, verbatim: *"vGPU profiles
   on a single physical GPU can have different types or sizes. For example, you
   can run vGPU VM profiles with 16-GB compute for compute-intensive work like
   machine learning (C-type vGPU profile) and 4-GB graphics (Q-type vGPU
   profile) simultaneously on a single device. Activating this feature reduces
   the maximum number of instances of some profiles."*
5. Repeat for every GPU device, then maintenance mode → restart.

### 7.2 Passthrough: Fixed or Dynamic DirectPath

1. Select the host → **Configure → Hardware → DirectPath**.
2. Select a GPU device → **Configure DirectPath Mode** → **Fixed/Dynamic
   DirectPath** → **Configure**.
3. Repeat for every GPU device, then maintenance mode → restart.

### 7.3 MIG

- **Enabling:** MIG is enabled per host, on each host in the cluster, following
  NVIDIA's [MIG User Guide][nv-mig] ([PAIF 9.1][paif-pdf]).
- **Switching a host from MIG back to passthrough** ([PAIF 9.1][paif-pdf]):
  maintenance mode; on the host, get the GPU IDs with `nvidia-smi`; turn MIG off
  per GPU and verify; reboot; then configure DirectPath (§7.2).

  ```shell
  nvidia-smi                      # list GPU IDs
  nvidia-smi -i <gpu_id> -mig 0   # MIG off for that GPU
  nvidia-smi -i <gpu_id>          # verify
  reboot
  ```

  Turn MIG off **before** removing the host driver. If the driver is already
  gone, TechDocs' workaround is to run the `nvidia-smi -i <GPU_ID> -mig 0`
  command from inside a VM that has `nvidia-smi`.

### 7.4 Allow vMotion of vGPU VMs

On the **workload domain's vCenter** ([PAIF 9.1][paif-pdf]):

1. Hosts and Clusters → select the vCenter instance.
2. **Configure → Advanced Settings → Edit Settings**.
3. Set **`vgpu.hotmigrate.enabled`** to **Enabled** → **Save**.

---

## 8. NVIDIA licensing for the guests

vGPU guests check out a licence from a service instance of the
[NVIDIA License System][nv-ls]. Set it up before the first vGPU workload,
because an unlicensed vGPU slows down. NVIDIA, verbatim: *"the performance of
the virtual GPU or physical GPU is degraded if the VM fails to obtain a license
within 20 minutes"*, and it degrades further after 24 hours
([NVIDIA licensing intro][nv-lic-intro]).

- The licence server software is downloaded from the same Licensing Portal
  ([§4.2](#42-where-to-download)).
- Each guest gets a **client configuration token** in the default folder
  ([NVIDIA client licensing][nv-lic-client]):
  - Windows: `%SystemDrive%\Program Files\NVIDIA Corporation\vGPU Licensing\ClientConfigToken`
  - Linux: `/etc/nvidia/ClientConfigToken`
- For a vGPU you don't set a licence type: the software *"selects the license
  type based on the vGPU type"* ([NVIDIA client licensing][nv-lic-client]).

Bake the token into your templates (or let the deep learning VM / GPU Operator
handle it, per the Private AI Foundation docs), and give the licence server an
owner: it is a new piece of infrastructure, with its own backups and renewals.

---

## 9. Guest drivers

| Mode | Guest driver |
| --- | --- |
| **vGPU** | The NVIDIA **vGPU guest driver** from the **same release** as the host driver ([§4.1](#41-which-release)). NVAIE subscribers can also use the containerised guest drivers on NGC. |
| **Passthrough** | The NVIDIA **data center driver**, public from [nvidia.com/drivers][nv-drivers]. The 9.1 deep learning VM installs it automatically in passthrough mode (default version 580.95.05; in a disconnected environment the OVF parameter `gpu-driver-url` points it to your own copy) ([PAIF 9.1][paif-pdf]). |
| **VKS clusters** | The **NVIDIA GPU Operator**, compatible with the cluster's Kubernetes version and the host driver ([PAIF 9.1][paif-pdf]). |

---

## 10. Validate

- [ ] Every GPU host is on the GPU image and **compliant** in vSphere
      Lifecycle Manager (no drift from the cluster image).
- [ ] `nvidia-smi` on each host lists every GPU (vGPU hosts; it ships with the
      host driver).
- [ ] *Configure → Hardware → Graphics* shows **Shared Direct** on every vGPU
      device; *DirectPath* shows the passthrough devices as configured.
- [ ] MIG mode matches the plan per GPU (`nvidia-smi -i <gpu_id>`).
- [ ] `vgpu.hotmigrate.enabled` is set on the workload domain vCenter, and a
      test vGPU VM vMotions between two GPU hosts.
- [ ] A test VM with a vGPU profile powers on, runs `nvidia-smi` in the guest,
      and gets a licence from the NVIDIA License System.
- [ ] GPU metrics appear in vCenter and VCF Operations.

---

## Not covered here

- **Advanced NIC passthrough** (Enhanced DirectPath I/O and Uniform
  Passthrough for NVIDIA ConnectX-6 DX / ConnectX-7 / BlueField-3, GPUDirect
  RDMA). Those clusters are added by hand to a dedicated vDS and transport node
  profile; with such hosts as the first cluster, the workload domain must be
  created **without** an initial cluster ([PAIF 9.1][paif-pdf]).
- **Device groups** (NVLink / NVSwitch GPUs presented as one unit) and HGX
  platforms.
- Everything above the hosts: VM classes, deep learning VMs, VKS GPU clusters,
  Private AI Services, VCF Automation catalog items — see the
  [Private AI Foundation docs][paif].

---

## References

**Broadcom:**
[VMware Private AI Foundation with NVIDIA 9.1 (PDF)][paif-pdf] ·
[Private AI Foundation 9.x docs][paif] ·
[Requirements for Deploying Private AI Foundation][paif-req] ·
[Configure NVIDIA vGPU or GPU Passthrough on the ESX Hosts][paif-gpu] ·
[Managing vSphere Lifecycle Manager Images for VCF (9.1)][td-images] ·
[Import a vSphere Lifecycle Manager Image to a VCF Instance (9.1)][td-import] ·
[vSphere 9.1 — Working with Image Library][td-imagelib] ·
[KB 425993][kb425993] ·
[KB 367541 — Installing and configuring the NVIDIA VIB on ESXi][kb367541] ·
[Broadcom Compatibility Guide][bcg] ·
[VCF 9.1 is an NVIDIA-Certified Hypervisor (VCF blog, 2026-08-27)](https://blogs.vmware.com/cloud-foundation/2026/08/27/vcf-achieves-nvidia-hypervisor_certification/)

**NVIDIA:**
[vGPU support matrix — VMware vSphere (latest)][nv-matrix] ·
[19.x matrix][nv-19] ·
[18.x release notes (archived)][nv-18] ·
[vGPU updates by release][nv-whatsnew] ·
[Getting NVIDIA vGPU Software][nv-get] ·
[vGPU evaluation][nv-eval] ·
[NVIDIA License System][nv-ls] ·
[Client licensing — introduction][nv-lic-intro] ·
[Client licensing — configuring a licensed client][nv-lic-client] ·
[NVAIE VMware deployment — software][nvaie-vmware] ·
[NGC — Virtual GPU Manager][ngc-vgm] ·
[MIG User Guide][nv-mig] ·
[Public driver downloads][nv-drivers]

[paif]: https://techdocs.broadcom.com/us/en/vmware-cis/private-ai/foundation-with-nvidia/9-0/private-ai-foundation-9-x.html
[paif-pdf]: https://techdocs.broadcom.com/content/dam/broadcom/techdocs/us/en/pdf/vmware/private-ai/private-ai-nvidia/vmware-private-ai-foundation-with-nvidia-9-1.pdf
[paif-req]: https://techdocs.broadcom.com/us/en/vmware-cis/private-ai/foundation-with-nvidia/9-0/private-ai-foundation-9-x/deploying-private-ai-foundation-with-nvidia/requirements-for-deploying-private-ai-foundation-with-nvidia.html
[paif-gpu]: https://techdocs.broadcom.com/us/en/vmware-cis/private-ai/foundation-with-nvidia/9-0/private-ai-foundation-9-x/deploying-private-ai-foundation-with-nvidia/configure-nvidia-vgpu-or-gpu-passthrough-on-the-esx-hosts.html
[td-images]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/lifecycle-management/lifecycle-management-of-vcf-components/managing-vsphere-lifecycle-manager-images-for-vmware-cloud-foundation.html
[td-import]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/lifecycle-management/lifecycle-management-of-vcf-components/managing-vsphere-lifecycle-manager-images-for-vmware-cloud-foundation/import-a-vsphere-lifecycle-manager-image-to-a-vcf-instance.html
[td-imagelib]: https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/9-1/managing-host-and-cluster-lifecycle/working-with-image-library.html
[kb425993]: https://knowledge.broadcom.com/external/article/425993
[kb367541]: https://knowledge.broadcom.com/external/article/367541/installing-and-configuring-the-nvidia-vi.html
[bcg]: https://compatibilityguide.broadcom.com/
[bcg-l40s]: https://compatibilityguide.broadcom.com/detail?program=gpu&productId=39&persona=live
[nv-matrix]: https://docs.nvidia.com/vgpu/latest/product-support-matrix/vmware-vsphere.html
[nv-19]: https://docs.nvidia.com/vgpu/19.0/product-support-matrix/vmware-vsphere.html
[nv-18]: https://archive.docs.nvidia.com/vgpu/18.0/grid-vgpu-release-notes-vmware-vsphere/index.html
[nv-whatsnew]: https://docs.nvidia.com/vgpu/latest/whats-new-vgpu/release-notes.html
[nv-get]: https://docs.nvidia.com/vgpu/latest/grid-software-quick-start-guide/getting-your-nvidia-grid-software.html
[nv-hub]: http://nvid.nvidia.com/dashboard/
[nv-eval]: https://www.nvidia.com/en-us/data-center/resources/vgpu-evaluation/
[nv-ls]: https://docs.nvidia.com/license-system/latest/
[nv-lic-intro]: https://docs.nvidia.com/vgpu/latest/grid-licensing-user-guide/intro-to-grid-licensing.html
[nv-lic-client]: https://docs.nvidia.com/vgpu/latest/grid-licensing-user-guide/configuring-nls-licensed-client.html
[nvaie-vmware]: https://docs.nvidia.com/ai-enterprise/deployment/vmware/latest/software.html
[ngc]: https://catalog.ngc.nvidia.com/
[ngc-vgm]: https://catalog.ngc.nvidia.com/orgs/nvidia/vgpu/resources/virtual-gpu-manager-8/-
[nv-mig]: https://docs.nvidia.com/datacenter/tesla/mig-user-guide/
[nv-drivers]: https://www.nvidia.com/en-us/drivers/
