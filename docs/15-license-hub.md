# License Hub — Deployment Guide

Deploying **License Hub**, the centralized license manager for VMware vDefend
and Avi subscription license files. The
[prerequisites gate](prerequisites.md#license-hub-only-for-vdefend-or-avi-on-on-prem-licensing)
states *what* must exist before you start. This page covers *how*: the current
**License Hub 2.0** standalone OVA, the post-deploy registration and licensing
chain both versions share, and the older **5.1.2** SSP Installer flow.

> **License Hub is not the License Server — and both exist.** The **License
> Server** is deployed **automatically at bring-up**, is tied to VCF
> Operations, and licenses the VCF fleet (deployment plan story 5.4).
> **License Hub** is a separate appliance, deployed **Day-N**, licensing
> **vDefend + Avi**. They **coexist**: a fleet running Avi has both.

## At a glance: 2.0 or 5.1.2

**A greenfield site deploys 2.0 and skips 5.1.2.** There is no upgrade path
between them (see [Moving from 5.1.2 to 2.0](#moving-from-512-to-20)).

| | **License Hub 2.0** (current) | **License Hub 5.1.2** (older) |
| --- | --- | --- |
| Shape | One standalone OVA, one appliance | SSP Installer `.ova` + License Hub `.tar` → 3 VMs (installer, controller, worker) |
| Download | **Avi Load Balancer → Primary Downloads**, ~11 GB | **vDefend Security Services Platform**: installer ~5.0 GB + package ~4.5 GB |
| Footprint | 6 vCPU / 12 GB / 256 GB | Installer 4 / 6 / 400 + controller 2 / 8 / 155 + worker 4 / 16 / 255 |
| IP addresses | **3**: appliance + a 2-address Kafka pool | **~9**: installer 1, node pool 4, service pool 4 |
| FQDNs | **2**: appliance, Kafka (→ 2nd pool IP) | **3**: installer, Instance (→ 1st service IP), Messaging (→ 2nd) |
| Internal CIDR | ≥512 addresses, default `10.10.0.0/16` ([`34-internal-cidrs.md`](34-internal-cidrs.md)) | Not asked |
| Passwords | `sysadmin` / `admin` / `audit`: 15–128 chars, 4 character classes | OVA: min 12, strict extra rules. Instance `admin` / `audit`: 15–128 |
| DNS servers | Up to 3 | OVA up to 3, instance up to 5 |
| Immutable after deploy | FQDNs and IPs | Instance name, Instance FQDN, storage policy, node + service pools |
| Upgrades | Within 2.0, via the *Lifecycle Management* tab | None to 2.0: rebuild |

## Contents

1. [The full sequence, start to finish](#the-full-sequence-start-to-finish)
2. [License Hub 2.0 (standalone OVA)](#license-hub-20-standalone-ova)
3. [Register the hub (both versions)](#register-the-hub-both-versions)
4. [Licensing vDefend endpoints](#licensing-vdefend-endpoints)
5. [License Hub 5.1.2 (SSP Installer flow)](#license-hub-512-ssp-installer-flow)
6. [References](#references)

## The full sequence, start to finish

1. **Confirm it's needed**
   ([prerequisites gate](prerequisites.md#license-hub-only-for-vdefend-or-avi-on-on-prem-licensing)):
   for **vDefend**, and for **Avi on on-prem licensing**. Avi can instead use
   **Cloud Licensing** straight to the Avi Cloud Console; a disconnected /
   air-gapped site needs the hub.
2. **Pick the version** (table above). New sites: 2.0.
3. **Deploy.**
   - **2.0:** download the OVA, create DNS **including the Kafka FQDN**
     (validated hard at first boot), run the wizard, confirm
     `vsx-license-hub-deploy.service` succeeded.
     → [License Hub 2.0](#license-hub-20-standalone-ova)
   - **5.1.2:** SSP Installer, then the License Hub instance.
     → [License Hub 5.1.2](#license-hub-512-ssp-installer-flow)
4. **Register** the hub with the Avi Cloud Console, connected or disconnected.
   → [Register the hub](#register-the-hub-both-versions)
5. **License the endpoints**: load the licence file, put the hub on the NSX DFW
   exclusion list, onboard NSX Manager (and SSP), assign, point NSX at the hub,
   verify. → [Licensing vDefend endpoints](#licensing-vdefend-endpoints)
6. **Ongoing**: usage reporting. Automatic when connected; a recurring manual
   loop when disconnected.

---

## License Hub 2.0 (standalone OVA)

*Per TechDocs (`vdefend/license-hub/2-0`). Items marked **Field-verified** were
confirmed on a live deploy on a 9.0.2 lab, 2026-08-24; the rest is
TechDocs-sourced.*

### Download

- **No SSP Installer anymore.** TechDocs: *"Starting with License Hub 2.0,
  installation no longer requires any dependency on Security Services Platform
  Installer."* One OVA (`License-Hub-2.0.0.0.<build>.ova`, ~11 GB), one
  appliance.
- **It's filed under Avi, not vDefend.** In the Broadcom Support Portal it is
  listed under **VMware Avi Load Balancer `<version>` → Primary Downloads**,
  next to the Avi controller / SE OVAs. There is no separate "License Hub"
  product.

### Plan addresses and DNS

| Item | What to plan |
| ---- | ------------ |
| **Appliance FQDN + IPv4** | A + PTR. Must resolve to the appliance's own IP |
| **Kafka FQDN** | A + PTR → the **second** IP of the Kafka pool. **Validated at first boot** (see [Troubleshooting first boot](#troubleshooting-first-boot)). Field-verified tooltip: *"NSX uses this FQDN to connect to the Kafka broker"*, so NSX consumes it too |
| **Kafka IP pool** | **2 contiguous addresses** (5.1.2 needed 4) |
| **Internal Cluster Network** | Non-routable, **≥512 addresses** (`/23` or larger). Field-verified default **`10.10.0.0/16`**; tooltip: *"Most deployments can leave this at the default value."* Keep it unless that block is in use. Alternatives: [`34-internal-cidrs.md` §2.2](34-internal-cidrs.md#22-license-hub-20-row-3) |
| **DNS servers** | Up to 3, space-separated |
| **NTP servers** | Space-separated FQDNs or IPs |

**Immutable:** *"You cannot change the FQDNs or IP addresses after
deployment."* Example names in `01-network-dns-plan.md`:
`sfo-lichub01.sfo.example.io` (appliance) and
`sfo-lichub01-kafka.sfo.example.io` (Kafka). They deliberately don't share the
`lic` stem of the unrelated License Server.

### Deploy wizard

Per *Deploy a License Hub Appliance*:

| Group | Fields |
| ----- | ------ |
| VM placement | Name + datacenter folder; compute resource; datastore + virtual disk format; management network |
| Customize template — passwords | GRUB root password; GRUB menu timeout; **`sysadmin`**, **`admin`**, **`audit`** — **15–128 characters, at least one lowercase, one uppercase, one numeric and one special character** |
| Network — appliance | **FQDN**; **IPv4 address**; **netmask**; **default gateway** |
| Network — Kafka | **Kafka FQDN**; **IP Pool** (two contiguous addresses) |
| Network — additional | **Internal Cluster Network** |
| DNS | DNS server list (up to 3); domain search list |
| Services | NTP server list; **Enable SSH** checkbox |

### First boot and the two UIs

- **First boot builds a Kubernetes workload cluster inside the appliance**
  (hence the ≥512-address CIDR) and installs License Hub on it as a Helm chart
  (`licensing-ssp`). Budget real time: the workload-cluster stage alone ran 5/5
  tasks before the chart install started.
- **Two separate UIs. Bookmark both.** Field-verified.

  | UI | URL | What's there |
  | -- | --- | ------------ |
  | Appliance admin | `https://<fqdn>:5480` | Home; *Infrastructure → License Hub Configuration* (per-instance **Deployment Status**: Workload Cluster → Platform Service → Metrics, with a live Helm-install percentage, e.g. *"Triggering installation of chart `licensing-ssp` ....(34%)"*); Lifecycle Management; Troubleshooting; Certificates; User Management |
  | License Hub product | `https://<fqdn>` (plain HTTPS) | Get Started, registration, licensing. **FQDN only**: *"You must use the FQDN and not the IP address."* |

- **Registration is the same as 5.1.2** (field-verified): same Connected /
  Disconnected choice, same four stages. See
  [Register the hub](#register-the-hub-both-versions).
- **A lab without a real Broadcom entitlement stops at Get Started.** That's
  expected: completing registration needs a vDefend / Avi subscription behind
  the account. Reaching Get Started cleanly proves the deploy chain works.

### Troubleshooting first boot

**The Kafka FQDN is checked hard at first boot, before anything is built.** If
it doesn't resolve to the **second** Kafka-pool IP, `vsx-license-hub-deploy`
exits, no License Hub instance is created, and the appliance UI on 5480 keeps
working, so it looks like a hang rather than a failure. Two causes have been
seen in the field: a wrong **Kafka A record** (2026-08-24) and a wrong **DNS
server entered in the OVA wizard** (2026-10-22).

**Symptoms** [field-verified]:

| Where | What you see |
| ----- | ------------ |
| Product UI (`https://<fqdn>`) | Down: there is no instance to serve it |
| VM console | Boot log ends at *"Starting vsx-license-hub-deploy.service - License Hub Deploy Service..."* |
| 5480 → *Infrastructure → License Hub Configuration* | **Empty** Deployment Status, or *"No License Hub instance configured"*. A healthy deploy fills this within minutes |
| 5480 → *Troubleshooting → Diagnostic* | **Mgmt Cluster: Critical**, score 0: *"Failed to execute troubleshooting component 'Mgmt Cluster'. Error: record not found"*, Root Cause *Unknown*. The services next to it can still show green. The diagnostic has no cluster record to inspect; it's a symptom, not the cause |
| `systemctl status vsx-license-hub-deploy` | `failed (Result: exit-code)`, or stuck `activating` |

**Not a failure: the 5480 Home page error during a healthy deploy.** While
*Platform Service* is still running, Home shows *"Parameter 'platform-id' in
path has an error: must have a value: must have a value"* with a spinner. The
platform doesn't exist yet. The difference is Deployment Status: in a healthy
deploy it is **filling** (Workload Cluster *Completed 5/5*, Platform Service
*"Waiting for 1 deployment(s) (monitor) to be up …(86%)"*, Metrics queued). Let
it finish. [field-verified 2026-10-22: the deploy then completed **Healthy**]

**Diagnose, fastest first:**

1. **Check what was typed into the wizard, without logging in.** In the
   vSphere Client: VM → **Configure → Settings → vApp Options**. The OVF
   properties show the values as entered: DNS servers, appliance and Kafka
   FQDN, Kafka pool, internal CIDR. Compare them with your plan. This is how
   the wrong DNS server was found in the 2026-10-22 case.
2. **Read the journal.** Over SSH, or from the **VM console** if SSH wasn't
   enabled in the OVA: press Enter or switch to another terminal
   (Alt+F2 / Ctrl+Alt+F2) to get a login prompt and log in as `sysadmin`
   (the console login user isn't confirmed in TechDocs). The console has no
   scrollback, so filter:

   ```
   systemctl status vsx-license-hub-deploy --no-pager
   sudo journalctl -u vsx-license-hub-deploy -b --no-pager | grep -i -E "error|kafka" | tail -20
   ```

   The Kafka failure reads: *"ERROR: Kafka FQDN '\<fqdn\>' resolves to
   {'\<ip\>'} but none match IP pool {'\<pool ip 1\>', '\<pool ip 2\>'}"*.
3. **Check resolution from the appliance:** `nslookup <kafka-fqdn>` must return
   the second pool address.

**Fix:**

| Cause | Fix |
| ----- | --- |
| **Wrong A record in DNS** | Correct the record, then `sudo systemctl restart vsx-license-hub-deploy`. No redeploy needed |
| **Wrong value in the OVA wizard** (DNS server, FQDN, Kafka pool) | **Redeploy** with the correct values. **Field-verified 2026-10-22:** after a redeploy with the corrected DNS server, Workload Cluster finished 5/5 within ~15 minutes of power-on and the instance came up **Healthy**. FQDNs and IPs are immutable after deployment, and editing the vApp properties afterwards has **not** been tested on License Hub |

Prevent it: create the appliance and Kafka A + PTR records, and check them
with `nslookup` against the DNS servers you'll enter, **before** powering the
appliance on.

TechDocs:
[Deploy a License Hub Appliance](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/license-hub/2-0/license-hub-appliance/deploy-a-license-hub-appliance.html)
·
[License Hub Appliance overview](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/license-hub/2-0/license-hub-appliance.html)
(the two-UI / FQDN-only note)
·
[License Hub 2.0 Release Notes](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/license-hub/2-0/release-notes/license-hub-20-for-vmware-vdefend-and-avi-load-balancer-release-notes.html).

---

## Register the hub (both versions)

Registration happens at **first login to the hub**, not at deploy time. The
*Get Started* screen offers **SKIP**, so a hub can sit unregistered. The
product labels **connected mode "Recommended"**. Decide it together with the
depot decision (intake `G1`).

### Connected vs disconnected

| | **Connected** | **Disconnected** |
| --- | --- | --- |
| Product wording | *"requires a stable internet connection to streamline the registration process, update licenses, and generate usage reports"* | *"does not require an Internet connection. You must manually download and transfer files for registration, update licenses, and generate usage reports"* |
| Registration | Log in with a **Broadcom account**; complete it in the Avi Cloud Console | Download a **registration file** → upload to the console → import the **activation file** back |
| Licences | Assign in the console; *"View assigned licenses"* in the hub | Generate a **licence file** in the console → import into the hub |
| Usage reporting | *"reported to Avi Cloud Console on a regular basis. Usage-based licensing will **automatically refresh**"* | Generate a report → upload → **import the refreshed licence file**, or the licence lapses |

### What both modes need

- **The Avi Cloud Console is `portal.pulse.broadcom.com`.** It is **not** on
  Broadcom's Public URLs list, so a proxy allowlist built from that page misses
  it. In disconnected mode the data centre never reaches it, but **an
  administrator's browser still does**.
- **It is the backend for vDefend too.** "Avi Cloud Console" as the only
  registration option is a legacy name, not a sign you need a second appliance.
  One hub, one registration, covers both product lines.
- **A Broadcom customer account is a prerequisite.** Connected mode logs in
  with it; disconnected mode still needs someone who can sign in to convert
  files into licences. Name **who holds that account** during planning. It is
  usually not the vCenter administrator.
- **Connected mode has its own proxy setting**, next to *"Check your internet
  connection"*. The hub doesn't inherit the fleet proxy; point it at one
  deliberately.

> **Disconnected mode is a standing manual loop, with two easy-to-miss steps.**
> Registration file → activation file → **and then a licence still has to be
> generated**. The hub says so: *"Don't forget to generate the license in Avi
> Cloud Console after downloading the activation file."* Usage reporting is the
> same in reverse: *"Generate a report periodically"*, upload it, *"to obtain a
> refreshed license file"*, and import that *"for continued use"*.
>
> **Air-gapped: the six-month import is forever.** Someone must carry a fresh
> licence file into the site **at least every six months**. Give it a named
> owner and a calendar reminder at deployment time, not at first expiry. (For
> 5.1.2, the `.ova` and `.tar` have to reach the site first as well.)

---

## Licensing vDefend endpoints

Deploying and registering the hub licenses nothing. vDefend's endpoints have to
be **onboarded**, **assigned** a licence, and NSX has to be **pointed at the
hub**: the vDefend equivalent of Avi's "switch the controller to On-prem
License Hub" step in [`14-avi-load-balancer.md`](14-avi-load-balancer.md). The
endpoint types are **NSX Manager**, the **vDefend Security Services Platform
(SSP)** and **Avi Controllers**. One hub handles up to **120 endpoints**:
*"Total Endpoints Connected to a single License Hub instance = 120, where
Endpoints could be a mix of NSX Manager, vDefend Security Services Platform,
Avi Controller."*

### Three licensing layers

*"It's done in the Pulse portal"* is a half-truth:

| Layer | Where | What happens there |
| ----- | ----- | ------------------ |
| **1. Pulse portal** | `portal.pulse.broadcom.com` (Avi Cloud Console) | Register the hub; **assign the subscription to the hub**; generate licence files (disconnected); usage reporting. Needs the **Broadcom account holder** |
| **2. On-prem License Hub** | The appliance | **Load** the licence file into *Licenses*; **onboard** endpoints; **assign** licences to them |
| **3. The endpoint** | NSX Manager / Avi Controller | For vDefend, **NSX Manager is the licence authority**: SSP features (Security Intelligence / NDR / Malware Prevention) are gated on NSX Manager being vDefend-licensed through the hub. For Avi, the *On-prem License Hub* toggle under *Administration → Licensing* |

> **Registered is not licensed.** A registered hub still banners: *"The License
> Hub is registered, but **no licenses are found**. Download the license file
> from Avi Cloud Console and add into Licenses."* Every step in the order of
> work below has to happen. Stopping at "the hub is up" leaves a healthy,
> **unlicensed** fleet, so give the whole chain **one owner**.

### Order of work

1. **Load the vDefend licence file.** Download it from the Avi Cloud Console
   and add it under *Licenses* before touching endpoints.
2. **Put the License Hub VMs on the NSX DFW exclusion list**, *before*
   onboarding. TechDocs: *"If the License Hub VMs are running in an NSX overlay
   network, NSX VLAN segments, and security-enabled port groups, add the
   License Hub VMs to a firewall exclusion list."* It doesn't say why, but the
   hub licenses the very firewall that could block it. Raise it with the DFW
   policy owner first; see [`07-firewall-ports.md`](07-firewall-ports.md).
3. **Onboard NSX Manager.** *Endpoint Management → Onboard an Endpoint →
   Connect to an Endpoint*:

   | Field | Value |
   | ----- | ----- |
   | Type | `NSX Manager` (or `Avi Controller`, …) |
   | Endpoint Name | Free text |
   | Connection Type | **Dynamic** (default) |
   | IP Address or FQDN | *"Enter either IP, Cluster IP, VIP, or FQDN"*; for NSX the **Cluster VIP** or FQDN |
   | Username / Password | An admin credential, for NSX **enterprise admin** |
   | Certificate | **Full chain (leaf + CA) in one paste**, see below |

4. **Onboard the vDefend SSP** the same way, **if deployed**. It's needed for
   Malware Prevention / ATP. DFW and Distributed IDS/IPS ride on the NSX
   Manager endpoint alone, so a Firewall-only site can skip it.
5. **Assign the vDefend licence** to each endpoint (vDefend Firewall, or
   Firewall with Advanced Threat Prevention).
6. **Point NSX at the hub**: NSX Manager → *System → Licenses*.
   **[verify in-product]** Unlike Avi, which has an explicit *Cloud Licensing*
   vs *On-prem License Hub* choice, NSX may simply reflect the hub's
   assignment once onboarded, or may need the mode set here. Confirm on your
   build.
7. **Verify on NSX**: *System → Licenses* shows the vDefend subscription
   active with capacity, and IDS/IPS / Malware Prevention are out of
   evaluation.

> **The Certificate field wants the full chain in one paste. [field-verified]**
> There are no separate leaf / CA fields: the **leaf and the CA certificate go
> in the same paste**. For a VCF-managed Avi Controller (certificate
> auto-generated by VCF Operations) or NSX Manager, the certificate isn't
> sitting in a store, so **extract it from the endpoint first**. Plan that
> retrieval along with the credentials.

**Avi Controllers** follow the same onboarding; the controller then has to opt
in under *Administration → Licensing → On-prem License Hub*. Until both halves
are done it shows **0 Used / 0 Available**. See
[`14-avi-load-balancer.md`](14-avi-load-balancer.md).

### Avi Cloud Console gotchas

> **`ADD LICENSE` greyed out? Upgrade the keys to LIC2 first.
> [field-verified]** A vDefend entitlement visible in the **old** Broadcom
> license portal does **not** appear on the Cloud Console *Licenses* page, and
> **ADD LICENSE** stays disabled, until at least one key is upgraded to
> **LIC2** (secure / subscription) format in the Broadcom Support Portal. The
> blue banner (*"upgrade, split, merge of license keys on the Broadcom support
> portal"*) points at exactly this. Field case: an "NSX Data Center Advanced"
> perpetual key covered DFW + IDS/IPS; a separate **vDefend with ATP** core
> entitlement showed only in the old portal until it was upgraded to LIC2, then
> appeared and became allocatable.
>
> Also check that the user has the Cloud Console **License Management** role,
> and that the entitlement's Broadcom division is linked to this **Site**. If
> no upgrade path is offered, or converted keys still don't appear, it's a
> Broadcom licensing support case.

> **Licenses page won't render (blank / stuck)? Try an incognito window.
> [field-verified]** It loaded there when the normal session didn't; clear the
> Cloud Console's cache / cookies in the stuck profile.

> **Splitting a licence across License Hubs (or sites): split in the Broadcom
> Support Portal, not in the Cloud Console. [field-verified 2026-10-22]** The
> Avi Cloud Console can't split a key. To divide one vDefend (or Avi) quantity
> between two hubs, for example one per site:
>
> 1. **Broadcom Support Portal → My Dashboard → My Entitlements**, select the
>    entitlement, click the **licence badge** icon.
> 2. On the key, **⋮ → Split License**, and enter the new quantities. They
>    **must add up to the full original total**, or the portal errors. The key
>    needs a quantity above 1.
> 3. Accept the warning, then **Continue**. The new keys show as **Unallocated**,
>    and **the original key becomes invalid**.
> 4. In the **Avi Cloud Console**, assign **each new key to its own registered
>    License Hub** (Enterprise Admin or License Admin role). Connected hubs pull
>    it within 15 minutes; a disconnected hub needs a fresh licence file.
>
> **Split before the LIC2 upgrade** if older deployments still need the legacy
> key. Broadcom: *"split the license key to only upgrade the required number of
> deployments, retaining enough licenses for continued use on earlier
> deployments"*. The upgrade can't be reversed. The split needs the **Split &
> Merge License Keys** permission and isn't available on expired contracts;
> **Merge** works the same way in reverse. Whether the Cloud Console can assign
> only *part* of one key to a hub is **not verified**: split first. Sources:
> [KB 405972](https://knowledge.broadcom.com/external/article/405972/split-vmware-license-keys-in-broadcom-su.html),
> [Upgrading Licenses](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/security-services-platform/5-1/licensing-overview/managing-licenses-and-registration-using-avi-cloud-console/license-assignment-process/upgrading-licenses.html),
> [License Hub 2.0 Licensing Workflow](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/license-hub/2-0/license-hub-overview/licensing-workflow.html).

### Turning the features on

Separate from licensing, in NSX, once the licence is live:

| Feature | Where |
| ------- | ----- |
| **Distributed Firewall** | Confirm *Security → Distributed Firewall → Distributed Firewall Service* is **On**. It's on by default, but if it was turned off, re-enable it before DFW policy applies **[field-verified]**. Then build policy there |
| **Distributed IDS/IPS** | *Security → IDS/IPS & Malware Prevention*: enable, pull signatures, enable per cluster, attach policies |
| **Malware Prevention / ATP** | Needs the SSP onboarded and licensed |
| **Gateway Firewall** | On the T0 / T1 gateways |

### Ongoing

**Usage reporting** runs on the same loop as every other hub endpoint:
automatic when connected, the generate → upload → import-refreshed-licence
cycle when disconnected (see
[Register the hub](#register-the-hub-both-versions)).

---

## License Hub 5.1.2 (SSP Installer flow)

*The older flow: a 3-VM instance deployed from the SSP Installer. Use it only
for an existing 5.1.2 site; new sites deploy 2.0. Field observations are from
SSP Installer `5.1.2`, 2026-07-22.*

### Moving from 5.1.2 to 2.0

TechDocs: *"There is no direct upgrade path from License Hub 5.1.2 to License
Hub 2.0."* Moving a site is a rebuild:

1. **Deploy 2.0 fresh** ([License Hub 2.0](#license-hub-20-standalone-ova)).
2. **Re-register** the new hub with the Avi Cloud Console: a new registration
   and Site association. **Nothing migrates.**
3. **Re-load licences** and **re-onboard every endpoint** (NSX Manager, SSP,
   Avi Controllers), see [Licensing vDefend endpoints](#licensing-vdefend-endpoints).
4. **Decommission the 5.1.2 instance**, but **keep the SSP Installer** if it
   also deploys the vDefend **SSP** ([`18-vdefend-ssp.md`](18-vdefend-ssp.md)).
   It's only redundant when License Hub was its *only* job.

### Installer and package download

Not in the VCF depot or the offline depot of
[`09-binary-depot.md`](09-binary-depot.md): download both files yourself from
the Broadcom Support Portal, under **vDefend Security Services Platform**
(verified 2026-07-22):

| File | What it is | Size |
| ---- | ---------- | ---- |
| `VMware-Security-Services-Platform-Installer-<version>.ova` | The **SSP Installer** appliance. Deploy this first | **~5.0 GB** |
| `License-Hub-<version>.tar` | The **License Hub package**, *uploaded to* the installer | **~4.5 GB** |

Take both from the **same release page** (their build numbers differ within a
release) and keep the **SHA2 / MD5**. Air-gapped, that's ~9.5 GB to carry in
before anything deploys.

### Plan

**Addresses: ~9 IPs on one subnet, in two contiguous pools plus the installer.**

| Pool | Addresses | Notes |
| ---- | --------- | ----- |
| Installer | 1 | Plus its own FQDN (A + PTR) |
| Node pool | 4 | Controller + worker nodes. **Immutable**; controllers and workers are the scale-out axis, so size for growth |
| Service pool | 4 | **Immutable**. First two addresses are taken by the FQDNs below |

Both pools are **start–end ranges inside one subnet**, so they need a **free,
unbroken block**; scattered spare addresses won't do.

**FQDNs pinned to the service pool** (*"253 characters max, alphanumeric name
with hyphens allowed"*):

| FQDN | Purpose | Maps to |
| ---- | ------- | ------- |
| **Instance FQDN** | *"the FQDN to use for accessing the License Hub instance from a browser or in an API call"* | *"the **first** IP address in the service IP pool"* |
| **Messaging FQDN** | *"used by the internal components of the License Hub instance"* | *"the **second** IP address in the service IP pool"* |

*"You must configure DNS with this mapping either before or after deploying the
instance."* Order the work: agree the subnet → fix the pool ranges → request A
+ PTR for the first two service-pool addresses. With a domain pre-check in the
wizard, DNS **first** is easiest.

**Footprint** (Instance Management reports *"1 controllers, 1 workers"*):

| Component | vCPU | Memory (GB) | Storage (GB) |
| --------- | ---- | ----------- | ------------ |
| Installer | 4    | 6           | 400 (thick; ~7 GB thin) |
| Controller| 2    | 8           | 155          |
| Worker    | 4    | 16          | 255          |

**One-way doors.** TechDocs, verbatim:

| Can't change after deployment | Constraint |
| ----------------------------- | ---------- |
| **Instance Name** | *"This name cannot be changed after deployment"*; *"cannot contain uppercase letters or special characters, and the length cannot exceed 32 characters"* |
| **Instance FQDN** | *"This FQDN cannot be changed after deployment"* |
| **Storage Policy** | *"You cannot change the storage policy after deployment"*. Also *"VM encrypted storage policy is not supported"* and *"You cannot use third-party encryption solutions"*: a cluster defaulting to an encrypted policy needs a non-encrypted one for this |
| **Node + service IP pools** | Immutable |
| **vCenter FQDN / IP** | *"Changing the vCenter Server's FQDN or IP address after the deployment is not supported"*: a new SSP Installer plus **restore from backup** is the only path (see [After it completes](#after-it-completes)) |

A rename or re-IP means a redeploy.

**vCenter object names: ten forbidden characters.** *"While naming the VMware
vCenter resources, such as data center, cluster datastore, resource pool,
storage policy, DVS name, or port group name used by the SSP Installer, do not
use the following 10 special characters:"* `/` `,` `'` `=` `[` `]` `&` `%` `\`
`"`. This constrains objects you **already have**: find them now, while the fix
is still a rename.

### SSP Installer OVA

A plain *Deploy OVF Template*, **single vNIC**, IP allocation **Static –
Manual**, IPv4 (`*` = required):

| Group | Fields |
| ----- | ------ |
| Application | GRUB root password; GRUB menu timeout (default `4`); **`sysadmin`\***, **`admin`\***, **`audit`\*** passwords |
| Network | **FQDN\*** (*"must contain a dot character"*); **IPv4 address\***; **netmask\***; default gateway |
| DNS | **DNS server list\*** (space-separated, **max 3**); domain search list |
| Services | NTP server list; **Enable SSH** (**off** by default) |

- **It needs a real FQDN** (A + PTR in Step 1), unlike VCF Operations for
  Networks.
- **Only the first three DNS servers are used**: *"all other will be ignored"*,
  silently. Choose which three.
- **NTP isn't marked required. Treat it as required:** clock skew breaks
  certificates and token exchange.

> **The OVA password rule is stricter than the rest of the platform.** For
> `sysadmin` / `admin` / `audit`: *"Min of 12 characters… ≥1 lower case
> letter… ≥1 upper case letter… ≥1 number digit… ≥1 special char… At least five
> different characters… No dictionary words… No palindromes… No monotonic
> character sequence (more than 4 monotonic characters are not allowed)"*.
> And *"password strength validation will occur during **VM boot**"*: a
> non-compliant password **deploys fine** and then forces a change at first
> login (`sysadmin` gets a prompt; for `admin` / `audit` log in to the SSPI UI
> as `admin` → **User Management**).

**Upload the package** under **Package Management** (a package stays **Not in
use** until an instance consumes it). The dialog accepts a **local file** or a
**locally hosted URL**. For a ~4.5 GB file, staging it on an internal web
server and using the URL beats pushing it through a browser.

### vCenter connection

*Connect to vCenter* asks for three things (field-verified against TechDocs):

| Field | TechDocs |
| ----- | -------- |
| **vCenter Server** | *"Enter the server FQDN or IP address."* |
| **Username** | *"Enter the VMware vCenter Admin user name, or the name of a user who has **administrator privileges**."* No least-privilege role is documented, so record who holds it |
| **Certificate** | Paste the PEM **or** *"click **Browse Local Files** to select the certificate file"* |

There is **no thumbprint prompt** and no "accept" button: have the certificate
**before** opening the dialog. TechDocs: browse to the vCenter base URL and use
**Download trusted root CA certificates**, which gives a **ZIP** of the
`TRUSTED_ROOTS` store.

> **Which certificate from that ZIP? The docs don't say, and the wrong one
> fails.** You need the **issuer of vCenter's machine SSL certificate**, not
> the first file in the archive: the VMCA root on a default vCenter, or the
> enterprise / subordinate CA intermediate if the machine certificate was
> replaced. Check what signed it before pasting.

### Instance deploy wizard

*Deploy an Instance | License Hub* runs **Configure → Pre-Checks → Deploy**:

| Step | Fields |
| ---- | ------ |
| **1. Define Instance and Required FQDN(s)** | **Version\*** (the uploaded package); **Instance Name\*** (*"32 characters max, all lowercase, alphanumeric name with hyphens allowed"*, **immutable**); Deployment (fixed: `License Hub`); **Instance FQDN\*** (→ 1st service IP, **immutable**); **Messaging FQDN** (→ 2nd service IP); **User Passwords\*** (a **SET** sub-dialog) |
| **2. Select vCenter Parameters** | **vCenter connection\*** (existing, or **ADD NEW CONNECTION**); **Data Center\***; **Cluster\***; **Storage Policy\*** (**immutable**, no encryption); **Content Library & VM Datastore\***; Resource Pool (optional, *"No selection creates a new pool by default"*); **Reserve Resource** (on by default, *"required for a production environment"*) |
| **3. Configure Connectivity Options** | **DVS\*** + **Port Group\*** (distributed); **Subnet\*** (CIDR, e.g. `10.1.1.0/24`); **Default Gateway\***; **Node IP Pool\*** (e.g. `10.1.1.4-10.1.1.15`); **Service IP Pool\*** (e.g. `10.1.1.16-10.1.1.24`); **NTP** (up to **5**, IP or FQDN); **DNS** (up to **5**, **IP only**); **Search Domain** (one) |

- **A distributed port group is required.** A vSphere Standard Switch isn't an
  option.
- **The content library datastore needs room** beyond the running VMs: the
  instance is staged through a content library.
- **Reservations are on by default** and turning them off isn't a supported
  production shortcut. Check management-cluster admission-control headroom
  first.

> **Instance passwords follow a different rule from the OVA.** The SET dialog
> shows **`admin` and `audit` only**: *"At least 15 characters in length, and no
> more than 128 characters… At least 1 lowercase, 1 uppercase, 1 numeric
> character and 1 special character"*. No dictionary / palindrome / sequence
> checks, but a **higher minimum**, so **a password that passes the OVA can
> fail here**. TechDocs says *"Minimum length: 12"*, but the shipping 5.1.2
> dialog says 15: believe the product. **One 15+ character password that also
> meets the OVA rules clears both.**

### Pre-checks and failures

**9 pre-checks**, each re-runnable with **RERUN PRE-CHECK**, so you fix and
retry in place:

| Pre-check | What it reported |
| --------- | ---------------- |
| Check SSPI basic infra | *"SSPI infra is healthy and Licensing validations passed"* |
| Check vCenter | *"Verified vCenter access, cluster, datacenter, datastore, portgroup, **CPU and memory**"* |
| Check compatibility | *"Complete Licensing compatibility check."* |
| Check content library datastore | *"Datastore check appears to be satisfactory."* |
| Check Storage Policy | *"The storage policy '…' appears to be satisfactory."* |
| Check network configuration | *"The network configuration appears to be satisfactory."* |
| Check fqdn domain | *"Domain check appears to be satisfactory."* |
| Check NTP configuration | *"NTP check completed successfully."* |
| Check network reachability | *"Verified **NodePool IP** network reachability."* |

Cluster CPU and memory are validated (so the reservation footprint is
checked), and the FQDN / domain and node-pool IPs are tested before anything is
built.

**The deploy: 4 steps, ~28 tasks.** **vCenter Configuration** (6, starting by
creating a content library), **Workload Cluster** (**18**, the bulk), **Security
Platform** (3), **Metrics** (1). TechDocs gives no expected duration.

**If it fails mid-run, three controls:**

| Control | What it does |
| ------- | ------------ |
| **Stop Deployment** | *"Halts the ongoing deployment so that you can fix the error. **This action does not undo any previous deployments.**"* |
| **Update & Redeploy** | *"Start the ongoing deployment after resolving an error. **The deployment starts from the point it was stopped.**"* |
| **Cleanup** | *"Removes all the previous deployment tasks."* |

Normal recovery: **Stop → fix → Update & Redeploy** (resumes). **Cleanup** is
the heavy option that discards the work.

> **A vCenter outage mid-deploy is the bad failure.** TechDocs: *"If the
> deployment fails because VMware vCenter becomes unavailable during the
> deployment, … the option to reset the configurations might not be available.
> … To resolve the issue, clean up the deployment before resetting the
> configurations. **If the VMware vCenter server is not recoverable, uninstall
> SSP Installer and deploy a new one.**"* So: **Cleanup before reset**, and
> don't deploy while vCenter is being patched or restarted.

### After it completes

- **The completion banner hands you the DNS request**: *"Share the Instance
  FQDN/IP … and Messaging FQDN/IP … with your DNS administrator."* The
  Messaging FQDN gets its own address, the one **right after** the instance IP.
- **Wait for Healthy** (if not, TechDocs points at **Troubleshooting
  Diagnostic**), click **Done**, open the **Instance FQDN & IP** link and log
  in with the `admin` / `audit` passwords from the SET dialog. Record them at
  planning time.
- **Back up the SSP Installer now.** The banner: *"Proper backup of this
  security service platform installer is crucial to restore the Service
  Platform Instances and Services to their working state in the event of a
  failure."* It is also the **only** migration path if the management vCenter
  is ever renamed or re-addressed (*"you must **deploy a new SSP Installer
  instance**, connect to the new vCenter Server, and **restore your
  configuration from a Security Services Platform backup**"*). The backup
  authenticates to SFTP with a **public key**, not the password its dialog
  asks for, and a saved configuration doesn't prove it can write: see
  [`08-backup-target.md` §6](08-backup-target.md#6-the-ssp-installer-is-the-odd-one-out).
- **Instance Management** is where you *"edit configurations, reset passwords,
  or delete the instance"*. **Delete** is the only answer to the immutable
  fields.
- Then **register** and **license**:
  [Register the hub](#register-the-hub-both-versions) →
  [Licensing vDefend endpoints](#licensing-vdefend-endpoints).

---

## References

TechDocs:
[License Hub for vDefend and Avi](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/security-modernization/vdefend-lateral-security/security-services-platform-for-vmware-cloud-foundation/license-hub-for-vdefend-and-avi/license-hub-for-vmware-vdefend-and-vmware-avi-load-balancer.html)
(the VCF 9.1 design blueprint — sizing, endpoint scale, modes) ·
[Deploying License Hub](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/security-services-platform/5-1/licensing-overview/deploying-license-hub.html)
(SSP 5.1 — the deploy procedure) ·
[Configure a License Hub Deployment](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/security-services-platform/5-1/licensing-overview/deploying-license-hub/steps-to-deploy-a-license-hub-instance/configure-a-license-hub-deployment.html)
(the field-by-field reference for the 5.1.2 wizard — FQDN-to-pool mapping, the
immutable fields, the storage-policy restriction).
