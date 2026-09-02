# vDefend Security Services Platform (SSP) — Deploy & First-Time Configuration

The **vDefend Security Services Platform (SSP)** is the analytics/services
platform that runs the advanced vDefend features — **Security Intelligence**
(traffic analysis + firewall-rule recommendations), **Network Detection and
Response (NDR)**, **Network Traffic Analysis (NTA)** and the **Malware
Prevention Service**. The plain Distributed Firewall and Distributed IDS/IPS do
**not** need it; everything above them does.

> **Three "SSP" things, don't conflate them.**
> - **SSP Installer (SSPI)** — the appliance you deploy *first*; it hosts the
>   packages and deploys/upgrades/backs-up the instances. Covered in
>   [`15-license-hub.md`](15-license-hub.md) (it is the same appliance that
>   deployed the 5.1.2 License Hub instance).
> - **SSP instance** — what this page is about: the Security Services Platform
>   itself, a Kubernetes cluster of controller + worker VMs.
> - **License Hub** — a *different* instance type deployed from the same
>   installer, licensing vDefend + Avi. [`15-license-hub.md`](15-license-hub.md).
>
> One SSP Installer can deploy **up to five instances** (5.2), any mix of SSP /
> License Hub / Avi Operations.

> **Sourcing.** This page is **TechDocs-scaffolded** against SSP `5.2` /
> `5.1` (`vdefend/security-services-platform`), not yet field-verified end to
> end. Steps that share the SSP Installer wizard with the License Hub instance
> deploy in [`15-license-hub.md`](15-license-hub.md) are field-verified *there*
> (2026-07-22) and cross-referenced rather than re-derived. Anything marked
> **[verify]** needs confirming against your build / TechDocs revision before
> you rely on it.

## Contents

| # | Section | Use it when |
| - | ------- | ----------- |
| 1 | [Prerequisites](#1-prerequisites) | Before you open Instance Management |
| 2 | [Form factors and footprint](#2-form-factors-and-footprint) | Sizing the instance and its IP pools |
| 3 | [Deploy the instance](#3-deploy-the-instance) | The SSP Installer wizard, screen by screen |
| 4 | [First-time configuration](#4-first-time-configuration) | Onboard NSX Manager, activate features |
| 5 | [Licensing](#5-licensing) | Making the features actually run |
| 6 | [Backup](#6-backup) | The one backup that matters here |
| 7 | [References](#7-references) | The TechDocs behind the above |

---

## 1. Prerequisites

- **SSP Installer already deployed and healthy**, with the **SSP package
  uploaded** under *Package Management* (same as the License Hub `.tar` flow in
  [`15-license-hub.md`](15-license-hub.md) — *Not in use* until an instance
  consumes it). Take the package from the same Broadcom Support Portal release
  page; it is **not** depot-fed.
- **vCenter** — supported: *"Version 9.1"*, *"Version 9.0, 9.0.1, 9.0.2"*,
  *"Version 8.0 Update 3 or later"*. An **administrator** credential and the
  vCenter **trusted root CA certificate** in hand (the same retrieval step, and
  the same "which cert from the ZIP" gotcha, as the SSP Installer's own vCenter
  connection — see [`15-license-hub.md`](15-license-hub.md)).
- **DRS on**, and **Storage DRS (SDRS) not supported** on the cluster SSP
  deploys to. TechDocs, verbatim: *"Storage DRS (SDRS) is not supported"* and
  *"Do not disable DRS on the vSphere cluster"*.
- **Storage policy** — no VM-encrypted policy, no third-party VM encryption
  (same restriction as the License Hub instance), and it is **immutable** after
  deploy. **[verify]** against the 5.2 requirements page for your revision.
- **A distributed port group** on a **vDS** for the instance network — a
  standard switch is not an option.
- **DNS: three FQDNs** (see §3), each with an **A + PTR** record, mapping into
  the service IP pool. **NTP** reachable (clock skew breaks the platform's
  certificate/token exchange — treat as required even where the field is not).
- **A free, contiguous IP block** on one subnet for the **node pool** and
  **service pool** (sizes in §2) — scattered spare addresses will not do; the
  pools are **immutable** after deploy.
- **NSX Manager** reachable from the instance, with an **Enterprise Admin**
  credential and the NSX Manager certificate to hand for §4.
- **License Hub deployed and holding a vDefend licence** — see §5 and
  [`15-license-hub.md` → Licensing vDefend endpoints](15-license-hub.md#licensing-vdefend-endpoints).

## 2. Form factors and footprint

All form factors are **3 controllers + N workers**. Per TechDocs 5.2 system
requirements:

| Form factor | Controllers | Workers | Total vCPU (cores) | Total memory | Total storage | Node pool | Service pool |
| ----------- | ----------- | ------- | ------------------ | ------------ | ------------- | --------- | ------------ |
| **Medium**  | 3 | 2 | 64 (32) | 222 GB | 3.26 TB | 7 addresses | 5 addresses |
| **Large**   | 3 | 4 (2–8) | 96 (48) | 350 GB | 3.6 TB | 9–13 addresses | 5–7 addresses |
| **Extra-Large** | 3 | 8 | 160 (80) | 606 GB | 6.12 TB | 14–22 addresses | 7–11 addresses |

Per-node: **controller** = 4 vCPU / 8 GB / 75 GB; **worker** = 16 vCPU / 64 GB /
155 GB. (The SSP Installer VM itself is 4 vCPU / 6 GB / 400 GB, already deployed.)

> **"Medium" is the 2-node marketing form factor.** SSP 5.2's "lighter
> footprint" 2-worker option *is* Medium (3 controllers + 2 workers) — it still
> delivers production Security Intelligence, Rule Analysis and DFW at scale.
> Malware Prevention / NDR at volume push you to Large or XL. **[verify]** the
> exact per-feature sizing guidance for your scale.

Check the total against **management-cluster admission-control headroom** before
deploying — like the License Hub instance, SSP lands with resource
**reservations** by default.

## 3. Deploy the instance

The SSP instance deploys from the **already-running SSP Installer**, through the
**same three-step wizard** documented (and field-verified) for the License Hub
instance in [`15-license-hub.md` → "What the License Hub deploy wizard asks
for"](15-license-hub.md#license-hub-512-ssp-installer-flow). Read that table for
the field-level detail and the gotchas (immutable Instance Name / FQDN /
storage policy; DVS + port group required; content-library datastore required;
Reserve Resource on by default; the strict password rules). What differs for an
SSP instance:

1. **Instance Management → Deploy an Instance** → choose **Security Services
   Platform** as the deployment type (the same menu offers License Hub and Avi
   Operations).
2. **Step 1 — Define Instance and Required FQDN(s):** pick the **SSP package
   version**; set the **Instance Name** (lowercase, ≤ 32 chars, **immutable**);
   the **Instance FQDN** (→ 1st service-pool IP, **immutable**) and **Messaging
   FQDN** (→ 2nd service-pool IP); the **form factor** from §2; instance
   passwords.
3. **Step 2 — Select vCenter Parameters:** vCenter connection (existing or
   add-new with the root CA cert), Data Center, Cluster, **Storage Policy**
   (**immutable**, no encryption), **Content Library & VM Datastore**, Resource
   Pool (optional), Reserve Resource (on).
4. **Step 3 — Configure Connectivity Options:** **DVS + distributed Port
   Group**; **Subnet** (CIDR) + **Default Gateway**; **Node IP Pool** and
   **Service IP Pool** ranges sized per §2; **NTP** (up to 5, IP or FQDN);
   **DNS** (up to 5, IP only); **Search Domain**.
5. **Pre-Checks:** a **pre-check VM is deployed** to validate network + storage;
   it checks vCenter access, cluster CPU/memory, datastore, storage policy,
   network config, FQDN/domain, NTP and node-pool reachability. **Errors block;
   warnings do not.** Re-runnable in place.
6. **Deploy:** phased tasks — **vCenter Configuration** (creates a content
   library), **Workload Cluster** (the bulk — the instance comes up as a
   controller + worker cluster), **Security Platform**, **Metrics**. TechDocs
   gives no expected duration; budget hours.
7. Wait for the instance to report **Healthy** in **Instance Management**, then
   reach the SSP UI at its **Instance FQDN** and log in with the passwords set
   in Step 1.

> **The three FQDNs.** Installer access (already set when you deployed the
> installer), **Instance FQDN** (SSP UI / API), **Messaging FQDN** (internal
> components). The instance + messaging records map to the **first two service
> pool addresses**; get the A + PTR records in **before** deploy so the domain
> pre-check does not stop you.

> **On vSAN stretched clusters** there is a separate *"Deploy on vSAN Stretched
> Configuration"* procedure — do not use the standard flow. **[verify]** the
> witness / host-group specifics against TechDocs for your topology.

## 4. First-time configuration

Once the instance is **Healthy**:

1. **Onboard NSX Manager** — SSP UI → **Getting Started** tab:

   | Field | Value |
   | ----- | ----- |
   | **FQDN / IP Address** | NSX Manager **VIP**, FQDN, or a unified-appliance node IP |
   | **Username / Password** | NSX Manager **Enterprise Admin** credentials |
   | **Certificate** | *"Browse Local Files"* and choose the NSX Manager certificate you saved earlier — with a VIP configured, the **MGMT_CLUSTER REST VIP** certificate; otherwise the REST API certificate for the FQDN/IP you entered |
   | **NSX Manager Name** | Required on NSX 4.2.1+, **cannot be changed after** |

   There is **no thumbprint / accept-cert button** — the certificate must be in
   hand before you open the dialog (same shape as every other endpoint the SSP
   Installer and License Hub connect to).

2. **Review the service-activation summary** and click **Continue**. Confirm
   readiness = **READY**, cluster status = **Stable**, connectivity = **Up**.

3. **In NSX**, confirm *Security → Distributed Firewall → Distributed Firewall
   Service* is **On** (on by default, but re-enable it here if it has been
   turned off — **[field-verified]**). The vDefend feature set builds on the
   distributed firewall data path.

4. **Activate features per licence** — SSP UI → **Platform & Features**:
   - **Security Intelligence + NDR + NTA** — SSP 5.2 offers **one-click**
     activation for the three together.
   - **Network Detection and Response** — log in to the SSP UI with Admin, open
     the **Network Detection & Response** window under Platform & Features.
   - **Malware Prevention Service** — activating it prompts for a **cloud
     region** (the Broadcom cloud analysis endpoint); if already active the
     selected region is shown. **[verify]** the exact region list and whether a
     proxy setting is offered here for constrained-egress sites.

> **NSX is the licence authority for the features.** TechDocs: *"Security
> Services Platform uses NSX Manager for license management and activation of
> security features."* So the onboarded NSX Manager must itself be licensed for
> vDefend (§5) — an unlicensed NSX Manager onboards fine but the feature
> activation in step 4 will be gated.

> **Egress.** NDR and Malware Prevention send telemetry / samples to a Broadcom
> cloud region. A constrained-egress or air-gapped site needs that path planned
> (or the features run degraded / local-only). **[verify]** the exact
> destinations for [`07-firewall-ports.md`](07-firewall-ports.md).

## 5. Licensing

SSP endpoints are licensed **through License Hub**, not on the platform
directly. The full chain — load the vDefend licence file into the hub, put the
License Hub VMs on the NSX DFW exclusion list, onboard **NSX Manager** and the
**SSP** as endpoints, assign the licence, point NSX at the hub — is in
[`15-license-hub.md` → Licensing vDefend endpoints](15-license-hub.md#licensing-vdefend-endpoints).

> **Three licensing layers — "it's done in the Pulse portal" is a half-truth.**
> | Layer | Where | What happens there |
> | ----- | ----- | ------------------ |
> | **1. Pulse portal** | `portal.pulse.broadcom.com` (the "Avi Cloud Console") | Register the hub; assign the subscription to the hub; generate licence files (disconnected mode); usage reporting. Needs the Broadcom account holder. **Not** on Broadcom's public URLs list (proxy-allowlist gotcha). |
> | **2. On-prem License Hub** | the appliance | Load the licence file into *Licenses*; onboard endpoints; assign licences to them. Registration alone brings none. |
> | **3. The endpoint** | **NSX Manager** | The vDefend licence authority — the feature activation in §4.4 is gated on NSX Manager being vDefend-licensed through the hub. |
>
> Entitlement and assignment-to-hub happen at Pulse; actual licence
> distribution to NSX/SSP happens through the on-prem hub. Full detail in
> [`15-license-hub.md`](15-license-hub.md#licensing-vdefend-endpoints).

Order relative to this page: the hub must exist and hold a vDefend licence
**before** the feature activation in §4.4 will succeed. Deploying the SSP
instance itself does not require the licence; **using** it does.

## 6. Backup

The backup that matters is the **SSP Installer's** — it is the only migration
path if the management vCenter is ever renamed or re-addressed, and it
authenticates to the SFTP target with a **public key**, not the password in its
own dialog. See [`08-backup-target.md` §6](08-backup-target.md#6-the-ssp-installer-is-the-odd-one-out).
The SSP instance is redeployed/restored *from* the installer, so a good
installer backup is the instance's safety net too.

## 7. References

TechDocs (`vdefend/security-services-platform`):
- [Security Services Platform Overview (5.2)](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/security-services-platform/5-2/security-services-platform-overview.html)
- [Deployment Requirements / System Requirements (5.2)](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/security-services-platform/5-2/security-services-platform-installer/configuring-pre-deployment-requirements.html)
  — form factors, footprint, IP-pool sizes, SDRS-not-supported.
- [Instance Management → Deploy an Instance (5.2)](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/security-services-platform/5-2/security-services-platform-installer/configuring-instance-management.html)
- [Deploy Security Services Platform (5.0 — full wizard walkthrough)](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/security-services-platform/5-0/security-services-platform-installer/deploy-ssp.html)
- [Onboard NSX Manager / Getting Started (5.0)](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/security-services-platform/5-0/onboarding-and-managing-platform/onboarding-ssp/connect-to-nsx-manager.html)
- [Activate Network Detection and Response (5.1)](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/security-services-platform/5-1/getting-started-with-nsx-network-detection-and-response/nsx-network-detection-and-response-workflow/activate-the-nsx-network-detection-and-response-feature.html)
- [License Management (5.1)](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/security-services-platform/5-1/onboarding-and-managing-platform/onboarding-ssp/licensing/license-management.html)
- [Security Services Platform 5.2 Release Notes](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/security-services-platform/5-2/release-notes/security-services-platform-52-release-notes.html)

VCF 9.1 design blueprint:
- [Security Services Platform for VMware Cloud Foundation — detailed design](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/security-modernization/vdefend-lateral-security/security-services-platform-for-vmware-cloud-foundation/security-services-platform-detailed-design.html)
