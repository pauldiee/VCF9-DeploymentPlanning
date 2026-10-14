# Log Management: Getting Logs In (VCF and VVF)

How to get logs into **Log Management** (formerly *VCF Operations for Logs*,
renamed in 9.1) on **VCF 9.1** and **vSphere Foundation (VVF) 9.1**: whether
your platform can run it at all, how it's deployed, which sources start sending
on their own, which ones need manual work, and the firewall flows.

This guide stands on its own. In a VCF build it's also the detail behind
deployment plan Story 8.4 ([`06-deployment-plan.md`](06-deployment-plan.md)).
Sizing is a separate page: [`30-ops-logs-sizing.md`](30-ops-logs-sizing.md).

Everything here was read from Broadcom TechDocs on **2026-10-14** (pages marked
*Last Updated October 12, 2026*) and from the
[Ports and Protocols portal](https://ports.broadcom.com/view/). It's not
lab-verified unless a section says so. See [Sources](#sources).

---

## 1. Can your platform run Log Management?

In 9.1, Log Management is a **VCF Management Services** component. It runs on
the VCF services runtime and is deployed from VCF Operations. If a platform has
no VCF Management Services, it has no Log Management.

| Platform | Log Management available? | How |
| --- | --- | --- |
| **VCF 9.1** | Yes | The management services arrive at bring-up; deploy Log Management Day-N from VCF Operations ([§2](#2-deploy-log-management)) |
| **VVF 9.1 with VCF Management Services** | Yes | Same Day-N deploy from VCF Operations ([§2](#2-deploy-log-management)) |
| **VVF 9.1 without VCF Management Services** | **No** | Add the management services first with the VCF Installer ([§1.1](#11-vvf-add-vcf-management-services-first)), then deploy |
| **VCF / VVF 9.0** | Yes, the 9.0 way | VCF: from fleet management. VVF: a standalone *VCF Operations for logs* OVA from the vSphere Client ([9.0 page](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/manual-deployment-of-components-to-complete-your-vcf-platform/vcf-operations-for-logs-for-vvf-clients.html)). **That page has no 9.1 equivalent** |

The VVF 9.1 page
[*Deploying VMware vSphere Foundation 9.1 Without VCF Management Services*](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/deploy-vmware-vsphere-foundation-using-the-deployment-wizard/deploying-vmware-vsphere-foundation-9-1-without-vcf-management-services.html)
says it explicitly. It lists, among the things that are **not available**
without the management services:

> "Log management by using the log management component."

and gives the way back:

> "If you need VCF management services, later you can deploy VCF management
> services by using VCF Installer. After that you can deploy log management by
> using VCF Operations."

The [component table](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/vcf-management-appliances.html)
lists Log management with platform type *VCF; vSphere Foundation*, so it's
supported on VVF once the management services are there.

**Coming from VVF 9.0 with the standalone OVA?** The 9.1 deploy wizard can
import that instance's configuration (§2). Plan the 9.1 component as a new
deployment with a **new FQDN**, not an in-place upgrade of the OVA.

### 1.1 VVF: add VCF Management Services first

VVF 9.1 with no management services yet (a manual build, or one deployed
without them; VCF Operations itself in VVF is
[`27-vcf-operations-ha-cloud-proxy-vvf.md`](27-vcf-operations-ha-cloud-proxy-vvf.md)).
The procedure is
[*Deploy VCF Management Services and License Server for vSphere Foundation*](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/upgrading-your-vsphere-foundation-to-9-1/install-vcf-management-services-to-vsphere-foundation-environment.html).
The points that need planning:

- **VCF Installer 9.1.1 or later.** It's deployed separately and needs the
  binaries (online, or via an offline depot: [`09-binary-depot.md`](09-binary-depot.md)).
- **What it installs:** VCF services runtime, fleet lifecycle, SDDC lifecycle,
  software depot and telemetry, at a **small** component size (change it only
  through a JSON spec). It also deploys a License Server, unless one already
  exists.
- **Three FQDNs** (fleet components, instance components, services runtime),
  plus the License Server FQDN if it's new. Each must point to a unique IP
  **outside** the services-runtime range. Use lowercase only, and **no
  `.local`**: TechDocs says validation only accepts Internet top-level domains.
- **IP pool for the services runtime.** For target 9.1.0.0–9.1.0.300, a range
  of **at least 10 IPs**. From 9.1.0.400, a comma-separated list
  (non-contiguous allowed), with exclusions. Log Management's worker nodes come
  out of this pool later, so size it for them too
  ([`30-ops-logs-sizing.md`](30-ops-logs-sizing.md)).
- **Internal cluster CIDR:** one of `198.18.0.0/15`, `240.0.0.0/15` or
  `250.0.0.0/15`. It must not clash with anything routed in your network.
- **Inputs from the existing environment:** the VCF Operations primary node
  FQDN and admin password, and the vCenter details.
- **Proxy gotcha:** if VCF Operations has a proxy configured **with SSL
  termination** and you run other management components, remove that proxy
  configuration before deploying.

Wizard path: VCF Installer → **Deployment Wizard** → **VMware vSphere
Foundation** → **Deploy VCF Management Services**. Once it finishes, continue
with §2.

---

## 2. Deploy Log Management

The same procedure for VCF and VVF:
[*Deploy Log Management*](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/manual-deployment-of-components-to-complete-your-vcf-platform/installing-vcf-logs.html).

1. Log in to VCF Operations as an Administrator.
2. **Build → Lifecycle → VCF Management**, **Components** tab.
3. **Add component → Log management**, and fill in:

| Field | What to enter |
| --- | --- |
| Version | The version to deploy |
| Import configuration from an earlier Operations for logs instance | Only when migrating from Aria Operations for Logs 8.x or a 9.0 instance; then also give that instance's FQDN, admin user and password |
| Log management FQDN | A **new**, unique FQDN, lowercase, **not** pointing at any services-runtime IP, and different from any existing logs instance |
| Size | Small / Medium / Large (8/16, 24/48, 32/64 vCPU/GB per node, 575 GB each); see [`30-ops-logs-sizing.md`](30-ops-logs-sizing.md) |
| Number of Replicas | Limited by the size you picked |

4. **Next → Finish**, and follow the task under **Tasks**.

The resources are **on top of** the VCF Management Services footprint. TechDocs:
*"VCF management services may scale out to accommodate the log management
deployment"*. That is why the services-runtime IP pool has to have room
(Log Management row in [`05-day2-deployments.md` §B](05-day2-deployments.md#b-the-deployable-set)).

**After an import** (8.18 or 9.0 → 9.1), the deploy page lists five follow-ups:

- **Agents:** reconfigured automatically from 9.0, but by hand from 8.18.
- **Log sources:** re-point any that weren't moved automatically.
- **Forwarders:** copied over but **not active**. Activate them by hand, and
  re-point any upstream forwarder at the new FQDN.
- **Custom content:** isn't transferred. Convert content packs to management
  packs.
- **Historical data:** the old cluster stays queryable from the 9.1 UI for
  90 days.

Legacy appliances keep collecting until you re-point the agents.

---

## 3. Which sources start sending on their own

From
[*Configuring Log Sources for Log Management*](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/infrastructure-operations/log-analysis/configuring-log-sources-for-log-management.html),
the [component table](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/vcf-management-appliances.html)
for which platform has what, and
[KB 396643](https://knowledge.broadcom.com/external/article/396643/deploy-and-configure-vcf-operations-for.html)
for SDDC Manager:

| Source | VCF | VVF | How collection starts |
| --- | --- | --- | --- |
| **VCF Operations** | ✓ | ✓ | *"Log collection is enabled by default."* |
| **vCenter** (+ ESX, Supervisor) | ✓ | ✓ | Enabled on the vCenter adapter, or on the VMware Cloud Foundation account. **vCenter's own logs** need a separate switch on the **Log Sources** page. See [§5](#5-vcenter-and-esx) |
| **NSX** | ✓ | – | Enabled on the NSX adapter or the VCF account. Healthy status shows as **Received**, not *active* |
| **VCF Operations for Networks** | ✓ (9.1+) | – | Enabled when the adapter is configured |
| **VCF Operations HCX** | ✓ (9.1+) | – | Enabled when the adapter is configured |
| **Identity Broker** | ✓ | – | Enabled once deployed through Fleet Lifecycle |
| **VCF Automation** | ✓ | – | Enabled once deployed through Fleet Lifecycle |
| **SDDC Manager** | ✓ | – (no SDDC Manager in VVF) | **Never automatic.** Manual agent install: [`05-day2-deployments.md` §B.6](05-day2-deployments.md#b6--log-management-does-not-collect-sddc-managers-own-logs) |
| **Any other Linux appliance or VM** | ✓ | ✓ | Manual agent install with a secret: [§4](#4-agents-and-authentication) |

Two settings apply to every source: **Audit Logs can't be disabled** once
collection is on, and the default **log level is Info**. You can change the
level per source (for example to Debug), add custom tag fields, and reset to
default.

**Upgrading from 9.0 or 8.18?** TechDocs: *"Log Collection configuration is not
automatically updated after migration from a previous version"*. Only a 9.x →
9.1 Log Management import carries the collection configuration over. Check
every source after the upgrade.

---

## 4. Agents and authentication

Anything without an embedded agent gets the **Log Management agent** installed
by hand. That covers SDDC Manager on VCF and your own Linux VMs on either
platform
([*Configuring Agents*](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/infrastructure-operations/log-analysis/overview-of-log-management-agents/configure-agents.html),
[*Overview of Log Management Agents*](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/infrastructure-operations/log-analysis/overview-of-log-management-agents.html)).

- **Supported OS:** RHEL 9/10, SLES 15 SP7/16, Ubuntu 22.04/24.04/26.04 LTS,
  Debian 12/13, Photon 4.0+. Requires OpenSSL 3.0+ and systemd 235+.
- **Get the package:** VCF Operations → **Operate → Administration →
  Configurations → Log Collection** tile → **Agent** tab → **DOWNLOAD AGENT**
  (RPM or Debian, from the Broadcom support portal). Install it with
  `rpm -i` / `dpkg -i`.
- **Protocols:** `cfapi`, the ingestion API (9543 over TLS, 9000 plain), or
  syslog.
- The agent appears in the **Agents** list after a few minutes. Embedded agents
  in VCF components show **VCF Component = yes** and aren't configurable from
  there.

### Secrets: optional now, required if you enforce them

Per
[*Agent Authentication for Log Ingestion*](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/infrastructure-operations/log-analysis/overview-of-log-management-agents/agent-authentication-for-log-ingestion.html):

> "By default, authentication is enabled but optional. The server accepts both
> authenticated and unauthenticated logs."

**Enforcing** it is a Global Setting. Once on, *"any ingestion request without a
valid Bearer token is dropped"*. So before you turn it on:

1. Generate a secret per agent: **Log Collection → SECRETS → GENERATE SECRET**.
   **It's shown once**, so copy it straight away.
2. Add it under `[server]` in the agent's `liagent.ini`: `secret=<value>`. The
   agent swaps it for a token and renews it automatically. This needs agent
   **9.1 or later**.
3. Only then enforce authentication.

Limits: it covers the HTTP/HTTPS ingestion APIs only, because *"Legacy Syslog
ingestion remains unauthenticated"*. Windows agents aren't supported. A revoked
secret stays listed for about 7 days, and its name can't be reused in that time.

> **SDDC Manager (VCF):** the KB 396643 script writes a `liagent.ini` **with no
> `secret=` line**, and every re-run overwrites the file. If you enforce
> authentication, add the secret after each run, or SDDC Manager's logs are
> dropped. See [`05` §B.6](05-day2-deployments.md#b6--log-management-does-not-collect-sddc-managers-own-logs).

### Cloud Proxy Log Forwarder

The Ports and Protocols portal lists a **Cloud Proxy Log Forwarder (CPLF)** as
a second ingestion target. It accepts the same 9543 / 1514 / 514 as Log
Management itself, so remote sources can send to a local Cloud Proxy instead of
straight to the cluster. Two known points: TechDocs notes that *"Auto upgrade
for the agents that are sending logs through Cloud Proxy Log Forwarder is not
supported"*, and a Cloud Proxy behind a network proxy needs 9543 open through
that proxy
([`27` step 8](27-vcf-operations-ha-cloud-proxy-vvf.md)).

---

## 5. vCenter and ESX

> **Placeholder.** Log collection for vCenter and ESX is under investigation in
> [#228](https://github.com/pauldiee/VCF9-DeploymentPlanning/issues/228):
> collection switched on centrally does not reliably reach ESX and NSX, and a
> Broadcom support case is open. This section gets filled in once it's
> settled, so the guide doesn't document behaviour that may turn out to be a
> bug.

What TechDocs documents, for orientation only:

- Collection is enabled on the vCenter adapter, or on the VMware Cloud
  Foundation account. Broadcom recommends the VCF account route. VVF without
  fleet management uses the vCenter adapter
  ([`26-vcf-operations-vvf-vcenter.md`](26-vcf-operations-vvf-vcenter.md)).
- That route picks up vCenter events, tasks and alarms plus ESX and Supervisor
  logs. **vCenter's own logs** need explicit activation on the **Log Sources**
  page.
- **vCenter 9.1+ uses the Logs Agent.** Earlier vCenter versions use rsyslog,
  and then *"custom filtering and extracted fields are not applied"*.
- ESX sends **syslog over TLS on 1514** (Ports and Protocols, Log Management
  9.1.1).

---

## 6. Firewall flows

From the [Ports and Protocols portal](https://ports.broadcom.com/view/), product
*Log Management*, releases 9.1.0 and 9.1.1, read 2026-10-14. These are the
flows that cross a firewall. The portal also lists the cluster-internal ones
(Cassandra, OpenSearch, Thrift) and the VCF Management Services platform flows.
**Pull the full set from the portal rather than copying it.** The
deployment-critical subset is also in
[`07-firewall-ports.md` §E](07-firewall-ports.md#e-fleet--operations-cloud-proxy-license-server-syslog).

**Into Log Management (or a CPLF):**

| Source | Port | Proto | Purpose |
| --- | --- | --- | --- |
| Agents (incl. SDDC Manager's) | **9543** | TCP | Ingestion API (cfapi) over TLS (the one to use) |
| Agents | 9000 | TCP | Ingestion API over plain HTTP |
| ESX hosts, syslog sources | **1514** | TCP | Syslog over TLS |
| Syslog sources | 514 | TCP/UDP | Plain syslog (9.1.0 listing) |
| Admin workstations | 443 / 9543 | TCP | UI / REST API |
| Supervisor / services runtime | 8080 | TCP | Health probe |

**Out of Log Management:**

| Destination | Port | Proto | Purpose |
| --- | --- | --- | --- |
| vCenter | 443 | TCP | Configure collection, events, inventory sync |
| VCF Operations | 443 | TCP | Token auth, licence sync, alert forwarding, collection config |
| NSX Manager / HCX / Ops for Networks / Supervisor | 443 | TCP | Configure collection on that component (VCF; Supervisor where enabled) |
| AD domain controllers | 636 | TCP | LDAPS |
| DNS / NTP | 53 / 123 | TCP+UDP / UDP | Name resolution, time |
| External syslog | 1514 | TCP | Log forwarding over TLS |
| NFS archive | 2049 (+ NFSv3 helpers) | TCP | Archive storage |
| Legacy Log Insight / 9.0 instance | 9543 | TCP | Import during migration only |
| Broadcom telemetry | 443 | TCP | CEIP phone-home |

The portal still labels the product *VCF Operations for Logs* in some rows.

---

## Sources

All read 2026-10-14.

- [Deploy Log Management (9.1)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/manual-deployment-of-components-to-complete-your-vcf-platform/installing-vcf-logs.html)
- [Deploying VMware vSphere Foundation 9.1 Without VCF Management Services](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/deploy-vmware-vsphere-foundation-using-the-deployment-wizard/deploying-vmware-vsphere-foundation-9-1-without-vcf-management-services.html)
- [Deploy VCF Management Services and License Server for vSphere Foundation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/upgrading-your-vsphere-foundation-to-9-1/install-vcf-management-services-to-vsphere-foundation-environment.html)
- [Components in VCF and vSphere Foundation (9.1)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/vcf-management-appliances.html)
- [Configuring Log Sources for Log Management](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/infrastructure-operations/log-analysis/configuring-log-sources-for-log-management.html)
- [Overview of Log Management Agents](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/infrastructure-operations/log-analysis/overview-of-log-management-agents.html)
- [Configuring Agents](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/infrastructure-operations/log-analysis/overview-of-log-management-agents/configure-agents.html)
- [Agent Authentication for Log Ingestion](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/infrastructure-operations/log-analysis/overview-of-log-management-agents/agent-authentication-for-log-ingestion.html)
- [Deploying the VCF Operations for logs Appliance for VMware vSphere Foundation (9.0 only)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/manual-deployment-of-components-to-complete-your-vcf-platform/vcf-operations-for-logs-for-vvf-clients.html)
- [KB 396643: Deploy and configure the logs agent in SDDC Manager](https://knowledge.broadcom.com/external/article/396643/deploy-and-configure-vcf-operations-for.html)
- [Broadcom Ports and Protocols portal](https://ports.broadcom.com/view/): product *Log Management*, releases 9.1.0 and 9.1.1
