# Private AI Foundation (PAIF) — Setup Guide, Connected and Dark Site

This guide covers **VMware Private AI Foundation with NVIDIA** on **VCF 9.1**
above the GPU hosts: the licensing and NVIDIA services, VM classes, content
libraries, the VCF Automation organization, the Harbor registry, the catalog
items, and Private AI Services. It treats the **disconnected (dark-site)**
variant as a first-class path, because that is where most of the work is:
every artifact a connected site pulls from the internet has to be staged
locally, each with its own source, landing place and owner.

Start with [`32-gpu-hosts.md`](32-gpu-hosts.md): the GPU hosts, the NVIDIA host
driver in the vLCM image, and the per-host GPU configuration are prerequisites
for everything here.

> **Evidence level:** sourced from the
> [*VMware Private AI Foundation with NVIDIA 9.1*][paif-pdf] PDF (generated
> 2026-09-21; covers PAIF 9.1 of 2026-05-12 and 9.1.1 of 2026-09-03, and
> Private AI Services 2.1 and 3.0). **Not lab- or field-verified in this repo
> yet.** Private AI Services and the deep learning VM image ship on their own
> cadence, separately from VCF, so check their release notes for the versions
> you install.

---

## The sequence, end to end

Broadcom publishes the setup as two workflows — one for **deep learning VMs and
VKS clusters with GPU**, one for **Private AI Services** — each in a connected
and a disconnected variant ([setup workflows][td-workflows],
[Private AI Services workflows][td-workflows-pais]). Combined, in order:

| # | Step | Connected | Disconnected |
| --- | --- | --- | --- |
| 1 | [Decide the scope](#1-decide-the-scope) | ✓ | ✓ |
| 2 | [NVIDIA licensing and access](#2-nvidia-licensing-and-access) — licence service, client token, NGC API key (vGPU) | Cloud License Service | **DLS appliance** on site |
| 3 | [GPU workload domain, hosts, VM classes](#3-the-workload-domain-hosts-and-vm-classes) | ✓ | ✓ |
| 4 | [Bastion and admin hosts](#41-bastion-and-admin-hosts) | — | ✓ |
| 5 | [Content libraries](#5-content-libraries) — VKr (Ubuntu) and deep learning VM images | Subscribed | **Local / depot-backed** |
| 6 | [VCF Automation organization](#6-vcf-automation-organization) — region, quota, namespace | ✓ | ✓ |
| 7 | [Platform Harbor registry](#7-platform-harbor-registry) | For model galleries (Private AI Services) | **Required** |
| 8 | [Stage the artifacts](#4-dark-site-staging-infrastructure-and-artifacts) — mirror into Harbor, Ubuntu mirror, driver web server | — | ✓ |
| 9 | [Catalog items — the Private AI Foundation Quickstart](#8-catalog-items-the-private-ai-foundation-quickstart) | ✓ | ✓ |
| 10 | [Private AI Services](#9-private-ai-services) (if used) — Data Services Manager, OIDC, install, activate | ✓ | ✓ + artifact mirroring |

---

## 1. Decide the scope

Answer these before anything is ordered; each one changes the work list.

| Decision | Options | What it changes |
| --- | --- | --- |
| **Workloads** | Deep learning VMs · VKS clusters with GPU · Private AI Services | Private AI Services adds Data Services Manager, an OIDC provider and its own install ([§9](#9-private-ai-services)). **The Quickstart needs both** deep learning VMs **and** VKS prepared — [PAIF 9.1][paif-pdf]: *"When you run the Private AI Foundation Quickstart in VCF Automation, you must prepare the environment for both AI workload platform models ... although you might plan to apply only one of them."* |
| **Connectivity** | Connected · Disconnected (air-gapped) | Disconnected adds the bastion/admin hosts, DLS, local Harbor, the Ubuntu mirror, a driver web server and artifact mirroring ([§4](#4-dark-site-staging-infrastructure-and-artifacts)). |
| **Compute model** | vGPU · GPU passthrough · CPU-only (Private AI Services on llama.cpp) | vGPU brings NVAIE, the licence service and the vGPU guest drivers. CPU-only skips the GPU parts but still needs VM classes with enough CPU. |
| **Private AI Services version** | 2.1 (the 9.1.0 version) · 3.0 (2026-09-03, with 9.1.1) | 3.0 installs from the VCF software depot or Broadcom's registry, takes multiple OIDC providers, and makes VCF Automation optional. 2.1 needs VCF Automation for its UI and Data Services Manager always ([§9](#9-private-ai-services)). |
| **VCF Automation** | Deployed · not deployed | The catalog-item path (Quickstart) and Private AI Services 2.1's UI need it. Without it, Harbor is deployed as a Supervisor Service instead ([§7](#7-platform-harbor-registry)). |

The GPU workload domain itself always carries a **Supervisor**: the PAIF
guided workflow deploys the domain with *"The vSphere Supervisor option is
mandatory"* ([PAIF 9.1][paif-pdf]), and VKS clusters, VCF Automation
namespaces and Private AI Services all run on it.

---

## 2. NVIDIA licensing and access

Needed for **vGPU** (passthrough needs no NVIDIA licence, [`32` §2](32-gpu-hosts.md#2-line-up-the-licences)).

| Item | Connected | Disconnected |
| --- | --- | --- |
| **Licence service** | A **License Service instance** configured on the NVIDIA Licensing Portal (cloud-hosted). | An **NVIDIA Delegated License Service (DLS)** virtual appliance, registered on the NVIDIA Licensing Portal, with a licence server bound and installed on it. *"You can deploy the virtual appliance in the same workload domain as the AI workloads or in the management domain"* ([PAIF 9.1][paif-pdf]). |
| **Client configuration token** | Generated from the service instance; goes into the deep learning VMs, the GPU Operator on VKS clusters, and the Quickstart. | Same, from the DLS instance. |
| **NGC API key** | For pulling NVIDIA AI Enterprise containers from the NGC catalog. | Still needed — used on the **bastion host** to pull what gets mirrored. |

Give the DLS appliance an owner, an IP/FQDN and a backup like any other
appliance: on a dark site every vGPU workload depends on it. NVIDIA's
[License System docs][nv-ls] cover its deployment.

---

## 3. The workload domain, hosts and VM classes

1. **GPU workload domain with a Supervisor, and the GPU hosts** —
   [`32-gpu-hosts.md`](32-gpu-hosts.md) end to end, plus the licence, SSO and
   vCenter Linking steps in [`32` §2](32-gpu-hosts.md#gpus-for-vms-or-private-ai-foundation).
2. **Optional: Advanced NIC Passthrough** clusters (ConnectX / BlueField,
   GPUDirect RDMA) — not covered here; see [PAIF 9.1][paif-pdf].
3. **VM classes** ([TechDocs][td-vmclass]), in the vSphere Client of the
   management vCenter:
   - For classes **with GPU reservation**, first create a **DirectPath
     Profile** for the GPU device on the workload domain vCenter (*Policies
     and Profiles → DirectPath Profiles → Create*).
   - Create the VM classes from *Private AI Foundation → Set Up Environment →
     Create VM classes with NVIDIA vGPUs*: the vGPU or passthrough profile as a
     PCI device; for GPU reservation, *"the same non-zero values for reservation
     and limit"* for CPU and memory. AI/ML VM classes need **full memory
     reservation**.
   - Passthrough GPUs that map more than 16 GB: set
     `pciPassthru.use64bitMMIO = true` and size
     `pciPassthru.use64bitMMIOSizeGB` (TechDocs' example: two 40 GB A100s →
     80 GB → round up to 128 → then 256).
   - **Reserve** VM classes per zone (*Supervisor Management → Supervisor →
     Zones → Add Reserved VM Class*); VCF Automation hands these out to
     organizations later.
   - **Leave failover capacity unreserved.** TechDocs: *"in a 16-host cluster,
     ensure that one host always serves as a dedicated failover host and the
     remaining hosts handle zonal GPU reservations without exceeding the
     capacity of 14 hosts."*
   - **Group GPUs of the same type per cluster** (for example H100 in one
     cluster, L40 in another): a namespace with GPU reservations must use
     reserved VM classes *"of the same type and ... on the same cluster"*.
   - For Private AI Services on CPU (llama.cpp), make sure the VM class has
     enough CPU.

---

## 4. Dark site: staging infrastructure and artifacts

*Disconnected only.* Skip to [§5](#5-content-libraries) for a connected site.

### 4.1 Bastion and admin hosts

[PAIF 9.1][paif-pdf] defines three machines:

| Host | Where | Needs |
| --- | --- | --- |
| **Bastion** | Internet access (or a download path) — *"usually running Linux"* | Docker, Helm, VCF Consumption CLI; the NGC API key; downloads everything below |
| **Admin** | **Inside** the air gap, *"connected to all the hosts in the environment"* — vCenter for the workload domain, the Supervisor, the local registry | Docker, VCF Consumption CLI, kubectl (and `oras` for the Ubuntu index file) |
| **Jump host** | End-user access to the UIs | — |

*"The admin host and the bastion host run the same Linux OS image, usually
Ubuntu."* One machine can do both jobs, *"for example, if the machine is a
server in a DMZ with access to the Internet and temporary access to the
isolated environment over a firewall."* With two machines, the `.tar` bundles
are carried across by hand. If you already built these for the Supervisor
([`20-supervisor-image-registry.md` §4.1](20-supervisor-image-registry.md#41-two-hosts-and-the-tooling)),
reuse them.

### 4.2 What has to be staged, and where

Captured from [PAIF 9.1][paif-pdf] (*Deployment Artifacts* sections):

| Artifact | Source | Lands in | How |
| --- | --- | --- | --- |
| **VKr images** (Ubuntu edition) | VKr content library in the VCF **software depot** (offline / disconnected mode, filled by the VCF Download Tool) | Subscribed content library in vCenter | [§5](#5-content-libraries) |
| **Deep learning VM image (`.ova`)** | Broadcom Support Portal, *VMware Private AI* area | Local content library in the VCF Automation org | [§5](#5-content-libraries) |
| **NVIDIA DL workload containers** (PyTorch, TensorFlow, CUDA Sample, Triton, DCGM Exporter) | NVIDIA NGC catalog | Platform Harbor | Resource mirroring utility, [KB 388470][kb388470] |
| **NVIDIA GPU Operator** Helm chart + images (vGPU / data center driver, device manager, DCGM exporter, MIG plugin, NFD, `tkg-gpu-console` / `deep-learning-container`) | NGC catalog, Broadcom Artifactory | Platform Harbor | Resource mirroring utility, [KB 388470][kb388470] |
| **vGPU guest driver / data center driver `.run`** (for deep learning VMs) | NVIDIA Licensing Portal | **Web server**, with an index file for vGPU | Manual, [§4.4](#44-the-driver-web-server) |
| **Ubuntu package repository** | `archive.ubuntu.com` | **Web server** (≥ 800 GB), index file pushed to Harbor | Manual, [§4.3](#43-ubuntu-package-mirror) |
| **Private AI Services** package, inference engines (llama.cpp, vLLM, Infinity), its GPU Operator package | Broadcom Artifactory (`pais-docker.packages.broadcom.com`, `packages.broadcom.com`), NGC (`helm.ngc.nvidia.com`, `nvcr.io`) | Platform Harbor (~40 GB for the Private AI Services artifacts) | Artifact mirroring tool (AMT), [§9](#9-private-ai-services) |

Put an **owner** against each row, and a **refresh routine**: guest drivers,
GPU Operator versions, DL containers and the Ubuntu mirror all move on their
own schedules, and on a dark site nothing updates by itself.

### 4.2a Plan the outside staging first — it is the hard part

> **Field note:** on dark-site builds, the hardest part wasn't any one
> install step. It was **getting the images inside**. Everything has to be
> prepared **outside** first, so you need somewhere to **host it** there, and
> it is **a lot of data**.

Broadcom's docs say *what* to stage, but not how big it gets or where it sits
before it crosses the gap. Plan that as its own work item, before the build
starts:

- **An outside staging location with real capacity.** The bastion (or a file
  server next to it) has to hold everything in the table above **at the same
  time**: the Ubuntu mirror alone is **≥ 800 GB**, the Private AI Services
  artifacts **~40 GB** ([PAIF 9.1][paif-pdf]), plus the GPU Operator and NGC
  DL workload containers, the deep learning VM `.ova`, the VKr images and any
  models. Broadcom gives no totals for the containers and models, so measure
  your own set on the bastion. Add headroom for the next refresh, which you
  download while the current set is still in use.
- **The same capacity again inside:** Harbor, the web server (Ubuntu mirror,
  drivers) and the content libraries each hold their copy.
- **A transfer path sized for the volume:** removable media, a data diode, or
  a temporary firewall opening to a DMZ host. Time a test transfer early: at
  hundreds of GB, this sets the schedule.
- **Download early, from the outside.** Licences, NGC keys, Support Portal and
  registry tokens all need to work on the bastion before the window opens.
- **Treat it as recurring.** Every driver, GPU Operator, container or Ubuntu
  update repeats the download → carry → push cycle.

### 4.3 Ubuntu package mirror

*"A local Ubuntu repository is required for compiling the vGPU or GPU data
center guest driver before installing it on the cluster nodes"* ([PAIF 9.1][paif-pdf]).

- **At least 800 GB** on the mirror machine, served by a web server that the
  VKS clusters with GPU can reach.
- An index file (`custom-repo.list`) pointing at the mirror — Ubuntu 22.04
  (`jammy`) or 24.04 (`noble`), `main universe` plus `-updates` and
  `-security`.
- For **GPU passthrough** only, the mirror *"can be a partial mirror with only
  the packages that are required for the NVIDIA GPU Operator driver
  compilation."*
- Push the index file into the Harbor project so VCF Automation deployments
  find it (`oras push <harbor>/<project>/resources/custom-repo.list:1.0
  custom-repo.list:text/plain`); with the catalog path the location is then
  *"discovered automatically"*. Share the mirror's address with DevOps
  engineers who provision VKS clusters with `kubectl`.
- See also NVIDIA's *Install NVIDIA GPU Operator in Air-Gapped Environments*.

### 4.4 The driver web server

For deep learning VMs, upload the drivers from the NVIDIA Licensing Portal to
a local web server ([PAIF 9.1][paif-pdf]):

- **vGPU guest drivers** as `.run` or `.zip`, plus an **index** — either a
  `.txt` list of *host driver version / guest driver URL* pairs, or a web
  server directory listing (then the files must be `.zip`). The index is
  *"required for deploying deep learning VMs using kubectl or directly on a
  vSphere cluster."*
- **Data center drivers** (passthrough) as `.run`; you give the URL directly.
  The deep learning VM's OVF parameter `gpu-driver-url` points it at your copy.

### 4.5 Mirror into Harbor

With the platform Harbor up ([§7](#7-platform-harbor-registry)) and a project
created for PAIF, run Broadcom's **resource mirroring utility**
([KB 388470][kb388470]) on the bastion to pull the GPU Operator and DL workload
images, carry the `.tar` files across, and push them into the Harbor project
from the admin host.

---

## 5. Content libraries

| Library | Connected | Disconnected |
| --- | --- | --- |
| **VKr (Kubernetes releases)** — must be the **Ubuntu** edition: *"Deploying NVIDIA-aware AI workloads on VKS clusters requires the use of the Ubuntu edition of vSphere Kubernetes releases."* | The standard subscribed VKr library | In the vSphere Client: *Private AI Foundation* → **Cloud disconnected** → *Set Up Environment*; create a **subscribed** library pointing at your own depot: `https://depot-fqdn/depot-service/content-gateway/PROD/COMP/VKR/lib.json`. Fill the depot with the VCF Download Tool ([`09-binary-depot.md`](09-binary-depot.md)). *Caution (TechDocs): "The VKr content library is used across all vSphere namespaces in the Supervisor."* |
| **Deep learning VM images** (created in the VCF Automation org, [§6](#6-vcf-automation-organization)) | Subscribed to `https://dl.broadcom.com/<download_token>/PROD/COMP/DLVM/<version>/lib.json` — no authentication | A **local** library; import the `.ova` from the Broadcom Support Portal (*VMware Private AI* area) |

Sources: [PAIF 9.1][paif-pdf], [VKr content library for disconnected][td-vkr].

---

## 6. VCF Automation organization

The base tenant setup — region, external IP block, connection, organization —
is [`17-vcfa-tenant-config.md`](17-vcfa-tenant-config.md). On top of it, PAIF
needs ([PAIF 9.1][paif-pdf], *Set Up Your VCF Automation Organization*):

- **Prerequisites to check first:** the Supervisor with GPUs; the VM classes
  from [§3](#3-the-workload-domain-hosts-and-vm-classes); the Supervisor's NSX
  Manager registered in VCF Automation; zones **Ready** in Provider Management;
  an **All Apps** organization with a region quota in the GPU zone; **VPC
  networking** for the organization with a public IP range, a transit gateway
  IP range and a VPC private IP range; *create subscribed content libraries*
  enabled for the organization; optionally the Data Services Manager
  Consumption Operator and its VCF Automation plug-in.
- **Region** (*Infrastructure → Regions*): one NSX Manager per region; storage
  classes must exist with **the same names** on every vCenter in the region.
- **Region quota** for the organization: per zone, finite CPU and memory limits
  and reservations (*"You cannot assign unlimited resources"*; reservations
  can't be over-provisioned); the non-reserved VM classes and storage classes;
  and the **reserved VM classes** with their counts. Those counts *"must fit the
  capacity of that zone on the supervisor, and not the aggregated capacity of
  the zone."*
- **Project + namespace** for PAIF, on a namespace class and a VPC, in at least
  one zone. A namespace class can hold non-reserved **or** reserved GPU VM
  classes, **not both** — mixing them makes VCF Automation treat it as reserved
  and requests with the non-reserved class fail.
- **The deep learning VM content library** ([§5](#5-content-libraries)).
- VCF Automation refreshes this inventory every 15 minutes; *Refresh* on the
  vCenter in Provider Management forces it.

---

## 7. Platform Harbor registry

A Harbor registry holds the model galleries for Private AI Services (connected
**and** disconnected) and, on a dark site, every container artifact from
[§4.2](#42-what-has-to-be-staged-and-where) ([PAIF 9.1][paif-pdf]):

| Your situation | How Harbor is deployed |
| --- | --- |
| **VCF 9.1 with VCF Automation** | The pre-built **Harbor service** in VCF Automation Provider Management (*Install Regional Harbor*). It pulls Supervisor Service packages and images from the VCF software depot automatically. |
| **9.1.0 without VCF Automation** | The Harbor **Supervisor Service**, bootstrapped: connected, from Broadcom Artifactory with the manifests from the Support Portal; disconnected, from a **bootstrap registry** holding the Carvel packages, with the manifests edited to point at it. |
| **9.1.1 without VCF Automation** | The Harbor Supervisor Service **from the software depot** (*Deploying VKS in Air-Gapped Environments*). |

Then:

- Size the storage for everything in [§4.2](#42-what-has-to-be-staged-and-where),
  plus the **models** for Private AI Services endpoints and any custom
  inference engine.
- Create the **projects** (PAIF artifacts; Private AI Services; on 9.1.1 a
  **public** project for `deep-learning-container`, needed even when connected).
- Create a **robot account** for pulling from the model galleries.
- Trust Harbor's CA on the Supervisor / VKS side
  ([`20-supervisor-image-registry.md`](20-supervisor-image-registry.md#48-harbor-for-user-images-only-if-you-need-one)).

This is a **user/platform** registry. Supervisor and VKS **system** images
come from the depot's own OCI registry in 9.1
([`20` §4](20-supervisor-image-registry.md#4-c-air-gapped-path--walkthrough)).

---

## 8. Catalog items: the Private AI Foundation Quickstart

In the VCF Automation organization, as organization administrator: *Overview →
Private AI Foundation Quickstart → Start*. It asks for the project and
namespace, the **NVIDIA client configuration token**, optionally the Data
Services Manager integration, and the content to add, and creates four catalog
items: **AI Workstation** (deep learning VM), **Triton Inference Server**,
**AI Kubernetes Cluster** (VKS with GPU workers) and **DSM Database**
(pgvector) ([PAIF 9.1][paif-pdf]).

- Run it again to add another Supervisor, a new licence token or licence
  server, a new guest-driver URL or **local registry** (dark site), a new deep
  learning VM image, other VM classes, or a proxy change. Each run adds items
  next to the old ones.
- **VCF 9.1.1:** after the Quickstart, *"replace the reference to
  tkg-gpu-console image in the AI Kubernetes Cluster blueprint, with a
  reference to deep-learning-container"*. Needs the public Harbor project from
  [§7](#7-platform-harbor-registry), and on a connected site a machine with
  Docker.
- **GPU Operator v25.3.1** (the 9.0 / 9.1.0 blueprint default) **has reached
  end-of-life**; update the blueprint to **v26.3.1** ([KB 439984][kb439984]).
- The **NVIDIA RAG** catalog items were removed in 9.1.

---

## 9. Private AI Services

Model runtime and API gateway (vLLM, Infinity, llama.cpp), data indexing and
retrieval, an MCP tool gallery, an agent builder and observability, run as a
**Supervisor Service** ([Private AI Services release notes][paif-pdf]).

**Before installing:**

- **Data Services Manager** — *"You deploy a VMware Data Services Manager
  instance in the management domain"*, install its Consumption Operator as a
  Supervisor Service, and give it at least one infrastructure policy. Required
  for **2.1**; for **3.0** only *"if you use knowledge bases and agents"*. A
  pgvector platform from another vendor also works.
- **An OIDC provider** (Authorization Code with PKCE, OIDC Discovery): an
  external one, or VCF Automation; local accounts only for a proof of concept.
  **Not VCF SSO:** *"Connecting Private AI Services directly to VCF Single
  Sign-on and identity broker is not supported because the two entities are
  connected to different networks."* 3.0 takes multiple providers per
  namespace; 2.1 only one.
- **Harbor** as the Supervisor's **default container registry** — the regional
  Harbor connected to the depot (3.0 from the depot on 9.1.1), or the platform
  Harbor added manually (3.0 from Broadcom's registry).

**Install source:**

- **3.0** — from the VCF software depot through the regional Harbor
  (`pais-3.0.0.yml`, VCF 9.1.1, connected) or from
  `pais-docker.packages.broadcom.com` (`pais-3.0.0-external.yaml`).
  **Disconnected: use the separately distributed package** — *"For disconnected
  environments, use the option where Private AI Services is separately
  distributed."*
- **2.1** — from `pais-docker.packages.broadcom.com` only.
- Broadcom's registries need a **registry token** (Support Portal → *My
  Downloads → Registry Tokens*), added to the Supervisor before installing.

**Dark site extra:** an Ubuntu mirror + index file ([§4.3](#43-ubuntu-package-mirror)),
a Harbor project with **~40 GB**, VCF Consumption CLI and Docker on the
bastion and admin hosts, then the **artifact mirroring tool (AMT)** to carry
the Private AI Services package, the inference engines and its GPU Operator
package into Harbor. The AMT pulls from `pais-docker.packages.broadcom.com`,
`packages.broadcom.com`, `helm.ngc.nvidia.com`, `nvcr.io` and
`archive.ubuntu.com` — the bastion's allowlist. The vGPU variant of the GPU
Operator package needs an NVAIE licence.

**Then:** install the Supervisor Service on the GPU workload domain's
Supervisors, and activate Private AI Services per organization namespace (in
the VCF Automation UI or with `kubectl`). Private AI Services can be updated
without updating VCF.

---

## 10. Version notes

| Item | Value | Source |
| --- | --- | --- |
| PAIF 9.1 / 9.1.1 | 2026-05-12 / 2026-09-03 | [PAIF 9.1][paif-pdf] release notes |
| Private AI Services | 2.1 (2026-03-20, 2026-05-12) · **3.0 (2026-09-03)** | Private AI Services release notes |
| Data Services Manager | 9.1.x for VCF 9.1.0 and 9.1.1 | PAIF compatibility table |
| Deep learning VM for 9.1 | Ubuntu 24.04; vGPU host drivers NVAIE 7.x (580.x) and 8.0 (595.58.02) | DLVM release notes |
| Deep learning VM for 9.1.1 | Ubuntu 26.04; NVAIE 8.0 and later (595.x) | DLVM release notes |
| GPU Operator in the AI Kubernetes Cluster blueprint | v25.3.1 is EOL → v26.3.1 | [KB 439984][kb439984] |

---

## References

**Broadcom:**
[VMware Private AI Foundation with NVIDIA 9.1 (PDF)][paif-pdf] ·
[PAIF 9.x docs][paif] ·
[Setup workflows — deep learning VMs and VKS][td-workflows] ·
[Setup workflows — Private AI Services][td-workflows-pais] ·
[Configure VM classes for AI workloads][td-vmclass] ·
[Content library with Ubuntu VKr (disconnected)][td-vkr] ·
[Local Harbor registry for PAIF][td-harbor] ·
[Setting up VCF Automation for PAIF][td-vcfa] ·
[Installing and configuring Private AI Services][td-pais] ·
[KB 388470 — resource mirroring utility][kb388470] ·
[KB 439984 — GPU Operator in the AI Kubernetes Cluster blueprint][kb439984]

**NVIDIA:**
[NVIDIA License System (DLS / CLS)][nv-ls] ·
[GPU Operator — air-gapped installs](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/install-gpu-operator-air-gapped.html)

**This repo:**
[`32-gpu-hosts.md`](32-gpu-hosts.md) ·
[`09-binary-depot.md`](09-binary-depot.md) ·
[`17-vcfa-tenant-config.md`](17-vcfa-tenant-config.md) ·
[`20-supervisor-image-registry.md`](20-supervisor-image-registry.md)

[paif-pdf]: https://techdocs.broadcom.com/content/dam/broadcom/techdocs/us/en/pdf/vmware/private-ai/private-ai-nvidia/vmware-private-ai-foundation-with-nvidia-9-1.pdf
[paif]: https://techdocs.broadcom.com/us/en/vmware-cis/private-ai/foundation-with-nvidia/9-0/private-ai-foundation-9-x.html
[td-workflows]: https://techdocs.broadcom.com/us/en/vmware-cis/private-ai/foundation-with-nvidia/9-0/private-ai-foundation-9-x/deploying-private-ai-foundation-with-nvidia/setup-workflows.html
[td-workflows-pais]: https://techdocs.broadcom.com/us/en/vmware-cis/private-ai/foundation-with-nvidia/9-0/private-ai-foundation-9-x/deploying-private-ai-foundation-with-nvidia/setup-workflow-for-private-ai-services.html
[td-vmclass]: https://techdocs.broadcom.com/us/en/vmware-cis/private-ai/foundation-with-nvidia/9-0/private-ai-foundation-9-x/deploying-private-ai-foundation-with-nvidia/configure-vgpu-based-vm-classes-for-ai-workloads.html
[td-vkr]: https://techdocs.broadcom.com/us/en/vmware-cis/private-ai/foundation-with-nvidia/9-0/private-ai-foundation-9-x/deploying-private-ai-foundation-with-nvidia/create-a-content-library-with-ubuntu-tkr.html
[td-harbor]: https://techdocs.broadcom.com/us/en/vmware-cis/private-ai/foundation-with-nvidia/9-0/private-ai-foundation-9-x/deploying-private-ai-foundation-with-nvidia/enable-a-private-harbor-registry-in-paif.html
[td-vcfa]: https://techdocs.broadcom.com/us/en/vmware-cis/private-ai/foundation-with-nvidia/9-0/private-ai-foundation-9-x/deploying-private-ai-foundation-with-nvidia/setting-up-vcf-automation-for-private-ai-foundation-with-nvidia.html
[td-pais]: https://techdocs.broadcom.com/us/en/vmware-cis/private-ai/foundation-with-nvidia/9-0/private-ai-foundation-9-x/deploying-private-ai-foundation-with-nvidia/installing-and-configuring-private-ai-services.html
[kb388470]: https://knowledge.broadcom.com/external/article/388470
[kb439984]: https://knowledge.broadcom.com/external/article/439984
[nv-ls]: https://docs.nvidia.com/license-system/latest/
