# Certificates in VCF 9.1 — Build Guide

Every VCF component comes up with a certificate from the **VMware Certificate
Authority (VMCA)**. TechDocs: *"During deployment, each component is assigned
a certificate from a default signing Certificate Authority (VMware Certificate
Authority CA)."* Replacing those with certificates your organisation trusts,
and keeping them valid afterwards, is a Day-N job in **VCF Operations**. It is
also the step where a missing DNS name, an approval-gated CA template or two
batches fired at once costs a change window.

This page puts the whole subject in one place: what VCF Operations manages
([§1](#1-what-vcf-operations-manages)), which CA to use
([§2](#2-choose-the-ca)), preparing a Microsoft CA
([§3](#3-prepare-a-microsoft-ca)), configuring the CA for the fleet
([§4](#4-configure-the-ca-for-the-fleet)), the certificate pass itself
([§5](#5-the-certificate-pass)), renewal and expiry
([§6](#6-renewal-and-expiry)), and the trust relationships that live outside
the certificate pages ([§7](#7-trust-outside-the-certificate-pages)).

Where it sits in the project: the CA is a prerequisite
([`prerequisites.md` → Certificate Authority](prerequisites.md#certificate-authority)),
its inputs are collected in Step 1 ([`01` §F](01-network-dns-plan.md#f-certificates))
and the intake ([`02` §D](02-intake.md#d-pki--certificate-team)), and the
pass itself is deployment-plan story **E8 8.5** (optionally partly in **E6
6.2**), see [`06-deployment-plan.md`](06-deployment-plan.md).

[![The certificate pass in VCF 9.1: prepare the CA, configure it for the fleet, generate CSRs in batches, then either replace with a configured-CA certificate (VMCA, Microsoft CA, OpenSSL) or download the CSRs, have an external CA sign them, import and replace with the imported certificate. Verify each batch by its n/total counter and the task list. Afterwards, configured-CA certificates can renew automatically 60 days before expiry or be renewed by hand; external-CA certificates go through the three manual steps again; expired certificates need vcf-cert-tool (KB 445742) with Broadcom Support.](../web/public/diagrams/certificate-pass.png)](../web/public/diagrams/certificate-pass.svg)

> **Evidence level:** TechDocs VCF 9.1 *Managing Certificates in VMware Cloud
> Foundation* and its eleven sub-pages, and the *Certificate Management*
> design blueprint (five pages), all last updated 2026-11-12 and read
> verbatim on 2026-11-16; KB 445742 on the same day. The batch behaviour,
> the CSR placeholders and the NSX backup failure are **field-verified
> 2026-07-22** on a real deployment. The *Deactivated* auto-renewal status on
> a fresh fleet is **field-observed** on the same deployment. OpenSSL as a
> fleet CA was **verified in-product** (#68, #69).

---

## 1. What VCF Operations manages

### 1.1 Three categories

| Category | VCF Operations can | Who changes it |
| --- | --- | --- |
| **User-managed** | View, monitor, generate CSRs, import, replace, auto-renew: *"full lifecycle management"* | You, in VCF Operations |
| **Externally managed** | View and monitor, with *"expiry alerts"* | *"The individual components own the management of these certificates. Users must replace or renew these certificates through the component's own UI, API, or CLI."* |
| **System-managed** | Nothing visible; *"alerts for unrecoverable issues only"* | The component itself, *"during routine operations such as upgrades"* |

### 1.2 Which components

| VCF management components | VCF instance / domain components | Standalone |
| --- | --- | --- |
| VCF Operations, VCF Automation, VCF Operations for networks, Log management, License server, Identity broker, VCF management services, Cloud proxy | ESX, vCenter, NSX Manager, SDDC Manager, VCF Operations HCX, Avi Load Balancer, vSphere Supervisor | ESX, vCenter, vSphere Supervisor |

- **Cloud proxy, License server and vSphere Supervisor** are covered from
  **9.1.1**: *"Starting with VCF 9.1.1 and later, certificate management
  coverage expands to include"* those three.
- **HCX and Avi need a management pack** in VCF Operations before their
  certificates show up (*Management Pack for VCF Operations HCX*, *Management
  Pack for VMware Avi Load Balancer*).
- **Older environments:** VCF instances from **5.2**, and standalone vCenter
  and ESX from **8.0 Update 3**.
- **ESX certificate mode changes.** *"Using VCF Operations to changes ESX
  certificates changes the vCenter vpxd.certmgmt.mode setting to Custom"*,
  and from then on *"all subsequent renewals must be managed centrally by
  using VCF Operations"*.

### 1.3 Non-disruptive certificate updates

Since 9.0, a renewed or replaced **leaf** certificate is picked up by the
components that depend on it: they *"retrieve the new certificate, verify
it, and update their trust stores without a manual re-trust"*. Supported on
ESX, vCenter, SDDC Manager, NSX, VCF Operations, VCF Operations for
networks, HCX, VCF Automation, VCF management services, Log management, and
Avi from 22.1.6.

Two limits to plan around:

- *"NDC does not cover the replacement of root or intermediate CA
  certificates. When a root CA changes without a corresponding leaf
  certificate change, manual remediation is required."* Moving to a new CA
  hierarchy is therefore its own project, not a renewal.
- *"NDC relies on the previous private key of the component."*

### 1.4 What VCF Operations can't do

- **Replace or renew root or intermediate certificates.**
- **Replace or renew an expired certificate.** Use `vcf-cert-tool`
  ([§6.4](#64-expired-certificates)).
- **Renew certificates from an external CA or self-signed ones.** *"You
  perform a 3-step manual replace (generate CSR, import the signed
  certificate, and replace)."*
- **Use VMCA as an intermediate of your CA.** *"VCF does not support
  configuring the VMCA as a customer intermediate CA for both greenfield and
  brownfield deployments that are converged or upgraded to VCF 9.1."*
- **Manage ESX certificates whose private keys live outside the host** (an
  HSM, for example): *"the keys remain outside the visibility of VCF
  Operations, so VCF Operations cannot be used to manage those ESX host
  certificates."*

Broadcom's design guidance on tools: manage certificates *"exclusively
through VCF Operations"*; SDDC Manager's certificate APIs only *"for backward
compatibility"*; and *"Do not use vCenter (API, UI, CLI) to manage ESX host
or vCenter certificates once those certificates are being managed by VCF
Operations"*, because it *"creates orphaned CSRs in vCenter and results in a
"Source of Truth" conflict"*.

---

## 2. Choose the CA

VCF Operations knows three **configured** CA types and, besides those, an
**external** CA that you use by hand:

| CA | What it is | Fits |
| --- | --- | --- |
| **VMCA** | The default; every component starts with a VMCA-signed certificate | Labs and isolated environments; Broadcom's default for ESX (below) |
| **Microsoft CA** (MSCA) | *"an enterprise CA that runs on Windows Server with Active Directory Certificate Services"*, reached through Web Enrollment | An existing Microsoft PKI; renewals automatic |
| **OpenSSL CA** | *"a certificate service hosted within VCF Operations"*; it creates its own self-signed root | Supported (verified in-product, #68 / #69), but Broadcom positions it for *"testing or development environments"*: it *"cannot be chained into an existing external CA hierarchy"* |
| **External CA** | Any CA: VCF generates the CSR, you get it signed, you import the result | Non-Microsoft enterprise PKI, or policies that need human approval per certificate |

What each can do (TechDocs, *Certificate Operations by Certificate Authority
Type*):

| Operation | Configured CA | External CA | Self-signed |
| --- | --- | --- | --- |
| Generate CSR, import, replace | Yes | Yes | Yes |
| Auto-renew | Yes | **No** | **No** |
| Manual renew | Yes | **No** | **No** |
| Replace with a VMCA-signed certificate | Yes, from 9.1.1 | Yes, from 9.1.1 | Yes, from 9.1.1 |

**The private key never leaves VCF.** When you generate a CSR, *"the
corresponding private key is retained in the VCF Operations keystore. When
the CA-signed certificate is imported in VCF Operations, the certificate is
validated with the stored private key."* So you can't import a certificate
and key created entirely outside VCF. If policy demands externally generated
keys, Broadcom's design guide points to the API: *"API-Based Automation is
the only viable path. Native Auto-Renewal relies on VCF generating the
keys."*

**Design defaults from Broadcom's blueprint:**

| Component | Recommended | Trade-off |
| --- | --- | --- |
| **ESX hosts** | *"Default VMCA"*: *"The default and recommended option for VCF fleets"* | Host certificates *"do not chain to the enterprise Certificate Authority"*. If they must, use the enterprise CA through VCF Operations; that adds *"a one-time certificate replacement activity"* and a dependency on the CA |
| **vCenter Machine SSL** | *"Enterprise CA"*, *"to avoid browser and client trust warnings"* | VMCA only for *"lab or small, isolated environments"* |
| **Management components** | *"Default CA-signed certificates on VCF management components should be replaced with certificates that are issued by a trusted enterprise Certificate Authority before going to production."* | — |

Once the hosts carry enterprise-CA certificates, new hosts must too:
[`40` §1.4](40-host-commissioning.md#14-certificates-follow-the-management-domain).

**How to keep them current** (design guide, *VCF Certificate Lifecycle
Automation*):

| Approach | When | Watch out |
| --- | --- | --- |
| **Auto-renewal** | Most fleets | *"no administrative control over task scheduling"*; *"unsuitable for environments requiring short-lived certificates (less than 60 days) or manual approval workflows"*; needs the CA reachable at all times |
| **API-based automation** | Change-controlled environments, custom schedules, external key custody | You own the workflow, its error handling and audit trail |
| **Manual** | *"Small or isolated environments"*, or temporarily | *"high operational overhead at scale"* |

---

## 3. Prepare a Microsoft CA

Four steps on the CA side, from TechDocs *Prepare Your Microsoft Certificate
Authority to Allow VMware Cloud Foundation to Manage Certificates*. Hand
this section to the PKI team.

**1. Roles.** Active Directory Certificate Services with **Certification
Authority** and **Certification Authority Web Enrollment**.

> **Same server or not?** TechDocs disagrees with itself (all pages last
> updated 2026-11-12). *Configure a Certificate Authority* says *"With VCF
> Operations 9.1 and later"* the two roles may be on different machines. The
> role and basic-authentication pages say *"9.1.1 and later"*, and: *"For
> VCF Operations 9.1.0.x The Microsoft Certificate Authority and IIS must be
> installed on the same server."* Safe reading: **same server on 9.1.0.x**,
> separate servers allowed from **9.1.1**.

**2. Basic authentication** on IIS: add the *Basic Authentication* role
service (Web Server → Security), enable it on *Default Web Site → CertSrv*,
restart the site.

**3. Certificate template**, duplicated from **Web Server**:

| Tab | Setting |
| --- | --- |
| Compatibility | Certification Authority **Windows Server 2008 R2**; certificate recipient **Windows 7 / Server 2008 R2** |
| General | Display name, for example **`VMware`** (this is the name you give VCF) |
| Extensions → Application Policies | **Remove Server Authentication** |
| Extensions → Basic Constraints | **Enable this extension** |
| Extensions → Key Usage | Tick **Signature is proof of origin (nonrepudiation)**, keep the rest |
| Subject Name | **Supply in the request** |

Then issue it: *certsrv.msc → Certificate Templates → New → Certificate
Template to Issue*.

> **No manual approval on this template.** Field-verified 2026-07-22: a bulk
> generate sends every selected CSR at once, and an approval-gated template
> turns that into a stalled queue rather than an error.

**4. Service account** with least privilege, a normal domain user (Broadcom's
example `svc-vcf-ca`):

| Where | Allow | Deny (leave unticked) |
| --- | --- | --- |
| The CA (*certsrv.msc → Properties → Security*) | **Issue and Manage Certificates**, **Request Certificates** | Read, Manage CA |
| The `VMware` template (*certtmpl.msc*) | **Read**, **Enroll** | Full Control, Write, Autoenroll |

**Network:** VCF Operations must reach the CA's Web Enrollment over **443**
([`07-firewall-ports.md`](07-firewall-ports.md); TechDocs points to the
Ports and Protocols tool).

---

## 4. Configure the CA for the fleet

*VCF Operations → **Manage** → Fleet Management → **Certificates** →
**VCF Management** → **Configure CA for Fleet**.* One setting for the whole
fleet.

**Microsoft CA:**

| Field | Value |
| --- | --- |
| CA Server URL | Must *"begin with https:// and end with certsrv"*, for example `https://ca01.rainpole.io/certsrv` |
| User Name | The service account in **UPN format**: *"You must use the UPN format for the user name"*, for example `svc-vcf-ca@rainpole.io` |
| Password | The service account's password |
| Template Name | The template from §3, for example `VMware` |

**OpenSSL:** Common Name (TechDocs: *"the FQDN of the SDDC Manager
appliance"*), Country, Locality, Organization, Organizational Unit, State
(written out in full). VCF Operations then *"generates a self-signed root CA
certificate using the organization details you provide"*: distribute that
root to every client that must trust the fleet.

---

## 5. The certificate pass

### 5.1 Before you start

- **Every component needs a DNS name.** *"VCF 9.1 enforces strict
  certificate validation and requires an FQDN for the VCF component in the
  Subject Alternative Name (SAN) field."* VCF Operations does RFC 6125
  hostname checks, and *"A certificate that contains only an IP address in
  the SAN field does not satisfy the hostname verification requirement."*
  Components deployed IP-only (VCF Operations for networks, see
  [`05` §B.2](05-day2-deployments.md)) need a name planned in Step 1.
- **No short names in a SAN.** *"Dot-less shortnames in the SAN field are
  not supported"*, and *"If a dot-less shortname is included alongside an
  FQDN or an IP address, the entire CSR generation fails."*
- **Components without an FQDN** (vSphere Supervisor can be IP-only) may use
  *"A domain-structured FQDN string, for example, supervisor.local or
  component.internal"*, a Punycode label, or `localhost`, whichever your CA
  accepts.
- **External load balancer in front of a clustered component** (VCF
  Operations, for example): the SAN must hold *"the FQDNs of the load
  balancer and all component nodes"*, and IP Name *"the IP addresses of the
  load balancer and all component nodes"*.
- **Key sizes:** RSA **2048, 3072 or 4096**. Check the site's crypto policy.
- **No NSX backup in the window.** Field-verified 2026-07-22: the one failure
  in a batch was an NSX Manager with an NSX backup running. Whether the
  rotation triggers a backup itself is not confirmed. Check no backup is
  running or scheduled, and give NSX Manager its own batch.
- **A fresh VCF Operations backup** before the first batch.

### 5.2 Generate CSRs

*Manage → Fleet Management → Certificates → VCF Management* (or a VCF
instance or domain). Select one or more components, ellipsis →
**Generate CSR**. Since 9.1 this works for many components at once.

| Field | What to enter |
| --- | --- |
| Organization, OU, Country, State, Locality | Your values. **Field-verified 2026-07-22:** the dialog pre-fills Broadcom's own placeholders (Organization `Broadcom`, OU `vcfms`, United States, `CA`, `Palo Alto`). Agree the subject with the CA owner; the template may enforce it anyway |
| Email Address | Optional |
| Key Size | 2048 (default), 3072 or 4096 |
| Common Name | The component FQDN |
| Subject Alternative Name | Every FQDN, per §5.1 |
| IP Name | The component's IPs: *"To avoid issues with certificate validation, do not leave this field blank."* |

### 5.3a Replace with a configured-CA certificate

*Select the components → ellipsis → **Replace with configured CA
certificate** → select the CA → Confirm.* Field-verified 2026-07-22: the
dialog says *"Last generated Certificate Signing Requests (CSRs) will be used
for generating certificate(s)"*. If a component's SANs or FQDN changed since
its last CSR, generate a new one first, or you sign a stale request.

### 5.3b Replace with an external-CA certificate

1. **Download the CSRs** (ellipsis on the component) and have your CA sign
   them.
2. **Import:** *Certificates → ellipsis → **Import Certificates***. Up to
   **20 files** at once; `.crt`, `.cer`, `.pem`, `.p7b`, `.p7c`; base64 only.
   Pasted text goes as server certificate plus CA certificate, the CA part as
   intermediate(s) followed by the root. As files: *"first, import the leaf
   certificate, then all intermediate certificates, and finally the root
   CA."* Click **Validate**, then **Import**.
3. **Replace:** select the components → **Replace with imported
   certificate** → pick the imported certificates → Confirm.

### 5.4 Run it in batches, one at a time

Field-verified 2026-07-22:

- **Never two batches at once.** The replace dialog requires you to
  acknowledge: *"Each certificate rotation can trigger automated retrust
  operations across dependent components. To avoid system instability, wait
  for any current or ongoing batch operations to be completed before
  starting the next."* Plan fewer, larger batches with a settling pause.
- **A batch doesn't stop on a failure.** The others carry on. The **n/total
  counter** (`5/6` = one failed) and the task list are the only signal. Re-run
  the failures as their own batch afterwards.
- **A suggested order:** management components first, then per VCF instance
  vCenter, NSX Manager (alone), SDDC Manager, and ESX hosts in groups. This
  order is a planning suggestion, not a Broadcom requirement.

### 5.5 Check

- The certificate list: issuer, expiry and SANs per component. Certificate
  metadata is collected *"every 6 hours"* and right after a successful
  generate, replace, renew or configure-CA task.
- Each component's own UI in a browser, from the jump host, with the
  enterprise root trusted: no warning.
- Integrations that pin certificates rather than trust a CA. Known one: the
  SDDC Manager log agent from KB 396643 pins the Log Management certificate
  and needs its script run again
  ([`05` §B.6](05-day2-deployments.md#b6--log-management-does-not-collect-sddc-managers-own-logs)).

### 5.6 Checklist

| # | Item | Done |
| --- | --- | --- |
| 1 | CA type chosen per component group (§2), auto-renewal or not | ☐ |
| 2 | Microsoft CA: roles, basic auth, template without approval, service account (§3) | ☐ |
| 3 | 443 from VCF Operations to the CA open | ☐ |
| 4 | CA configured for the fleet, UPN user name (§4) | ☐ |
| 5 | Every component has an FQDN with A + PTR; no short names in SANs | ☐ |
| 6 | Subject fields agreed; Broadcom placeholders replaced | ☐ |
| 7 | VCF Operations backup taken; no NSX backup in the window | ☐ |
| 8 | Batches planned, one at a time; NSX Manager alone | ☐ |
| 9 | Each batch: n/total complete, failures re-run | ☐ |
| 10 | Per component: issuer, expiry, browser check | ☐ |
| 11 | Pinned integrations redone (SDDC Manager log agent) | ☐ |
| 12 | Auto-renewal on where intended (§6.1); expiry alerts routed (§6.3) | ☐ |

---

## 6. Renewal and expiry

### 6.1 Automatic renewal

- Only for certificates signed by **VMCA, Microsoft CA or OpenSSL CA**:
  *"VCF Operations cannot auto-renew certificates signed by an external CA."*
- *"Automatic renewal happens 60 days before a certificate expires."*
- *"You must manually renew a certificate before turning on auto-renewal if
  that certificate is due to expire in 60 days or less."*
- Set **separately** for VCF management components and per VCF instance:
  *Certificates → VCF Management* or a VCF instance → **Activate
  Auto-renewal** toggle.
- **It is opt-in.** Field-observed: on a freshly deployed 9.1 fleet the
  *Auto-renewal Status* column showed **Deactivated**. Don't assume the
  fleet renews itself.

### 6.2 Manual renewal

For the same configured-CA certificates: select → **Renew certificate** →
confirm. Several at once is possible. Not for root, intermediate,
self-signed or expired certificates.

### 6.3 Watch expiry

- VCF Operations raises expiry alerts for user-managed and externally managed
  certificates. Broadcom recommends its *"built-in alerts and notifications
  mechanism"*, which *"Requires integrations with the notification plugin in
  VCF Operations for outbound alerting"*. Without a notification target
  nobody hears about them.
- **External-CA certificates** never renew themselves: each needs the three
  manual steps again before expiry. Name an owner (intake **D6**).
- Broadcom also recommends **Audit Records** in VCF Operations, keeping
  certificate events in **Log Management**, and giving certificate *Manage*
  and *View* permissions only to the roles that need them.

### 6.4 Expired certificates

VCF Operations can't replace or renew an expired certificate. TechDocs
points to the **VCF Certificate Management Tool** (`vcf-cert-tool`,
[KB 445742](https://knowledge.broadcom.com/external/article/445742)): a
menu-driven CLI that brings together the older repair tools (*"vCert, CARR,
and certmgr"*) for vCenter and ESX (8.0 U3+), NSX (4.2+), the Supervisor,
VCF Operations and Cloud Proxy (8.18+). Download: Broadcom Support Portal →
VMware Cloud Foundation 9 → release → *Drivers & Tools* → *VCF certificate
tool*.

The KB's warnings: *"vcf-cert-tool is intended to be used at the direction
of Broadcom Support"*, *"Changes made could render a system inoperable"*,
and *"Replacing certificates using this tool will not automatically update
existing trust relationships."* Open a case first; take backups.

---

## 7. Trust outside the certificate pages

These are covered on their own pages; this list is where to look.

| What | Problem | Where |
| --- | --- | --- |
| **License Server → vCenter** | VCF Operations pushes the License Server certificate into vCenter's trusted roots; missing privileges, a proxy or a missing trust all give the same error. Manual workaround, and re-import after each License Server patch | [`26` → License Server certificate trust](26-vcf-operations-vvf-vcenter.md#license-server-certificate-trust--how-it-works-and-a-manual-workaround) |
| **LDAPS for the Identity Broker** | Domain controller certificate and the root CA in PEM | [`12` → LDAPS](12-sso-configuration.md#ldaps--the-domain-controller-certificate-and-the-pem-root-ca) |
| **Avi controller → License Hub** | Onboarding needs the controller's leaf and CA certificate pasted together | [`14-avi-load-balancer.md`](14-avi-load-balancer.md), [`15-license-hub.md`](15-license-hub.md) |
| **Avi virtual service for VCF Automation** | A CA-signed certificate matching the VCF Automation FQDN | [`14-avi-load-balancer.md`](14-avi-load-balancer.md) |
| **Log Management ← ESX syslog over SSL** | ESX accepts only the CA certificate, not a chain; a known defect after rotation (KB 459802 pending) | [`31-log-management.md`](31-log-management.md) |
| **SDDC Manager log agent** | Pins the Log Management certificate; re-run after replacement | [`05` §B.6](05-day2-deployments.md#b6--log-management-does-not-collect-sddc-managers-own-logs) |
| **New hosts after an enterprise-CA switch** | Hosts for new domains must carry enterprise-CA certificates too | [`40` §1.4](40-host-commissioning.md#14-certificates-follow-the-management-domain) |
| **The jump host** | Import the enterprise root (or the OpenSSL root) so browsers and PowerCLI trust the fleet | [`42-jump-host-powershell.md`](42-jump-host-powershell.md) |

### 7.1 VVF

VVF has no fleet certificate pages. TechDocs: *"you can manage certificates
directly per component, or use the VCF Operations certificate management API
to view and manage certificates centrally."* In VVF 9.1 the Log Management
certificate is managed *"by using VCF Operations API"*. VCF Operations'
own trusted certificates and exceptions are under *Operate → Administration →
Control Panel → **Trusted Certificates***.

### 7.2 VCF 9.1.2: removed roots and two known issues

From the 9.1.2.0 release notes, read 2026-11-24. TechDocs only, not tested
here.

**SDDC Manager drops the eMudhra roots and Sectigo "AAA Certificate
Services".** [VCF Installer / SDDC Manager 9.1.2.0 release
notes](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/release-notes/vmware-cloud-foundation-9-1-2-0-release-notes/sddc-manager-9-1-2-0-release-notes.html):
*"VCF 9.1.2 removes the eMudhra root CAs and the Sectigo AAA Certificate
Services root CA from the trust stores of SDDC Manager."* That covers the
Java trust store and the Photon OS trust list. What keeps working and what
breaks:

- *"A certificate installed on vCenter, NSX, or ESX through SDDC Manager (VCF
  Operations) continues to work because its chain is already in the SDDC
  Manager trust store."*
- *"A certificate installed directly on a component outside SDDC Manager, or
  a customer-configured endpoint such as a proxy, depot, backup target,
  directory service, or mail server, fails if it chains to one of the removed
  roots."*
- *"Do not add the eMudhra or "AAA Certificate Services" root certificates
  back to the trust store. [...] Add only the specific issuing CA, and plan to
  replace the certificate."*

Before upgrading to 9.1.2, check the chain of the proxy, the [offline
depot](09-binary-depot.md), the [SFTP backup target](08-backup-target.md), the
LDAPS directory and the mail server. A certificate from your own internal CA
doesn't chain to these public roots; a publicly issued one might. The VCF
Services Runtime trust bundle drops the eMudhra roots as well ([VCF Operations
9.1.2.0 release
notes](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/release-notes/vmware-cloud-foundation-9-1-2-0-release-notes/vcf-operations-9-1-2-0-release-notes.html)).

**Known issue: an ESX certificate from a multi-level CA loses intermediates.**
[VCF Operations 9.1.2.0 release notes](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/release-notes/vmware-cloud-foundation-9-1-2-0-release-notes/vcf-operations-9-1-2-0-release-notes.html):
after replacing an ESX certificate signed by *"a multi-level external CA
hierarchy"* through VCF Operations, the task reports success, but *"the host's
CA store keeps only the first intermediate certificate in the bundle. The
remaining intermediates and the root certificate are silently dropped."* A
client that trusts only the root then fails with *"Unable to get local issuer
certificate"*; the host stays connected to vCenter. Workaround: *"manually add
the missing root and intermediate certificates to /etc/vmware/ssl/castore.pem
on the affected host"*, or replace the certificate again through vCenter. After
an ESX pass with a root plus intermediates ([§5](#5-the-certificate-pass)),
test the chain from a client per host, for example with
`openssl s_client -connect <esx-fqdn>:443 -showcerts`.

**Known issue at bring-up: a custom ESX certificate of an unlucky length.**
[VCF Installer / SDDC Manager 9.1.2.0 release notes](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/release-notes/vmware-cloud-foundation-9-1-2-0-release-notes/sddc-manager-9-1-2-0-release-notes.html):
with `esxiCertsMode` set to `Custom` in the JSON spec, and *"one or more ESX
host certificates have a Base64-encoded body length that is a multiple of 253
characters"*, the *Deploy vCenter Appliance* task fails, and the rollback
leaves *"residual vSAN configuration"* on the hosts. Workaround: *"Reissue every
custom ESX host certificate so its Base64-encoded body length is not a multiple
of 253 characters"* and update the `sslThumbprint` values in the spec. Check
the length before bring-up (the Base64 body without the BEGIN/END lines and
line breaks).

---

## Sources

TechDocs VCF 9.1, last updated 2026-11-12, read verbatim on 2026-11-16:

- [Managing Certificates in VMware Cloud Foundation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/certificate-management-9-0.html):
  categories, components, CA types, operations per CA type, SAN rules, key
  sizes, collection, non-disruptive updates
- [Configure a Certificate Authority](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/certificate-management-9-0/configure-a-certificate-authority_9-0.html)
  and [Prepare Your Microsoft Certificate Authority](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/certificate-management-9-0/configure-a-certificate-authority_9-0/prepare-your-certificate-authority-to-enable-sddc-manger-to-manage-certificates-9-0.html)
  with its four steps:
  [roles](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/certificate-management-9-0/configure-a-certificate-authority_9-0/prepare-your-certificate-authority-to-enable-sddc-manger-to-manage-certificates-9-0/install-microsoft-certificate-authority-roles-9-0.html),
  [basic authentication](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/certificate-management-9-0/configure-a-certificate-authority_9-0/prepare-your-certificate-authority-to-enable-sddc-manger-to-manage-certificates-9-0/configure-the-microsoft-certificate-authority-for-basic-authentication_1.html),
  [template](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/certificate-management-9-0/configure-a-certificate-authority_9-0/prepare-your-certificate-authority-to-enable-sddc-manger-to-manage-certificates-9-0/create-and-add-a-microsoft-certificate-authority-template_9-0.html),
  [service account](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/certificate-management-9-0/configure-a-certificate-authority_9-0/prepare-your-certificate-authority-to-enable-sddc-manger-to-manage-certificates-9-0/assign-certificate-management-privileges-to-the-sddc-manager-service-account-9-0.html)
- [Generate CSRs](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/certificate-management-9-0/generate-certificates-signing-requests-in-vmware-cloud-foundation.html),
  [Import Certificates](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/certificate-management-9-0/import-certificates-in-vmware-cloud-foundation.html),
  [Replace with a Configured CA-Signed Certificate](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/certificate-management-9-0/replace-a-certificate-with-a-certificate-authority--ca--certificate.html),
  [Replace with an External CA-Signed Certificate](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/certificate-management-9-0/install-third-party-ca-signed-certificates-using-server-certificate-and-certificate-authority-files_9-0.html)
- [Manually Renew](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/certificate-management-9-0/manually-renew-certificates-in-vmware-cloud-foundation.html)
  and [Set Up Automatic Renewal](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/certificate-management-9-0/set-up-automatic-renewal-of-certificates-in-vmware-cloud-foundation.html)
- [Managing Certificates in VMware vSphere Foundation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/certificate-management-9-0/managing-certificates-in-vmware-vsphere-foundation.html)
  and [its Certificates page](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/certificate-management-9-0/managing-certificates-in-vmware-vsphere-foundation/certificates.html)
- Design blueprint [Certificate Management](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/fleet-management-blueprint/certificate-management.html):
  [approach](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/fleet-management-blueprint/certificate-management/vcf-certificate-lifecycle-management/vcf-certificate-management-approach.html),
  [lifecycle automation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/fleet-management-blueprint/certificate-management/vcf-certificate-lifecycle-management/vcf-certificate-lifecycle-automation.html),
  [ESX](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/fleet-management-blueprint/certificate-management/vsphere-certificate-management/esx-certificate-management.html),
  [vCenter Machine SSL](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/fleet-management-blueprint/certificate-management/vsphere-certificate-management/vcenter-machine-ssl-certificates-management.html),
  [recommendations](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/infrastructure-modernization/fleet-management-blueprint/certificate-management/recommendations-for-vcf-certificate-management.html)
- [KB 445742](https://knowledge.broadcom.com/external/article/445742):
  VCF Certificate Management Tool for expired certificates
