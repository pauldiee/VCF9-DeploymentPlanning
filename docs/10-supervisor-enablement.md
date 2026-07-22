# vSphere Supervisor — Enablement Guide

Enabling a **vSphere Supervisor** on a VCF 9.1 workload domain. The
[prerequisites gate](prerequisites.md#vsphere-supervisor-only-if-in-scope)
states *what* must exist and the [deployment plan](06-deployment-plan.md) carries
the stories; this page covers *how to enable it*, what to check before the
wizard, and the field-notes gotchas that cost redo time.

Activation is **Day-N and per workload domain** — nothing here happens at
bring-up. It is also **not reversible in any cheap way**: several inputs are
fixed for the life of the Supervisor, and a decommissioned cluster cannot host a
new one (see [§8](#8-field-notes)).

> **Read [§1](#1-decide-the-shape-first) before anything else.** The word
> *centralized* means two different things in the 9.x documentation, and picking
> the wrong one sends you down a path that has no wizard in 9.1.

## Contents

| # | Section | Use it when |
| - | ------- | ----------- |
| 1 | [Decide the shape first](#1-decide-the-shape-first) | **Before any build** — networking model, load balancer, zones |
| 2 | [Pre-flight gate](#2-pre-flight-gate) | The morning of — what to verify before opening the wizard |
| 3 | [Build the Centralized Transit Gateway](#3-build-the-centralized-transit-gateway) | Edge cluster + Tier-0 + BGP + the IP blocks |
| 4 | [Avi Load Balancer (only if used)](#4-avi-load-balancer-only-if-used) | Ordering, and the settings that cannot be changed later |
| 5 | [Content library for Supervisor / VKS images](#5-content-library-for-supervisor--vks-images) | **Changed in 9.1** — the public CDN is gone |
| 6 | [Activate the Supervisor](#6-activate-the-supervisor) | The wizard, screen by screen |
| 7 | [Validate](#7-validate) | Proving it actually works, not just that it finished |
| 8 | [Field notes](#8-field-notes) | Known failure signatures and their causes |
| 9 | [The other networking paths](#9-the-other-networking-paths) | Distributed TGW, classic NSX segment, vDS |
| 10 | [References](#10-references) | The TechDocs and KBs behind the above |

> **Sourcing convention on this page.** Statements are marked **[documented]**
> where a Broadcom TechDocs page or KB says so, and **[field-reported]** where
> the only sources are practitioner blogs. Anything unmarked is ordinary
> operational advice. The distinction matters here more than usual, because
> several 9.1 Supervisor pages were withdrawn rather than updated — see
> [§9](#9-the-other-networking-paths).

---

## 1. Decide the shape first

### 1.1 "Centralized" is ambiguous — resolve it

| Term | What it actually is | 9.1 status |
| ---- | ------------------- | ---------- |
| **Centralized Transit Gateway (CTGW)** | A *connectivity mode of VPC networking*. The Transit Gateway attaches to a **Tier-0 on an Edge cluster** instead of to a VNA. Still VPC networking, still the VPC wizard. | Fully supported, UI-driven, 9.1-documented |
| **Classic NSX Segment Networking** | The pre-9 model: pod / ingress / egress CIDRs, Tier-1 per namespace, Edge LB or Avi. Wizard field reads *Networking Stack: NSX*. | **Removed from the vSphere Client UI in 9.1 — API only** |

Verbatim, from the vSphere Supervisor 9.1 release notes **[documented]**:

> "Starting with VCF 9.1, the vSphere Client UI no longer supports deploying a
> Supervisor with classic NSX Segment Networking. Deployment remains fully
> supported through the API."

**This page documents the CTGW path.** If you need classic NSX segment
networking, go to [§9.2](#92-classic-nsx-segment-networking-api-only-in-91)
first — the plan changes materially.

Both Transit Gateway modes exist under VPC networking **[documented]**:

- **Centralized** — "attaches the Transit Gateway to a Tier-0 Gateway"; "uses the
  Tier-0 networking capabilities and services like BGP and requires an Edge
  Cluster".
- **Distributed** — "directly connects to the VLAN of the datacenter without
  requiring additional configuration on the physical environment"; requires a
  **VNA cluster**; "scales out as you add hosts".

A Transit Gateway must be **all-centralized or all-distributed, never mixed**
**[documented]**.

### 1.2 Load balancer — you may not need Avi

Supervisor activation requires *a* load balancer, not specifically Avi. On the
VPC path the prerequisite reads **[documented]**:

> Optionally install and configure the Avi Load Balancer; the **NSX Edge load
> balancer is used if NSX does not detect the Avi Load Balancer**.

So Avi is opt-in, and it is *detected* rather than configured in the Supervisor
wizard. Choose it only when you have a reason — an existing Avi estate, L7
ingress requirements, or a VCF Automation deployment already fronted by it.
Otherwise the built-in path needs no extra appliance, no extra licence and no
extra failure domain.

> **The licensing trap.** An Avi Controller that cannot have licences attached
> blocks activation just as hard as one that was never deployed. Avi 9.1
> introduces a new subscription licence file format replacing 25-character serial
> keys, with a **90-day grace period** on the move to 32.1.1 **[documented]**.
> If a licence migration is in flight, settle it before the deployment day or
> plan to use the built-in load balancer.

### 1.3 Zones — and what a stretched cluster gives you

| Model | Clusters | Control-plane VM placement |
| ----- | -------- | -------------------------- |
| Single zone | 1 | All three VMs on the one cluster |
| Three zone | 3 | One VM per zone |

Latency between clusters in a zone: **100 ms maximum** **[documented]**.

**A stretched vSAN cluster does not give you a multi-zone Supervisor**
**[documented]**:

> "The supported Supervisor deployment on a vSAN stretched cluster is a
> single-zone Supervisor, where the underlying vSphere cluster is a vSAN
> stretched cluster."

and

> "You can only use a greenfield deployment for a Supervisor running on a
> stretched vSAN cluster starting from the vSphere 8 Update 3 release."

Two consequences worth stating plainly to whoever is expecting resilience:
Kubernetes sees **one** zone, so you get vSphere-level HA across sites but not
Kubernetes-level zone awareness; and there is **no conversion path** — you cannot
stretch your way into it later.

Not documented for the stretched case: Edge cluster and Tier-0 placement across
sites, Avi Controller and Service Engine placement across AZs, and Service Engine
Group host-group affinity per site. Decide these deliberately and record the
reasoning.

---

## 2. Pre-flight gate

Verify — do not accept assurances. Each of these has failed a real activation.

### Platform

- [ ] Workload domain healthy in SDDC Manager, no in-flight LCM tasks
- [ ] **DRS enabled and in Fully Automated mode** — "must be in Fully Automated
      mode" **[documented]**. The failure symptom is *not* documented; treat the
      requirement as absolute
- [ ] **vSphere HA enabled** on the target cluster
- [ ] Hosts: 3 per cluster without vSAN, **4 with vSAN**; minimum **8 CPU /
      64 GB RAM** per host **[documented]**
- [ ] **Host names are lowercase** — "Otherwise, the activation of the Supervisor
      might fail" **[documented]**. Cheap to check, ugly to diagnose
- [ ] Storage policy selected for control-plane VM placement, and compatible with
      the target datastore
- [ ] NTP configured on **all ESX hosts and vCenter**; DNS reachable

### Addressing

- [ ] **5 consecutive static IPs** free on the management network — 3 control
      plane VMs, 1 floating IP, 1 held for rolling upgrade. Ping them; do not
      trust the spreadsheet
- [ ] Management network and workload network are on **different subnets**
      **[documented]**
- [ ] **Service CIDR** chosen, overlapping nothing — other Supervisors, fleet
      networks, or the VPC blocks
- [ ] **API server FQDN** chosen, with forward **and** reverse DNS records in
      place before activation
- [ ] **IPv6 is not supported** — plan IPv4 **[documented]**

### Networking (CTGW)

- [ ] Edge cluster deployed and healthy, **minimum two Edge nodes**, **Large**
      form factor **[documented]**
- [ ] Tier-0 up, BGP established, routes exchanged in **both** directions
- [ ] **VPC External IP Blocks** — routable and advertised upstream
- [ ] **Private (Transit Gateway) IP Blocks** — see the sizing caveat in
      [§3.3](#33-the-ip-blocks-and-the-16-question)
- [ ] MTU **1700** end to end (see [§8](#8-field-notes) — the docs contradict
      themselves here)
- [ ] Supervisor management network reaches **vCenter** and the **host management
      vmkernel** (Spherelet) **[documented]**

### Load balancer and content

- [ ] Load balancer decision made per [§1.2](#12-load-balancer--you-may-not-need-avi)
- [ ] If Avi: Controller cluster healthy **in the management domain**, licensed,
      registered, and **Default-Group configured** — see [§4](#4-avi-load-balancer-only-if-used)
- [ ] **VCF Software Depot configured in vCenter** — this is what creates the
      VKS content library in 9.1. See [§5](#5-content-library-for-supervisor--vks-images)

---

## 3. Build the Centralized Transit Gateway

Skip this section if the Edge cluster and Tier-0 already exist and carry
production routing — but still confirm the IP blocks in
[§3.3](#33-the-ip-blocks-and-the-16-question).

The guided wizard builds the Edge cluster, the gateway and the IP blocks in one
flow. Field list **[documented]**:

### 3.1 Edge cluster

| Field | Note |
| ----- | ---- |
| Edge cluster name | |
| MTU | **Default 1700** |
| Form factor | **Large** |
| Edge nodes | **Minimum two** |

Per Edge node: node name, vSphere cluster, resource pool, **Edge host affinity**
(yes/no), management IP allocation (static — port group, a **unique** management
IP CIDR per node, default gateway), overlay networking, active/standby pNICs,
**TEP VLAN ID**, and TEP IP allocation (DHCP, IP pool, or static list) with
gateway and subnet mask.

> Edge host affinity is worth a deliberate decision on a stretched cluster — it
> is what keeps both Edge nodes from landing on the same site.

### 3.2 Gateway and BGP

| Field | Note |
| ----- | ---- |
| Gateway name | |
| High availability mode | **Active Standby** — the guided wizard sets this |
| Gateway routing type | **BGP** |
| Local autonomous system number | Your ASN |

Per Edge node uplink: gateway interface **VLAN**, gateway interface **CIDR**,
**BGP peer IP**, **BFD** toggle, **MTU** (valid range 1600–9000), **BGP peer
ASN**, and **BGP peer password**.

> Get the BGP peer password and ASN from the network team **in writing** before
> the day. A silent BGP session is the single most common reason this stage
> stalls, and the peer side is rarely yours to inspect.

### 3.3 The IP blocks, and the /16 question

Two blocks are configured here **[documented]**:

- **VPC External IP Blocks** — "Advertised CIDRs that allow outside connectivity
  to VPC workloads". These must be routable and advertised upstream.
- **Private (Transit Gateway) IP Blocks** — "Private CIDRs that are available for
  inter-VPC communication".

**Broadcom documents no minimum prefix size for either block.** The wizard pages
ask for both and state no sizing. The 9.0 page that carried a VPC requirements
table has been withdrawn — it now returns 404 and is delisted from both the 9.0
and 9.1 books.

> **The /16 claim — [field-reported], not documented.** Multiple practitioner
> blogs report that in 9.1 the **private transit gateway block must be a `/16`**,
> where 9.0 accepted a `/24`, and that with a `/24` the deployment **never
> completes** rather than failing cleanly. There is no TechDocs statement and no
> KB behind this. It is reported independently by more than one author, the
> failure mode is expensive, and a `/16` of private space costs nothing — so
> **size it `/16`** and treat a hang at this stage as evidence. Do not present it
> to a customer as a documented requirement.

---

## 4. Avi Load Balancer (only if used)

Skip entirely if you are using the built-in NSX Edge load balancer.

### 4.1 Ordering — this is a hard dependency

> "If you want to use Avi Load Balancer in VCF Automation, or for vSphere
> Supervisor load balancing, the Avi Load Balancer Controller cluster must be
> deployed **before** you activate vSphere Supervisor in the workload domain."
> **[documented]**

Build order: NSX (transport zones, uplink profile, transport nodes) → Tier-0 →
**Avi Controller** → Supervisor activation.

### 4.2 Controller

- **Placement: the management domain**, always — one set per NSX instance, not
  one per workload domain. Service Engines are what run per cluster in the
  workload domain.
- Controller IPs: single node = 1 management IP; **3-node cluster = 4 IPs**
  (one per VM plus a cluster VIP), from the management network **[documented]**.
  Three nodes is the production recommendation.
- Versions: vCenter 9.0+, NSX 9.0+, **Avi Controller 31.1.1+** **[documented]**.
- Licence: **Enterprise** or **Enterprise with Cloud Services**. The Controller
  starts in evaluation mode and must be moved off it **[documented]**.
- The **backup passphrase** set in the first-login wizard is a restore-blocker —
  store it with a named owner, exactly as with the SFTP target passphrase
  ([08-backup-target.md](08-backup-target.md)).

### 4.3 Service Engine Group — set it before activation

Two documented statements that together make this a one-shot setting
**[documented]**:

> "The AKO creates one Service Engine Group for each vSphere Supervisor cluster."

> "Changes made to the Default-Group configuration will not reflect in an already
> created Service Engine Group."

So **Default-Group must be right before you activate**. Retrofitting it
afterwards does nothing for the Supervisor that already exists. Set HA mode
(N+M buffer / active-standby / active-active), the maximum Service Engine count
(default 10), and virtual-service placement (**Compact**, the default, packs onto
existing SEs; **Distributed** spreads across new ones). At least two Service
Engine VMs are deployed per Supervisor.

### 4.4 Documented limitations that bite

- **"You cannot deploy the Avi Load Balancer Controller in a vCenter Enhanced
  Linked Mode deployment. You can only deploy the Avi Load Balancer Controller in
  a single vCenter deployment."** **[documented]** — check this against your
  vCenter topology *before* committing to Avi. In a linked-mode VCF estate this
  is decisive.
- **"Traffic fails for load balancer services with endpoints in a different
  Namespaces"** **[documented]** — SNAT is used when the SE crosses Tier-1
  gateways; DFW rules are needed for cross-namespace communication.
- An Ingress gets no external IP when no host name is specified, when
  `defaultBackend` is used instead of a host name, or when the same host name is
  reused in another namespace **[documented]**.
- Avi provides **L4 for Services in both Supervisor and VKS clusters**, but
  **L7 for Ingresses in Supervisor clusters only** **[documented]**.

---

## 5. Content library for Supervisor / VKS images

**This changed in 9.1 and old procedures are actively wrong.** Verbatim from the
vSphere Supervisor 9.1 release notes **[documented]**:

> "Starting with VCF 9.1, the public CDN (wp-content.vmware.com or
> wp-content.broadcom.com) is no longer used to create the default VKS content
> library. Only on vCenter instances where VCF Software Depot is configured in a
> VCF or VVF deployment, the default VKS content library is automatically created
> based on the VCF Software Depot endpoint upon the first Supervisor enablement
> in vCenter."

Read that carefully, because it inverts the usual assumption:

1. **Any subscription URL under `wp-content.*` is dead.** A guide, runbook or
   habit that starts by pasting that URL will produce a library that never syncs.
2. **With the VCF Software Depot configured, you do not create the library by
   hand.** It is created **automatically**, from the depot endpoint, on the
   **first Supervisor enablement in that vCenter**.
3. **Manual creation is the fallback**, for when the depot is not configured or
   the site is air-gapped.

So the real pre-flight item is *"is the VCF Software Depot configured in this
vCenter?"* — not *"has someone built a content library?"*. Confirm the depot
first; if it is configured, let activation create the library and verify it
afterwards ([§7](#7-validate)).

> **Offline / air-gapped sites.** The library must be populated from the offline
> depot rather than a subscription. Note also a **[field-reported]** issue that
> the 9.1 `vks-download-tool` does not download the Supervisor OVA or Kubernetes
> release artifacts, with a fix expected in 9.1.1 — verify the artifacts are
> actually present before relying on them.

> **A synced library is not a populated one.** Check the item count and that a
> usable release is actually listed — not just that the sync reported success.
> An empty-but-healthy library fails you late, after the control plane is up.

> **It also blocks teardown.** "Supervisor disablement fails and remains stuck in
> a removing phase if an associated Content Library cannot be deleted"
> **[documented]** — the fix is to delete the content-library usage association
> via REST.

---

## 6. Activate the Supervisor

**Where:** vSphere Client → home menu → **Supervisor Management** → **Get
Started**. (In 9.x the menu item is *Supervisor Management*; the post-activation
status table is still under *Workload Management*.) A Supervisor can alternatively
be activated as an optional step of **workload domain creation** in VCF
Operations **[documented]**.

Screens and fields, in order **[documented]**:

**1 — vCenter Server and Network.** Select the vCenter; set **Networking Stack =
VCF Networking with VPC**.

**2 — Supervisor Location.** Supervisor name, data center, HA, and either three
vSphere zones or one compatible zone.

**3 — Storage.** Storage policy for control-plane VM placement.

**4 — Management Network.** IP assignment mode (DHCP or **Static**), network,
the **5 consecutive IPs / floating IP**, subnet mask, gateway, **DNS servers**
(required if vCenter uses an FQDN), DNS search domains, **NTP servers**.

**5 — Workload Network.**

| Field | Description as printed |
| ----- | ---------------------- |
| NSX Project | Name of the NSX project containing the VPC |
| VPC Connectivity Profile | The connectivity profile name |
| External IP Blocks | "Advertised CIDRs that allow outside connectivity to VPC workloads" |
| Private (Transit Gateway) IP Blocks | "Private CIDRs available for inter-VPC communication" |
| Private (VPC) CIDRs | CIDR blocks for private subnet allocation |
| Service CIDR | Kubernetes service IP allocation range |
| DNS Server | DNS server IP addresses |
| NTP Server(s) | NTP reference |

> An **empty "VPC Connectivity Profile" dropdown** means the NSX instance has
> overlay but no north-south spine — no Edge cluster, no Tier-0, or no
> connectivity profile. Go back to [§3](#3-build-the-centralized-transit-gateway).
> **[field-reported]**

**6 — Advanced Settings.**

| Field | Note |
| ----- | ---- |
| Supervisor Control Plane Size | Tiny (2 vCPU / 8 GB) · Small (4 / 16) · Medium (8 / 16) · Large (16 / 32). **Can only scale up** |
| API Server DNS Names | The FQDN(s) used to reach the Supervisor. **Set this now** — FQDN login requires it to have been configured at enablement |
| Export Configuration | Exports a JSON file of the whole configuration |

> **Export the configuration.** It is one click, it documents exactly what was
> deployed, and it is the input for "Deploy a Supervisor by Importing a JSON
> Configuration File" later. Do it every time.

Activation then performs "deployment of control plane VMs, ESX host configuration
as Kubernetes nodes, virtual IP preparation on the load balancer, and core
Supervisor Services deployment" **[documented]**. Status moves through
**Configuring** to **Running** in the Workload Management Supervisor table
(*config status* and *host config status* columns).

---

## 7. Validate

Finished is not the same as working. Check all of these.

| Check | What good looks like |
| ----- | -------------------- |
| Config status | **Running** in the Workload Management table, and *host config status* clean |
| Control-plane VMs | Three, healthy, and — on a three-zone Supervisor — one per zone |
| API endpoint by **FQDN** | Reachable by name, not only by IP |
| Certificate | Accepted on FQDN login. SNI provides the VIP certificate when the request is made by FQDN **[documented]** |
| CLI login | See below — the command changed in 9.1 |
| Namespace | Create one and schedule a test workload |
| Load balancer | Avi: NSX Cloud status green, Service Engines spawned, virtual service **placed**. Built-in: VIP responding |
| Content library | Synced **and** listing a usable release ([§5](#5-content-library-for-supervisor--vks-images)) |
| North-south | Workload egress works and an ingress VIP is reachable from outside |

**The CLI changed in 9.1** — it is the **VCF CLI**, not `kubectl vsphere login`,
and the plugin naming (`kubectl-vsphere`) is gone **[documented]**:

```
vcf context create --endpoint <SUPERVISOR-ADDRESS> --username <VCENTER-SSO-USER> --ca-certificate <PATH-TO-CERTIFICATE-FILE>
```

The endpoint accepts either an IP or an FQDN. Supply the password by prompt or
via `VCF_CLI_VSPHERE_PASSWORD`. Verify with `vcf context list`; switch with
`vcf context use <name>`. **"Using FQDN requires it to be configured during the
Supervisor enablement"** — the *API Server DNS Names* field from
[§6](#6-activate-the-supervisor).

> There is **no documented enumeration** of Supervisor config-status values
> beyond Configuring / Running / Error, and no documented post-activation
> validation checklist. The table above is assembled from the troubleshooting and
> connection pages rather than quoted from one.

---

## 8. Field notes

### Failure signatures worth recognising

| Symptom | Cause and fix |
| ------- | ------------- |
| Enablement halts at **"Configured Supervisor Control plane VM's Workload Network"**; **eth1 never configured**; CoreDNS one pod CrashLoopBackOff and two Pending | `nsx-ncp` stuck in **"Restore mode"** after a previous NSX Manager restore, so the workload segment is never created. Patch `ncpconfig nsx-restore-status` with the NSX `restore_end_time`, restart nsx-ncp (KB 406786) |
| Cluster provisioning hangs; *"call timeout expired … http2: client connection lost"*; Avi shows **"Unable to acquire IP address for network"**; a direct `curl` to the control-plane VM **succeeds** | The load balancer, not the Supervisor. Create a new Service Engine Group and reassign the virtual service to it (KB 442187) |
| Stuck on the load-balancer step: *"Configured Load Balancer fronting the Kubernetes API Server — Timed out waiting for LB service update"* | Foundation LB instance **naming conflict** when more than one Supervisor exists in a single vCenter (KB 405115) |
| Load balancer service traffic fails when endpoints sit outside the VPC | Documented 9.1 issue; workaround is auto-SNAT |
| vSphere Namespace creation fails against a 9.1 NSX | NSX 9.1 introduces the **`cidr_list`** parameter on IPBlock; a 9.0 Supervisor consumes the old **`cidr`**. Version-mismatch, not misconfiguration |
| Re-enabling a Supervisor on a previously decommissioned cluster fails | Documented, and the workaround is to **build a new cluster**. Decommissioning is one-way for this purpose |
| Deployment never completes at the transit-gateway stage | Suspect the private transit-gateway block size — see [§3.3](#33-the-ip-blocks-and-the-16-question) **[field-reported]** |

All rows above are **[documented]** in release notes or KBs except where marked.

### Traps that are requirements, not symptoms

These have documented *requirements* and **no documented failure symptom** — so
they present as an unexplained stall. Check them in pre-flight rather than
diagnosing them later: DRS not fully automated, storage-policy incompatibility,
NTP or DNS drift, and uppercase host names.

### MTU — the docs contradict each other

The core VCF page states 1500 minimum on VDS port groups and >1600 for host and
Edge TEPs; the Avi requirements page states **1700 minimum on vSphere Distributed
Switch port groups**. Unresolved in the documentation. **Use 1700** — it
satisfies both.

### Other things worth knowing

- **Supervisor upgrade puts every host into maintenance mode**, one at a time —
  expected behaviour, no workaround **[documented]**. Plan the maintenance window
  accordingly.
- **NSX policy IDs containing `?`, `#`, `[` or `]` cannot be used** with the
  Supervisor **[documented]**.
- Since 9.0.2, **Supervisor control-plane backup is enabled by default**
  **[documented]**.
- If the API server is unresponsive, the documented diagnostic path is to SSH the
  control plane and run `systemctl status kubelet`,
  `journalctl -u kubelet -n 100 --no-pager`, `journalctl -u containerd -n 100`,
  and `tail -n 200 /var/log/vmware/wcp/wcpsvc.log` **[documented]**.

---

## 9. The other networking paths

### 9.1 Distributed Transit Gateway

Same VPC wizard, different connectivity mode. Requires a **VLAN-backed network
with outside connectivity** and a **VNA (Virtual Network Appliance) cluster**
providing NAT and load balancing, instead of an Edge cluster and Tier-0
**[documented]**. It "scales out as you add hosts" and needs no additional
physical-network configuration. Everything in [§5](#5-content-library-for-supervisor--vks-images)
through [§8](#8-field-notes) still applies.

### 9.2 Classic NSX segment networking (API only in 9.1)

Removed from the vSphere Client UI in 9.1 — see
[§1.1](#11-centralized-is-ambiguous--resolve-it). Deployment "remains fully
supported through the API", and the practical route is **Deploy a Supervisor by
Importing a JSON Configuration File**, which "automatically populates all the
configuration values in the Supervisor activation wizard" **[documented]**.

Two things to plan around if you land here. First, the 9.1 Supervisor book has
**no** requirements page for this path — the surviving topic is one sentence
pointing at the **9.0** Avi book, so the requirement numbers you work from are
9.0-vintage. Second, the CIDR model is different from VPC: **Pod CIDR /23
minimum**, **Services CIDR /16 minimum**, **Ingress and Egress /27 minimum each**
(these two must be routable and advertised upstream, and must not overlap),
namespace subnet prefix **/28 default**, and a Tier-0 uplink **/24** — 1 IP with
no Edge redundancy, 3 with static routes and redundancy, 4 with BGP and
redundancy **[documented, 9.0 sources]**.

### 9.3 vDS networking

No NSX. Requires the **Foundation Load Balancer** or Avi, and workload port
groups on a different subnet from the Supervisor management network. See
[prerequisites.md](prerequisites.md#vsphere-supervisor-only-if-in-scope).

### 9.4 Simplified ("Easy") Supervisor

Available in 9.1 **[documented]**. Base configuration: **a single control-plane
VM**, **one network carrying both management and workload traffic**, and **VM
Service only** — vSphere Pods and Supervisor Services are not available
initially. It expands afterwards in any order: add a load balancer (Avi or
Foundation), which unlocks vSphere Pods and Supervisor Services; scale the
control plane from 1 to 3 VMs for HA; add a second NIC to separate workload from
management traffic. An FQDN is mandatory for Supervisor access on this path too,
pointing at the floating IP when there is no load balancer, or at the VIP when
there is.

---

## 10. References

**VCF 9.1 Supervisor**

- [vSphere Supervisor Installation and Configuration (9.1)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsphere-supervisor-installation-and-configuration.html)
- [Supervisor Networking with Virtual Private Clouds](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsphere-supervisor-installation-and-configuration/supervisor-networking-with-virtual-private-clouds.html) — architecture, the NSX VPC workflow, Configure the Centralized Gateway, and Deploy a Supervisor with NSX VPC
- [vSphere Supervisor 9.1 Release Notes](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-service-administration-and-development/9-1/release-notes/vmware-vsphere-supervisor-release-notes.html) — the classic-NSX UI removal and the content-library change
- [Deploying Supervisor with a Simplified Deployment Flow](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsphere-supervisor-installation-and-configuration/deploying-easy-supervisor.html)
- [Connect to the Supervisor as a vCenter Single Sign-On User](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsphere-supervisor-installation-and-configuration/connecting-to-vsphere-with-tanzu-clusters/connect-to-the-supervisor-cluster-as-a-vcenter-single-sign-on-user.html) — the VCF CLI
- [Supervisor on a vSAN Stretched Cluster](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsphere-supervisor-installation-and-configuration/overview-of-running-vsphere-iaas-control-plane-on-vsan-stretched-cluster.html)
- [Troubleshooting the Supervisor](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsphere-supervisor-installation-and-configuration/troubleshooting-vsphere-with-kubernetes.html)

**Avi Load Balancer**

- [Avi Load Balancer for VCF 9.1](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/avi-load-balancer/avi-load-balancer-vmware-cloud-foundation/9-1.html) — including licence management and the 32.1.1 licence-format transition
- [Avi Load Balancer for VCF 9.0](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/avi-load-balancer/avi-load-balancer-vmware-cloud-foundation/9-0.html) — where the 9.1 Supervisor book sends you for the NSX + Avi procedure, including the Service Engine Group and NSX Cloud configuration and the documented limitations

**KBs**

- [KB 442187](https://knowledge.broadcom.com/external/article/442187/vks-guest-cluster-deployment-hangs-with.html) — cluster deployment hangs on Avi virtual-service placement
- [KB 406786](https://knowledge.broadcom.com/external/article/406786/vks-supervisor-enablement-stuck-at-confi.html) — enablement stuck at the workload-network step after an NSX restore
- KB 405115 / KB 406096 — Foundation LB naming conflict and the related upgrade timeout

**In this repo**

- [prerequisites.md → vSphere Supervisor](prerequisites.md#vsphere-supervisor-only-if-in-scope) — the planning-time input gate
- [06-deployment-plan.md](06-deployment-plan.md) — the E9 stories and their ordering
- [09-binary-depot.md](09-binary-depot.md) — the Software Depot that now feeds the VKS content library
