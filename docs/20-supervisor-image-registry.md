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

Nothing to *configure* — but there is a real reachability requirement to prove,
from the right place.

### Step 1 — Open the firewall

Allow **TCP 443** to `projects.packages.broadcom.com` (Broadcom rotates the
backing IPs — allow by FQDN / SNI, not by address) from **all** of:

- the **Supervisor management network** (control-plane VMs);
- **every workload / VKS node subnet** — the pods and the VKS guest-cluster
  nodes are what pull most images, and routing that only reaches vCenter is not
  enough;
- if the pod/workload side is behind NSX Default Outbound NAT, confirm that NAT
  is on and its external IP block can egress — see
  [`10-supervisor-enablement.md` §3.4](10-supervisor-enablement.md#34-creating-the-external-ip-block-and-attaching-it-to-the-profile).

Also allow **DNS** so those networks can resolve `projects.packages.broadcom.com`.

### Step 2 — Verify from a workload subnet (not the jump host)

The test must run from where the pull actually happens. Use a **VKS node** or a
throwaway pod on the Supervisor:

```
# from a node:
curl -sI https://projects.packages.broadcom.com/v2/

# or a pod (image must itself be reachable — use one you already have):
kubectl run reg-test --rm -it --restart=Never \
  --image=<reachable-registry>/curl -- \
  curl -sI https://projects.packages.broadcom.com/v2/
```

**Expect `HTTP/1.1 401 Unauthorized`** — the registry answered and is asking for
auth. That is success.

| You see | Meaning | Fix |
| ------- | ------- | --- |
| `401` | reachable | done |
| hang / `curl: (28)` timeout | no route / firewall drop | open 443 from *this* subnet |
| `curl: (6)` could not resolve | no DNS | allow DNS from this subnet |
| `407 Proxy Authentication Required` / a proxy banner | traffic is being proxied | you are actually on path **B** — go to §3 |
| corporate-issued TLS cert in `-v` | a transparent proxy is intercepting | path **B** — trust its CA (§3 Step 1) |

### Step 3 — No further action

Image pulls just work. Re-run the Step 2 check after any firewall change and
before enabling each new VKS cluster.

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

> **Placeholders used below.** Substitute your own: proxy
> `http://proxy.rainpole.io:3128`, vCenter `sfo-m01-vc01.rainpole.io`, NSX
> Manager `sfo-m01-nsx01.rainpole.io`, Supervisor API FQDN
> `sfo-w01-cl01-sn01.rainpole.io` + VIP `10.11.20.10`, Supervisor Pod CIDR
> `10.244.0.0/20`, Supervisor Service CIDR `10.96.0.0/23`, workload / VPC subnet
> `172.16.0.0/16`, guest-cluster Pod CIDR `192.168.0.0/16`, guest-cluster
> Service CIDR `10.97.0.0/16`.

### Step 1 — Gather the proxy details

Write these down before touching anything — you enter the same values in two
places (Step 3 and Step 4).

| Item | Notes |
| ---- | ----- |
| **HTTP proxy URL** | `http://<host>:<port>`, e.g. `http://proxy.rainpole.io:3128`. If the proxy requires auth, `http://<user>:<pass>@<host>:<port>` — URL-encode any special characters in the password (`@` → `%40`, `:` → `%3A`). |
| **HTTPS proxy URL** | Almost always the **same value** as the HTTP proxy (the scheme prefix stays `http://` — it is the *proxy's* protocol, not the target's). |
| **Does the proxy do TLS interception / MITM?** | If it re-signs TLS with a corporate CA, you must trust that CA (Step 3 `tlsRootCaBundle`, Step 4 `trust.additionalTrustedCAs`) or every `https://` pull fails with a certificate error. Test: `curl -x http://proxy.rainpole.io:3128 -vI https://projects.packages.broadcom.com/v2/ 2>&1 | grep -i 'issuer\|subject'` — a corporate issuer means interception. |
| **Proxy root CA in PEM** | If intercepting: obtain `proxy-ca.pem`. Base64 it for the YAML/API: `base64 -w0 proxy-ca.pem` (Linux) or `base64 -i proxy-ca.pem` (macOS). |

### Step 2 — Build the no-proxy list (do this first)

The single biggest cause of a broken proxy deployment is an incomplete no-proxy
list: in-cluster and management traffic then gets sent to the proxy, which
cannot route RFC-1918 / `.cluster.local` destinations, and pods hang or the
Supervisor goes unhealthy. Assemble **one** list now and paste it into **both**
Step 3 and Step 4 (they are separate fields — filling one is not enough).

| Category | Entries (example values) | Why |
| -------- | ------------------------ | --- |
| **Loopback** | `localhost`, `127.0.0.1` | node-local calls |
| **Supervisor Pod + Service CIDRs** | `10.244.0.0/20`, `10.96.0.0/23` | Supervisor control-plane ↔ services. From `10-supervisor-enablement.md` §2 (Service CIDR) and the enablement wizard |
| **Every VKS guest-cluster Pod + Service CIDR** | `192.168.0.0/16`, `10.97.0.0/16` | guest-cluster internal traffic. From `10` §5.5 — add each guest cluster's ranges |
| **Workload / Namespace / Ingress / Egress CIDRs** | `172.16.0.0/16` | node ↔ node, LB VIPs, egress |
| **Cluster-internal DNS suffixes** | `.svc`, `.svc.cluster.local`, `cluster.local`, `.local` | Kubernetes service discovery |
| **Supervisor / API-server** | `sfo-w01-cl01-sn01.rainpole.io`, `10.11.20.10` | kubelet / VKS ↔ Supervisor API. Include **both** the FQDN and the control-plane VIP |
| **Infrastructure** | `sfo-m01-vc01.rainpole.io`, `sfo-m01-nsx01.rainpole.io`, the ESXi host subnet (e.g. `10.11.10.0/24`) | CSI/CPI to vCenter, Antrea ↔ NSX, spherelet ↔ hosts |
| **VKS control-plane endpoints + node subnets** | each guest cluster's API VIP; `172.16.0.0/16` | CAPI reconcile |
| **Air-gapped depot path (§4), if also in use** | `depot-image-proxy.kube-system.svc.cluster.local`, the Software Depot FQDN | otherwise depot pulls go out to the corporate proxy and fail |
| **Any internal registry / Harbor** | `harbor.rainpole.io` | local image pulls |

> **CIDR vs suffix.** Both proxies accept CIDRs (`10.96.0.0/23`) and domain
> suffixes (`.svc.cluster.local`). Use CIDRs for IP ranges and leading-dot
> suffixes for domains; do **not** rely on bare hostnames matching subdomains.

### Step 3 — Set the Supervisor proxy **[documented]**

Applies to the Supervisor's own image pulls and container traffic. **Changeable
after enablement, no redeploy** — the change rolls out to the control-plane VMs
in a few minutes.

**Option 3a — vSphere Client (simplest):**

1. *vSphere Client → Workload Management → Supervisors →* select your Supervisor.
2. *Configure →* **General** (older builds: *Network*) *→* the **HTTP Proxy**
   section *→* **Edit**.
3. Set the mode:
   - **Use vCenter Server proxy settings** = `VC_INHERITED` — pick this only if
     vCenter already has exactly the proxy + no-proxy you want.
   - **Configure a proxy for this Supervisor** = `CLUSTER_CONFIGURED` — the
     normal choice.
   - **No proxy** = `NONE`.
4. With `CLUSTER_CONFIGURED`, fill:
   - **HTTP proxy** — `http://proxy.rainpole.io:3128`
   - **HTTPS proxy** — `http://proxy.rainpole.io:3128`
   - **No proxy** — the Step 2 list, comma-separated
   - **Proxy TLS certificate** — paste the PEM of the proxy root CA (only if it
     intercepts TLS)
5. **OK / Save.** Watch *Workload Management → Supervisors →* the config-status
   column return to **Running** / **Configured**.

**Option 3b — Cluster Management API** (scriptable):

```
PATCH https://sfo-m01-vc01.rainpole.io/api/vcenter/namespace-management/clusters/<supervisor-id>
Authorization: Bearer <vcenter-session-token>
Content-Type: application/json

{
  "cluster_proxy_config": {
    "proxy_settings_source": "CLUSTER_CONFIGURED",
    "http_proxy_config":  "http://proxy.rainpole.io:3128",
    "https_proxy_config": "http://proxy.rainpole.io:3128",
    "no_proxy_config": [
      "localhost", "127.0.0.1",
      "10.244.0.0/20", "10.96.0.0/23", "172.16.0.0/16",
      ".svc", ".svc.cluster.local", "cluster.local",
      "sfo-w01-cl01-sn01.rainpole.io", "10.11.20.10",
      "sfo-m01-vc01.rainpole.io", "sfo-m01-nsx01.rainpole.io"
    ],
    "tls_root_ca_bundle": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n"
  }
}
```

Get `<supervisor-id>` from
`GET /api/vcenter/namespace-management/clusters` (the `cluster` field), and the
session token from
`POST /api/session` with vCenter SSO basic auth.

**Option 3c — DCLI:**
`dcli com vmware vcenter namespacemanagement clusters update --cluster <id> …`
(same fields; run `dcli … update --help` for the exact flag names on your
build).

**Verify the Supervisor took it:** SSH to a control-plane VM (via the
`vmware-system-user` / the JSON from enablement) and check
`env | grep -i proxy` in the relevant service context, or simply confirm the
next step's cluster comes up clean.

### Step 4 — Set the VKS `TkgServiceConfiguration` proxy

This is inherited by **every VKS cluster** the Supervisor provisions from now
on. Point `kubectl` at the **Supervisor** (`kubectl vsphere login` / `vcf
context` to the Supervisor, not a guest cluster), as a Supervisor
administrator:

```
kubectl get tkgserviceconfigurations
# NAME
# tkg-service-configuration

kubectl edit tkgserviceconfigurations tkg-service-configuration
```

Add a `proxy` block under `spec` (and `trust` only if the proxy intercepts
TLS). Filled example — replace the CIDRs/FQDNs with yours from Step 2:

```yaml
apiVersion: run.tanzu.vmware.com/v1alpha1
kind: TkgServiceConfiguration
metadata:
  name: tkg-service-configuration
spec:
  # ...existing fields left untouched...
  proxy:
    httpProxy:  http://proxy.rainpole.io:3128
    httpsProxy: http://proxy.rainpole.io:3128
    noProxy:
      - localhost
      - 127.0.0.1
      - 10.244.0.0/20            # Supervisor Pod CIDR
      - 10.96.0.0/23             # Supervisor Service CIDR
      - 192.168.0.0/16           # guest-cluster Pod CIDR
      - 10.97.0.0/16             # guest-cluster Service CIDR
      - 172.16.0.0/16            # workload / node subnet
      - 10.11.10.0/24            # ESXi host subnet
      - .svc
      - .svc.cluster.local
      - cluster.local
      - .local
      - sfo-w01-cl01-sn01.rainpole.io
      - "10.11.20.10"            # Supervisor control-plane VIP
      - sfo-m01-vc01.rainpole.io
      - sfo-m01-nsx01.rainpole.io
      - depot-image-proxy.kube-system.svc.cluster.local   # only if §4 in use
  trust:
    additionalTrustedCAs:
      - name: corp-proxy-ca
        data: LS0tLS1CRUdJTiBDRVJU...      # base64 of proxy-ca.pem (Step 1)
```

Save and exit the editor — the apply is immediate. Confirm:

```
kubectl get tkgserviceconfigurations tkg-service-configuration -o jsonpath='{.spec.proxy}' ; echo
```

### Step 5 — Roll it to existing VKS clusters

Clusters created **before** Step 4 keep their old proxy (or none) — the setting
is applied at cluster creation. To update one:

- **Trigger a rolling reconcile** — edit a benign field on the `Cluster` object
  (a label, or an annotation) so CAPI re-templates the nodes:

  ```
  kubectl -n <namespace> annotate cluster <cluster-name> proxy-refresh="$(date +%s)" --overwrite
  ```

  The machine deployments roll; watch `kubectl -n <namespace> get machines -w`.
- **Or set per-cluster values** — put a `proxy` (and `trust`) block in that
  `Cluster`'s topology variables. This is also how you give **one** cluster a
  *different* proxy, or **no** proxy, overriding the `TkgServiceConfiguration`
  default.

### Step 6 — Validate

Run these in order; stop and fix on the first failure.

1. **Proxy reaches the registry** — from a **VKS node** (or a debug pod on the
   Supervisor):

   ```
   curl -sI https://projects.packages.broadcom.com/v2/
   ```

   Expect `HTTP/1.1 401 Unauthorized`. Then check the **proxy access log** shows
   a `CONNECT projects.packages.broadcom.com:443` from that node's IP — proof it
   went *via* the proxy, not around it.
2. **A fresh VKS cluster comes up clean:**

   ```
   kubectl -n <namespace> create -f <cluster>.yaml
   kubectl -n <namespace> get cluster,machines -w
   ```

   All machines reach `Running`; the cluster's `Ready` condition goes `True`.
3. **System pods pulled their images** — on the guest cluster:

   ```
   kubectl get pods -A | grep -Ev 'Running|Completed'
   ```

   Empty output. In particular no `ImagePullBackOff` / `ErrImagePull` on
   `antrea-*`, `coredns-*`, `metrics-server-*`, `vsphere-csi-*`.
4. **In-cluster traffic still works** (proves `noProxy` covers the Pod/Service
   CIDRs) — `kubectl run t --rm -it --image=<reachable>/busybox -- wget -qO- http://kubernetes.default.svc/healthz`
   returns without hanging.
5. **No `503` / proxy errors in events** — `kubectl get events -A --field-selector type=Warning`
   shows nothing proxy-related.

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
Appliance** is the vendor path — [§4.8](#48-harbor-for-user-images-only-if-you-need-one).)

**Steps:** 1 two hosts + tooling → 2 download the bundles (bastion) →
3 transfer across the gap → 4 stand up the Supervisor + the OVA library →
5 prepare the admin host → 6 relocate the images into the depot OCI registry →
7 the depot image proxy → 8 Harbor (only for user images) → 9 deploy + validate.
You end up with: every Supervisor / VKS system image served from the **VCF
Software Depot OCI registry**, reached over the **management network** via the
**depot image proxy** — nothing at runtime touches `projects.packages.broadcom.com`.

> **Placeholders below.** Supervisor `sfo-w01-cl01-sn01.rainpole.io`, vCenter
> `sfo-m01-vc01.rainpole.io`, Software Depot `sfo-m01-fleet01.rainpole.io`,
> namespace `ns01`, cluster `vks-w01`. Versions (`3.6.x`, `2.14.2`) are examples
> — use whatever your build ships.

### 4.1 Two hosts and the tooling

| Host | Where | Does |
| ---- | ----- | ---- |
| **Bastion** | Internet-connected (Ubuntu / RHEL) | Downloads image bundles from `projects.packages.broadcom.com` and files from the Broadcom Support Portal |
| **Admin** | Inside the air-gapped network, reaches vCenter + the Software Depot on the management network | Uploads the bundles into the depot OCI registry, drives the Supervisor |

**Get the helper scripts** — clone the community repo on **both** hosts:

```
git clone https://github.com/vmware/vsphere-supervisor.git
cd vsphere-supervisor/airgapped        # the scripts referenced below live here
```

The scripts used: `oci_image_depot_migrator.py` (download / upload / copy image
bundles), `toggle_software_depot_oci_image_upload.sh` (enable/disable the depot's
write mode), `manage-depot-image-proxy.sh` (create the in-cluster depot proxy).

**OS packages on both hosts:** `wget curl ssh sshpass docker jq yq openssl
python3` plus `imgpkg` (the Carvel tool — `wget -O /usr/local/bin/imgpkg
https://github.com/carvel-dev/imgpkg/releases/latest/download/imgpkg-linux-amd64
&& chmod +x /usr/local/bin/imgpkg`).

**VCF CLI + plugins** (from the Support Portal → *My Downloads* → search *VCF
Consumption CLI* → download **CLI 9.1.0** and **Plugin-Bundle 9.1.0** for your
OS). Install on both hosts:

```
tar -xzvf VCF-Consumption-CLI-Linux_AMD64-9.1.0.tar.gz
sudo install ./vcf-cli-linux_amd64 /usr/local/bin/vcf
vcf version

mkdir -p ~/vcf-plugin-bundle
tar -xvzf VCF-Consumption-CLI-PluginBundle-Linux_AMD64-9.1.0.0.<build>.tar.gz -C ~/vcf-plugin-bundle/
vcf plugin install all --local-source ~/vcf-plugin-bundle/
vcf plugin list        # expect: context, addon, package, ... all "installed"
```

### 4.2 Download the bundles (bastion)

**4.2a — Kubernetes Release OVAs** (the VKS node templates). From the bastion,
per the "air-gapped cluster provisioning" docs, download the OVA(s) for the
Kubernetes versions you will run from `https://wp-content.broadcom.com/v2/latest/`
(one folder per K8s version, each with `.ovf` / `.vmdk` / `.mf`).

**4.2b — Supervisor Service bundles.** Each Supervisor Service is a Carvel
package; you need the **VKS Service** at minimum. For each service:

1. Get the service's YAML definitions (Support Portal, or *vCenter → Supervisor
   Services*). Two variants ship: `*-legacy-*.yml` (direct image URLs) and
   `*-depot-*.yml` (depot URLs). Open the **`legacy`** one.
2. Find the bundle image reference:

   ```
   yq '.spec.template.spec.fetch[].imgpkgBundle.image' \
     vks-service-legacy-3.6.3-*.yml
   # e.g. projects.packages.broadcom.com/vsphere/supervisor/vks-service/3.6.3/vks-service:v3.6.3_vmware.1
   ```
3. Download it to a `.tar`:

   ```
   ./oci_image_depot_migrator.py download \
     -s projects.packages.broadcom.com/vsphere/supervisor/vks-service/3.6.3/vks-service:v3.6.3_vmware.1
   # -> vks-service-v3.6.3_vmware.1.tar
   ```

   Repeat for: **VKS Service** (required); **Harbor** *only if VCF Automation is
   not deployed* (§4.8); any Standard services you use (Contour, cert-manager,
   external-dns, Prometheus, …).

**4.2c — the VKS Standard Packages bundle** (all the add-on images in one):

```
./oci_image_depot_migrator.py download \
  -s projects.packages.broadcom.com/vsphere/supervisor/vks-standard-packages/3.6.0-20260211/vks-standard-packages:3.6.0-20260211
# -> vks-standard-packages-3.6.0-20260211.tar   (several GB)
```

### 4.3 Transfer across the gap

Move to the **admin** host (physical media, one-way diode, guarded SFTP —
whatever your process allows): every `.tar` from 4.2b/4.2c; **both** the
`*-legacy-*.yml` and `*-depot-*.yml` for each service; the Kubernetes Release
OVAs; the VCF CLI + plugin tarballs. Checksum before and after.

### 4.4 Stand up the Supervisor and the OVA content library

1. **Enable the Supervisor** on the air-gapped vCenter — the full
   [`10-supervisor-enablement.md`](10-supervisor-enablement.md) flow (pre-flight,
   CTGW, LB, the **Supervisor Images** content library, the wizard). Note the
   Supervisor endpoint, e.g. `sfo-w01-cl01-sn01.rainpole.io`.
2. **Create a local content library** in vCenter (*Content Libraries → Create →
   Local*, publishing on, a datastore) and **import the Kubernetes Release
   OVAs** from 4.2a — this is the "Create a Local Content Library for air-gapped
   cluster provisioning" step, and it is a **separate** artifact from the OCI
   images.
3. **Create the vSphere namespace(s)** VKS clusters will run in (e.g. `ns01`) —
   assign storage, a VM class, and the local content library.

### 4.5 Prepare the admin host

1. **`kubectl`** from the Supervisor:

   ```
   wget --no-check-certificate https://sfo-w01-cl01-sn01.rainpole.io/wcp/plugin/linux-amd64/vsphere-plugin.zip
   unzip vsphere-plugin.zip
   sudo install ./bin/kubectl /usr/local/bin/kubectl
   kubectl version --client
   ```
2. **Trust the vCenter CA:**

   ```
   wget --no-check-certificate https://sfo-m01-vc01.rainpole.io/certs/download.zip
   unzip download.zip
   sudo cp certs/lin/*.0 /usr/local/share/ca-certificates/ 2>/dev/null || \
     for f in certs/lin/*; do sudo cp "$f" /etc/ssl/certs/$(basename "$f").crt; done
   sudo update-ca-certificates || true
   ```
3. **Log in to the Supervisor with the VCF CLI:**

   ```
   vcf context create sup1 \
     --endpoint https://sfo-w01-cl01-sn01.rainpole.io \
     --username administrator@vsphere.local \
     --type k8s
   vcf context use sup1:ns01
   kubectl get ns            # sanity check
   ```

### 4.6 Relocate the images into the Software Depot OCI registry

1. **Find the Software Depot FQDN** — *VCF Operations → Build → Lifecycle → VCF
   Management → Components → VSP*. Say `sfo-m01-fleet01.rainpole.io`.
2. **Enable offline write** on the depot (temporary — it is off by default and
   you turn it off again in step 5):

   ```
   ./toggle_software_depot_oci_image_upload.sh enable \
     --vsp-host sfo-m01-fleet01.rainpole.io \
     --admin-username admin@vsp.local \
     --admin-password '<vsp-admin-pw>'
   # expect: "offlineWriteEnabled": true
   ```
3. **Upload each bundle.** From the admin host, per `.tar`:

   ```
   ./oci_image_depot_migrator.py upload \
     -s projects.packages.broadcom.com/vsphere/supervisor/vks-service/3.6.3/vks-service:v3.6.3_vmware.1 \
     -t sfo-m01-fleet01.rainpole.io
   ```

   The script reads the matching `.tar`, fetches the depot TLS cert
   (`openssl s_client`), and runs `imgpkg copy --tar … --to-repo …
   --registry-ca-cert-path …`, mapping the source path to a depot path like
   `sfo-m01-fleet01.rainpole.io/vcf-service-vks/ga/3.6.3/vks-service:v3.6.3_vmware.1`.
   Do the **VKS Service**, every other Supervisor Service `.tar`, and the **VKS
   Standard Packages** `.tar`.

   > If the admin host *does* have DMZ reach to
   > `projects.packages.broadcom.com`, use **`copy`** instead of `upload` to
   > stream straight through without staging the `.tar` on the admin host.
4. **Spot-check** one repo exists on the depot:

   ```
   curl -sk https://sfo-m01-fleet01.rainpole.io/v2/_catalog | jq .
   # expect the vcf-service-vks / vks-standard-packages repos listed
   ```
5. **Disable offline write** again (hardening — leave it off):

   ```
   ./toggle_software_depot_oci_image_upload.sh disable \
     --vsp-host sfo-m01-fleet01.rainpole.io \
     --admin-username admin@vsp.local --admin-password '<vsp-admin-pw>'
   # expect: "offlineWriteEnabled": false
   ```

### 4.7 The depot image proxy (so the Supervisor can reach the depot)

The Supervisor runs on the **management network** and *can* route to the depot,
but it pulls by an in-cluster service name. **VCF Automation provides this proxy
automatically when it is deployed.** If **VCF Automation is not deployed**,
create it by hand:

```
./manage-depot-image-proxy.sh add \
  sfo-m01-vc01.rainpole.io \
  '<vc-root-ssh-password>' \
  administrator@vsphere.local \
  '<vc-sso-password>' \
  <supervisor-id>
```

Get `<supervisor-id>` from
`kubectl get supervisors -A` (or the cluster-management API). The script creates
the ExternalName service **`depot-image-proxy.kube-system.svc.cluster.local`**
that forwards Supervisor image pulls to `sfo-m01-fleet01.rainpole.io`.

**Check:**

```
kubectl -n kube-system get svc depot-image-proxy
kubectl -n kube-system run dp-test --rm -it --restart=Never \
  --image=<any-reachable>/curl -- \
  curl -sk https://depot-image-proxy.kube-system.svc.cluster.local/v2/   # -> 200 or 401
```

> **If a Supervisor proxy is also set (§3):** add
> `depot-image-proxy.kube-system.svc.cluster.local` **and**
> `sfo-m01-fleet01.rainpole.io` to its `no_proxy_config` — otherwise the depot
> pull is sent to the corporate proxy and fails.

### 4.8 Harbor for user images (only if you need one)

**Not needed for Supervisor/VKS system images** — those now come from the depot
OCI registry. Deploy Harbor only for **tenant / user** images, or where policy
requires a local registry in the data path.

- **Harbor Supervisor Service 2.14.x** — register the service on vCenter; before
  installing, edit its bundle image reference from the `depot.kube-system.svc/…`
  form to the proxy form:

  ```yaml
  fetch:
    - imgpkgBundle:
        image: depot-image-proxy.kube-system.svc.cluster.local/supervisor-service-harbor/ga/2.14.2/harbor:v2.14.2_vmware.2-vks.1
  ```

  Then install per "Deploy Harbor Supervisor Service in VVF without VCFA".
- **VMware Bootstrap Registry Appliance** — a hardened Photon 5 OVA shipping an
  OCI Harbor. Use it as *Registry 0* to bootstrap the Harbor Supervisor Service
  on a fully isolated site, then retire it once Harbor Service (*Registry 1*) is
  healthy.

**Trust Harbor's CA** on the Supervisor/VKS side —
`TkgServiceConfiguration.spec.trust.additionalTrustedCAs` ([§3 Step 4](#step-4--set-the-vks-tkgserviceconfiguration-proxy)).

### 4.9 Deploy a cluster and validate

1. **The add-on repository points at the depot:**

   ```
   vcf addon repository list
   # default-addonrepository-3.6.0-regional-harbor  ->
   #   depot.kube-system.svc/vcf/vks-standard-packages/ga/3.6.0-20260211/vks-standard-packages:3.6.0-20260211
   ```
2. **Create a VKS cluster:**

   ```
   kubectl -n ns01 create -f vks-w01.yaml
   kubectl -n ns01 get cluster,machines -w
   ```

   All machines reach `Running`; `kubectl -n ns01 describe cluster vks-w01`
   shows `Ready`.
3. **Every system pod pulled from the depot** — on the guest cluster
   (`vcf context use sup1:ns01:vks-w01`):

   ```
   kubectl get pods -A | grep -Ev 'Running|Completed'          # empty
   kubectl get pods -A -o jsonpath='{range .items[*]}{range .spec.containers[*]}{.image}{"\n"}{end}{end}' | sort -u
   ```

   The image list shows **`sfo-m01-fleet01.rainpole.io/…`** (or the
   `depot-image-proxy…` name) — **nothing** on
   `projects.packages.broadcom.com`.
4. **Install a Standard package from the depot:**

   ```
   vcf addon available list cert-manager
   vcf addon install create cert-manager \
     --addon-release-name cert-manager.kubernetes.vmware.com.1.19.1-vmware.1-vks.1 \
     --namespace ns01 --cluster-name vks-w01
   kubectl get pods -n cert-manager                             # Running
   ```

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
