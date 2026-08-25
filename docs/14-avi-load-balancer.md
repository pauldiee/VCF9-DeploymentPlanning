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
