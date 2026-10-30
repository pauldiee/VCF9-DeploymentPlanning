# Private AI Foundation — Dark-Site Build Walkthrough

The step-by-step companion to [`33-private-ai-foundation.md`](33-private-ai-foundation.md).
Guide 33 says **what** has to be staged and **why**; this page is the **order of
work and the commands** for a disconnected (air-gapped) build, from the bastion
host to the point where the Private AI Foundation Quickstart can run.

> **Evidence level:** commands and values are taken from the
> [*VMware Private AI Foundation with NVIDIA 9.1*][paif-pdf] PDF and
> [KB 388470][kb388470] (both read 2026-10-30). **Not run on a build in this
> repo yet.** Where a step is general practice rather than Broadcom's text, it
> says so.

Read [`33` §4](33-private-ai-foundation.md#4-dark-site-staging-infrastructure-and-artifacts)
first for the artifact list and the capacity planning. Everything below assumes
the GPU workload domain and Supervisor exist
([`32-gpu-hosts.md`](32-gpu-hosts.md), [`33` §3](33-private-ai-foundation.md#3-the-workload-domain-hosts-and-vm-classes)).

---

## The build at a glance

| Phase | What you end up with | Where you work |
| --- | --- | --- |
| [0. Prepare](#0-prepare-what-you-need-before-you-start) | Accounts, tokens, a capacity plan | Outside |
| [1. Hosts](#1-bastion-and-admin-hosts) | Bastion and admin host with the same tooling | Both |
| [2. Harbor](#2-harbor-the-platform-registry) | Platform Harbor, a project, a robot account | Inside |
| [3. Mirror containers](#3-mirror-the-gpu-operator-and-dl-workload-images) | GPU Operator + DL workload images in Harbor | Bastion → admin |
| [4. Ubuntu mirror](#4-ubuntu-package-mirror-and-index-file) | Package mirror + `custom-repo.list` in Harbor | Outside → inside |
| [5. Driver server](#5-vgpu-and-data-center-drivers) | Guest drivers + index file on a web server | Outside → inside |
| [6. VKr library](#6-vkr-content-library-ubuntu) | Ubuntu VKr images in a local content library | Inside |
| [7. Private AI Services](#7-private-ai-services-30-artifacts) | PAIS 3.0 package, engines, GPU Operator in Harbor | Bastion → admin |
| [8. Verify](#8-verify-before-the-quickstart) | A checklist that catches the common gaps | Inside |

Phases 3, 4, 5 and 7 are independent once phases 1 and 2 are done; run them in
parallel if the transfer path allows it.

---

## 0. Prepare: what you need before you start

Collect these **on the bastion side** before the window opens. A missing token
costs more time than any install step.

| Item | Where from | Used in |
| --- | --- | --- |
| **Broadcom Support Portal login** | [support.broadcom.com](https://support.broadcom.com) | Downloads, KB 388470 script |
| **Registry token** | Support Portal → *My Downloads* → *Registry Tokens* → *Generate Token* | `docker login` to `pais-docker.packages.broadcom.com` and `dlvm.packages.broadcom.com` |
| **NGC API key** with the **NVAIE entitlement** | NVIDIA NGC ([API keys][ngc-keys]) | Pulling from `nvcr.io` and `helm.ngc.nvidia.com` |
| **NVIDIA Licensing Portal access** | NVIDIA | Guest drivers; the DLS appliance ([`33` §2](33-private-ai-foundation.md#2-nvidia-licensing-and-access)) |
| **Harbor admin credentials** | Whoever runs the platform Harbor | Phases 2, 3, 7 |
| **A written list of what you will stage** | You | Capacity planning, [`33` §4.2a](33-private-ai-foundation.md#42a-plan-the-outside-staging-first--it-is-the-hard-part) |

Decide now which compute models you will offer. The GPU Operator comes in two
variants, **vGPU (`nvaie`)** and **GPU passthrough (`oss`)**
([PAIF 9.1][paif-pdf]); pulling only the one you use saves space.

---

## 1. Bastion and admin hosts

Roles and the single-machine shortcut are in [`33` §4.1](33-private-ai-foundation.md#41-bastion-and-admin-hosts).
Build both from the **same Ubuntu image** ([PAIF 9.1][paif-pdf]); if you already
built them for the Supervisor
([`20` §4.1](20-supervisor-image-registry.md#41-two-hosts-and-the-tooling)),
reuse them and only add what is missing.

**Minimum for the mirroring script** ([KB 388470][kb388470]): Ubuntu 22.04 or
24.04, 4 cores, 8 GB RAM, and **at least 180 GB free disk** with the default
`bom.json` (**+100 GB** if you set `PACK_CONTAINER=true`, see
[phase 3](#3-mirror-the-gpu-operator-and-dl-workload-images)).

| Tool | Bastion | Admin | Notes |
| --- | --- | --- | --- |
| Docker | ✓ | ✓ | KB 388470: **v27.5 or earlier**. Non-root use: [post-install steps][docker-post] |
| `jq`, `helm` | ✓ | ✓ | On `PATH` |
| VCF Consumption CLI + `pais` plug-in | ✓ | ✓ | Install below |
| `kubectl` | | ✓ | Admin host talks to the Supervisor |
| `oras` | | ✓ | Pushes the Ubuntu index file ([phase 4](#4-ubuntu-package-mirror-and-index-file)) |

**Install the VCF Consumption CLI and the `pais` plug-in** (apt method from
[KB 388470][kb388470], which labels it *"VCF 9.0.x only"*; for 9.1, PAIF 9.1
installs the CLI from the vSphere Client, *Download and Install the VCF
Consumption CLI from the vSphere Client*):

```bash
sudo apt update && sudo apt install -y ca-certificates curl gpg
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://packages.broadcom.com/artifactory/api/security/keypair/PackagesKey/public \
  | sudo gpg --dearmor -o /etc/apt/keyrings/vcf-archive-keyring.gpg
echo "deb [signed-by=/etc/apt/keyrings/vcf-archive-keyring.gpg] https://packages.broadcom.com/artifactory/vcfcli-debian noble main" \
  | sudo tee /etc/apt/sources.list.d/vcf.list
sudo apt update && sudo apt install -y vcf-cli
vcf plugin search                     # shows which pais versions exist
vcf plugin install pais --version v3.0.0   # match the PAIS version you install (§7)
vcf plugin list                       # pais should show "installed"
```

On the **admin host (inside the air gap)** the `apt` route is not available.
Install the CLI from the vSphere Client instead (the PAIF 9.1 route), or carry
the package across with the rest of the bundles. Broadcom does not describe a
fully offline CLI install for the `pais` plug-in; **confirm how you will get
`vcf pais` onto the admin host before the window**. Per PAIF 9.1 the `pais`
plug-in (which contains the artifact mirroring tool) is needed on **both** hosts.

If the bastion reaches the internet through a **proxy**, set `HTTP_PROXY`,
`HTTPS_PROXY`, `NO_PROXY` in the shell **and** give the Docker daemon a systemd
drop-in (`/etc/systemd/system/docker.service.d/proxy.conf`, then
`systemctl daemon-reload && systemctl restart docker`), exactly as
[KB 388470][kb388470] describes.

---

## 2. Harbor: the platform registry

Which Harbor route applies to you is the table in
[`33` §7](33-private-ai-foundation.md#7-platform-harbor-registry). In short:

| Your situation | Do this |
| --- | --- |
| VCF 9.1 **with** VCF Automation | VCF Automation Provider Management → install the **Harbor service** (*Install Regional Harbor*). It pulls Supervisor Service packages from the software depot by itself. |
| 9.1.1 **without** VCF Automation | Deploy the Harbor Supervisor Service **from the software depot** (*Deploying VKS in Air-Gapped Environments*). |
| 9.1.0 **without** VCF Automation | Deploy Harbor + Contour as Supervisor Services from a **bootstrap Harbor**: the Carvel packages sit in the bootstrap registry and the manifest YAMLs are edited to point at it. Written up in the 9.0 docs ([Local Harbor registry][td-harbor]). |

Then, with Harbor running ([PAIF 9.1][paif-pdf]):

1. **Create a project** for the PAIF resources (the Harbor administrator does
   this; [phases 3](#3-mirror-the-gpu-operator-and-dl-workload-images) and
   [7](#7-private-ai-services-30-artifacts) push into it). Use separate projects
   for the DL/GPU Operator images and for Private AI Services if you want to
   keep their lifecycles apart (general practice).
2. **Size it.** The KB 388470 script project needs **at least 180 GB free**;
   Private AI Services needs **40 GB**; add the models you will serve.
3. **Create a robot account** that can pull from the model galleries (needed for
   Private AI Services endpoints).
4. **On 9.1.1:** create a **public** project for `deep-learning-container`
   (needed even when connected, see [`33` §8](33-private-ai-foundation.md#8-catalog-items-the-private-ai-foundation-quickstart)).
5. **Trust Harbor's CA** on the Supervisor / VKS side
   ([`20` §4.8](20-supervisor-image-registry.md#48-harbor-for-user-images-only-if-you-need-one)).

**Check:** from the admin host, `docker login <harbor-fqdn>` succeeds, and you
can push a small test image to the project.

---

## 3. Mirror the GPU Operator and DL workload images

This is the *resource mirroring utility* of the PAIF docs: a shell script from
[KB 388470][kb388470]. It mirrors **container images, Helm charts and model
profiles** for deep learning VMs and VKS clusters with GPU.

1. **Download the zip that matches your VCF version** from the KB attachments
   (`vpaifn-airgap-res-mirror-9.1.x.zip` for 9.1). Unzip it. You get
   `vpaifn-airgap-res-mirror.sh`, `config.env` and BOM files.
2. **Pick the release.** The default `bom.json` is the **latest release in the
   series** (for 9.1.x that is **9.1.1**). To mirror an older release, overwrite
   `bom.json` with the matching `bom-<release>.json`. Broadcom warns that
   resources in older BOMs may have been **removed from the source registry**,
   so pulls can fail.
3. **Edit `config.env`:**

   | Variable | Value |
   | --- | --- |
   | `LOCAL_HARBOR_URI` | Harbor and project, e.g. `harbor.sfo.rainpole.io/paif-project` |
   | `LOCAL_HARBOR_USERNAME` / `LOCAL_HARBOR_PASSWORD` | Harbor credentials (default user `admin`) |
   | `NGC_API_KEY` | NGC key **with the NVAIE entitlement** |
   | `LOCAL_RESOURCES_DIR` | Disk path for the downloaded resources |
   | `PACK_CONTAINER` | `true` if pull and push run on **different machines**: each image is saved as a `.tar` you can carry across (needs **+100 GB**). Default `false`. |

4. **Pull on the bastion:**

   ```bash
   ./vpaifn-airgap-res-mirror.sh --pull
   ```

5. **Carry across.** Copy the package directory, `config.env` and
   `LOCAL_RESOURCES_DIR` to the admin host (with `PACK_CONTAINER=true`, that
   includes the `.tar` files). Checksum before and after
   (`sha256sum`, general practice).
6. **Push on the admin host:**

   ```bash
   ./vpaifn-airgap-res-mirror.sh --push
   ```

   On a **single machine** with both network paths, `--all` does pull and push
   in one go. Do not edit `bom.json` unless Broadcom support tells you to.

**9.1.1 extra — replace `tkg-gpu-console`.** For a more secure image, log in to
the VCF registry **before running the script** or the
`deep-learning-container:9.1.1.0` image cannot be pulled
([KB 388470][kb388470]):

```bash
echo <registry_token> | docker login dlvm.packages.broadcom.com \
  --username <support-portal-login> --password-stdin
```

The blueprint change that follows the Quickstart is in
[`33` §8](33-private-ai-foundation.md#8-catalog-items-the-private-ai-foundation-quickstart).

**Check:** the Harbor project lists the GPU Operator chart and images, the NVIDIA
DL workload images (PyTorch, TensorFlow, CUDA Sample, Triton, DCGM Exporter) and
`deep-learning-container` (9.1.1).

---

## 4. Ubuntu package mirror and index file

Required to **compile the guest driver** on the VKS GPU nodes
([PAIF 9.1][paif-pdf]). Capacity and trimming advice:
[`33` §4.2a](33-private-ai-foundation.md#42a-plan-the-outside-staging-first--it-is-the-hard-part).

1. **Build the mirror** (Broadcom: **≥ 800 GB** free on the machine) and serve
   it from a **web server the VKS clusters with GPU can reach**. How you mirror
   is up to you (`apt-mirror`, `debmirror`, or a registry-style tool; general
   practice, not Broadcom's text). For **GPU passthrough** only, a **partial
   mirror** with the packages needed to compile the GPU Operator driver is
   allowed. NVIDIA lists the required packages in
   [*Install NVIDIA GPU Operator in Air-Gapped Environments*][nv-airgap].
2. **Write the index file** `custom-repo.list`, with your mirror's address:

   ```text
   deb [arch=amd64] http://<mirror-address>/ubuntu jammy main universe
   deb [arch=amd64] http://<mirror-address>/ubuntu jammy-updates main universe
   deb [arch=amd64] http://<mirror-address>/ubuntu jammy-security main universe
   ```

   For Ubuntu 24.04 replace `jammy` with `noble`. Use the release your **VKr**
   runs ([phase 6](#6-vkr-content-library-ubuntu)).
3. **Push it to Harbor** from the admin host, into a `resources` repository of
   the PAIF project, so VCF Automation deployments find it:

   ```bash
   oras login <harbor-fqdn> -u <user> -p <password>
   oras push <harbor-fqdn>/<project>/resources/custom-repo.list:1.0 \
     custom-repo.list:text/plain
   ```

4. **Tell the DevOps engineers** the mirror address if they provision VKS
   clusters with `kubectl`. With the VCF Automation catalog the location is
   *discovered automatically*.

For **Private AI Services** the index file is not pushed with `oras`: it is
passed to the artifact mirroring tool in
[phase 7](#7-private-ai-services-30-artifacts).

**Check:** from a machine on the VKS network, `curl http://<mirror-address>/ubuntu/dists/jammy/Release`
returns the release file, and the `oras` push shows the artifact in the Harbor
project.

---

## 5. vGPU and data center drivers

For **deep learning VMs** ([PAIF 9.1][paif-pdf]):

1. Download the driver versions you support from the **NVIDIA Licensing Portal**
   on the bastion side. Match them to the host driver in your vLCM image
   ([`32-gpu-hosts.md`](32-gpu-hosts.md)).
2. Upload them to a local **web server** the deep learning VMs can reach:
   - **vGPU guest drivers:** `.run` **or** `.zip`.
   - **Data center drivers (passthrough):** `.run`.
3. **vGPU only: create an index file** next to them, in one of two forms:
   - a `.txt` file of pairs, **host driver version** then **guest driver URL**:

     ```text
     <host-driver-version-1>
     <guest-driver-download-URL-1>
     <host-driver-version-2>
     <guest-driver-download-URL-2>
     ```

   - or the **directory listing** your web server generates (NGINX, Apache); the
     driver files must then be `.zip`.
4. **Passthrough:** no index; the deep learning VM's OVF parameter
   `gpu-driver-url` points at the `.run` URL.
5. Tell DevOps engineers where the drivers are if they deploy with `kubectl`.

**Check:** `curl -I <driver-url>` returns 200 from a machine on the VM network.

---

## 6. VKr content library (Ubuntu)

Must be the **Ubuntu edition** of the vSphere Kubernetes releases
([TechDocs][td-vkr], page *Last Updated October 28, 2026*). The library is *"used
across all vSphere namespaces in the Supervisor"*.

**Option A — depot-backed (preferred if you already run the depot):** a
subscribed library pointing at your own depot:
`https://<depot-fqdn>/depot-service/content-gateway/PROD/COMP/VKR/lib.json`,
filled by the VCF Download Tool ([`09-binary-depot.md`](09-binary-depot.md)).

**Option B — manual upload** (TechDocs procedure):

1. Download the Ubuntu-based VKr images for the Kubernetes versions you need from
   `https://wp-content.vmware.com/v2/latest/`.
2. Sign in to the **management domain** vCenter.
3. *Private AI Foundation* → switch the top selector to **Cloud disconnected** →
   *Set Up Environment* → **Start**.
4. Create a **local content library** for VKr and import the images (same wizard
   as *Content Libraries*, *Create a Local Content Library for Air-Gapped Cluster
   Provisioning*).
5. Associate the library with the Supervisor.

**Check:** a test VKS cluster request offers the Ubuntu VKr versions.

---

## 7. Private AI Services 3.0 artifacts

Only if you use Private AI Services. The **artifact mirroring tool (AMT)** is
part of the `pais` plug-in. Prerequisites on top of the earlier phases
([PAIF 9.1][paif-pdf]): a Harbor project for Private AI Services with **40 GB**,
`custom-repo.list` on the admin host, VCF Consumption CLI and Docker on both
hosts. (2.1 uses a different procedure; it is only in the
[PDF][paif-pdf], *Upload the Private AI Services 2.1 Components*.)

**On the bastion (connected):**

1. **Download the YAML** `pais-3.0.0-external.yaml` from the Support Portal
   (VMware Cloud Foundation download area → *Private AI Services* group). Check
   that it points at `pais-docker.packages.broadcom.com`.
2. **Install the plug-in** at the matching version
   (`vcf plugin install pais --version v3.0.0`, [phase 1](#1-bastion-and-admin-hosts)).
3. **Log in to the source registries:**

   ```bash
   export BROADCOM_TOKEN="<registry-token>"
   export NGC_API_KEY="<ngc-api-key>"
   docker login pais-docker.packages.broadcom.com -u <support-portal-login> --password-stdin <<< "${BROADCOM_TOKEN}"
   docker login nvcr.io/nvidia/vgpu -u '$oauthtoken' --password-stdin <<< "${NGC_API_KEY}"
   ```

4. **Pull** into a local store. Add the GPU Operator variant you use
   (`nvaie` = vGPU, `oss` = passthrough):

   ```bash
   vcf pais amt pull ./pais-3.0.0-external.yaml --local-store ./pais-store
   vcf pais amt pull ./pais-3.0.0-external.yaml --gpu-operator-variant nvaie --local-store ./pais-store
   ```

   The tool fetches from `pais-docker.packages.broadcom.com`,
   `packages.broadcom.com`, `helm.ngc.nvidia.com`, `nvcr.io` and
   `archive.ubuntu.com`: that is the bastion's allowlist.

**Carry** the `pais-store` directory and `custom-repo.list` to the admin host.

**On the admin host (inside):**

5. `docker login <harbor-fqdn> -u <user> --password-stdin`
6. **Push**, passing the index file's *content*:

   ```bash
   vcf pais amt push <harbor-fqdn>/<project> \
     --ubuntu-repo-list "$(cat ./custom-repo.list)"
   ```

**Result:** the artifacts are in the Harbor project, and `pais-store` now holds
an **updated `pais-3.0.0-external.yaml`** and a **`yaml-svc-cfg.yaml`**. Those two
files are what you use to install the Supervisor Service. Keep them; the install
steps are in [`37` §6](37-paif-connected-runbook.md#6-install-private-ai-services-the-supervisor-service)
(the disconnected column), background in [`33` §9](33-private-ai-foundation.md#9-private-ai-services).

---

## 8. Verify before the Quickstart

| Check | How |
| --- | --- |
| Harbor project has the GPU Operator + DL images | Harbor UI → project → repositories |
| `custom-repo.list` is in Harbor | `oras pull <harbor>/<project>/resources/custom-repo.list:1.0` |
| Ubuntu mirror reachable from the VKS network | `curl` the `Release` file |
| Driver URL and index reachable from the VM network | `curl -I` |
| Ubuntu VKr library attached to the Supervisor | Test VKS cluster lists the versions |
| Supervisor trusts Harbor's CA and can pull | Pull a test image in a namespace |
| (PAIS) `yaml-svc-cfg.yaml` and updated install YAML present | `ls pais-store` |
| DLS reachable, client token generated | [`33` §2](33-private-ai-foundation.md#2-nvidia-licensing-and-access) |

Then continue with the VCF Automation organization and the Quickstart
([`33` §6](33-private-ai-foundation.md#6-vcf-automation-organization),
[§8](33-private-ai-foundation.md#8-catalog-items-the-private-ai-foundation-quickstart)).

---

## Refreshing

Every update repeats phases 3, 4, 5 or 7 for the part that changed. Keep the
`bom.json` / YAML version you mirrored, diff it against the new one, and carry
only the difference ([`33` §4.2a](33-private-ai-foundation.md#42a-plan-the-outside-staging-first--it-is-the-hard-part)).

---

## References

**Broadcom:**
[VMware Private AI Foundation with NVIDIA 9.1 (PDF)][paif-pdf] ·
[KB 388470 — resource mirroring script][kb388470] ·
[Local Harbor registry][td-harbor] ·
[Ubuntu VKr content library (disconnected)][td-vkr]

**NVIDIA:**
[GPU Operator — air-gapped installs][nv-airgap] ·
[NGC API keys][ngc-keys]

**This repo:**
[`33-private-ai-foundation.md`](33-private-ai-foundation.md) ·
[`32-gpu-hosts.md`](32-gpu-hosts.md) ·
[`09-binary-depot.md`](09-binary-depot.md) ·
[`20-supervisor-image-registry.md`](20-supervisor-image-registry.md)

[paif-pdf]: https://techdocs.broadcom.com/content/dam/broadcom/techdocs/us/en/pdf/vmware/private-ai/private-ai-nvidia/vmware-private-ai-foundation-with-nvidia-9-1.pdf
[kb388470]: https://knowledge.broadcom.com/external/article/388470
[td-harbor]: https://techdocs.broadcom.com/us/en/vmware-cis/private-ai/foundation-with-nvidia/9-0/private-ai-foundation-9-x/deploying-private-ai-foundation-with-nvidia/enable-a-private-harbor-registry-in-paif.html
[td-vkr]: https://techdocs.broadcom.com/us/en/vmware-cis/private-ai/foundation-with-nvidia/9-0/private-ai-foundation-9-x/deploying-private-ai-foundation-with-nvidia/create-a-content-library-with-ubuntu-tkr.html
[nv-airgap]: https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/install-gpu-operator-air-gapped.html
[ngc-keys]: https://docs.nvidia.com/ngc/gpu-cloud/ngc-user-guide/index.html#ngc-api-keys
[docker-post]: https://docs.docker.com/engine/install/linux-postinstall/
