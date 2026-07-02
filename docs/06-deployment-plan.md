# Deployment Plan — Agile Work Breakdown

A ready-to-use **work breakdown** for a VMware Cloud Foundation 9.1 deployment,
structured as **epics → stories → tasks** so it drops straight into a scrum /
agile backlog (Jira, Azure DevOps, GitLab, …). It captures **what** and **in
what order** and **who owns it** — deliberately **no dates or estimates**; add
those in your own tool.

> **[▶ Open the Deployment Plan export tool](https://pauldiee.github.io/VCF9-DeploymentPlanning/tools/deployment-plan/)** —
> build your deployment scope and export this plan as **Markdown** or a **CSV** that
> imports into Jira, Azure DevOps, or GitLab.

Build your **scope** from the blocks below: the **core epics apply to every
deployment**, and the variants switch on **independently**. The management domain
can be **stretched** or not; the **Day-2 fleet** is optional; and you add **one or
more workload domains**, each independently **non-stretched or stretched**.

## Scope building blocks

| Block | What it is | Epics |
| ----- | ---------- | ----- |
| **Core** (always) | The management fleet: prereqs → plan → intake → workbook → bring-up → config → handover | E1–E6, E10 |
| **Stretch the management domain** | Management cluster stretched across two AZs + its own witness | + E8 |
| **Day-2 fleet** | VCF Operations / Automation / Logs deployed after bring-up | + E9 |
| **Workload domain** (repeat per WLD) | A VI workload domain — **non-stretched** or **stretched** (its own hosts, and if stretched its own witness) | + E7 (one per WLD) |

Mix freely — e.g. a stretched management domain + the Day-2 fleet + two workload
domains (one stretched) = Core **+ E8 + E9 + two E7**. Execution order runs **core
config → management stretch → Day-2 → workload domains → handover**. The
[export tool](https://pauldiee.github.io/VCF9-DeploymentPlanning/tools/deployment-plan/)
assembles the exact epic/story set per scope.

Owner key: **Arch** = solution architect · **Net** = network · **AD** =
AD/DNS/NTP · **PKI** = certificate team · **Plat** = platform/VMware · **Sec** =
security · **Cust** = customer teams.

---

## Core epics (every deployment)

### E1 — Prerequisites & readiness gate  ·  Owner: Arch + Cust
Ref: [`prerequisites.md`](prerequisites.md)

- **Story 1.1 — Hardware ready.** Hosts on the VCG, matched spec, BOM confirmed.
  - Confirm CPU/RAM/storage per host against the sizing output (E3).
  - *Acceptance:* every host model on the Broadcom compatibility guide; even, matched counts.
- **Story 1.2 — Physical network ready.** VLANs, MTU, and BGP fabric provisioned.
  - Trunk the required VLANs to host uplinks; set MTU 9000 on jumbo networks.
  - Configure the ToR BGP fabric (AS numbers, peer IPs) for the NSX edges.
  - *Acceptance:* VLAN/MTU/BGP verified against the Step 1 plan (E2).
- **Story 1.3 — Core services ready.** AD, DNS, NTP, CA, depot reachable.
  - *Acceptance:* forward+reverse DNS resolves; NTP in sync; CA reachable; depot/binaries staged.
- **Story 1.4 — Access ready.** Jump host / management access into the environment.
  - *Acceptance:* the prerequisite gate is fully green before any build starts.

### E2 — Network, DNS & routing plan  ·  Owner: Net + AD
Ref: [`01-network-dns-plan.md`](01-network-dns-plan.md)

- **Story 2.1 — VLAN / subnet plan.** Lock every management VLAN, subnet, MTU, gateway, and the IP carve-out.
  - *Acceptance:* one-page plan signed by the network owner; no overlapping ranges.
- **Story 2.2 — BGP plan.** Edge AS, ToR AS, peer IPs, MD5, BFD, advertised/received routes.
  - *Acceptance:* BGP parameters agreed with the fabric team.
- **Story 2.3 — DNS & NTP records.** All A + PTR records created; NTP sources confirmed.
  - *Acceptance:* every appliance FQDN resolves both ways.
- **Story 2.4 — Certificates.** CA type, template, and signing approach decided.
  - *Acceptance:* CA reachable and the cert template validated.

### E3 — Intake & sizing  ·  Owner: Arch + all role teams
Ref: [`02-customer-intake.md`](02-customer-intake.md) · [`04-sizing.md`](04-sizing.md)

- **Story 3.1 — Role-based intake complete.** Sections A–F answered by their owners.
  - *Acceptance:* every intake question has an answer or an explicit N/A.
- **Story 3.2 — Sizing & host fit.** Run the [sizing calculator](https://pauldiee.github.io/VCF9-DeploymentPlanning/tools/mgmt-sizing/); confirm the fleet fits the proposed hosts at N-1.
  - *Acceptance:* fit check passes (or hosts adjusted); sizing signed off.

### E4 — Workbook & deployment-JSON prep  ·  Owner: Arch + Plat
Ref: [`workbook-cell-mapping.md`](workbook-cell-mapping.md)

- **Story 4.1 — Fill the P&P workbook.** Transfer intake answers into the official workbook — or use [**Coscia's VCF Planner**](https://vcfplanning.lcoscia.fr/) for an easier fillable form (live VLAN/IP/CIDR validation) that also doubles as an **as-built** record, with JSON/Markdown/CSV export.
  - *Acceptance:* workbook complete; no red validation warnings.
- **Story 4.2 — Generate the deployment JSON.** Produce the bring-up JSON (e.g. VCF.JSONGenerator) from the filled workbook.
  - *Acceptance:* JSON generated and reviewed against the plan.

### E5 — Management domain bring-up  ·  Owner: Plat
- **Story 5.1 — Install & configure the management hosts.** Image each host with the supported **ESXi ISO** (see the [**VCFHostPreparation**](https://github.com/pauldiee/VCFHostPreparation) repo to prep + commission hosts quickly); set the management VMkernel (IP / gateway / VLAN), DNS, NTP, and root password; confirm the ESXi build matches the BOM.
  - *Acceptance:* every host reachable on the management network with the matched ESXi build; DNS + NTP correct.
- **Story 5.2 — Stage the VCF Installer.** Deploy the Installer on a management-domain host using the **IP + FQDN planned for SDDC Manager** (it switches into SDDC Manager at bring-up — not a throwaway IP); verify it reaches the ESXi management network.
- **Story 5.3 — Deploy the management domain.** Run bring-up: the Installer validates the prepared hosts, then builds vCenter, SDDC Manager, NSX, and vSAN; submit the JSON.
  - *Acceptance:* bring-up completes; SDDC Manager healthy; vSAN datastore online.

### E6 — Management domain configuration  ·  Owner: Plat + Net + Sec
- **Story 6.1 — NSX edges & north-south.** Deploy edges; establish BGP peering to the ToRs; verify routes.
- **Story 6.2 — Certificates (optional / partial here).** You *can* replace certificates for the components deployed **so far** now, but the **full** CA-signed replacement is usually done **once all components exist** — after the Day-2 fleet — so the whole fleet is certified in one pass (see E9 story 9.5).
- **Story 6.3 — Identity & roles (optional, *not recommended* at this stage).** You *can* bind **vCenter SSO** directly to AD/LDAP now for early management access, but the **recommended** path is fleet-wide SSO via the **VCF Identity Broker**, a Day-2 component (see E9 / [`05-day2-deployments.md`](05-day2-deployments.md)). Prefer deferring identity to Day-2; only bind vCenter SSO here if you genuinely need AD admin access before the fleet is up, and map admin/operator/viewer groups if you do.
- **Story 6.4 — Backup & lifecycle.** Configure SFTP backups; connect the depot; apply licensing.
  - *Acceptance:* north-south routing verified; SFTP backups run; depot connected; licensing applied. (Full fleet certificates + AD SSO are finalized Day-2 — see E9 9.5.)

### E10 — Validation & handover  ·  Owner: Arch + all
- **Story 10.1 — Health check.** Run a post-deploy health check of the live environment.
- **Story 10.2 — As-built.** Capture the as-built (FQDNs, IPs, VLANs, passwords in the secret store).
- **Story 10.3 — Handover.** Walk the customer through operations and hand over.
  - *Acceptance:* health check clean; as-built delivered; customer sign-off.

---

## Variant epics (add per scope)

Order runs **core config → management stretch (E8) → Day-2 (E9) → workload
domains (E7, one per WLD) → handover (E10)**.

### E7 — Workload domain  ·  Owner: Plat + Net (+ Storage if stretched)
Ref: [`02-customer-intake.md`](02-customer-intake.md) section H (+ [`03-multi-az-prep.md`](03-multi-az-prep.md) if stretched)

**Repeat this epic per workload domain.** Each WLD is independently
**non-stretched** or **stretched** — a stretched WLD gets its **own** second-AZ
hosts and its **own** vSAN witness (one witness per stretched cluster, separate
from the management witness).

**Non-stretched WLD:**
- **Story 7.1 — WLD network prep.** Provision the per-WLD VLANs/subnets (Step 1) and the 5 IPs the WLD consumes on the mgmt VM-mgmt subnet.
- **Story 7.2 — Prepare & commission the WLD hosts.** Image the WLD hosts with the supported **ESXi ISO** (see [**VCFHostPreparation**](https://github.com/pauldiee/VCFHostPreparation)); configure the management network, DNS, NTP; then **commission** them into SDDC Manager.
- **Story 7.3 — Deploy the WLD.** vCenter + NSX (shared or dedicated) + first cluster.
- **Story 7.4 — WLD connectivity.** Edges / uplinks (Centralized or Distributed); optional vSphere Supervisor.
  - *Acceptance:* WLD healthy in SDDC Manager; workloads can be placed.

**Stretched WLD** (multi-AZ set):
- **Story 7.1 — WLD network prep (per-AZ).** Provision the per-WLD VLANs/subnets across **both AZs** (per-AZ networks) and the 5 mgmt-subnet IPs.
- **Story 7.2 — Prepare & commission the WLD hosts (both AZs).** Image the WLD hosts in both AZs (see [**VCFHostPreparation**](https://github.com/pauldiee/VCFHostPreparation)); configure the per-AZ management networks, DNS, NTP; then **commission** them into SDDC Manager.
- **Story 7.3 — Deploy the WLD.** vCenter + NSX (shared or dedicated) + first cluster.
- **Story 7.4 — WLD witness.** Deploy a **dedicated** vSAN witness for **this** WLD at the third site (one per stretched cluster, separate from the management witness); route it to both AZ ESX-management networks.
- **Story 7.5 — Stretch the WLD cluster.** Fault domains (preferred/secondary/witness); per-AZ networks; storage policy for the dual-site mirror (~2× capacity). Edge stretched only under NSX **Centralized** connectivity.
  - *Acceptance:* stretched WLD compliant; an AZ-failure test survives on the surviving site.
- **Story 7.6 — WLD connectivity.** Edges / uplinks (Centralized or Distributed); optional vSphere Supervisor.
  - *Acceptance:* WLD healthy in SDDC Manager; workloads can be placed.

### E8 — Stretch the management domain  ·  Owner: Net + Arch + Storage
Ref: [`03-multi-az-prep.md`](03-multi-az-prep.md)

- **Story 8.1 — Witness site (management).** Deploy the vSAN witness appliance for the **management** cluster at the third site; route it to both AZ ESX-management networks.
- **Story 8.2 — Inter-AZ fabric.** Verify <5 ms RTT, ≥10 Gbps, MTU 9000, HA L3 gateway between AZs.
- **Story 8.3 — Install, configure & commission the second-AZ hosts.** Image the AZ2 hosts with the supported **ESXi ISO** (see [**VCFHostPreparation**](https://github.com/pauldiee/VCFHostPreparation) to prep + commission hosts quickly); configure the per-AZ management network (IP / VLAN / gateway), DNS, NTP, and root; then **commission** them into SDDC Manager, ready for the stretch.
  - *Acceptance:* AZ2 hosts reachable on their per-AZ management network with the matched ESXi build; commissioned and available in SDDC Manager.
- **Story 8.4 — Stretch the cluster.** Configure fault domains (preferred/secondary/witness); per-AZ networks; storage policy for the dual-site mirror (~2× capacity).
  - *Acceptance:* stretched cluster compliant; an AZ-failure test survives on the surviving site.

### E9 — Day-2 fleet deployment  ·  Type D  ·  Owner: Plat
Ref: [`05-day2-deployments.md`](05-day2-deployments.md)

- **Story 9.1 — Network placement.** Decide Shared / Dedicated / NSX Overlay / NSX VLAN Segment; build the network if non-shared.
- **Story 9.2 — VCF Operations.** Deploy Operations (+ Cloud Proxy, License Server). Decide the cluster address: **floating IP** (default) or an **external load-balancer VIP** — VCF never provides the LB for Operations, so if a VIP is wanted, provision the external LB and add its FQDN to the cert SAN *first* (see `05-day2-deployments.md` B.1).
- **Story 9.3 — VCF Automation.** Deploy via SDDC Manager API or via VCF Operations; set the services-runtime cluster CIDR.
- **Story 9.4 — Ops for Logs / Networks & Identity Broker.** Deploy the remaining fleet components as needed.
  - *Acceptance:* each Day-2 component healthy; the fleet synthetic check passes.
- **Story 9.5 — Certificates & identity (full fleet).** Now that all components exist, do the full **CA-signed certificate** replacement across the whole fleet in one pass, and complete **fleet SSO via the VCF Identity Broker** (the recommended identity path, deferred from E6 6.3).
  - *Acceptance:* every fleet endpoint presents a CA-signed cert with no trust warnings; AD/LDAP SSO via the Identity Broker works.

---

## Using this in your backlog

- Treat **E1–E10** as epics, the **Story** lines as stories, and the bullets
  under them as tasks; carry the *Acceptance* line into the story's acceptance
  criteria.
- Add the **stretch** / **Day-2** blocks and **one E7 per workload domain** you
  need (see the scope table up top); order runs core → management stretch → Day-2
  → workload domains → handover.
- Sequence is roughly top-to-bottom; E1–E4 are planning (parallelisable across
  role teams), E5 onward is the build.
- This page is generic — replace the linked detail pages' placeholder values with
  the customer's real plan during E2/E3.
