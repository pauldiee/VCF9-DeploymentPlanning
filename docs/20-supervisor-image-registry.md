# vSphere Supervisor / VKS — Container Image Registry Connectivity

How the Supervisor control plane, vSphere Pods, and **every VKS guest-cluster
node** reach the **runtime container images** they need — Antrea / CNI, CoreDNS,
metrics-server, the cluster-agent extensions, add-on (Standard) packages,
`pause`. These pull from Broadcom's OCI registry
**`projects.packages.broadcom.com`** (formerly `projects.registry.vmware.com`).

This is a **separate supply chain** from the content libraries / Software Depot
that carry the Supervisor OVA and the VKS Kubernetes-release artifacts
([`10-supervisor-enablement.md` §5](10-supervisor-enablement.md#5-content-libraries-for-supervisor-and-vks-images)),
and it is **not** covered by the fleet services-runtime (`G5`) proxy
([`09-binary-depot.md` §5](09-binary-depot.md#5-proxy-for-the-vcf-services-runtime-via-the-fleet-lcm-api)).
The **choice** between the three options is made in
[`10-supervisor-enablement.md` → Container image registry connectivity](10-supervisor-enablement.md#container-image-registry-connectivity);
this page is the **how-to** for the two that need one.

> **Sourcing.** The **proxy** path is **[documented]** (Broadcom TechDocs). The
> **air-gapped** path is **[field-reported]** — the concrete flow (scripts, the
> depot OCI registry, the depot image proxy) comes from the community-maintained
> [`vmware/vsphere-supervisor`](https://github.com/vmware/vsphere-supervisor)
> repo's `airgapped/` guides, not a single TechDocs page. Treat versions and
> exact script names as *check against your build*.

## Contents

| # | Section | Use it when |
| - | ------- | ----------- |
| 1 | [The three options](#1-the-three-options) | Deciding — mirrors the summary in `docs/10` |
| 2 | [A. Direct egress](#2-a-direct-egress) | Workload / node networks can reach the internet |
| 3 | [B. Proxy path — walkthrough](#3-b-proxy-path--walkthrough) | Egress only via an HTTP(S) proxy |
| 4 | [C. Air-gapped path — walkthrough](#4-c-air-gapped-path--walkthrough) | No egress from the workload / node networks at all |
| — | [VCF Automation reaches the OCI registry too](#vcf-automation-reaches-the-oci-registry-too--a-different-path) | VCFA runs on the services runtime — a **separate** proxy / image path from the Supervisor's |
| 5 | [References](#5-references) | The TechDocs and repo guides behind the above |

---

## 1. The three options

| Situation | Option | Where it's set |
| --------- | ------ | -------------- |
| Workload / node networks have routed internet | **A — Direct** | Firewall only |
| Workload / node networks reach the internet **only through a proxy** | **B — Proxy** | The **Supervisor** proxy **and** the **VKS `TkgServiceConfiguration`** |
| No egress from the workload / node networks | **C — Air-gapped** | Relocate images into the **VCF Software Depot OCI registry**; the Supervisor reaches it through a **depot image proxy** |

The decision is **independent of** the content-library / depot decision — a site
can be online for one and offline for the other — but they usually match. If the
whole site is air-gapped you are almost certainly doing **C** here **and** the
offline-depot seeding in
[`10-supervisor-enablement.md` §5.4](10-supervisor-enablement.md#54-offline-depot-configured-is-not-the-same-as-populated).

> **VCF Automation needs the OCI registry too**, but by a **different route** —
> it runs on the VCF services runtime, so its path follows the *services-runtime*
> proxy / depot, not the Supervisor's. Same A / B / C choice, configured once via
> Fleet Management — see
> [VCF Automation reaches the OCI registry too](#vcf-automation-reaches-the-oci-registry-too--a-different-path).

---

## 2. A. Direct egress

Nothing to configure beyond the firewall: the **Supervisor management network**
**and every workload / VKS node subnet** must reach
`projects.packages.broadcom.com` on **TCP 443** (through whatever routed or NAT'd
path — see [`10-supervisor-enablement.md` §3.4](10-supervisor-enablement.md#34-creating-the-external-ip-block-and-attaching-it-to-the-profile)
on Default Outbound NAT for the pod / workload side).

**Verify from where it matters** — a node in a workload subnet, or a test pod:

```
curl -sI https://projects.packages.broadcom.com/v2/
```

Expect **`HTTP/1.1 401 Unauthorized`** (registry reachable, auth required) — not
a timeout or a proxy error. A `401` here is success.

---

## 3. B. Proxy path — walkthrough

Image pulls traverse an HTTP(S) proxy, set in **two independent places** — you
need **both** if you run VKS clusters:

- **The Supervisor** — its own image pulls and container traffic.
- **The VKS `TkgServiceConfiguration`** — inherited by every VKS cluster the
  Supervisor provisions.

Neither is the depot's `G5` fleet proxy — a site can have the depot
online-via-proxy while the workload networks use a *different* proxy, or none.

**Steps:** 1 gather the proxy details → 2 build the no-proxy list →
3 set the Supervisor proxy → 4 set the VKS `TkgServiceConfiguration` proxy →
5 roll it to existing clusters → 6 validate.

### Step 1 — Gather the proxy details

- **Proxy URL(s)** — `http://<host>:<port>` for both HTTP and HTTPS (prefix
  `user:pass@` if it authenticates). The two are usually the same value.
- **Does it TLS-intercept?** If yes, get its **root CA in PEM** — you trust it
  on the Supervisor (`tlsRootCaBundle`) and in VKS
  (`trust.additionalTrustedCAs`).

### Step 2 — Build the no-proxy list (before you set anything)

The biggest cause of a broken proxy deployment is an incomplete no-proxy list —
in-cluster and management traffic then goes to the proxy, which can't route it.
Assemble **one** list, used verbatim in both places below:

| Include | Examples |
| ------- | -------- |
| Loopback | `localhost`, `127.0.0.1` |
| Pod + Service CIDRs — the Supervisor's **and** each VKS cluster's | Supervisor Service CIDR (e.g. `10.96.0.0/16`), guest Pod/Service CIDRs ([`10` §2](10-supervisor-enablement.md#2-pre-flight-gate), §5.5) |
| Namespace / workload network, Ingress, Egress CIDRs | your VPC / workload subnets |
| Cluster-internal domains | `.svc`, `.svc.cluster.local`, `cluster.local`, `.local` |
| Supervisor + API | the Supervisor / API-server FQDN **and** its VIP |
| Infrastructure | vCenter, NSX Manager, the ESXi hosts |
| VKS | control-plane endpoints, node subnets |
| Air-gapped depot path (§4), if also used | `depot-image-proxy.kube-system.svc.cluster.local`, the Software Depot FQDN |
| Any internal registry / Harbor | its FQDN |

> The Supervisor `no_proxy_config` and the VKS `noProxy` are **separate fields**
> — put the same list in both.

### Step 3 — Set the Supervisor proxy **[documented]**

Changeable after enablement, no redeploy. Pick one method:

- **vSphere Client** — *Workload Management → Supervisors →* your Supervisor *→
  Configure → General → HTTP Proxy* (labelled *Network* on some builds). Choose
  **Configure a proxy for this Supervisor** (= mode `CLUSTER_CONFIGURED`), enter
  the HTTP proxy, HTTPS proxy, the **no-proxy list from Step 2**, and the proxy
  CA if it intercepts TLS. (**Inherit from vCenter** = `VC_INHERITED`; **None**
  = `NONE`.)
- **API** — `PATCH …/api/vcenter/namespace-management/clusters/<supervisor-id>`
  with `http_proxy_config`, `https_proxy_config`, `no_proxy_config`,
  `tlsRootCaBundle`.
- **DCLI** — `com vmware vcenter namespacemanagement clusters update`.

### Step 4 — Set the VKS `TkgServiceConfiguration` proxy

As a Supervisor administrator (`kubectl` context = the Supervisor):

```
kubectl edit tkgserviceconfigurations tkg-service-configuration
```

Add the `proxy` block under `spec` (and `trust` only if the proxy intercepts
TLS):

```yaml
spec:
  proxy:
    httpProxy:  http://<user>:<pass>@<proxy-host>:<port>
    httpsProxy: http://<user>:<pass>@<proxy-host>:<port>
    noProxy:
      - localhost
      - 127.0.0.1
      - <Supervisor Pod CIDR>
      - <Supervisor Service CIDR>
      - <guest Pod/Service CIDRs>
      - <workload / Namespace / Ingress / Egress CIDRs>
      - .svc
      - .svc.cluster.local
      - cluster.local
      - <vCenter FQDN>
      - <NSX Manager FQDN>
      - <Supervisor API FQDN and VIP>
  trust:
    additionalTrustedCAs:
      - name: corp-proxy-ca
        data: <base64 PEM of the proxy root CA>
```

Every VKS cluster created **after** this inherits it.

### Step 5 — Roll it to existing VKS clusters

Clusters created before Step 4 keep their old (or no) proxy. Either **trigger a
rolling reconcile** (edit a benign field on the `Cluster` object) or set
`proxy` / `trust` **directly on that `Cluster`'s topology variables** — the same
mechanism for giving one cluster a *different* proxy, or none.

### Step 6 — Validate

- From a **node**: `curl -sI https://projects.packages.broadcom.com/v2/` returns
  **`401`**, and the request appears in the **proxy access log**.
- A **new VKS cluster** reaches all system pods `Running` — no
  `ImagePullBackOff` on `antrea`, `coredns`, `metrics-server`.
- `kubectl get pod -A` on that cluster — nothing wedged on image pull.
- In-cluster service-to-service traffic still works (proves the no-proxy list
  covers the Pod / Service CIDRs).

*Sources: [Configuring HTTP Proxy Settings in vSphere Supervisor][sup-proxy] · [Customize the VKS Configuration for VKS Clusters][vks-config]*

---

## 4. C. Air-gapped path — walkthrough

**[field-reported]** — from the
[`vmware/vsphere-supervisor` `airgapped/air-gapped-vcf91.md`][airgap91] guide.
Names, versions and script paths change between releases; **read that guide for
your build** and treat the below as the shape and the checkpoints.

**The 9.1 change:** you do **not** need an external registry to host the
*Supervisor Services* and *VKS Standard Packages* images. **VCF 9.1's Fleet ships
an OCI registry inside the VCF Software Depot** — you relocate the images into
*it*. (An external Harbor is only needed as a **user image registry**, and for
that the **Harbor Supervisor Service** or the **VMware Bootstrap Registry
Appliance** is the vendor path — [§4.8](#48-harbor-for-user-images-only-if-needed).)

**Steps:** 1 two hosts + tooling → 2 download the bundles (bastion) →
3 transfer across the gap → 4 stand up the Supervisor + the OVA library →
5 prepare the admin host → 6 relocate the images into the depot OCI registry →
7 the depot image proxy → 8 Harbor (only for user images) → 9 deploy + validate.
You end up with: every Supervisor / VKS system image served from the **VCF
Software Depot OCI registry**, reached over the **management network** via the
**depot image proxy** — nothing at runtime touches `projects.packages.broadcom.com`.

### 4.1 Two hosts and the tooling

| Host | Where | Purpose |
| ---- | ----- | ------- |
| **Bastion** | Internet-connected | Download the bundles from `projects.packages.broadcom.com` and the Broadcom Support Portal |
| **Admin** | Inside the air-gapped network | Upload the bundles into the Software Depot, drive the Supervisor |

Tools on both (from the `vmware/vsphere-supervisor` repo unless noted):
`imgpkg`, `oci_image_depot_migrator.py`, `toggle_software_depot_oci_image_upload.sh`,
`manage-depot-image-proxy.sh`, plus `wget curl ssh sshpass jq yq openssl python3`
and the **VCF CLI** (`vcf`) + its plugin bundle (Support Portal → *VCF
Consumption CLI 9.1.0* + *Plugin-Bundle 9.1.0*).

### 4.2 Download the bundles (bastion)

- **Kubernetes Release OVAs** — the VM templates for VKS nodes, from
  `https://wp-content.broadcom.com/v2/latest/` per the air-gapped
  cluster-provisioning docs.
- **Supervisor Service bundles** — each service is a Carvel package. From the
  service's `*-legacy-*.yml`, take the
  `spec.template.spec.fetch.imgpkgBundle[].image` reference, then:

  ```
  ./oci_image_depot_migrator.py download -s <projects.packages.broadcom.com/...>
  ```

  Do this for **VKS Service** (required), **Harbor** (only if VCF Automation is
  not deployed), and any Standard services you need (Contour, cert-manager,
  Prometheus, …). Each produces a `.tar`.
- **VKS Standard Packages bundle** —

  ```
  ./oci_image_depot_migrator.py download -s \
    projects.packages.broadcom.com/vsphere/supervisor/vks-standard-packages/<ver>/vks-standard-packages:<ver>
  ```

### 4.3 Transfer to the admin host

Copy across the gap: every `.tar`, both `*-legacy-*.yml` **and** `*-depot-*.yml`
service YAMLs, the Kubernetes Release OVAs, and the VCF CLI + plugin tarballs.

### 4.4 Stand up the Supervisor and the OVA library

- Enable the Supervisor on the air-gapped vCenter
  ([`10-supervisor-enablement.md` §6](10-supervisor-enablement.md#6-activate-the-supervisor)).
- Create a **local content library** and import the Kubernetes Release OVAs
  ("Create a Local Content Library for air-gapped cluster provisioning").
- Create the vSphere namespace(s) VKS clusters will run in.

### 4.5 Prepare the admin host

- Install **`kubectl`** from the Supervisor
  (`https://<supervisor>/wcp/plugin/linux-amd64/vsphere-plugin.zip`).
- Install the **VCF CLI** + plugins from the tarballs
  (`vcf plugin install all --local-source <dir>`).
- **Trust the vCenter CA** (`https://<vcenter>/certs/download.zip` → the Linux
  PEMs into `/etc/ssl/certs/`).
- `vcf context create <name> --endpoint https://<supervisor> --username administrator@vsphere.local --type k8s`
  then `vcf context use <name>:<namespace>`.

### 4.6 Relocate the images into the Software Depot OCI registry

1. Get the Software Depot FQDN — **VCF Operations → Build → Lifecycle → VCF
   Management → Components → VSP**.
2. **Enable offline write** on the depot:

   ```
   ./toggle_software_depot_oci_image_upload.sh enable \
     --vsp-host <depot-fqdn> --admin-username admin@vsp.local --admin-password '<pw>'
   ```

   Confirm `"offlineWriteEnabled": true`.
3. **Upload each bundle** (from the admin host, using the transferred `.tar`s):

   ```
   ./oci_image_depot_migrator.py upload -s <source-image-ref> -t <depot-fqdn>
   ```

   (If the admin host has DMZ reach to `projects.packages.broadcom.com`, use
   `copy` instead of `upload` to stream directly.) The script fetches the
   depot's TLS cert (`openssl s_client`) and calls
   `imgpkg copy --tar … --to-repo …` with `--registry-ca-cert-path`. Do **VKS
   Service**, every other Supervisor Service, and the **VKS Standard Packages**
   bundle.
4. **Disable offline write** again (hardening):

   ```
   ./toggle_software_depot_oci_image_upload.sh disable --vsp-host <depot-fqdn> …
   ```

   Confirm `"offlineWriteEnabled": false`.

### 4.7 The depot image proxy (so the Supervisor can reach the depot)

The Supervisor is on the **management network**; the depot OCI registry is
reachable there, but the Supervisor pulls by an in-cluster name. If **VCF
Automation is not deployed**, run:

```
./manage-depot-image-proxy.sh add <vc-host> <vc-root-ssh-pw> <vc-admin-user> <vc-admin-pw> <supervisor-id>
```

This creates the service **`depot-image-proxy.kube-system.svc.cluster.local`**,
which proxies Supervisor image pulls to the Software Depot on the management
network.

> **If a Supervisor proxy is configured (§3.1), add
> `depot-image-proxy.kube-system.svc.cluster.local` and the depot FQDN to its
> `no_proxy_config`** — otherwise the pull is sent out to the corporate proxy
> and fails.

### 4.8 Harbor for user images (only if needed)

Not required for Supervisor/VKS system images (those come from the depot OCI
registry). Deploy it only for **tenant / user** images or where a policy needs a
local registry in the data path:

- **Harbor Supervisor Service 2.14.x** — register the service; edit its bundle
  image reference to the `depot-image-proxy.kube-system.svc.cluster.local/…`
  path before install ("Deploy Harbor Supervisor Service in VVF without VCFA").
- **VMware Bootstrap Registry Appliance** — a hardened Photon 5 OVA shipping an
  OCI Harbor, used as *Registry 0* to bootstrap the Harbor Supervisor Service in
  a fully air-gapped site, then retired once Harbor Service is healthy.

Trust its CA on the Supervisor / VKS side (`TkgServiceConfiguration`
`trust.additionalTrustedCAs`, §3.2).

### 4.9 Deploy and validate

- `vcf addon repository list` → the default add-on repository points at
  `depot.kube-system.svc/vcf/vks-standard-packages/…` (i.e. the depot, via the
  image proxy).
- Create a VKS cluster (`kubectl create -f <cluster>.yaml -n <ns>`); it comes up
  with **no `ImagePullBackOff`** on any system pod.
- `vcf addon install create <pkg> …` from the workload-cluster context installs
  a Standard package, pulling from the depot.
- Nothing in the cluster references `projects.packages.broadcom.com` at runtime
  (`kubectl get pods -A -o jsonpath …` on image fields).

### 4.10 Gotchas

- **Community-repo-sourced, not TechDocs** — the scripts and the exact flow live
  in `vmware/vsphere-supervisor`; re-check names/versions per build.
- **Leave `offlineWriteEnabled` off** except during an upload window.
- **The `depot-image-proxy` no-proxy entry** (§4.7) is the usual missed step
  when a Supervisor proxy is also set.
- The **content library** for the K8s Release OVAs (§4.4) is a *different*
  offline artifact from the OCI images — both must be seeded.

*Sources: [`vmware/vsphere-supervisor` — air-gapped VCF 9.1][airgap91] · [`vmware/vsphere-supervisor` — air-gapped Harbor][airgap-harbor] · [Upgrade VKS from a Private Registry][vks-private] · [Deploying Harbor Service in Air-Gapped VCF 9.0 (Broadcom blog)][harbor-blog] · [VMware Bootstrap Registry Appliance (Broadcom blog)][bra-blog]*

---

## VCF Automation reaches the OCI registry too — a different path

**VCF Automation is not a Supervisor.** It runs on the **VCF services runtime**
(the fleet Kubernetes runtime), and its own components — plus the VKS
cluster-management it performs and its package updates — also pull runtime
images from `projects.packages.broadcom.com`. The **Supervisor** proxy and the
**`TkgServiceConfiguration`** from [§3](#3-b-proxy-path--walkthrough) do **not**
apply to it. Handle it once, with the same A / B / C choice:

| Option | For VCF Automation |
| ------ | ----------------- |
| **A — Direct** | The **services-runtime network** reaches `projects.packages.broadcom.com:443`. It is already in the fleet's public-URL allowlist ([`prerequisites.md`](prerequisites.md)). Nothing extra. |
| **B — Proxy** | Set the **services-runtime proxy** — *VCF Operations → Fleet Management → Configuring Management Components → Configure a Proxy Server for VCF Management Services Components and VCF Automation* (also scriptable, KB 447542). It "applies to **all components** hosted on that runtime instance", VCF Automation included. This is the **same proxy family as `09-binary-depot.md` §5's `G5`** — **not** the Supervisor proxy. |
| **C — Air-gapped** | The Fleet's Software Depot OCI registry serves the services runtime directly on the management network — the "Standard" service YAML definitions target the depot; the "legacy" ones use direct image URLs. **When VCF Automation is deployed it *provides* the Supervisor Management Proxy** (`depot-image-proxy`) that [§4.7](#47-the-depot-image-proxy-so-the-supervisor-can-reach-the-depot) otherwise sets up by hand — so having VCFA present makes the Supervisor's air-gapped image path simpler, not harder. |

> **Practical upshot:** on a proxied or air-gapped site you configure **two
> proxies / two image paths** — one for the services runtime (VCF Automation,
> the depot, Identity Broker, telemetry) via Fleet Management, and one for the
> Supervisor / VKS ([§3](#3-b-proxy-path--walkthrough) / [§4](#4-c-air-gapped-path--walkthrough)).
> They are independent; a site can run one online and the other offline.

*Sources: [Configure a Proxy Server for VCF Management Services Components and VCF Automation][mgmt-proxy] · [Scripted process to configure a proxy on VCF Management Services and VCF Automation (KB 447542)][kb447542] · [`09-binary-depot.md` §5](09-binary-depot.md#5-proxy-for-the-vcf-services-runtime-via-the-fleet-lcm-api)*

---

## 5. References

- [Configure a Proxy Server for VCF Management Services Components and VCF Automation][mgmt-proxy]
- [Scripted process to configure a proxy on VCF Management Services and VCF Automation (KB 447542)][kb447542]
- [Configuring HTTP Proxy Settings in vSphere Supervisor][sup-proxy]
- [Customize the VKS Configuration for VKS Clusters][vks-config]
- [`vmware/vsphere-supervisor` — `airgapped/air-gapped-vcf91.md`][airgap91]
- [`vmware/vsphere-supervisor` — `airgapped/air-gapped-harbor.md`][airgap-harbor]
- [Upgrade VKS from a Private Registry][vks-private]
- [Deploying Harbor Service in Air-Gapped VMware Cloud Foundation 9.0][harbor-blog]
- [VMware Bootstrap Registry Appliance — Air-Gapped Harbor in VCF 9.0][bra-blog]
- **In this repo** — [`10-supervisor-enablement.md`](10-supervisor-enablement.md)
  (the connectivity decision + the content libraries),
  [`09-binary-depot.md`](09-binary-depot.md) (the offline depot and the `G5`
  fleet proxy — a separate proxy from this page's).

[sup-proxy]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/vsphere-supervisor-installation-and-configuration/configuring-and-managing-a-supervisor-cluster/configuring-http-proxy-settings-in-vsphere-with-tanzu.html
[vks-config]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vsphere-supervisor-services-and-standalone-components/latest/managing-vsphere-kuberenetes-service-clusters-and-workloads/managing-networking-for-tkg-service-clusters/customize-the-tkg-service-configuration-for-tkg-clusters.html
[airgap91]: https://github.com/vmware/vsphere-supervisor/blob/main/airgapped/air-gapped-vcf91.md
[airgap-harbor]: https://github.com/vmware/vsphere-supervisor/blob/main/airgapped/air-gapped-harbor.md
[vks-private]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vsphere-supervisor-services-and-standalone-components/latest/managing-vsphere-kubernetes-service/installing-and-upgrading-the-tkg-service/upgrade-tkg-service-from-a-private-registry.html
[harbor-blog]: https://blogs.vmware.com/cloud-foundation/2026/04/21/deploying-harbor-service-in-air-gapped-vmware-cloud-foundation-9-0/
[bra-blog]: https://blogs.vmware.com/cloud-foundation/2026/08/11/vmware-bootstrap-registry-appliance-air-gapped-harbor-deployment/
[mgmt-proxy]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/configuring-management-components/configure-a-proxy-server-to-download-bundles-from-sddc-manager.html
[kb447542]: https://knowledge.broadcom.com/external/article/447542/
