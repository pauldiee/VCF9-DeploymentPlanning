# License Hub — Deployment Guide

Deploying **License Hub**, the centralized license manager for VMware vDefend
and Avi subscription license files. The
[prerequisites gate](prerequisites.md#license-hub-only-if-vdefend-or-avi-is-in-scope)
states *what* must exist before you start; this page covers *how to deploy
it* — for both the current **License Hub 2.0** standalone-OVA flow and the
older **5.1.2** SSP Installer flow — plus the post-deploy registration and
licensing chain shared by both versions.

> **License Hub is not the License Server — and both exist.** The **License
> Server** is deployed **automatically at bring-up**, is tied to VCF
> Operations, and licenses the VCF fleet (deployment plan story 5.4).
> **License Hub** is a separate appliance, deployed **Day-N**, licensing
> **vDefend + Avi**. They **coexist** — a fleet running Avi has both. Two
> similar names, two unrelated appliances: don't plan one and assume it
> covers the other.

## License Hub 2.0 (standalone OVA)

*Per TechDocs (`vdefend/license-hub/2-0`); fields marked **Field-verified** below
are confirmed against a live deploy on a 9.0.2 lab, 2026-08-24. Everything else
in this subsection is TechDocs-sourced only.*

**No dependency on the SSP Installer anymore.** TechDocs, verbatim: *"Starting
with License Hub 2.0, installation no longer requires any dependency on
Security Services Platform Installer."* It ships as **one standalone OVA**
(`License-Hub-2.0.0.0.<build>.ova`, ~11 GB) instead of an installer `.ova` plus
a separate `.tar` package, and deploys as a single appliance rather than a
3-VM instance.

**Download location has moved.** It is **not** under vDefend Security
Services Platform in the Broadcom Support Portal, and there is no separate
top-level "License Hub" product either — it is listed under **VMware Avi Load
Balancer `<version>` → Primary Downloads**, alongside the Avi controller/SE
OVAs.

**No upgrade path from 5.1.2.** TechDocs is explicit: *"There is no direct
upgrade path from License Hub 5.1.2 to License Hub 2.0."* A site with an
existing 5.1.2 hub needs a fresh 2.0 deployment, not an in-place upgrade.

**Deploy-wizard fields**, per *Deploy a License Hub Appliance*:

| Group | Fields |
| ----- | ------ |
| VM placement | Name + datacenter folder; compute resource; datastore + virtual disk format; management network |
| Customize template — passwords | GRUB root password; GRUB menu timeout; **`sysadmin`**, **`admin`**, **`audit`** passwords — **15–128 characters, at least one lowercase, one uppercase, one numeric and one special character** |
| Network — appliance | **FQDN** (must resolve to the appliance's own IPv4 address); **IPv4 address**; **netmask**; **default gateway** |
| Network — Kafka | **Kafka FQDN** (resolves to the **second** IP in a pool); **IP Pool** — two contiguous addresses |
| Network — additional | **Internal Cluster Network** — a **non-routable CIDR supporting at least 512 addresses**, dedicated to this appliance |
| DNS | DNS server list (up to 3, space-separated); domain search list |
| Services | NTP server list (space-separated FQDNs or IPs); **Enable SSH** checkbox |

**Immutable after deployment:** TechDocs, verbatim — *"You cannot change the
FQDNs or IP addresses after deployment."* Example naming for the two FQDNs
(deliberately not sharing the `lic` stem already used by the unrelated
License Server): see `01-network-dns-plan.md`'s DNS table —
`sfo-lichub01.sfo.example.io` (appliance) and
`sfo-lichub01-kafka.sfo.example.io` (Kafka).

Two things worth flagging while planning:
- **The internal cluster CIDR needing ≥512 addresses is new** — that is a
  `/23` or larger, non-routable, reserved for this one appliance. **Field-
  verified 2026-08-24** (Deploy OVF Template, *Customize template* step): the
  field ships with a real default, **`10.10.0.0/16`**, and its tooltip reads
  *"The CIDR must support at least 512 IP addresses (prefix /23 or smaller).
  Use non-routable IPs as this is for internal use only, and ensure the range
  is not used elsewhere in your datacenter. Most deployments can leave this at
  the default value."* So the product's own guidance is: **take the default
  unless `10.10.0.0/16` is already in use somewhere in your datacenter** — no
  need to invent a range. If it does collide, any non-routable block your
  fabric doesn't already use works; the fleet elsewhere (VCF Automation's
  internal services-runtime CIDR, `05-day2-deployments.md` §D) falls back to
  the IANA benchmarking ranges (`198.18.0.0/15`, `240.0.0.0/15`,
  `250.0.0.0/15`) for the same reason, which is a reasonable fallback choice
  here too.
- The **Kafka pool is only 2 addresses**, smaller than 5.1.2's 4-address
  service pool, but still immutable — get the FQDN-to-second-IP mapping into
  DNS before or immediately after deploying, same as 5.1.2's instance/messaging
  pair. **Field-verified**: the Kafka FQDN tooltip gives a worked example —
  *"This FQDN must resolve to the second IP address of the IP Pool below (for
  example, `172.16.111.41`). NSX uses this FQDN to connect to the Kafka
  broker."* — confirming NSX itself is a consumer of this endpoint, not just
  the hub's own internals.

> **The Kafka FQDN's DNS record is validated at first boot, hard, before
> anything else deploys — and the wizard tooltip's wording ("must resolve to
> the second IP address") undersells how strictly this is enforced.**
> Field-verified 2026-08-24: a mismatch here doesn't degrade gracefully or
> warn — the appliance comes up, the 5480 admin UI works fine, but
> **`vsx-license-hub-deploy.service` fails outright** (`systemctl status`
> shows `failed (Result: exit-code)`), and the actual License Hub service
> never gets created — the appliance-level UI just shows "No License Hub
> instance configured" with no obvious error pointing at DNS. The journal
> names the exact cause: *"ERROR: Kafka FQDN '\<fqdn\>' resolves to {'\<ip\>'}
> but none match IP pool {'\<pool ip 1\>', '\<pool ip 2\>'}"*. So get the A
> record right **before** powering on the appliance — if it's already up and
> stuck in this state, fix the DNS record, then `sudo systemctl restart
> vsx-license-hub-deploy`. Diagnose with:
>
> ```
> systemctl status vsx-license-hub-deploy
> sudo journalctl -u vsx-license-hub-deploy --no-pager -b | tail -150
> ```

- **After first boot completes, the appliance shows two separate UIs — don't
  expect the licensing product on the port you deployed with.** **Field-
  verified 2026-08-24.** Port `5480` (the FQDN or IP, `https://<fqdn>:5480`)
  is the **appliance/VAMI-style admin shell** — Home, Infrastructure →
  License Hub Configuration (shows deployment status per-instance, expand a
  row for a **Deployment Status** modal: Workload Cluster → Platform Service →
  Metrics, each reporting task counts and a live percentage on the Helm chart
  install, e.g. *"Triggering installation of chart `licensing-ssp` ....(34%)"*),
  Lifecycle Management, Troubleshooting, Certificates, User Management. The
  **actual License Hub product** — Get Started, registration, licensing — is a
  **second, separate UI** on the **plain HTTPS port, and it requires the
  FQDN, not the IP**: TechDocs, verbatim, *"To log in to the License Hub
  service, from your browser, specify the FQDN of the License Hub appliance.
  For example, `https://license-hub.example.com`. **You must use the FQDN and
  not the IP address.**"* Bookmark both separately; going to the IP on the
  default port gets you nowhere.
- **First boot brings up an actual Kubernetes workload cluster internally**
  (hence the ≥512-address non-routable CIDR requirement above) and installs
  the License Hub product as a **Helm chart** (`licensing-ssp`) on top of it.
  Budget real time for this — the workload-cluster stage alone ran 5/5 tasks
  before the platform-service chart install even started.
- **The post-deploy Get Started / registration flow is unchanged from 5.1.2.**
  Field-verified: same **Connected Mode / Disconnected Mode** choice, same
  four-stage chain (Registration → Licenses → Endpoint Management → Usage
  Reporting and License Refresh) described in the 5.1.2 section below.
  **"Avi Cloud Console" showing up as the only registration backend — even
  though License Hub also licenses vDefend — is not a sign a second appliance
  is needed.** It is the same shared cloud backend (`portal.pulse.broadcom.com`)
  for **both** product lines; the name is a legacy holdover from before
  vDefend licensing was folded into it. One License Hub instance, one
  registration flow, covers both — vDefend's endpoints (NSX Manager, the
  Security Services Platform) get onboarded through this same instance's
  **Endpoint Management**, same as Avi Controllers.
- **Reaching this screen without a real Broadcom entitlement is as far as a
  credential-less lab can go**, and that is expected, not a fault: completing
  either mode's Step 2 (Broadcom account login, or downloading/uploading a
  registration file) requires an actual vDefend/Avi subscription behind the
  account. A lab deploy that reaches **Get Started** cleanly has confirmed the
  entire deploy chain works; registration itself needs real entitlement to
  take further.

TechDocs:
[Deploy a License Hub Appliance](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/license-hub/2-0/license-hub-appliance/deploy-a-license-hub-appliance.html)
·
[License Hub Appliance overview](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/license-hub/2-0/license-hub-appliance.html)
(the two-UI / FQDN-only access note)
·
[License Hub 2.0 Release Notes](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/license-hub/2-0/release-notes/license-hub-20-for-vmware-vdefend-and-avi-load-balancer-release-notes.html).

## License Hub 5.1.2 (SSP Installer flow)

- **~9 IPs on one subnet, in two pools** — **installer 1**, **controller +
  worker nodes 4**, **License Hub services 4**. The **node and service pools
  cannot be modified after deployment**, so size them for scale-out up front.
  Both pools are entered as **contiguous start–end ranges inside one subnet**
  (see the deploy-wizard table below), so they need a **free, unbroken block** —
  scattered spare addresses in an otherwise-used subnet will not do.
- **Two FQDNs for the instance, on top of the installer's own — and they are
  pinned to the service IP pool.** The installer appliance needs an FQDN
  (below), and the **License Hub instance** it deploys asks for an **Instance
  FQDN** (it errors *"Instance FQDN is required"*) and a **Messaging FQDN**.
  Both take *"253 characters max, alphanumeric name with hyphens allowed"*.
  Neither is a free-standing record — TechDocs is explicit about which address
  each one resolves to:

  | FQDN | Purpose | Maps to |
  | ---- | ------- | ------- |
  | **Instance FQDN** | *"the FQDN to use for accessing the License Hub instance from a browser or in an API call"* | *"the **first** IP address in the service IP pool"* |
  | **Messaging FQDN** | *"used by the internal components of the License Hub instance"* | *"the **second** IP address in the service IP pool"* |

  *"You must configure DNS with this mapping either before or after deploying
  the instance"* — for both. So the **service pool's first two addresses are
  spoken for**, and the DNS records cannot be written until the pool range is
  fixed. Order the work that way: agree the subnet → fix the two pool ranges →
  then request A + PTR for the first two service-pool addresses.

> **Three things here cannot be changed after deployment — get them right the
> first time.** TechDocs, verbatim: the **Instance Name** — *"This name cannot
> be changed after deployment"* (and *"cannot contain uppercase letters or
> special characters, and the length cannot exceed 32 characters"*); the
> **Instance FQDN** — *"This FQDN cannot be changed after deployment"*; and the
> **Storage Policy** — *"You cannot change the storage policy after
> deployment"*. Add the **node and service IP pools**, immutable for the same
> reason, and this appliance has an unusually long list of one-way doors for
> something deployed Day-N. A rename or a re-IP means a redeploy.

> **Encrypted storage policies are not supported — check this before you pick a
> cluster.** TechDocs: *"VM encrypted storage policy is not supported"* and
> *"You cannot use third-party encryption solutions."* A site whose management
> cluster defaults to an encryption-enabled storage policy (or runs third-party
> VM encryption) has to provide a non-encrypted policy for this instance —
> and since the policy is also immutable, that is a deploy-time decision, not
> something to fix afterwards.
- **Three VMs, not one appliance** — an **installer**, a **controller** node and
  a **worker** node (it deploys as an SSP instance: one controller + one
  worker). **Instance Management** reports this back as a **Deployment Size** of
  *"1 controllers, 1 workers"* — plural, because **controllers and workers are
  the scale-out axis**, and they draw from the node pool. That is precisely why
  the pools are immutable and have to be sized for growth up front: adding nodes
  later means addresses have to already be sitting in the range. Footprint:

  | Component | vCPU | Memory (GB) | Storage (GB) |
  | --------- | ---- | ----------- | ------------ |
  | Installer | 4    | 6           | 400          |
  | Controller| 2    | 8           | 155          |
  | Worker    | 4    | 16          | 255          |

- **Scale:** *"Total Endpoints Connected to a single License Hub instance =
  120, where Endpoints could be a mix of NSX Manager, vDefend Security Services
  Platform, Avi Controller."* One instance covers all but the largest fleets.
- **Connected or disconnected — decide with the depot decision (intake `G1`).**
  The choice is made at **first login to the hub**, not at deploy time, and it
  can be deferred: the *Get Started* screen offers **SKIP**, so a deployed hub
  can sit unregistered. The product labels **connected mode "Recommended"**.

  | | **Connected** | **Disconnected** |
  | --- | --- | --- |
  | Product wording | *"requires a stable internet connection to streamline the registration process, update licenses, and generate usage reports"* | *"does not require an Internet connection. You must manually download and transfer files for registration, update licenses, and generate usage reports"* |
  | Registration | Log in with a **Broadcom account**; complete it in the Avi Cloud Console | Download a **registration file** → upload to the console → import the **activation file** back |
  | Licences | Assign in the console; *"View assigned licenses"* in the hub | Generate an updated **licence file** in the console → import into the hub |
  | Usage reporting | *"reported to Avi Cloud Console on a regular basis. Usage-based licensing will **automatically refresh**"* | Generate a report → upload to the console → **import the refreshed licence file**, or the licence lapses |

  - **The endpoint is `portal.pulse.broadcom.com`** — the **Avi Cloud Console**.
    It is **not** on Broadcom's Public URLs list, so a proxy allowlist built from
    that page alone will miss it. In **disconnected** mode nothing in the data
    centre needs it, but **an administrator's browser still does** — the file
    exchange happens through that portal from wherever they sit.
  - **A Broadcom customer account is a prerequisite, not a detail.** Connected
    mode logs in with it; disconnected mode still needs someone able to sign
    into the console to convert registration files into licences. Establish
    **who holds that account** during planning — it is an entitlement question,
    and it is not the same person as the vCenter administrator.
  - **Connected mode has its own Proxy Server Setting**, offered right next to
    *"Check your internet connection"*. So the hub does **not** have to inherit
    the fleet proxy — but it does need to be pointed at one deliberately.
  - **Endpoints are assigned licences in the hub's Endpoint Management** —
    *"Assign licenses to **NSX Managers, Security Service Platform, and Avi
    Controllers**"*. That names the three endpoint types behind the
    **120-endpoint** scale figure above.
  - **The endpoint has to opt in from its own side.** An Avi controller does not
    discover the hub: someone must switch it to **On-prem License Hub** under
    *Administration → Licensing* (the alternative being **Cloud Licensing**).
    Deploying the hub is therefore only half the job — see
    [`14-avi-load-balancer.md`](14-avi-load-balancer.md). Until both halves
    are done the controller shows **0 Used / 0 Available**.
  - **Onboarding an endpoint needs that endpoint's credentials *and* its
    certificate.** *Endpoint Management → Onboard an Endpoint → Connect to an
    Endpoint* asks for **Type** (e.g. `Avi Controller`), **Endpoint Name**,
    **Connection Type** (defaults to **Dynamic**), **IP Address or FQDN** —
    *"Enter either IP, Cluster IP, VIP, or FQDN"* — plus **Username**,
    **Password** and a **Certificate** paste box. The hub logs in to each
    endpoint, so **every** appliance it licenses needs an admin credential
    recorded and a certificate to hand. That is the same shape as the SSP
    Installer's vCenter connection above, and the same planning consequence:
    gather certificates before you start, not during.

> **The Certificate field wants the full chain, pasted in one go — not just
> the leaf.** Field-verified: onboarding a VCF-managed Avi Controller (using
> the certificate VCF Operations auto-generated at deploy) means the
> **leaf certificate and the CA certificate both go in the same paste**, in
> one single action — the dialog does not offer separate leaf/CA fields.
> Since the controller cert is auto-generated (not something already sitting
> in a cert store the way a manually-issued one would be), you have to
> **extract it from the controller first** rather than having it on hand —
> plan that retrieval step into the onboarding work, not just the credential
> gathering.

> **Registered is not licensed — there are three gates, not one.** With the hub
> deployed *and* registered, it still banners: *"The License Hub is registered,
> but **no licenses are found**. Download the license file from Avi Cloud
> Console and add into Licenses."* The full chain is:
>
> 1. **Deploy** the SSP Installer, then the License Hub instance.
> 2. **Register** the hub with the Avi Cloud Console (connected or disconnected).
> 3. **Load licences** — download the licence file from the console and add it
>    under *Licenses*. Registration alone brings none.
> 4. **Onboard each endpoint** (credentials + certificate, above).
> 5. **Assign** licences to those endpoints.
> 6. **Switch the endpoint itself** to On-prem License Hub — for Avi, under
>    *Administration → Licensing*.
>
> Any of steps 3–6 left undone leaves a healthy, fully-deployed, **unlicensed**
> fleet. Plan the whole chain as one task with one owner; stopping at "the hub
> is up" is the failure mode this list exists to prevent.

> **Disconnected mode is a standing manual loop, and two of its steps are easy
> to miss.** The file exchange is not one round trip: registration file →
> activation file → **and then a licence still has to be generated**. The hub
> warns in as many words: *"Don't forget to generate the license in Avi Cloud
> Console after downloading the activation file."* Usage reporting is the same
> shape in reverse — *"Generate a report periodically"*, upload it, *"to obtain
> a refreshed license file"*, and import that *"for continued use"*. **Continued
> use is the operative phrase**: in disconnected mode the licence does not
> refresh itself, so this is a recurring, owner-assigned task, not a one-time
> registration. That is the same commitment as the six-month import below, seen
> from the console side.
- **You download the software yourself — it is not in the VCF depot.** Verified
  2026-07-22. The **Broadcom Support Portal**, under **vDefend Security Services
  Platform** (5.1.2 at the time of writing), carries **two** files and you need
  **both**:

  | File | What it is | Size |
  | ---- | ---------- | ---- |
  | `VMware-Security-Services-Platform-Installer-<version>.ova` | The **SSP Installer** appliance — deploy this first | **~5.0 GB** |
  | `License-Hub-<version>.tar` | The **License Hub installation package** — *uploaded to* the SSP Installer, which then deploys License Hub | **~4.5 GB** |

  Neither comes through the **Fleet Depot Service** or the offline depot in
  [`09-binary-depot.md`](09-binary-depot.md) — that machinery is VCF-component
  scoped. Take the two files from the **same release page** as a matched pair
  (their build numbers differ within a release), and keep the portal's **SHA2 /
  MD5** — a 5 GB OVA hand-carried on removable media is exactly when a checksum
  earns its keep.

> **Air-gapped: three things to carry, not one.** The `.ova`, the `.tar`
> (**~9.5 GB** together) **and** the six-monthly license file. The recurring
> commitment below is only the last of those — the first two also have to reach
> an isolated site before anything can be deployed at all.

- **What the SSP Installer OVA asks for.** Field-observed 2026-07-22. A plain
  *Deploy OVF Template* on a **single vNIC**, IP allocation **Static – Manual**,
  IPv4. Have these ready before you start (`*` = required):

  | Group | Fields |
  | ----- | ------ |
  | Application | GRUB root password; GRUB menu timeout (default `4`); **`sysadmin`\***, **`admin`\***, **`audit`\*** passwords |
  | Network | **FQDN\*** — *"must contain a dot character"*; **IPv4 address\***; **netmask\***; default gateway |
  | DNS | **DNS server list\*** (space-separated, **max 3**); domain search list |
  | Services | NTP server list; **Enable SSH** (**off** by default) |

  - **It needs a real FQDN**, unlike VCF Operations for Networks — so plan an
    A + PTR record for it in Step 1, not just an IP.
  - **Four passwords to capture at deploy time**, three of them mandatory.
  - **Only the first three DNS servers are used** — *"all other will be
    ignored"*, silently. If the site standard hands out four or more resolvers,
    decide which three, rather than letting the order decide.
  - **NTP is not marked required — treat it as required anyway.** This is a
    licensing and security appliance; clock skew breaks certificate validation
    and token exchange, and the platform is gated on NTP regardless.
  - **Storage: 396 GB thick, but only ~7 GB thin** (5.0 GB download). The 400 GB
    in the table above is the thick figure.

> **The password rule is stricter than the rest of the platform — check your
> generator.** Verbatim, for `sysadmin` / `admin` / `audit`: *"Min of 12
> characters… ≥1 lower case letter… ≥1 upper case letter… ≥1 number digit… ≥1
> special char… At least five different characters… No dictionary words… No
> palindromes… No monotonic character sequence (more than 4 monotonic characters
> are not allowed)"*. That is well beyond the min-8 rule other fleet components
> accept. Worse, *"password strength validation will occur during **VM boot**"* —
> so a non-compliant password **deploys successfully** and then forces a change
> at first login (`sysadmin` gets a change-password prompt; for `admin`/`audit`
> you log into the SSPI UI as `admin` and use **User Management**) rather than
> failing in the wizard where you typed it.

- **Uploading the License Hub package — there is a URL option.** Once the
  installer is up, the `.tar` is loaded under **Package Management**, which
  tracks packages as *in use* / *not in use* (a package stays **Not in use**
  until an instance consumes it). The **Upload a License Hub Package** dialog:
  *"The License Hub package is available for download from the Broadcom
  Downloads site. Once downloaded, it can be uploaded directly to the platform
  using the **local file** option or by providing the **locally hosted URL**."*
  For a **~4.5 GB** file the URL path is the friendlier one — stage the `.tar`
  on an internal web server and let the appliance pull it, instead of pushing it
  through a browser session over a slow or long-haul link. In an air-gapped
  enclave the file is usually already sitting on an internal host anyway.

- **The vCenter connection needs the trusted root CA certificate — fetch it
  first.** Field-verified 2026-07-22 against TechDocs. *Connect to vCenter* asks
  for three things, and the third is the one that stops people:

  | Field | TechDocs |
  | ----- | -------- |
  | **vCenter Server** | *"Enter the server FQDN or IP address."* |
  | **Username** | *"Enter the VMware vCenter Admin user name, or the name of a user who has **administrator privileges**."* |
  | **Certificate** | Paste the PEM **or** *"click **Browse Local Files** to select the certificate file"* |

  There is **no thumbprint prompt and no "accept this certificate" button** —
  the certificate has to be **in your hands before you open the dialog**.
  TechDocs gives the retrieval route: *"From your browser, enter the VMware
  vCenter's base URL (for example, `vcenter.domain.com`). Right-click **Download
  trusted root CA certificates** at the bottom right"* — that link yields a
  **ZIP** of the vCenter `TRUSTED_ROOTS` store, which you unpack to get the
  certificate to paste. Add it to the jump-host prep: no certificate, no
  connection, no deploy.

  > **Which certificate from that ZIP — the docs do not say, and the wrong one
  > fails.** *"Download trusted root CA certificates"* yields a store with
  > **several** certificates, and the one the dialog wants is the **issuer of
  > vCenter's machine SSL certificate** — the **machine intermediate/root**, not
  > simply the first file in the archive. Where vCenter runs the default VMCA
  > that is the VMCA root; where the machine certificate has been replaced by an
  > enterprise or subordinate CA, it is **that** intermediate. Check what
  > actually signed the machine certificate before pasting, rather than working
  > through the ZIP by trial and error. Note also that **no least-privilege role is
  documented** — TechDocs asks for an administrator, so treat this as a
  privileged credential and record who holds it.

> **The SSP Installer is welded to its vCenter — and that is why the backup
> matters.** TechDocs, verbatim: *"Changing the vCenter Server's FQDN or IP
> address after the deployment is not supported. If a change of the FQDN or IP
> address is required, you must **deploy a new SSP Installer instance**, connect
> to the new vCenter Server, and **restore your configuration from a Security
> Services Platform backup**."* So the post-deploy "back up the SSP Installer"
> step is not routine hygiene — it is the **only** migration path if the
> management vCenter is ever renamed or re-addressed. A site with a vCenter
> rename on its roadmap should know this before it deploys.
>
> Configuring that backup is **not** like the other components: the SSP Installer
> authenticates to the SFTP target with a **public key**, not the password its own
> dialog asks for, and a saved configuration is no proof it can write. See
> [`08-backup-target.md` §6](08-backup-target.md#6-the-ssp-installer-is-the-odd-one-out).

> **Ten characters that must not appear in your vCenter object names.**
> TechDocs, verbatim: *"While naming the VMware vCenter resources, such as data
> center, cluster datastore, resource pool, storage policy, DVS name, or port
> group name used by the SSP Installer, do not use the following 10 special
> characters:"* `/` `,` `'` `=` `[` `]` `&` `%` `\` `"`. This is a constraint on
> the **environment you already have**, not on anything you are about to name —
> an existing datastore, storage policy or port group with a comma or an
> apostrophe in its name is a problem to find **now**, while the fix is still a
> rename rather than a redeploy.

- **What the License Hub deploy wizard asks for.** Field-observed 2026-07-22
  (SSP Installer `5.1.2`). *Deploy an Instance | License Hub* runs
  **Configure → Pre-Checks → Deploy**, with Configure split into three steps:

  | Step | Fields |
  | ---- | ------ |
  | **1. Define Instance and Required FQDN(s)** | **Version\*** (dropdown — the uploaded package; *"If no version is available, click Upload to upload a package"*); **Instance Name\*** (*"32 characters max, all lowercase, alphanumeric name with hyphens allowed"* — **immutable**); Deployment (fixed: `License Hub`); **Instance FQDN\*** (→ 1st service-pool IP, **immutable**); **Messaging FQDN** (→ 2nd service-pool IP); **User Passwords\*** (a **SET** sub-dialog — see the two-layer note below) |
  | **2. Select vCenter Parameters** | **vCenter connection\*** (pick an existing one or **ADD NEW CONNECTION** — needs the **root CA certificate**, see above); **Data Center\***; **Cluster\***; **Storage Policy\*** (**immutable**; **no VM-encrypted policy**); **Content Library & VM Datastore\***; Resource Pool (**optional** — *"No selection creates a new pool by default"*); **Reserve Resource** (toggle, **Activated** by default — *"required for a production environment"*) |
  | **3. Configure Connectivity Options** | **DVS\*** + **Port Group\*** (a **distributed** port group); **Subnet\*** (CIDR, e.g. `10.1.1.0/24`); **Default Gateway\***; **Node IP Pool\*** (range, e.g. `10.1.1.4-10.1.1.15`); **Service IP Pool\*** (range, e.g. `10.1.1.16-10.1.1.24`); **NTP Server(s)** (up to **5**, comma-separated, **IP or FQDN**); **DNS Server(s)** (up to **5**, comma-separated, **IP only**); **Search Domain** (one) |

  - **It needs a distributed port group** — the wizard asks for a **DVS** and a
    port group on it. A vSphere Standard Switch is not an option, which matters
    if the licensing appliances were going to land on a management network that
    is not on the vDS.
  - **A content library datastore is required**, and the same picker covers the
    VM datastore. The installer stages the instance through a content library,
    so that datastore needs room beyond the running VMs' footprint.
  - **Resource Pool is optional, but it creates one anyway**, and **Reserve
    Resource is on by default and TechDocs calls it *"required for a production
    environment"*** — so the instance lands with **reservations**, and turning
    them off to squeeze it in is not a supported production shortcut. Check the
    footprint against management-cluster admission-control headroom **before**
    deploying.

> **Two different DNS limits, and two different password rules — one product,
> two layers.** The **installer OVA** takes at most **3 DNS servers** (extras
> silently ignored) and enforces the strict min-12 rule above. The **deployed
> instance** takes up to **5 DNS servers** and enforces a *different, simpler*
> password rule, verbatim: *"At least 15 characters in length, and no more than
> 128 characters… At least 1 lowercase, 1 uppercase, 1 numeric character and 1
> special character"* — **no** dictionary / palindrome / monotonic-run checks,
> but a **higher minimum**. The practical consequence: **a password that passes
> the OVA can still be rejected by the instance wizard.** Users seen in that
> dialog: **`admin` and `audit` — those two only**, confirmed by scrolling it.
> That is two instance passwords on top of the installer's four. Pick one password
> pattern of **15+ characters** that satisfies the strict OVA rules, and it
> clears both layers.
>
> **TechDocs and the product disagree on the instance minimum — believe the
> product.** The deploy-configuration page states *"Minimum length: 12"*, while
> the shipping `5.1.2` dialog states *"At least 15 characters in length"*
> (field-observed 2026-07-22). A 12–14 character password planned from the
> documentation will be **rejected at the wizard**. The 15+ pattern above is
> the safe answer either way, which is why it is written that way here.

- **The Pre-Checks tab is the product's own pre-flight list — read it as your
  checklist.** Field-observed 2026-07-22: **9 pre-checks**, all re-runnable from
  a **RERUN PRE-CHECK** button, so a failure is fixed and retried in place
  rather than by restarting the wizard.

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

  Worth noting what that list implies: **cluster CPU and memory are validated**
  (so the reservation footprint is checked, not just accepted), and both the
  **FQDN/domain** and the **node-pool IPs** are tested before anything is built.
  TechDocs permits the DNS records *"either before or after deploying the
  instance"* — but with a domain pre-check in the way, having DNS in place
  **first** is the path of least resistance.

- **What the deploy itself does — 4 steps, ~28 tasks.** Once started:
  **vCenter Configuration** (6 tasks — it begins by **creating a content
  library**, which is what that datastore is for), **Workload Cluster** (**18
  tasks** — the bulk of the run; the instance comes up as a cluster, which is
  why it is controller + worker rather than one appliance), **Security
  Platform** (3) and **Metrics** (1). TechDocs gives **no expected duration**.

- **If it fails mid-run, there are three controls and they do different
  things.** Verbatim:

  | Control | What it does |
  | ------- | ------------ |
  | **Stop Deployment** | *"Halts the ongoing deployment so that you can fix the error. **This action does not undo any previous deployments.**"* |
  | **Update & Redeploy** | *"Start the ongoing deployment after resolving an error. **The deployment starts from the point it was stopped.**"* |
  | **Cleanup** | *"Removes all the previous deployment tasks."* |

  So the normal recovery is **Stop → fix → Update & Redeploy**, which *resumes*
  rather than restarting — **Cleanup** is the heavier option that discards the
  work so far. Stopping alone leaves everything already built in place.

> **A vCenter outage mid-deploy is the bad failure — and the escape hatch is
> ugly.** TechDocs, verbatim: *"If the deployment fails because VMware vCenter
> becomes unavailable during the deployment, and you navigate to the Configure
> screen, the option to reset the configurations might not be available. This is
> expected behavior because some resources have been created on the VMware
> vCenter server. To resolve the issue, clean up the deployment before resetting
> the configurations. **If the VMware vCenter server is not recoverable,
> uninstall SSP Installer and deploy a new one.**"* Two practical consequences:
> **Cleanup before reset**, in that order — and don't run this deploy during a
> window when vCenter is being patched or restarted.

- **The completion banner hands you the DNS request.** On success the installer
  names the instance and both endpoints, and says to *"Share the Instance
  FQDN/IP … and Messaging FQDN/IP … with your DNS administrator. Proper backup
  of this security service platform installer is crucial to restore the Service
  Platform Instances and Services to their working state in the event of a
  failure."* Three things this settles: the **Messaging FQDN is real and gets
  its own address** (not an optional extra); its IP is the one **immediately
  after** the instance IP, matching the TechDocs first/second service-pool rule;
  and DNS **can** legitimately be created after the deploy — the product hands
  you the two mappings to pass on. Creating them beforehand still avoids the
  domain pre-check being the thing that discovers a missing record.

- **After it completes.** Wait for the instance to report **Healthy** (if it
  does not, TechDocs points at **Troubleshooting Diagnostic**), click **Done**,
  then reach the hub through the **Instance FQDN & IP** link and log in *"using
  the credentials you specified in the Configure step"* — the `admin` / `audit`
  passwords from the SET dialog, so they need to be recorded at planning time,
  not invented at the wizard. **Back up the SSP Installer** at this point;
  TechDocs raises it as a step here rather than leaving it to a backup policy.
  **Instance Management** is where you *"edit configurations, reset passwords,
  or delete the instance"* afterwards — note **delete**, which is the only
  answer to the immutable fields above.

> **NSX firewall exclusion list — the licensing appliance can be blocked by the
> product it licenses.** TechDocs, verbatim: *"If the License Hub VMs are
> running in an NSX overlay network, NSX VLAN segments, and security-enabled
> port groups, add the License Hub VMs to a firewall exclusion list."* The
> documentation **does not say why**. Since License Hub exists to license
> **vDefend**, and vDefend is the distributed firewall doing the blocking, this
> is worth raising with whoever owns DFW policy **before** the deploy — see
> [`07-firewall-ports.md`](07-firewall-ports.md).

> **Air-gapped: the six-month import is a recurring commitment.** If the site
> has no internet path — the same site that needs the offline depot in
> [`09-binary-depot.md`](09-binary-depot.md) — someone must carry a fresh
> license file in **twice a year, forever**. Give it a named owner and a
> calendar reminder at deployment time, not at first expiry.

## Licensing vDefend endpoints

Deploying and registering the hub (either version above) licenses nothing by
itself. vDefend's endpoints have to be **onboarded** into the hub, **assigned**
a licence, and then NSX has to be **pointed at the hub** — the vDefend
equivalent of the Avi "switch the controller to On-prem License Hub" step in
[`14-avi-load-balancer.md`](14-avi-load-balancer.md). The endpoint types are
**NSX Manager** and the **vDefend Security Services Platform (SSP)**.

Order of work:

1. **Register the hub and load the vDefend licence file first.** The
   *"Registered is not licensed — there are three gates"* note above applies
   unchanged — registration brings no licences. Download the vDefend licence
   from the Avi Cloud Console and add it under *Licenses* before touching
   endpoints.
2. **Put the License Hub VMs on the NSX Distributed Firewall exclusion list**
   *before* onboarding — see the *"NSX firewall exclusion list"* note above and
   [`07-firewall-ports.md`](07-firewall-ports.md). You are about to enforce
   DFW; the appliance that licenses vDefend must not be caught by it.
3. **Onboard NSX Manager** — *Endpoint Management → Onboard an Endpoint →
   Connect to an Endpoint*: Type **NSX Manager**; Connection Type **Dynamic**;
   the **Cluster VIP** or FQDN; an NSX **enterprise-admin** credential; and the
   **full certificate chain (leaf + CA) pasted in one action**, exactly as for
   the Avi controller above — extract NSX Manager's certificate first, it is not
   sitting in a store to hand.
4. **Onboard the vDefend SSP** the same way **if it is deployed** — required for
   the Malware Prevention / ATP endpoints. Distributed Firewall and Distributed
   IDS/IPS licensing ride on the **NSX Manager** endpoint alone, so a
   Firewall-only site can skip this.
5. **Assign the vDefend licence** to each onboarded endpoint in the hub
   (vDefend Firewall, or Firewall with Advanced Threat Prevention).
6. **Point NSX at the hub.** NSX Manager → *System → Licenses*.
   **[verify in-product]** Unlike Avi — which has an explicit *Cloud Licensing*
   vs *On-prem License Hub* choice under *Administration → Licensing* — NSX may
   simply reflect the hub's assignment once the Manager is onboarded, or it may
   need the licensing mode set here. Confirm which on your build before treating
   the endpoint as licensed; this step will be tightened once field-verified.
7. **Verify on NSX** — *System → Licenses* shows the vDefend subscription active
   with capacity, and IDS/IPS / Malware Prevention are no longer in evaluation.

Turning the **features** on is separate and happens in NSX once the licence is
live: Distributed Firewall is already active (build policy under *Security →
Distributed Firewall*); **Distributed IDS/IPS** is enabled under *Security →
IDS/IPS & Malware Prevention* (enable, pull signatures, enable per cluster,
attach policies); **Malware Prevention / ATP** needs the SSP onboarded and
licensed; **Gateway Firewall** is configured on the T0/T1 gateways.

**Usage reporting** then runs on the same loop as every other hub endpoint —
automatic in connected mode, the recurring generate → upload →
import-refreshed-licence cycle in disconnected mode.

## References

TechDocs:
[License Hub for vDefend and Avi](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/security-modernization/vdefend-lateral-security/security-services-platform-for-vmware-cloud-foundation/license-hub-for-vdefend-and-avi/license-hub-for-vmware-vdefend-and-vmware-avi-load-balancer.html)
(the VCF 9.1 design blueprint — sizing, endpoint scale, modes) ·
[Deploying License Hub](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/security-services-platform/5-1/licensing-overview/deploying-license-hub.html)
(SSP 5.1 — the deploy procedure) ·
[Configure a License Hub Deployment](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/security-services-platform/5-1/licensing-overview/deploying-license-hub/steps-to-deploy-a-license-hub-instance/configure-a-license-hub-deployment.html)
(the field-by-field reference for the wizard above — FQDN-to-pool mapping, the
immutable fields, the storage-policy restriction).
