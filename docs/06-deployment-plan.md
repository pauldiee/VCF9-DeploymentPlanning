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
| **Core** (always) | The management fleet: plan → intake → workbook → readiness gate → bring-up → config → handover | E1–E6, E10 |
| **Stretch the management domain** | Management cluster stretched across two AZs + its own witness | + E7 |
| **Day-2 fleet** | Deferred/added after bring-up: VCF Automation (if not taken at bring-up), Log Management, Operations for Networks, Identity Broker (VCF Operations itself is a **bring-up** component) | + E8 |
| **Workload domain** (repeat per WLD) | A VI workload domain — **non-stretched** or **stretched** (its own hosts, and if stretched its own witness) | + E9 (one per WLD) |

Epic ids follow execution order. Mix freely — e.g. a stretched management domain
+ the Day-2 fleet + two workload domains (one stretched) = Core **+ E7 + E8 + two
E9**. Execution order runs **core config → management stretch → Day-2 → workload
domains → handover**. The
[export tool](https://pauldiee.github.io/VCF9-DeploymentPlanning/tools/deployment-plan/)
assembles the exact epic/story set per scope.

---

## Core epics (every deployment)

### E1 — Network, DNS & routing plan  ·  Owner: Network + AD/DNS/NTP
Ref: [`01-network-dns-plan.md`](01-network-dns-plan.md)

- **Story 1.1 — VLAN / subnet plan.** Lock every management VLAN, subnet, MTU, gateway, and the IP carve-out.
  - *Acceptance:* one-page plan signed by the network owner; every VLAN/subnet/gateway/MTU recorded and no overlapping subnets.
- **Story 1.2 — BGP plan.** Edge AS, ToR AS, peer IPs, BFD, advertised/received routes — plus an **optional** MD5 password only if you enable BGP authentication.
  - *Acceptance:* Edge AS, ToR AS, peer IPs, BFD, and advertised/received routes agreed and documented with the fabric team. (BGP MD5 is optional — capture a password only if authentication is enabled; VCF/NSX requires just the neighbor IP + remote AS.)
- **Story 1.3 — DNS & NTP records.** All A + PTR records created; NTP sources confirmed.
  - *Acceptance:* forward (A) + reverse (PTR) records created for every planned appliance FQDN and resolving both ways; NTP sources reachable and serving.
- **Story 1.4 — Certificates.** CA type (management components use **Microsoft CA** only — not OpenSSL — or an external CA via CSR), template, and signing approach decided.
  - *Acceptance:* CA reachable; signing method and certificate template chosen, with a test issuance succeeding.

### E2 — Intake & sizing  ·  Owner: Architect + all role teams
Ref: [`02-customer-intake.md`](02-customer-intake.md) · [`04-sizing.md`](04-sizing.md)

- **Story 2.1 — Role-based intake complete.** Sections A–F answered by their owners.
  - *Acceptance:* every intake question answered or explicitly marked N/A by its owner.
- **Story 2.2 — Sizing & host fit.** Run the [sizing calculator](https://pauldiee.github.io/VCF9-DeploymentPlanning/tools/mgmt-sizing/); confirm the fleet fits the proposed hosts at N-1.
  - *Acceptance:* sizing fit-check passes at N-1 (or hosts adjusted); sizing signed off by the architect.

### E3 — Workbook & deployment-JSON prep  ·  Owner: Architect + Platform
Ref: [`workbook-cell-mapping.md`](workbook-cell-mapping.md)

- **Story 3.1 — Fill the P&P workbook.** Transfer intake answers into the official workbook — or use [**Coscia's VCF Planner**](https://vcfplanning.lcoscia.fr/) for an easier fillable form (live VLAN/IP/CIDR validation) that also doubles as an **as-built** record, with JSON/Markdown/CSV export.
  - *Acceptance:* workbook complete with no red validation warnings (or the equivalent complete in Coscia's Planner).
- **Story 3.2 — Generate the deployment JSON.** Produce the bring-up JSON (e.g. VCF.JSONGenerator) from the filled workbook.
  - *Acceptance:* deployment JSON generated, schema-valid, and reviewed against the plan.

### E4 — Prerequisites & readiness gate  ·  Owner: Architect + Customer
Ref: [`prerequisites.md`](prerequisites.md)

The final go/no-go before bring-up — it verifies the customer built everything the
plan (E1–E3) called for. Runs in parallel with E1–E3; must be all-green before E5.

- **Story 4.1 — Hardware ready.** Hosts on the VCG, matched spec, BOM confirmed.
  - Confirm CPU/RAM/storage per host against the sizing output (E2).
  - *Acceptance:* all hosts on the Broadcom compatibility guide, identical spec; host count meets the cluster minimum (with an even per-AZ split if the cluster will be stretched).
- **Story 4.2 — Physical network ready.** VLANs, MTU, and BGP fabric provisioned.
  - Trunk the required VLANs to host uplinks; set MTU 9000 on jumbo networks.
  - Configure the ToR BGP fabric (AS numbers, peer IPs) for the NSX edges.
  - *Acceptance:* required VLANs trunked with MTU 9000 on the jumbo networks; ToR BGP fabric up; all verified against the network plan (E1).
- **Story 4.3 — Core services ready.** AD, DNS, NTP, CA, depot reachable (open the firewall flows — see [`07-firewall-ports.md`](07-firewall-ports.md)).
  - *Acceptance:* forward (A) **and** reverse (PTR) DNS resolves both ways for every management/fleet FQDN — ESXi hosts, vCenter, SDDC Manager, NSX Manager VIP + the 3 nodes, NSX Edge nodes (and any Day-2 fleet appliances: VCF Operations, Automation, Logs, Identity Broker); NTP in sync; CA reachable; depot/binaries staged.
- **Story 4.4 — Access & final readiness.** A jump/bastion host reaches the management network, and out-of-band (iDRAC / iLO / BMC) access to the hosts is available.
  - *Acceptance:* the build team can reach the management network and host consoles; and the full prerequisites checklist ([`prerequisites.md`](prerequisites.md) — hardware, network, AD, DNS, NTP, CA, depot) is green before bring-up starts.

### E5 — Management domain bring-up  ·  Owner: Platform
- **Story 5.1 — Install & configure the management hosts.** Image each host with the supported **ESXi ISO** (see the [**VCFHostPreparation**](https://github.com/pauldiee/VCFHostPreparation) repo to prep + commission hosts quickly); set the management VMkernel (IP / gateway / VLAN), DNS, NTP, and root password; confirm the ESXi build matches the BOM.
  - *Acceptance:* every host reachable on the management network with the matched ESXi build; DNS + NTP correct.
- **Story 5.2 — Stage the VCF Installer.** Deploy the Installer on a management-domain host using the **IP + FQDN planned for SDDC Manager** (it switches into SDDC Manager at bring-up — not a throwaway IP); verify it reaches the ESXi management network.
  - On that host, put the Installer on a port group carrying the **VM Management VLAN**. A fresh ESXi host's default `VM Network` port group is **untagged (VLAN 0)**, so if VM Management is a tagged VLAN, set the VLAN ID on it (or use a tagged port group) first — otherwise the appliance has no management connectivity.
  - *Acceptance:* VCF Installer deployed on the VM-Management VLAN, resolves in DNS on the planned SDDC Manager FQDN, and reaches the ESXi management network.
- **Story 5.3 — Deploy the management domain.** Run bring-up: the Installer validates the prepared hosts, then builds vCenter, SDDC Manager, NSX, vSAN, and **VCF Operations**; submit the JSON.
  - **VCF Operations is deployed at bring-up** in VCF 9.1 — not Day-2 (only VCF Automation can be deferred). Decide its cluster address up front: **floating IP** (default) or an **external load-balancer VIP** — VCF never provides the LB for Operations, so provision an external LB and add its FQDN to the cert SAN first if you want a VIP.
  - *Acceptance:* bring-up completes; vCenter, SDDC Manager, NSX, and VCF Operations healthy; vSAN datastore online.
- **Story 5.4 — Deploy VCF Management Services, License Server & Cloud Proxy.** These are **not** part of the automatic bring-up — once VCF Operations + SDDC Manager are up, deploy them **via VCF Operations** (its UI, or the SDDC Manager API for custom VLAN-backed placement to avoid IP exhaustion): **VCF Management Services** (VCF services runtime, fleet & SDDC lifecycle, software depot, telemetry), the **License Server**, and the **Cloud Proxy** collector as needed.
  - The **License Server** needs a unique FQDN resolving to an IP **outside** the VCF services-runtime range (IPv4 only). The **Cloud Proxy** stays on the **VM-Management** network and needs ports **443 / 4505 / 4506** to VCF Operations (see [`07-firewall-ports.md`](07-firewall-ports.md) §E). Licenses are applied fleet-wide later (E8 8.4).
  - *Acceptance:* VCF Management Services + License Server deployed and healthy; the License Server FQDN resolves to an IP outside the services-runtime range; Cloud Proxy (if used) is collecting.

### E6 — Management domain configuration  ·  Owner: Platform + Network + Security
- **Story 6.1 — NSX edges & north-south.** Deploy edges; establish BGP peering to the ToRs; verify routes.
  - *Acceptance:* edges deployed; BGP peering to the ToRs established; north-south routes advertised and reachable.
- **Story 6.2 — Certificates (optional / partial here).** You *can* replace certificates for the components deployed **so far** now, but the **full** CA-signed replacement is usually done **once all components exist** — after the Day-2 fleet — so the whole fleet is certified in one pass (see E8 story 8.4).
- **Story 6.3 — Identity & roles (optional, *not recommended* at this stage).** You *can* bind **vCenter SSO** directly to AD/LDAP now for early management access, but the **recommended** path is fleet-wide SSO via the **VCF Identity Broker**, a Day-2 component (see E8 / [`05-day2-deployments.md`](05-day2-deployments.md)). Prefer deferring identity to Day-2; only bind vCenter SSO here if you genuinely need AD admin access before the fleet is up, and map admin/operator/viewer groups if you do.
- **Story 6.4 — Backup & lifecycle.** Configure SFTP backups; connect the depot for **fleet lifecycle** (SDDC Manager already has its own depot from bring-up — this is the fleet-wide LCM depot, not a re-do).
  - *Acceptance:* a test SFTP backup completes; fleet-lifecycle depot connected. (North-south routing is verified in 6.1; certificates, identity & licensing are finalized Day-2 — see E8 8.5.)

---

## Variant epics (add per scope)

Order runs **core config → management stretch (E7) → Day-2 (E8) → workload
domains (E9, one per WLD) → handover (E10)**.

### E7 — Stretch the management domain  ·  Owner: Network + Architect + Storage
Ref: [`03-multi-az-prep.md`](03-multi-az-prep.md)

Stretch sequence: **inter-AZ fabric → commission second-AZ hosts → witness →
stretch** (the same order a stretched workload domain follows in E9).

- **Story 7.1 — Inter-AZ fabric.** Verify <5 ms RTT, ≥10 Gbps, MTU 9000, HA L3 gateway between AZs.
  - *Acceptance:* inter-AZ link measured under 5 ms RTT, at least 10 Gbps, MTU 9000 end-to-end; HA L3 gateway between AZs verified.
- **Story 7.2 — Install, configure & commission the second-AZ hosts.** Image the AZ2 hosts with the supported **ESXi ISO** (see [**VCFHostPreparation**](https://github.com/pauldiee/VCFHostPreparation) to prep + commission hosts quickly); configure the per-AZ management network (IP / VLAN / gateway), DNS, NTP, and root; then **commission** them into SDDC Manager, ready for the stretch.
  - *Acceptance:* AZ2 hosts reachable on their per-AZ management network with the matched ESXi build; commissioned and available in SDDC Manager.
- **Story 7.3 — Witness site (management).** Deploy the vSAN witness appliance for the **management** cluster at the third site (its **own** — a vSAN witness serves **only one** stretched cluster); route it to both AZ ESX-management networks.
  - *Acceptance:* management witness appliance deployed at the third site and reachable from both AZ ESX-management networks.
- **Story 7.4 — Stretch the cluster.** **SDDC Manager does the stretch for you** — submit a stretch **JSON spec via the SDDC Manager API** and VCF builds the fault domains (AZ1 preferred / AZ2 secondary / witness), balances hosts across the AZs, and flips the datastore storage policy to **site mirroring** (stretched, ~2× capacity). You just supply the inputs from 7.1–7.3: an **AZ2 network pool**, the commissioned AZ2 hosts (equal count per AZ), and the witness. It **won't** stretch if the cluster shares a vSAN storage policy with another cluster, has DPU-backed hosts, or has L3-different subnets within an AZ. Ref: [Broadcom — Stretching vSAN Clusters](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/stretching-clusters.html) · [`03-multi-az-prep.md`](03-multi-az-prep.md).
  - *Acceptance:* SDDC Manager reports the cluster stretched; vSAN healthy and storage-policy compliant (site mirroring); isolating one AZ keeps VMs running on the surviving site.

### E8 — Day-2 fleet deployment  ·  Owner: Platform
Ref: [`05-day2-deployments.md`](05-day2-deployments.md)

**VCF Operations (+ fleet management) is deployed at bring-up (E5 5.3), not here** —
in VCF 9.1 only **VCF Automation** can be deferred to Day-N. This epic covers the
components you defer or add after bring-up.

- **Story 8.1 — Network placement.** Decide Shared / Dedicated / NSX Overlay / NSX VLAN Segment for the Day-2 components; build the network if non-shared.
  - *Acceptance:* chosen placement built (or the shared network confirmed); the segment/VLAN is reachable and the fleet FQDNs resolve.
- **Story 8.2 — VCF Automation.** Deploy via SDDC Manager API or via VCF Operations; set the services-runtime cluster CIDR. (VCF Automation is the one fleet component you can **defer** from bring-up to Day-N.)
  - *Acceptance:* VCF Automation deployed and healthy; the services-runtime cluster CIDR is set and non-overlapping.
- **Story 8.3 — Log Management, Operations for Networks & Identity Broker.** Deploy the remaining fleet components as needed: **Log Management**, VCF Operations for Networks, and the Identity Broker.
  - *Acceptance:* each deployed Day-2 component healthy; the fleet-management health (synthetic) check passes.
- **Story 8.4 — Certificates, identity & licensing (full fleet).** Now that all components exist, do the full **CA-signed certificate** replacement across the whole fleet in one pass, complete **fleet SSO via the VCF Identity Broker** (the recommended identity path, deferred from E6 6.3 — prep the AD/LDAP identity source and its gotchas first: [`prerequisites.md` → Identity source for the VCF Identity Broker](prerequisites.md#identity-source-for-the-vcf-identity-broker)), and **apply licensing** across the fleet (via VCF Operations).
  - *Acceptance:* every fleet endpoint presents a CA-signed cert with no trust warnings; AD/LDAP SSO via the Identity Broker works; licensing applied.

### E9 — Workload domain  ·  Owner: Platform + Network (+ Storage if stretched)
Ref: [`02-customer-intake.md`](02-customer-intake.md) section H (+ [`03-multi-az-prep.md`](03-multi-az-prep.md) if stretched)

**Repeat this epic per workload domain.** Each WLD is independently
**non-stretched** or **stretched** — a stretched WLD gets its **own** second-AZ
hosts and its **own** vSAN witness (a witness serves **only one** stretched
cluster, so each has a dedicated one; **shared-witness is 2-node-cluster only**,
not stretched), and follows the same **hosts → witness → stretch**
order as the management stretch (E7). A stretched WLD also requires the
**management domain to be stretched first (E7)**.

**Non-stretched WLD:**
- **Story 9.1 — WLD network prep.** Provision the per-WLD VLANs/subnets (Step 1) and the 5 IPs the WLD consumes on the mgmt VM-mgmt subnet.
  - *Acceptance:* per-WLD VLANs/subnets provisioned; the 5 mgmt-subnet IPs reserved; DNS in place.
- **Story 9.2 — Prepare & commission the WLD hosts.** Image the WLD hosts with the supported **ESXi ISO** (see [**VCFHostPreparation**](https://github.com/pauldiee/VCFHostPreparation)); configure the management network, DNS, NTP; then **commission** them into SDDC Manager.
  - *Acceptance:* WLD hosts reachable, matched ESXi build, commissioned in SDDC Manager.
- **Story 9.3 — Deploy the WLD.** vCenter + NSX (shared or dedicated) + first cluster.
  - *Acceptance:* WLD deployed; its vCenter + NSX healthy; first cluster online in SDDC Manager.
- **Story 9.4 — WLD connectivity.** Edges / uplinks (Centralized or Distributed); optional vSphere Supervisor.
  - *Acceptance:* WLD healthy in SDDC Manager; north-south reachable; workloads can be placed.

**Stretched WLD** (multi-AZ set):
- **Story 9.1 — WLD network prep (per-AZ).** Provision the per-WLD VLANs/subnets across **both AZs** (per-AZ networks) and the 5 mgmt-subnet IPs.
  - *Acceptance:* per-WLD VLANs/subnets provisioned across both AZs; the 5 mgmt-subnet IPs reserved; DNS in place.
- **Story 9.2 — Prepare & commission the WLD hosts (both AZs).** Image the WLD hosts in both AZs (see [**VCFHostPreparation**](https://github.com/pauldiee/VCFHostPreparation)); configure the per-AZ management networks, DNS, NTP; then **commission** them into SDDC Manager.
  - *Acceptance:* WLD hosts in both AZs reachable, matched ESXi build, commissioned in SDDC Manager.
- **Story 9.3 — Deploy the WLD.** vCenter + NSX (shared or dedicated) + first cluster.
  - *Acceptance:* WLD deployed; its vCenter + NSX healthy; first cluster online in SDDC Manager.
- **Story 9.4 — WLD witness.** Deploy a **dedicated** vSAN witness for **this** WLD at the third site. A witness serves **only one** stretched cluster, so each stretched WLD needs its own, separate from the management witness (the **shared-witness** feature is **2-node-cluster only**, not stretched). Route it to both AZ ESX-management networks.
  - *Acceptance:* dedicated WLD witness deployed at the third site and reachable from both AZ ESX-management networks.
- **Story 9.5 — Stretch the WLD cluster.** Same as the management stretch — **SDDC Manager stretches it for you** from a **JSON spec via the API**: it builds the fault domains, balances the per-AZ hosts, and sets the **site-mirroring** storage policy. Supply the AZ2 network pool, the commissioned WLD hosts (equal per AZ), and this WLD's witness. **The management domain must already be stretched (E7)** before any workload-domain cluster can be stretched. Edge stretched only under NSX **Centralized** connectivity. Ref: [Broadcom — Stretching vSAN Clusters](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/stretching-clusters.html).
  - *Acceptance:* SDDC Manager reports the WLD stretched; vSAN healthy and storage-policy compliant (site mirroring); isolating one AZ keeps VMs running on the surviving site.
- **Story 9.6 — WLD connectivity.** Edges / uplinks (Centralized or Distributed); optional vSphere Supervisor.
  - *Acceptance:* WLD healthy in SDDC Manager; north-south reachable; workloads can be placed.

---

## Final epic (always last)

### E10 — Validation & handover  ·  Owner: Architect + all teams

A core epic that always runs **after** E6 and any variant epics (stretch / Day-2 /
workload domains) — it validates and hands over the *complete* environment.

- **Story 10.1 — Health check.** Run a post-deploy health check of the live environment.
  - *Acceptance:* post-deploy health check run; no critical findings (or all triaged).
- **Story 10.2 — As-built.** Capture the as-built (FQDNs, IPs, VLANs, passwords in the secret store).
  - *Acceptance:* as-built captured — FQDNs, IPs, VLANs recorded; passwords stored in the secret store.
- **Story 10.3 — Handover.** Walk the customer through operations and hand over.
  - *Acceptance:* health check clean; as-built delivered; customer sign-off received.

---

## Using this in your backlog

- Treat **E1–E10** as epics, the **Story** lines as stories, and the bullets
  under them as tasks; carry the *Acceptance* line into the story's acceptance
  criteria.
- Add the **stretch** (E7) / **Day-2** (E8) blocks and **one E9 per workload
  domain** you need (see the scope table up top); order runs core → management
  stretch → Day-2 → workload domains → handover.
- Sequence is roughly top-to-bottom; E1–E3 are planning (parallelisable across
  role teams), E4 is the readiness gate (must be all-green before bring-up), E5
  onward is the build.
- This page is generic — replace the linked detail pages' placeholder values with
  the customer's real plan during E2/E3.
