# Private AI Foundation — Connected-Site Runbook

The checklist-style companion to [`33-private-ai-foundation.md`](33-private-ai-foundation.md)
for a site **with internet access**. A connected build pulls most artifacts
straight from Broadcom and NVIDIA, so there is little to stage: the work is the
**order**, the **tokens** and the **settings** that are easy to miss. For a
disconnected site use [`36-paif-dark-site-walkthrough.md`](36-paif-dark-site-walkthrough.md);
the install and activation of Private AI Services in
[§6](#6-install-private-ai-services-the-supervisor-service) below is shared by both.

> **Evidence level:** from the [*VMware Private AI Foundation with NVIDIA 9.1*][paif-pdf]
> PDF (read 2026-10-30). **Not run on a build in this repo yet.**

Prerequisite for everything: the GPU hosts and the GPU workload domain with a
Supervisor ([`32-gpu-hosts.md`](32-gpu-hosts.md)).

---

## Order of work

| # | Task | Owner | Done when |
| --- | --- | --- | --- |
| 1 | [Collect tokens and keys](#1-collect-tokens-and-keys) | Platform + NVIDIA licence owner | All four items in hand |
| 2 | [Licence service and client token](#2-nvidia-licence-service) | Platform | Client configuration token generated |
| 3 | [VM classes](#3-vm-classes) | VI admin | Reserved VM classes exist per zone |
| 4 | [VCF Automation organization](#4-vcf-automation-organization) | VI + org admin | Namespace exists in a project |
| 5 | [Quickstart](#5-run-the-quickstart) | Org admin | Four catalog items visible |
| 6 | [Private AI Services](#6-install-private-ai-services-the-supervisor-service) | VI admin | Service installed and activated in a namespace |

Tasks 3 and 4 depend on the Supervisor; 2 and 1 can start on day one.

---

## 1. Collect tokens and keys

| Item | Where from | Needed for |
| --- | --- | --- |
| **NVIDIA client configuration token** | Your NVIDIA License Service instance ([`33` §2](33-private-ai-foundation.md#2-nvidia-licensing-and-access)) | Quickstart, deep learning VMs, GPU Operator |
| **NGC API key** | NVIDIA NGC ([API keys][ngc-keys]) | Pulling NVIDIA AI Enterprise containers |
| **Broadcom registry token** | Support Portal → *My Downloads* → *Registry Tokens* → *Generate Token* | Installing Private AI Services from `pais-docker.packages.broadcom.com` |
| **Deep learning VM library URL** | `https://dl.broadcom.com/<download_token>/PROD/COMP/DLVM/<version>/lib.json` (no authentication) | Content library, [task 4](#4-vcf-automation-organization) |

---

## 2. NVIDIA licence service

For **vGPU** only (passthrough needs no NVIDIA licence). On the NVIDIA Licensing
Portal, configure a **License Service instance** and generate the **client
configuration token** ([NVIDIA License System docs][nv-ls]). Keep the token
somewhere the org admin can reach it: the Quickstart asks for it.

---

## 3. VM classes

Details and rationale: [`33` §3](33-private-ai-foundation.md#3-the-workload-domain-hosts-and-vm-classes).
The sequence:

1. **DirectPath Profile** for the GPU on the workload domain vCenter (*Policies and
   Profiles → DirectPath Profiles → Create*), for classes with GPU reservation.
2. **Create the VM classes** from *Private AI Foundation → Set Up Environment →
   Create VM classes with NVIDIA vGPUs*: **full memory reservation**, and the
   same non-zero reservation and limit for CPU and memory when reserving a GPU.
3. **Reserve** them per zone (*Supervisor Management → Supervisor → Zones → Add
   Reserved VM Class*), leaving **failover capacity** unreserved.

---

## 4. VCF Automation organization

Base tenant setup: [`17-vcfa-tenant-config.md`](17-vcfa-tenant-config.md). On top
of it, in order ([PAIF 9.1][paif-pdf]):

1. **Check prerequisites:** zones **Ready**, the Supervisor's NSX Manager
   registered, an **All Apps** organization with a region quota in the GPU zone,
   VPC networking with the three IP ranges, *create subscribed content libraries*
   enabled.
2. **Content library for deep learning VMs** in the organization, subscribed to
   the URL from [task 1](#1-collect-tokens-and-keys).
3. **Region quota:** per zone, finite CPU/memory limits and reservations, the
   non-reserved VM and storage classes, and the **reserved VM classes with
   counts** (counts must fit the zone's Supervisor capacity).
4. **Namespace class** (CLI-created in the PDF's example): a
   `SupervisorNamespaceClass` and a `SupervisorNamespaceClassConfig` carrying
   `contentSources` (the library from step 2), `storageClasses`, `vmClasses` and
   per-`zones` limits, reservations and `vmClassReservations`. One namespace
   class holds reserved **or** non-reserved GPU classes, not both. The PDF has a
   full example; use it as the template.
5. **Project**, then **namespace** in it (*Manage & Govern → Projects*): pick
   the namespace class, the region, at least one zone, a networking type.

VCF Automation refreshes inventory every 15 minutes; use *Refresh* on the vCenter
in Provider Management to force it.

---

## 5. Run the Quickstart

As **organization administrator**: *Overview → Private AI Foundation Quickstart →
Start*. You enter the project and namespace, the **client configuration token**,
optionally the Data Services Manager integration, and the content to add.

Result: **AI Workstation**, **Triton Inference Server**, **AI Kubernetes
Cluster**, **DSM Database**. Both the deep learning VM and VKS sides must be
prepared even if you plan to use one.

Afterwards ([`33` §8](33-private-ai-foundation.md#8-catalog-items-the-private-ai-foundation-quickstart)):
on **9.1.1** swap the `tkg-gpu-console` reference in the AI Kubernetes Cluster
blueprint for `deep-learning-container`; update the **GPU Operator** from the EOL
v25.3.1 to v26.3.1 ([KB 439984][kb439984]).

---

## 6. Install Private AI Services (the Supervisor Service)

*Shared with the dark-site build.* Prerequisites in
[`33` §9](33-private-ai-foundation.md#9-private-ai-services): Data Services
Manager, an OIDC provider, Harbor as the Supervisor's default container registry.
Install source (3.0):

| Where the package is | YAML to download | When |
| --- | --- | --- |
| **Software depot**, through a regional Harbor | `pais-3.0.0.yml` | **VCF 9.1.1, connected** |
| **`pais-docker.packages.broadcom.com`** | `pais-3.0.0-external.yaml` | 9.1.0 or 9.1.1, connected **or** disconnected |

Steps ([PAIF 9.1][paif-pdf], *Install Private AI Services on the Supervisors of
the Workload Domain*):

1. **Registry credentials on the Supervisor** (only when installing from
   `pais-docker.packages.broadcom.com`). In the **management** vCenter: *Supervisor
   Management →* the Supervisor → *Configure → Supervisor → Container Registries
   → Add Registry*:

   | Field | Connected | Disconnected |
   | --- | --- | --- |
   | Registry name | `pais-reg-credentials` | same |
   | Host URL | `pais-docker.packages.broadcom.com` | your Harbor URL |
   | Username | Support Portal login e-mail | Harbor username |
   | Password | Broadcom registry token | Harbor password |

   The PDF gives the password for both cases as *your OCI registry access
   token*; for a Harbor registry that means the Harbor credential.

   When installing 3.0 from the depot, skip this: the regional Harbor connected
   to the depot must hold the package in its `vcf` project **and** be the
   Supervisor's default container registry.
2. *Private AI Foundation → Set Up Environment → Start → Install the Supervisor
   Service for Private AI Services → Start*.
3. Select the **workload domain**, **upload the YAML**, then choose the
   **service version** and the Supervisor. **Connected:** leave *YAML Service
   Config* empty. **Disconnected:** paste the content of the `yaml-svc-cfg.yaml`
   produced by the artifact mirroring tool, and use the `pais` YAML the tool
   created.
4. **Activate per namespace** (VCF Automation UI, or `kubectl`). Before you do:
   the namespace needs a VM class and storage policy for the control plane of the
   VKS cluster that runs model endpoints (no GPU needed there); a PostgreSQL
   database with pgvector if you use knowledge bases or agents (Data Services
   Manager creates it with the extension; third-party works if `pgvector` is
   installed) plus its CA certificate; OIDC issuer details; and an FQDN if your
   organisation requires one.

Manage the service later from *Supervisor Management → Services → Private AI
Services*.

---

## References

[VMware Private AI Foundation with NVIDIA 9.1 (PDF)][paif-pdf] ·
[NVIDIA License System][nv-ls] ·
[NGC API keys][ngc-keys] ·
[KB 439984][kb439984] ·
[`33-private-ai-foundation.md`](33-private-ai-foundation.md) ·
[`36-paif-dark-site-walkthrough.md`](36-paif-dark-site-walkthrough.md) ·
[`17-vcfa-tenant-config.md`](17-vcfa-tenant-config.md)

[paif-pdf]: https://techdocs.broadcom.com/content/dam/broadcom/techdocs/us/en/pdf/vmware/private-ai/private-ai-nvidia/vmware-private-ai-foundation-with-nvidia-9-1.pdf
[nv-ls]: https://docs.nvidia.com/license-system/latest/
[ngc-keys]: https://docs.nvidia.com/ngc/gpu-cloud/ngc-user-guide/index.html#ngc-api-keys
[kb439984]: https://knowledge.broadcom.com/external/article/439984
