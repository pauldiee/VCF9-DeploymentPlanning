# Avi Load Balancer — Deployment Guide

Deploying the **Avi Load Balancer** controller cluster from VCF Operations. The
[prerequisites gate](prerequisites.md#avi-load-balancer-only-if-in-scope)
states *what* must exist before you start; this page covers *how to deploy
it*, the controller's own first-login setup, and the licensing chain that
follows.

Deployed **Day-N from VCF Operations** (lifecycle-managed), needed when Avi is
the chosen load balancer for **vSphere Supervisor**, optionally in front of
**VCF Automation**, or for tenant/workload load balancing.

> **Controllers are central, Service Engines are local.** The **Avi
> controllers always run in the management domain** — whichever domain they
> serve, including a Supervisor on a workload domain. That is the same pattern
> as a workload domain's vCenter and NSX Managers, which also run in the
> management domain (`04-sizing.md`'s workload-domain repeater). Only the
> **Service Engine VMs** are distributed: they run **per cluster**, in the
> workload domain.
>
> **A controller set is scoped to the NSX instance, not the workload domain:**
> workload domains that **share** an NSX instance share **one** controller
> set; a workload domain with its **own** NSX instance gets its **own** set.
> Count controller sets by NSX instance, and Service Engines by cluster.

## Deploying from VCF Operations

**Before you start: a content library for Service Engine images is required
and VCF Operations does not create it.** See [Service Engine
infrastructure](#service-engine-infrastructure--cloud-content-library-and-se-group)
below for the full, field-verified procedure — read it before you activate
anything downstream (Supervisor or a virtual service), since this is the
single most commonly missed step in the whole Avi deployment.

**Where you deploy it from, and what "optional" means.** **VCF Operations →
Build → Lifecycle → VCF Instances → *your domain* → Manage Components**, where
**Avi Load Balancer** appears as a card beside **VCF Operations HCX**. That
page draws a distinction worth knowing at procurement time, verbatim: *"**Optional
components** are appliances that can be installed at domain to help in
leveraging specific use cases and/or goals and are **included in your
entitlement**. **Add-ons** are optional appliances that are **purchased and
managed in separate from the SDDC Manager**."* Avi is an **Optional
Component** — entitled and SDDC-Manager-managed, not a separate purchase.

**What the deploy wizard asks for.** Field-observed 2026-07-22 — four steps:

| Step | Fields |
| ---- | ------ |
| **1. Select version** | Version dropdown (e.g. `32.1.1`, ~3.8 GB) — shows the release date and **"Software bundle is downloaded and ready"**, i.e. it must already be in the depot |
| **2. Form Factor** | **Select Size** (Small / Large / XLarge) — then shows **Resource Availability**: the reservation needed against what the cluster actually has free |
| **3. Settings** | **Admin Password\***; **VCF Ops Admin Password\***; **Node 1 / 2 / 3 IP Address\*** (the three ALB controller cluster nodes); then, under *"Enter the VIP for cluster access"*, **Cluster FQDN** and **Cluster Name** — **the VIP address is not an input**, see the DNS bullet in the prerequisites gate |
| **4. Finish** | Review, then two notices worth reading (below) |

**Small** reserves **96 GB memory, 18 GHz CPU and 1,536 GB disk** across the
three-node cluster (≈32 GB / 6 GHz / 512 GB per node). Because step 2 shows
this **against live cluster availability**, it doubles as a capacity check —
but on a management cluster sized to the line, confirm the headroom in
`04-sizing.md` before you get there.

## Controller first-login setup

**The controller has its own first-login wizard — the VCF deploy is not the
end.** Field-observed 2026-07-22. Logging into the new controller opens
**WELCOME ADMIN → System Settings**, *"Let's get started with some basic
questions"*, which asks for:

Three sections, each with its own **NEXT**, then **SAVE**:

| Section | Fields (defaults in **bold**) |
| ------- | ----------------------------- |
| **1. System Settings** | **Passphrase\*** + **Confirm Passphrase\*** — a **third secret**, separate from the controller `admin` and VCF Ops admin passwords above, and **restore-critical** (see below); **DNS Resolver(s)** (comma-separated); **DNS Search Domain**; *Join the CEIP* (**off**); *Enable Configuration Warnings Checks* (**on**) |
| **2. Email/SMTP** | **None** / Local Host / SMTP Server / Anonymous Server |
| **3. Multi-Tenant** | **IP Route Domain**: per-tenant, or **share across tenants**; **Service Engines managed within the**: tenant, or **Provider (shared across tenants)**; **Tenant Access to Service Engine**: **Read Access** or None |

A **Setup Cloud After** checkbox sits alongside SAVE throughout, deferring
cloud configuration to a later step.

Three planning consequences:

- **A secret to have ready that no VCF-side document mentions — and losing it
  costs you your backups.** The Avi **Passphrase** protects the controller's
  configuration backups, so treat it exactly like the **backup encryption
  passphrase** for the SFTP target (see `08-backup-target.md`): chosen up
  front, stored in a password manager, with a **named owner**. It is
  **required to restore**, and a lost passphrase makes every controller backup
  useless. Nothing on the VCF side asks for it, and it is set once, in passing,
  on a welcome screen — which is exactly how it ends up unrecorded.
- **The controller's DNS is configured here**, not during the VCF deploy — so
  the resolvers and search domain belong in the Step 1 plan even though
  nothing in the deployment wizard asked for them.
- **The Multi-Tenant page is an architecture decision disguised as a setup
  step.** Whether Service Engines are **provider-shared or per-tenant**, and
  whether the **IP route domain is shared**, shape how the platform can be
  carved up later. The defaults (shared route domain, provider-managed SEs,
  tenants get read access) suit a single-tenant enterprise deployment. If the
  fleet is heading toward genuine tenant separation — service-provider use, or
  strict per-tenant isolation — decide this **before** first login rather than
  accepting the defaults and discovering the model later.

> **Email/SMTP defaults to None — so nothing is alerting anyone.** Avi raises
> its own events, and out of the box there is no path for them to reach a
> human. If the fleet has a monitoring or alerting standard, wire the
> controller into it deliberately; if it does not, at least record that Avi
> alerts live only in its own UI.

## Service Engine infrastructure — Cloud, content library, and SE Group

*Sourcing convention: **[documented]** = confirmed against TechDocs;
**[field-verified 2026-07-23]** = confirmed against a live 9.1 lab, ported
over from `10-supervisor-enablement.md` §4.5, which found this while
enabling Supervisor with Avi — the same Cloud/content-library/SE-Group
mechanism applies regardless of what consumes the load balancer (Supervisor,
VCF Automation, tenant LBaaS), since it's all the same NSX Cloud object in
Avi.*

**VCF Operations deploys the Controller, creates its service account,
generates the certificate, and propagates trust to NSX and vCenter, and
wires the base NSX Cloud connector** **[documented — 9.1 Avi release
notes]**. That leaves a **short, required** list of Avi-side configuration
you still have to do by hand before anything can actually deploy a Service
Engine — this is the gate almost everyone hits.

> **Verify before you build.** VCF Operations does the base "cloud connector
> setup", so parts of the NSX Cloud may already exist. Open **Infrastructure
> → Clouds** and **Templates → IPAM/DNS Profiles** and check what's already
> there before hand-creating anything.

**1. The Service Engine management network — the piece people miss**
**[documented; field-verified 2026-07-23]**. SE management NICs need their
own network, and **VCF Operations does not create it** — it leaves the NSX
Cloud connector's *Management Network* field blank, because it cannot guess
which segment your SEs should sit on. Two parts:

- **On NSX, build the segment first.** A **management transport zone** plus
  an **overlay segment behind a Tier-1** (or a **VLAN-backed segment**),
  with an **IP pool / allocation** for the SE management NICs. This does not
  exist until you make it.
- **In Avi, select it on the Cloud.** **Infrastructure → Clouds →** the NSX
  cloud **→ Management Network →** pick that transport zone + segment + IP
  allocation. Until this is set the Cloud sits **red** with the tell-tale
  *"Configured management transport zone '' of type ''"* (empty quotes =
  never set), and **no Service Engines can deploy** — surfacing later as the
  load-balancer step stalling with *"Unable to acquire IP address for
  network"* (KB 442187). The empty-quotes state is a **missing-config**
  error, not a trust/cert error — a cert problem shows as a
  connection/auth failure instead.
- **The data network still needs a transport zone — but no segments.** The
  Cloud config *requires* a **data-network transport zone** (the workload
  overlay TZ), but you do **not** configure data segments or IP pools under
  it in a VPC-networked cloud — the VPC handles the Data Network Segment
  itself. The data TZ does not need to match the management-network TZ, and
  it must be present in the **transport node profile of the ESXi hosts
  where the Service Engines will run**, or the SE data NICs cannot attach.

**2. The NSX Cloud connector — vCenter, a hand-built SE content library, and
the template SE Group** **[documented; field-verified 2026-07-23]**. Beyond
the management network above:

- Verify the Cloud has a **vCenter registered for SE placement** (where the
  SE *VMs* land — the target cluster; VCF Operations usually sets this, but
  confirm it).
- **Create the Service Engine content library by hand — VCF Operations does
  not create this one.** Make an (empty) **content library on the vCenter**
  and point the Cloud's vCenter config at it; Avi uploads the **Service
  Engine OVA** into it and clones SEs from it. No library, no SE deployment.
  **The push is immediate, not lazy** **[field-verified 2026-07-23]** — as
  soon as you save the vCenter/content-library config on the Cloud, Avi
  pushes the SE OVA into the library. Use that as a checkpoint: after
  saving, confirm the SE OVA item actually appears in the library, proving
  the SE image path works **before** you try to activate anything
  downstream — not something to discover mid-activation.
- Set the **Template Service Engine Group** on the Cloud. **Infrastructure
  → Clouds**.

**3. The Service Engine Group — configure Default-Group as the template,
before first use** **[documented]**. Two statements that together make this
a one-shot setting:

> "\<Consumer\> creates one Service Engine Group for each \<instance\>." /
> "If no template Service Engine Group is configured in the cloud, the
> Default-Group is used." / "Changes made to the Default-Group configuration
> will not reflect in an already created Service Engine Group."

So **Default-Group must be right before the first thing consumes it** —
retrofitting it afterwards does nothing for whatever already cloned from
it. Under **Infrastructure → Cloud Resources → Service Engine Group**, set:

- The **vSphere storage policy** — Service Engines are VMs, no policy means
  nowhere to deploy them.

  > **The storage policy lives on the Service Engine Group, not on the
  > Cloud object** **[field-verified 2026-07-23]** — there is no
  > storage-policy field on the NSX Cloud itself, which is the common place
  > people go looking for it first.
- **Placement scope** — compute cluster + datastore, optionally VM-group /
  host-group affinity.
- **HA mode** (N+M buffer / active-standby / active-active), maximum Service
  Engine count (default 10), and virtual-service placement (**Compact**, the
  default, packs onto existing SEs; **Distributed** spreads across new
  ones). At least two Service Engine VMs are typically deployed per
  consumer.

> **IPAM is NOT required for VPC networking** **[documented]** — a
> placeholder IPAM profile is only needed for a **non-VPC** cloud. On the
> VPC path (the model used both by Supervisor's built-in LB integration and
> the [VCF Automation DMZ VPC approach](#vcf-automation-externalcustomer-access)
> below), TechDocs states plainly: *"IPAM profiles are: Not required for VPC
> networking"*, because **the VIP comes from the VPC's External IP Block,
> not from Avi IPAM**. That External IP Block is the real pre-activation
> dependency in that model, and it lives in the VPC connectivity profile you
> build in NSX, not in Avi itself.

> **The short version:** SE management network built in NSX and selected in
> the Avi Cloud + a data-network transport zone (no segments needed under a
> VPC-networked cloud) + vCenter with a **hand-built SE content library** +
> a Service Engine Group (Default-Group, or a named template) with a
> **storage policy** set. Everything else a fuller walkthrough shows you is
> already done for you by VCF Operations.

## Licensing

**The controller must be pointed at License Hub — it does not find it.**
**Administration → Licensing** offers a two-way choice under *Get Started*:

| Mode | Product wording |
| ---- | --------------- |
| **Cloud Licensing** | *"Connect to cloud licensing to enable automatic license management and get access to the latest features."* |
| **On-prem License Hub** | *"For enhanced control, use an On-prem License Hub. Manage licenses locally and maintain full control over your licensing environment."* |

Selecting the second switches the controller to the hub (*"Switched to On-prem
License Hub"*), and its **ON BOARDING INSTRUCTION** button lays out the same
four stages the hub itself shows, from the Avi side: **Deploy & Register →
Licenses → Endpoint Management → Usage Reporting and License Refresh**. The
operative one is **Endpoint Management** — *"Assign licenses to AVI
Controllers from On-prem License Hub"*. That is the actual join between the
two appliances: the hub holds the entitlement, and the controller is an
**endpoint** it assigns licences to. Until that is done the controller reports
**0 Used / 0 Available**.

- **Licences are measured in Service Units**, not per-appliance — the figure
  to check against an entitlement at procurement time.
- Splitting, merging or upgrading licences happens in the **Broadcom Support
  Portal → Entitlements**, while assignment happens in the **Avi Cloud
  Console** — two different portals for two different jobs.
- Ordering: the controller can be **switched to On-prem mode before the hub is
  registered**, it simply has nothing to draw on yet. So the switch is safe to
  make early, but licences do not appear until the hub itself is registered
  (see [`15-license-hub.md`](15-license-hub.md)).

Once connected, the page shows an **ON-PREM LICENSE HUB** card — the hub
**URL**, a **Connectivity Status** of *Connected*, a **Last Refresh**
timestamp, a **REFRESH LICENSES** button and a **DISCONNECT ON-PREM
LICENSING** action. Use that card as the verification step: *Connected* plus a
recent refresh is the proof the join actually works.

> **Connected still means zero licences — verify the count, not the status.**
> Field-observed: with connectivity **Connected** and a fresh refresh
> timestamp, the controller still reported **0 Used / 0 Available**, because
> the licence file had not yet been loaded into the hub (step 3 of the
> licensing chain in `15-license-hub.md`). A green connectivity indicator is
> **not** evidence of a licensed fleet. Check **LICENSE USAGE**, not
> *Connectivity Status*.

> **Upgrading to 32.1.1 starts a 90-day clock that overrides your licence
> validity — decide this BEFORE you upgrade.** This is the single most
> time-critical item in this section. TechDocs, verbatim: *"Starting with Avi
> Load Balancer version 32.1.1, **25-character serial key (legacy license) and
> YAML-based licenses are deprecated**."* … *"Newly deployed or upgraded Avi
> Controllers on 32.1.1 are allowed to use legacy licenses for a **strict grace
> period of 90 days**. This period **commences upon the initial boot or
> completion of the upgrade**."* … *"**This 90-day limit overrides any existing
> validity dates**"* — with the worked example that *"an upgrade performed on
> May 31 will cause all legacy licenses to expire on August 28, 2026, **even if
> they were originally valid until 2029**."*
>
> So a site with **valid, paid-up legacy licences and years left on them** gets
> **90 days** after the upgrade, and then they stop. The clock starts silently
> at upgrade completion. Broadcom's own instruction is unambiguous: *"**Plan
> the transition to one of Cloud Licensing or On-premise License Hub
> deployment models before initiating an upgrade**."* If the site already runs
> Avi, treat entitlement migration as a **pre-upgrade gate**, not a follow-up.

> **Two dates on a fresh controller, and they mean different things.** A newly
> deployed 32.1.1 controller shows both, roughly two months apart, which reads
> as a contradiction until you know the cause:
>
> | Where | What it is |
> | ----- | ---------- |
> | The licence row's **Expiry**, ~30 days out | The *"built-in **30-day** keyless evaluation mode upon installation"* |
> | The banner, *"All legacy licenses are scheduled to expire on `<date>`"*, ~90 days out | The **90-day legacy grace period**, counted from that controller's own **initial boot** |
>
> Neither is a general Broadcom cutoff — both are **per-controller clocks
> started by your own deployment**. Diary both on the day you deploy.

**Licensing an Avi controller is a four-step sequence, and step 1 is not in
any appliance.** TechDocs, verbatim: *"**Upgrade Entitlement:** Log in to the
Broadcom Support Portal and upgrade your Avi license to the new subscription
format."* → *"Deploy License Hub on-premises (if applicable) and
onboard/register it with the Avi Cloud Console."* → *"Use the Avi Cloud
Console to allocate the license ID and generate an activation code (connected)
or signed license file (disconnected)."* → *"From the License Hub, assign the
validated license file directly to your Avi Controller endpoints."* Note that
the entitlement upgrade is a **portal action taken before any appliance work**,
and that **once upgraded a licence cannot be downgraded** — so it is a
one-way step to schedule deliberately, not to discover mid-deployment.

## VCF Automation (external/customer access)

*Sourcing convention: **[documented]** = confirmed elsewhere in this repo
against TechDocs/field observation; **[field-reported]** = practitioner blog,
not independently verified here. This whole section is one worked example,
not the only way to do it — TechDocs itself only says an external LB is
possible post-deploy, not how.*

VCF Automation's own **built-in load balancer is L4-only** — no SSL
termination, and (per the built-in-LB memory already in this repo) it's
never required. Putting Avi in front adds L7 termination and can keep
customer/tenant traffic off the management network entirely. The most
complete field walkthrough found for this is Tom Fojta's ["Load Balancing
VCF Automation with
Avi"](https://fojta.wordpress.com/2025/08/16/load-balancing-vcf-automation-with-avi/)
**[field-reported]**, which uses a **DMZ VPC** architecture — a separate NSX
VPC dedicated to external access, not a plain VDS network. Below follows
his steps with notes on what a **VCF-managed Avi deploy already did for
you**, since his article doesn't distinguish that.

> **Licensing note [field-reported]:** this approach needs **VPC networking
> and Avi/vDefend licensing beyond base VCF** — plain VCF only ships NSX
> Legacy L4 load balancing and a stateless gateway firewall.

### What the VCF Operations deploy already did

- **The NSX Cloud + vCenter/NSX linkage — already done, don't recreate it.**
  **[documented]**, per the deploy wizard's own Finish-step notice quoted in
  *Notices and gotchas* below: *"Service accounts will be created with NSX
  Manager and vCenter Server as required."* Fojta's guide lists creating an
  NSX Cloud that connects to the management domain's NSX and vCenter as its
  first Avi-side step — for a VCF-managed deploy this connection **already
  exists**. Go verify it under the Cloud configuration rather than creating
  a new one.
- **A default Service Engine Group likely already exists — configure it,
  don't assume it's ready as-is.** Avi ships a default SE Group, but Fojta's
  guide still calls for setting SE node sizing, placement, and HA on it. Not
  independently confirmed here whether the VCF-deployed default needs
  changes before it is production-ready for this use case — check live.
- **Everything else below is genuinely manual**, VCF-managed or not: the NSX
  networking chain (Project/Transit GW/VPC), the SE management network, and
  all of the virtual-service configuration are Day-2, use-case-specific work
  that nothing automates.

### NSX-side build (the DMZ VPC)

**[field-reported]**, in order:

1. **Confirm Avi is registered in NSX to support VPCs.** Not confirmed here
   whether this is automatic alongside the Cloud/service-account
   provisioning above, or a separate toggle — verify live before assuming
   either way.
2. **External IP block** for the DMZ VIP and SNAT.
3. **NSX Project** ("DMZ project") with a centralized connection to a Tier-0
   GW that can route to both the VCFA network and the external IP block.
4. **Transit GW** inside that project.
5. **DMZ VPC** with its own private CIDR (non-overlapping with the external
   block). Its Connectivity Profile uses the external IP block, N-S
   services, and default outbound NAT (so the service network can reach
   VCFA).
6. Enable **Avi Load Balancing** in the VPC's Advanced Settings.

> **DFW gotcha [field-reported]:** the default east-west (DFW) drop rule
> blocks LB→VCFA traffic. Temporarily open it to prove the path works, then
> harden back down deliberately rather than leaving it wide open.

If registered correctly, Avi **auto-detects** Avi-enabled VPCs and creates a
matching **tenant** per NSX Project — no manual tenant creation needed in
Avi itself.

### Avi-side SE Group, content library, and management-plane network

**Do this via the canonical procedure above, not from scratch.** The [Service
Engine infrastructure](#service-engine-infrastructure--cloud-content-library-and-se-group)
section covers the SE management network build, the hand-built content
library (VCF Operations does not create it — and confirming the SE OVA
lands in it is your checkpoint before going further), and the Service
Engine Group's storage policy — all of it applies here unchanged, since
it's the same NSX Cloud object regardless of what consumes the load
balancer. Fojta's own write-up **[field-reported]** names only a **Tier-1
GW + DHCP-enabled segment** for this — that matches the management-network
build above, just described less precisely; use the canonical section's
detail (including the exact place SEs go **red** if it's wrong) over his
shorthand.

If this controller cluster was **freshly deployed specifically for this use
case**, budget the full Cloud/content-library/SE-Group setup as real work
before expecting Service Engines to deploy at all — none of it is optional,
and none of it is done for you beyond what VCF Operations already handles
(cert, trust, service accounts, base connector).

### Building the virtual service

**[field-reported]**, field values from Fojta's guide:

| Object | Settings |
| ------ | -------- |
| **VIP** | Pick the NSX Cloud + DMZ VPC VRF context; auto-allocate from the public subnet |
| **Pool** | Generic application; same NSX Cloud/VRF as the VIP; default server port **443**; **server = VCFA's internal built-in-LB VIP** (single member — not the individual VMSP node IPs) |
| **Pool health monitor** | Type **HTTPS**; Client Request: `GET /api/server_status HTTP/1.1`; expected Server Response Data: *"Service is up."*; Response code: **2xx**; SSL enabled; **TLS SNI Server Name = the VCFA FQDN**; SSL Profile: System Standard |
| **Virtual Service** | Application Type **HTTP/HTTPS**; Application Profile **System-Secure-HTTP**; Cloud/VRF matching the VPC; the Service Engine Group; the VIP; service port **443** with SSL enabled; **certificate matching the VCFA FQDN**; Pool = above |

> **DNS cutover gotcha [field-reported] — and it's not what you'd expect.**
> *"AFAIK there is no documented way how to change FQDN of VCFA
> installation which means you cannot use a new FQDN for the public VIP."*
> So this is **not** a new customer-facing name added alongside the
> internal one — the **same** VCFA FQDN's DNS record has to move from the
> internal VIP to the new external VIP. Skip this and VCFA will redirect
> subsequent calls back to the internal VIP, breaking the flow, because the
> internal VIP still believes it owns that name.

### Known gotcha: HTTP/2 breaks Supervisor image pulls

**[field-reported]**, and worth reading before enabling HTTP/2 on this
virtual service at all: VKS Cluster Management traffic (Supervisor and VKS
clusters talking to the VCFA endpoint) needs **HTTP/2**, because the cluster
agent extensions use gRPC over HTTP/2. But on **Avi 32.1.1**, enabling
HTTP/2 broke Supervisor's ability to pull images from the VCFA endpoint
(`ErrImagePull` on pods like `auto-attach`) — Avi was rewriting the
backend's HEAD-request `Content-Length` to `0` under HTTP/2, and downstream
image resolution failed on that malformed response. Workaround: a
**second VCFA pool with HTTP/2 disabled**, with an Avi **request policy**
that context-switches HTTP `HEAD` requests to that pool instead. If this
fleet uses Supervisor/VKS against the same VCFA endpoint, budget for
hitting this and plan the second pool up front rather than discovering it
mid-incident.

## Notices and gotchas

> **The wizard states the per-NSX-instance rule itself.** At Finish, verbatim:
> *"This Avi Load Balancer will automatically be deployed and linked to other
> workload domains sharing the same NSX manager associated with `<workload
> domain>`."* This is the rule from the callout above, in the product's own
> words — deploying "an Avi for this workload domain" silently serves **every**
> workload domain on that NSX Manager. Also noted there: *"Service accounts
> will be created with NSX Manager and vCenter Server as required"* — the
> deploy provisions its own service accounts, so expect new principals in
> both.

> Not the same thing as the **external load balancer for VCF Operations** (see
> `prerequisites.md`'s Network table and `05-day2-deployments.md` B.1) — that
> one is never served by VCF.

## References

TechDocs:
[Requirements for Deploying Avi Load Balancer](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/avi-load-balancer/avi-load-balancer-vmware-cloud-foundation/9-1/build-and-deploy-avi-91/requirements-for-deploying-avi-load-balancer.html)
·
[Deploy Avi Load Balancer from VCF Operations](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/avi-load-balancer/avi-load-balancer-vmware-cloud-foundation/9-1/build-and-deploy-avi-91/deploy-avi-load-balancer-from-vcf-operations.html).
The P&P workbook has **no Avi input fields** — only sizing rows — so capture
these values in the Step 1 plan / intake instead.
