# VCF Operations in VVF/Standalone — Deployment (Nodes, HA, Cloud Proxy, License Server)

> Closes #346, #348. Companion to
> [`26-vcf-operations-vvf-vcenter.md`](26-vcf-operations-vvf-vcenter.md) —
> this doc deploys VCF Operations itself (nodes, HA, Cloud Proxy, License
> Server); docs/26 already assumes VCF Operations exists and only covers
> connecting it to vCenter. Do this doc first, docs/26 second. Also
> companion to [`05-day2-deployments.md`](05-day2-deployments.md)
> §B.1/§B.4 (fleet-managed VCF Operations topics, for contrast — this doc
> is the VVF/standalone, no-Fleet-LCM path) and
> [`09-binary-depot.md`](09-binary-depot.md) (proxy config for the VCF
> services runtime, a different topology).

**In a full VCF fleet, the Installer deploys VCF Operations, its Cloud
Proxy, and a License Server all automatically at bring-up**
(`05-day2-deployments.md` D2, §B.4). **A VVF deployment has no Fleet LCM to
do that** — you deploy the VCF Operations nodes yourself from OVA, run the
setup wizard, optionally enable HA, deploy a Cloud Proxy, and deploy a
License Server, all by hand. This doc covers that whole flow for a fresh
VVF/standalone deployment.

**Sourcing note:** the OVA-deploy and Cloud Proxy procedures below are
pulled verbatim from Broadcom's *VCF 9.1 Upgrade* TechDocs tree — that's
the only place Broadcom publishes the manual OVA/wizard steps in full,
since a fleet deployment never needs them (the Installer does it). Same
OVA, same wizard, same appliance regardless of whether you arrived at this
appliance via an upgrade or a fresh VVF deployment — the steps apply
either way. The HA-conversion procedure (Step 3) comes from the
non-upgrade *"Configuring Advanced Architectures for VCF Operations"*
TechDocs section, which **does** apply generically. The License Server
procedure (Step 5) comes from a third tree —
*"Adding or Removing VCF Components Post Deployment"* — Broadcom's
standard manual-add flow, and the one genuinely universal path to a
License Server in VVF/standalone (there's no separate "at bring-up"
variant to source it from, since VVF has no such automation).

---

## Contents

| # | Section | Use it when |
| - | ------- | ----------- |
| 1 | [Prerequisites](#prerequisites) | Before you download anything |
| 2 | [Step 1 — Deploy the VCF Operations nodes](#step-1--deploy-the-vcf-operations-nodes) | OVA deploy, one per node |
| 3 | [Step 2 — Run the setup wizard](#step-2--run-the-setup-wizard) | Create the primary node; optionally enable HA inline |
| 4 | [Step 3 — Enable HA after the fact](#step-3--enable-ha-after-the-fact) | Converting an already-running single-node cluster, instead of Step 2's inline option |
| 5 | [Step 4 — Deploy and register the Cloud Proxy](#step-4--deploy-and-register-the-cloud-proxy) | Needed before you can add a vCenter/VCF instance integration |
| 6 | [Step 5 — Deploy the License Server](#step-5--deploy-the-license-server) | Needed before licensing works at all |
| 7 | [Field notes](#field-notes) | LB expectations, password rules, proxy behavior |
| 8 | [References](#references) | TechDocs/KB behind the above |

---

## Prerequisites

- IP addresses + DNS (forward and reverse) for every node you'll deploy —
  primary, replica (if HA), any data nodes, and the Cloud Proxy.
- vSphere permissions to deploy OVF templates
  ([Deploy and Export OVF and OVA Templates](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/8-0/vsphere-virtual-machine-administration/deploying-virtual-machines-and-vapps/deploying-ovf-and-ova-templates.html)).
- All nodes on the **same time zone** — the setup wizard requires it.
- Broadcom Support Portal access to download the VCF Operations 9.1 Install
  OVA (**My Downloads → VMware Cloud Foundation → VMware Cloud Foundation
  9 → 9.1.1.0 → VCF Operations → View group**) and, later, the Cloud Proxy
  OVA (downloaded from inside the VCF Operations UI instead — Step 4).
- Decide **HA vs. single-node** before Step 2 — you can add HA later
  (Step 3), but deciding now saves a second pass.

## Step 1 — Deploy the VCF Operations nodes

Repeat this once per node (primary, plus a replica and any data nodes if
you're going straight to HA). Verbatim from Broadcom's OVA-deploy
procedure:

1. Log in to vCenter using the vSphere Client. Start the **Deploy OVF
   Template** wizard.
2. On **Select an OVF template**, point it at the downloaded VCF
   Operations Install OVA file, then follow the prompts to the node-name
   screen.
3. **Provide input to deploy each node:**
   - **Node name** — no nonstandard characters (e.g. underscores); a
     unique name per node in a multi-node cluster.
   - **Size configuration** — your selection does **not** affect disk
     size.
   - **Disk format** — Thin Provisioned / Thick Provisioned Lazy Zeroed /
     Thick Provisioned Eager Zeroed.
   - **Destination Network**, then the networking properties (static
     IPv4/IPv6 needs Domain Name, Domain Search Path, Domain Name Servers).
   - **Time zone** — must match across every node.
   - *(Optional)* **FIPS Mode** — check **Activate FIPS Mode** if you need
     a FIPS-activated deployment.
4. Review and **Finish**. Note the node's FQDN/IP after deployment.
5. **Power on** the appliance and wait for it to finish bootstrapping.
6. Repeat for every node you're deploying before moving to Step 2.

**Root password:** ships blank on first boot — set it via the vSphere
console the first time, per the complexity rule in
[`05-day2-deployments.md` §B.4](05-day2-deployments.md#b4--root-password-requirements-for-vcf-ops-family-appliances-vcf-operations-cloud-proxy).

## Step 2 — Run the setup wizard

Once the primary node has bootstrapped, browse to its FQDN/IP and run
**New Installation**:

1. **New Installation → Next.**
2. Enter and confirm a password for the **admin** user. The admin
   username can't be changed; the KB-sourced password rule from
   `05-day2-deployments.md` §B.4 covers the *root* account, but the admin
   account here has its own, stricter rule per TechDocs: **minimum 15
   characters, one uppercase, one lowercase, one digit, one special
   character.**
3. **Certificate** — use the included default certificate, or **Install a
   certificate** and browse to your own.
4. **Primary node name** (e.g. `ops-primary`), then **NTP**: leave the
   shared IP address blank to let VCF Operations manage its own
   synchronization (all nodes sync with the primary/replica), or enter an
   NTP URL/IP (e.g. `nist.time.gov`) and click **Add**.
5. **Configure VCF Operations availability** — this is the inline
   alternative to Step 3 below. Activate **Availability Mode** and choose
   **High Availability** or **Continuous Availability**, or click **Next**
   to continue on full capacity (single-node, add HA later via Step 3).
6. To add a node here (replica or data), click **+**, enter its **Node
   Name** and **Node Address**, select its **Current Cluster Role**,
   **Next**.
7. **Finish.** The admin interface appears; it takes a moment to finish
   adding the primary node.
8. You can create/add more data nodes before starting the cluster, or
   start a single-node cluster now. Click **Start VCF Operations** —
   allow **10-30 minutes** depending on cluster/node size, and **don't
   touch cluster nodes while it's starting.**

VCF Operations comes up in **evaluation mode** — assign the entitlement
type via
[Registering VCF Operations and a License Server with the VCF Business
Services Console](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/licensing/register-vcf-operations.html)
before adding other components.

## Step 3 — Enable HA after the fact

Skip this if you already activated HA inline in Step 2. This is the
Day-N path for converting an already-deployed, already-running single-node
(or not-yet-started) cluster to HA — per Broadcom's **"Configure a VCF
Operations Cluster for High Availability"** procedure, verbatim:

**Prerequisites:** the primary node exists and is configured; you have a
data node with a static IP address ready to become the replica; note the
primary node's FQDN/IP. **If the cluster is running, activating HA
restarts it** — adding HA before the cluster's first start is less
disruptive than converting a live one.

1. Browse to `https://<primary-node-fqdn-or-ip>/admin`.
2. Log in as **admin** with the administrator password.
3. **Add new Nodes → Add Nodes** icon. Enter **Node Name** (a generic
   identifier) and **Node Address** (the new node's IP — this is the node
   you already deployed in Step 1, not a new OVA deploy from here).
   **Current Cluster Role: Data** (to be used as the primary's replica).
4. **Save**, review/close the thumbprint, **Next**. Enter the **Primary
   Node Password** (the admin password from login), **Finish**.
5. If the cluster was online, wait for it to return to **Online** before
   proceeding — you can't activate HA mid-initialization.
6. Under **High Availability**, click **Activate**. In the wizard, select
   the data node to serve as the replica, **OK**.
7. **Confirm Cluster Restart → Yes.** VCF Operations configures,
   synchronizes, and rebalances the cluster for HA.

**Split-brain recovery note, verbatim from the same TechDocs page:** if
the primary and replica both go offline and the primary stays offline
while the replica comes back online, *the replica does not automatically
take over the primary role.* Recovery: take the whole cluster offline
(including data nodes), SSH into the replica as `root`, edit
`$ALIVE_BASE/persistence/persistence.properties`, set `db.role=PRIMARY`
and `db.driver=/data/vcops/xdb/vcops.bootstrap`, save, then bring the
replica online first (verify it becomes primary) before bringing the rest
of the cluster online.

To **deactivate HA** later on an established cluster: **Deactivate HA** in
the admin UI and follow its steps — deactivation time depends on cluster
size and data retention period.

## Step 4 — Deploy and register the Cloud Proxy

You need at least one Cloud Proxy before you can add a vCenter/VCF
instance integration (`26-vcf-operations-vvf-vcenter.md` Step 4 needs
this done first). Two or more Cloud Proxies form a **cloud proxy group**
for HA/load-balancing on the collector side — separate from the analytics
cluster's own HA in Steps 2-3.

**Prerequisites**, verbatim from TechDocs: an IP + DNS for the proxy;
vSphere OVF-deploy permissions; outbound HTTPS 443; inbound 443, 4505,
4506 (Telegraf app monitoring — prefer 443 over the legacy 8443, which is
heading to end-of-support); inbound 443 for push-model adapters/Suite-API;
a vCenter cloud account with the privileges to install a Cloud Proxy on
that vCenter Server; proper DNS resolution to the VCF Operations nodes
(**restrict Cloud Proxy traffic by FQDN, not IP** — IPs can change without
notice).

1. **Operate → Administration → Cloud Proxies → Add.**
2. Download the **VMware Cloud Foundation Operations collector (Cloud
   Proxy) OVA** from the Broadcom Support Portal link on that page.
3. In vSphere Client: select your vCenter cluster → **Actions → Deploy
   OVF Template**, point it at the downloaded OVA.
4. **Deploy in the Unified Cloud Proxy configuration** — sizing (Unified
   Small: up to 16,000 VMs, 4 vCPU/16GB; Unified Standard: 16,000-80,000
   VMs, 8 vCPU/48GB, per
   [KB 324340](https://knowledge.broadcom.com/external/article/324340) for
   current numbers). **Don't deploy
   Classic Cloud Proxy unless support explicitly tells you to.**
5. When the wizard prompts for **Unique Registration Key**, go back to
   the **Install Cloud Proxy** page in VCF Operations, optionally activate
   **Data Persistence** (buffers data through connectivity issues), then
   click the **Copy Key** icon. **This key expires 24 hours after
   generation** — click **Regenerate Key** if your deploy is going to run
   long, rather than using a stale one. Paste it into the OVA wizard's
   Unique Registration Key field.
6. **Set the Docker Subnet explicitly — don't take the default.** Must be
   `/27` or larger. Left blank, Docker assigns its own default (often a
   `/16` from `172.17.0.0`), which risks silently colliding with a real
   network elsewhere in your estate — see the Field notes below for the
   failure mode.
7. *(Optional)* **Prefer IPv6** for internal communications.
8. *(Optional)* **Set up a proxy server** — Network Proxy IP/password; if
   forwarding logs through it, port 9543 must be open; **Use SSL
   connection to proxy** + **Verify proxy's SSL cert** if applicable; a
   **Custom CA** field accepts an inspecting proxy's root CA
   (`-----BEGIN CERTIFICATE-----` / `-----END CERTIFICATE-----`) — **this
   is the one appliance where SSL inspection is actually supported**, see
   Field notes.
9. *(9.1.1+, optional)* **Outbound Network Proxy Settings** — a separate,
   dedicated proxy specifically for Broadcom Portal traffic.
10. **Finish.** After deploy, **power it on within 24 hours of
    registration** — an expired key has no repair path; delete the proxy
    and deploy a new one if you miss the window.
11. Back in VCF Operations' Cloud Proxy page, watch it come online.
    **Field-verified 2026-09-15: allow up to ~15 minutes** between
    "connected/going online" and fully online — normal registration
    delay, not stuck. Only chase the Docker Subnet overlap if it's still
    not online well past that.
12. Assign the new Cloud Proxy to the VCF instance/workload domains that
    should use it — `26-vcf-operations-vvf-vcenter.md` Step 4 does this
    as part of adding the vCenter adapter (**Cloud Proxy/Group** field).

## Step 5 — Deploy the License Server

VCF Operations needs at least one License Server before licensing works at
all. In a fleet, the first one is deployed automatically at bring-up
(`05-day2-deployments.md` §B.4); **VVF/standalone has no such automation —
this manual OVA deploy is the only path to a License Server**, even for
the very first one. Per Broadcom's
[Deploy a License Server](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/manual-adding-vcf-components-post-deployment/add-license-server.html)
(verbatim below):

**Prerequisites:** administrator privileges in the VCF Operations instance
you'll use for license management; administrator privileges in the vCenter
instance you'll deploy into; a Broadcom Support Portal role with
sufficient privileges to download the binaries; a unique FQDN for the
License Server with A and PTR records already in DNS. **The License Server
cannot be deployed on a standalone ESX host — it must go into a vCenter
instance as an OVF template, and it doesn't support IPv6.**

1. **Obtain the Unique Registration Key first, from VCF Operations**: log
   in, **Manage → Licensing → Licenses & Registration**, in the
   **Registration and License Server Status** card click **Manage License
   Servers**, then **Add License Server** on the License Servers tab.
   Copy and save the key it shows you.
2. In vSphere Client, right-click the target vCenter instance → **Deploy
   OVF template**.
3. **Select an OVF template** → **Local file** → upload the License
   Server OVA downloaded from the Broadcom Support Portal → **Next**.
4. **Select a name and folder** — name the VM, pick a location.
5. **Select a compute resource** — pick the destination compute resource;
   check **Automatically power on deployed VM** at the bottom → **Next**.
6. Review the OVF template details → **Next**.
7. **Select storage** — where/how to store the deployed template's files.
8. **Select networks** — pick a **Destination Network** → **Next**.
9. **Customize template** — the properties that matter:

   | Property | What it's for |
   | --- | --- |
   | **Hostname** | Best practice: set as an FQDN using the same domain suffix as **Domain Name** below. Add this FQDN to DNS — every vCenter using licenses from this server must resolve it. |
   | **Unique Registration Key** | The key from Step 1. Time-bound; not the same thing as VCF Business Services Console registration (that comes later). |
   | **Domain Name** | Primary DNS domain suffix (e.g. `corp.local`). Leave blank if using DHCP. |
   | **Domain Name Search** | Domain search paths. Leave blank unless told otherwise. |
   | **Default Gateway** | IPv4 gateway. Leave blank if using DHCP. |
   | **Domain Name Servers** | DNS server IPv4 addresses. Leave blank if using DHCP. |
   | **Network 1 IP Address** / **Network 1 IP Netmask** | Static IPv4 + netmask (dotted-decimal, e.g. `255.255.255.0`). Leave blank if using DHCP. |
   | **Egress proxy IP / port / username / password** | **Not for internet access — the License Server never talks to the internet directly.** Only fill these in if a proxy sits between the License Server and *VCF Operations itself*. Leave blank otherwise. |
   | **API Key** | Don't set unless support specifically instructs you to. |

10. Review, **Finish**. Deployment takes up to **20 minutes**. Once the VM
    powers on, it connects to VCF Operations automatically — check
    **Connectivity to VCF Operations: Connected** on the License Server
    Details page.
11. Back in VCF Operations, click **Review License Servers** to see it
    listed — a banner flags it as **unregistered** until the next step.
12. **Register it with the VCF Business Services Console** — required
    before it's actually usable, not optional. If this VCF Operations
    instance is already registered, see
    [Register an Additional License Server with the VCF Business Services Console](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/licensing/register-vcf-operations/add-license-server.html);
    if it isn't yet, see
    [Registering VCF Operations and a License Server with the VCF Business Services Console](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/licensing/register-vcf-operations.html).

## Field notes

- **No built-in load balancer for the analytics cluster.** Same rule as
  the fleet-managed case
  ([`05-day2-deployments.md` §B.1](05-day2-deployments.md#b1--vcf-operations-load-balancer-is-external-never-served-by-vcf)):
  reach the nodes directly on their FQDNs by default. If you want a VIP in
  front, you bring your own external LB (VCF doesn't deploy or manage
  one) and put every node FQDN **and** the LB FQDN in the certificate's
  SAN list — decide before you request certificates in Step 2.
- **VVF/standalone has no proxy for the analytics cluster itself beyond
  Global Settings.** If the primary/replica/data nodes need outbound
  internet access through a proxy (e.g. for licensing calls to
  `eapi.broadcom.com`/`vcf.broadcom.com`), that's **Administration →
  Global Settings → Network Settings → HTTP Proxy** on VCF Operations
  itself — a single, cluster-wide setting, separate from anything you
  configure on the Cloud Proxy OVA in Step 4 (Cloud Proxies each take
  their **own** proxy setting at deploy time; they don't inherit this).
  The **License Server has no outbound path to Broadcom at all** — don't
  put a proxy on it; if you did, redeploy it without one (Broadcom
  [KB 441747](https://knowledge.broadcom.com/external/article/441747/vcf-license-server-unable-to-connect-to.html)).
  This matches the OVA's own field description in Step 5: its **Egress
  proxy** properties are explicitly for reaching *VCF Operations*, not the
  internet — there's no field there that would even accept a
  Broadcom-facing proxy.
- **If that proxy does SSL inspection (TLS termination/re-signing),
  exclude `eapi.broadcom.com` and `vcf.broadcom.com` from inspection.**
  VCF Operations' own Global Settings proxy field does **not** support an
  inspecting proxy — TechDocs, verbatim: *"SSL termination proxy is not
  supported in VCF Operations."* No field there accepts a custom
  re-signing CA. **Test Connection actively detects and blocks this**
  (field-verified 2026-09-15: *"SSL-terminating proxy detected. VCF
  Operations requires a pass-through (non-SSL-terminating) proxy."*), but
  **the check only gates Test Connection, not Save** — saving without
  passing the test still persists the config, and licensing activation
  was observed succeeding through the same rejected proxy anyway. Treat
  that as an unsupported, unverified-long-term workaround, not a green
  light — get the no-inspection bypass rule from your proxy/security team
  instead. **The Cloud Proxy OVA is different** — its own deploy wizard
  (Step 4) has a genuine Custom CA field, because Cloud Proxy is the one
  appliance where SSL inspection is actually supported; that only covers
  the Cloud Proxy's own outbound path, not VCF Operations' licensing
  calls.
- **Docker Subnet collisions are silent.** Broadcom
  [KB 392302](https://knowledge.broadcom.com/external/article/392302/connectivity-issues-between-cloud-proxy.html),
  verbatim:
  *"If a Docker network overlaps with the external environment network,
  connectivity problems may occur, as network packets won't be routed
  outside the Cloud Proxy but will instead be routed internally."* And:
  *"there is no permanent resolution to update the docker bridge network
  pool"* after the fact — recreating the Docker networks is the only fix,
  not a setting change. Pick a `/24` you're certain isn't routed anywhere
  in the estate and record it in the network plan like any other reserved
  allocation.

## References

- [Deploy VCF Operations as Part of a VCF 9.1 Upgrade](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/upgrading-cloud-foundation/upgrade-backup-and-restore/deploy-vcf-operations.html) — source for Step 1/Step 2 (OVA deploy, setup wizard)
- [Configure a VCF Operations Cluster for High Availability](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/manual-deployment-and-configuration-of-components-for-advanced-architectures/run-the-setup-wizard-to-create-an-ha-node.html) — source for Step 3
- [Deploy Cloud Proxy as part of a VCF 9.1 Upgrade](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/upgrading-cloud-foundation/upgrade-backup-and-restore/configuring-cloud-proxies-in-vrealize-operations-cloud.html) — source for Step 4
- [Deploy a License Server](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/manual-adding-vcf-components-post-deployment/add-license-server.html) — source for Step 5
- [Register an Additional License Server with the VCF Business Services Console](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/licensing/register-vcf-operations/add-license-server.html)
- [Registering VCF Operations and a License Server with the VCF Business Services Console](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/licensing/register-vcf-operations.html)
- [Collecting Data with Cloud Proxy in VCF Operations](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/collecting-data-with-cloud-proxies-in-vrealize-operations-cloud.html)
- [Broadcom KB 324340 — current Cloud Proxy sizing](https://knowledge.broadcom.com/external/article/324340)
- [Broadcom KB 392302 — Connectivity Issues Between Cloud Proxy and Connected Nodes Due to Network Overlap](https://knowledge.broadcom.com/external/article/392302/connectivity-issues-between-cloud-proxy.html)
- [Broadcom KB 441747 — VCF License Server unable to connect to VCF Operations with proxy configured](https://knowledge.broadcom.com/external/article/441747/vcf-license-server-unable-to-connect-to.html)
