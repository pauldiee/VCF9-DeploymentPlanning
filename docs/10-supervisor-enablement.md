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
| 5 | [Content libraries for Supervisor and VKS images](#5-content-libraries-for-supervisor-and-vks-images) | **Two libraries** — one is a hard prerequisite to enablement |
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

### 1.1 The networking paths, and which one this page follows

There are **three** networking models for a Supervisor in 9.1, and the VPC model
splits again into two Transit Gateway modes — so four practical paths:

**1. VPC + Centralized Transit Gateway** — UI-driven. **Covered on this page.**
Needs a Tier-0 with outside connectivity and an **Edge cluster**. Load balancer:
Avi, or the NSX Edge load balancer.

**2. VPC + Distributed Transit Gateway** — UI-driven. See
[§9.1](#91-distributed-transit-gateway).
Needs a VLAN-backed network with outside connectivity and a **VNA cluster**, and
no Edge cluster at all. Load balancer: Avi, or the built-in VPC/VNA one.

**3. Classic NSX segment networking** — **API only in 9.1**. See
[§9.2](#92-classic-nsx-segment-networking-api-only-in-91).
Needs an Edge cluster and Tier-0, plus pod / ingress / egress CIDRs. Load
balancer: Avi, or the NSX Edge load balancer.

**4. vDS networking** — UI-driven. See [§9.3](#93-vds-networking).
No NSX; distributed port groups instead. Load balancer: the **Foundation Load
Balancer**, or Avi.

The **Simplified ("Easy") flow** ([§9.4](#94-simplified-easy-supervisor)) is a
*deployment flow*, not a fifth networking path — it cuts the starting
configuration down and expands afterwards.

Within VPC networking, the two Transit Gateway modes are **[documented]**:

- **Centralized** — "attaches the Transit Gateway to a Tier-0 Gateway"; "uses the
  Tier-0 networking capabilities and services like BGP and requires an Edge
  Cluster".
- **Distributed** — "directly connects to the VLAN of the datacenter without
  requiring additional configuration on the physical environment"; requires a
  **VNA cluster**; "scales out as you add hosts".

A Transit Gateway must be **all-centralized or all-distributed, never mixed**
**[documented]**.

#### The word "centralized" is ambiguous — resolve it before you build

Paths 1 and 3 both get called *centralized* in conversation, and they are not the
same thing:

**Centralized Transit Gateway (CTGW)** is a *connectivity mode of VPC
networking*. The Transit Gateway attaches to a **Tier-0 on an Edge cluster**
instead of to a VNA — but it is still VPC networking, and still the VPC wizard.
Fully supported and UI-driven in 9.1.

**Classic NSX Segment Networking** is the pre-9 model: pod / ingress / egress
CIDRs, a Tier-1 per namespace, Edge LB or Avi. The wizard field reads *Networking
Stack: NSX*. **Removed from the vSphere Client UI in 9.1 — API only.**

They look alike from a distance — both want an Edge cluster and a Tier-0, and
both are "the one with the Edges" — but they use different wizards, different
CIDR models, and in 9.1 only one of them has a wizard at all. Verbatim, from the
vSphere Supervisor 9.1 release notes **[documented]**:

> "Starting with VCF 9.1, the vSphere Client UI no longer supports deploying a
> Supervisor with classic NSX Segment Networking. Deployment remains fully
> supported through the API."

**This page documents path 1, the CTGW path.** If you need classic NSX segment
networking, go to [§9.2](#92-classic-nsx-segment-networking-api-only-in-91)
first — the plan changes materially.

### 1.2 Load balancer — you may not need Avi

Supervisor activation requires *a* load balancer, not specifically Avi. On the
VPC path the prerequisite reads **[documented]**:

> Optionally install and configure the Avi Load Balancer; the **NSX Edge load
> balancer is used if NSX does not detect the Avi Load Balancer**.

And the choice is exclusive **[documented]**:

> "You can use either the VCF Native Load Balancer or the Avi Load Balancer."

> "You can only use one load balancer. If the Supervisor is configured with the
> VCF Native Load Balancer, a VPC using the Avi Load Balancer cannot be used."

So Avi is opt-in, it is *detected* rather than configured in the Supervisor
wizard, and it is **one or the other** — committing the Supervisor to the native
load balancer rules Avi out for VPCs under it, which is a decision to make before
activation rather than after. Choose it only when you have a reason — an existing Avi estate, L7
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

*Sources: [Supervisor architecture with VPC networking][arch] · [Supervisor 9.1 release notes][relnotes] · [Supervisor on a vSAN stretched cluster][stretched]*

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
- [ ] If Avi via **VCF Operations**: the required post-deploy config is done —
      an **SE management network built on NSX and selected in the Avi cloud** (the
      NSX Cloud connector goes **red** until it is — *"management transport zone ''"*),
      **vCenter registered** on the cloud for SE placement, and the **Service
      Engine Group Default-Group** with a **storage policy**
      ([§4.5](#45-post-deploy-configuration-vcf-ops-path--what-is-left-to-do)).
      IPAM is **not** required in VPC — the VIP comes from the **VPC External IP
      Block** ([§3.3](#33-the-ip-blocks-and-the-16-question))
- [ ] If Avi: the certificate is correct **for your deployment model** — on
      **VCF-Ops-managed** Avi, VCF Operations generated it and the NSX cloud
      connector is **green** (do not touch it by hand); on **standalone** Avi, you
      created it with CN + SAN matching the endpoint you give Supervisor
      ([§4.4](#44-the-controller-certificate--cn-and-san))
- [ ] **Supervisor Images content library created and assigned** — a hard
      prerequisite: since VCF 9 the Supervisor release images ship separately
      from vCenter ([§5.1](#51-the-supervisor-images-library--the-one-you-need-first))
- [ ] **VCF Software Depot configured in vCenter** — this is what the libraries
      subscribe to, and what auto-creates the VKS library at first enablement
      ([§5.2](#52-the-vks-library--for-guest-clusters-afterwards))
- [ ] **The depot actually holds the content** — a separate question from whether
      the depot is configured, and the usual cause of a library that syncs but is
      empty. Check the **SUPERVISOR** path first, then **VKR**
      ([§5.4](#54-offline-depot-configured-is-not-the-same-as-populated))

*Sources: [Deploy a Supervisor with NSX VPC][deploy-vpc] · [Requirements for Supervisor deployment with NSX (9.0)][req-nsx90] · [Supervisor architecture with VPC networking][arch]*

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

> **The HA modes are not a free choice, and the two layers differ.** Verbatim
> **[documented]**: "VCF 9.1 supports a tier-0 gateway in **Active/Active**
> configuration and a Centralized Transit Gateway in **Active/Standby**
> configuration with the required stateful services such as NAT for the
> Supervisor." The Transit Gateway is active/standby because it carries stateful
> services; the Tier-0 beneath it is active/active. If someone reports "the
> Tier-0 had to be rebuilt as active/standby", that is the *classic NSX segment*
> path or a different design constraint — it is not this one.

Per Edge node uplink: gateway interface **VLAN**, gateway interface **CIDR**,
**BGP peer IP**, **BFD** toggle, **MTU** (valid range 1600–9000), **BGP peer
ASN**, and **BGP peer password**.

> Get the BGP peer password and ASN from the network team **in writing** before
> the day. A silent BGP session is the single most common reason this stage
> stalls, and the peer side is rarely yours to inspect.

### 3.3 The IP blocks, and the /16 question

Two blocks are configured here **[documented]**:

- **VPC External IP Blocks** — "Advertised CIDRs that allow outside connectivity
  to VPC workloads". These must be routable and advertised upstream. **With Avi in
  VPC mode this block is also the load-balancer VIP source** — Avi IPAM is not used
  in VPC, so the Supervisor API VIP and every LoadBalancer Service VIP come from
  here. Size it for the VIPs you expect, and make sure it exists and has free
  space *before* activation (see [§4.5](#45-post-deploy-configuration-vcf-ops-path--what-is-left-to-do)).
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

*Sources: [Configure the Centralized Gateway][ctgw] · [Supervisor architecture with VPC networking][arch]*

---

## 4. Avi Load Balancer (only if used)

Skip entirely if you are using the built-in NSX Edge load balancer.

> **First, decide *which Avi* you are running — this changes everything below.**
> There are two deployment models, and most of this section's manual steps apply
> to only one of them:
>
> - **VCF-Operations-managed Avi (the 9.1 default).** VCF Operations deploys the
>   Controller cluster and owns its **whole lifecycle** — service-account
>   creation, the NSX cloud connector, **Supervisor registration**, and
>   **certificate generation and trust propagation to NSX Manager and vCenter**
>   **[documented — 9.1 Avi release notes]**. On this model you do **not** set the
>   VIP in NSX, do **not** register with NSX by hand, and do **not** replace the
>   certificate in the Avi UI. The NSX tab *System → Appliances → Avi Load
>   Balancer* is the *NSX-native* deploy path — expect it to stay empty, and do
>   not click *Set Virtual IP* / *Add Avi Load Balancer* there or you start a
>   second, conflicting Controller. Deploy from **VCF Operations → Build →
>   Lifecycle → VCF instances → Manage Components**.
> - **Standalone / NSX-native Avi.** You deploy the Controller yourself and wire
>   it up by hand. **§4.2–§4.5 below are written for this model.** They come from
>   the 9.0 "Supervisor with NSX and Avi" book, which is the current documentation
>   for the manual path.
>
> **The trap that follows from mixing them:** on a VCF-Ops-managed Controller,
> **replacing the certificate manually in the Avi UI breaks the trust from NSX**,
> and re-importing the thumbprint by hand does **not** reliably restore it
> **[field-reported; consistent with the "managed by VCF Operations" banner NSX
> shows]**. If you have already done it, the clean recovery is to **revert to the
> original VCF-Ops-generated certificate** (it presents the thumbprint NSX and
> vCenter already trust); if that cert object is gone, re-drive the certificate
> **through VCF Operations**, which regenerates and re-propagates the chain. Only
> TLS certs signed by **VMCA, Microsoft CA, or OpenSSL** are auto-renewable this
> way **[documented]**. Do the cert lifecycle in VCF Operations, never in the Avi
> or NSX UI, whenever VCF Operations deployed the Controller.

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

### 4.4 The Controller certificate — CN and SAN

> **Standalone Avi only.** On a **VCF-Operations-managed** Controller, VCF
> Operations already generated this certificate and propagated its trust to NSX
> and vCenter — **do not create or replace it here**; doing so breaks NSX trust
> (see the callout at the top of [§4](#4-avi-load-balancer-only-if-used)). The
> steps below are for the standalone path, where you supply the cert yourself.

**You must give the Controller a custom certificate before you activate the
Supervisor** — and the fields on that screen are easy to fill in wrong, because
the one that matters is not the obvious one. Verbatim **[documented]**:

> "You must provide a custom certificate to enable Supervisor. You cannot use the
> default certificate."

> "If you use a private Certificate Authority (CA) signed certificate, the
> Supervisor deployment might not complete and the Avi Load Balancer
> configuration might not be applied."

So a **self-signed** Controller certificate is the low-risk path for enablement;
a private-CA-signed one can make the deployment hang with the Avi side silently
unapplied. Create it in the Controller dashboard under **Templates → Security →
SSL/TLS Certificates → Create → Controller Certificate**.

**Common Name** — the fully-qualified name clients use to *reach the Controller*,
not the Supervisor and not a wildcard. The doc: "this entry must match the
hostname that the client entered in the browser" **[documented]**.

- **Single-node Controller** → the Controller VM's management FQDN
  (e.g. `avi01.sfo.example.io`).
- **3-node cluster** → the **cluster VIP** FQDN, never an individual node.

**Subject Alternate Name (SAN) — this is the field that actually gates
activation.** It must contain the address you later type into the Supervisor
wizard as the Avi Controller endpoint. Verbatim **[documented]**: "Enter the
cluster IP address or FQDN, or both, of the Avi Load Balancer Controller … it
must match the IP address or FQDN that you specify during deployment."

> **The rule that keeps you out of trouble:** whatever value you give Supervisor
> as the Controller endpoint must appear in the certificate's **SAN**. The docs
> explicitly allow "or both", so put **both the FQDN and the IP** in the SAN and
> you cannot mismatch it — for a single node use its FQDN + IP, for a cluster use
> the VIP FQDN + VIP IP.

Algorithm **EC** is recommended (2048-bit if RSA); add the SAN entries, enter the
cluster IP/FQDN, **Validate**, then **Save**. You reference this certificate again
when you configure the Supervisor to enable Supervisor Management — it is not a
throwaway.

> Source is the **9.0** Avi book (the 9.1 Supervisor book points at it by
> design); the certificate flow is unchanged in 9.1.

### 4.5 Post-deploy configuration (VCF-Ops path) — what is left to do

VCF Operations deploys the Controller, creates the service account, generates the
certificate and propagates its trust, and wires the base cloud connector and
Supervisor registration **[documented — 9.1 Avi release notes]**. That leaves a
**short, required** list of Avi-side configuration you still do by hand before
activation — and a longer set of steps that are **optional** and often mistaken
for mandatory because a popular field walkthrough includes them.

> **Verify before you build.** VCF Operations does "cloud connector setup", so
> parts of the NSX cloud may already exist. Open **Infrastructure → Clouds** and
> **Templates → IPAM/DNS Profiles** and check what is already there before
> hand-creating anything — verify-then-fill, do not blind-rebuild.

**Required — the gate for a working Supervisor load balancer:**

1. **Prepare a management network on NSX for the Service Engines — this is the
   piece people miss** **[documented; field-verified 2026-07-23]**. The SE
   management NICs need their own network, and **VCF Operations does not create
   it** — it leaves the NSX Cloud connector's *Management Network* blank for you
   to fill, because it cannot guess which segment your SEs should sit on. Two
   parts:
   - **On NSX, build the segment first.** A **management transport zone** plus an
     **overlay segment behind a Tier-1** (or a **VLAN-backed segment**), with an
     **IP pool / allocation** for the SE management NICs. This does not exist until
     you make it.
   - **In Avi, select it on the cloud.** **Infrastructure → Clouds →** the NSX
     cloud **→ Management Network →** pick that transport zone + segment + IP
     allocation. Until this is set the cloud sits **red** with the tell-tale
     *"Configured management transport zone '' of type ''"* (empty quotes = never
     set), and **no Service Engines can deploy** — which surfaces at activation as
     the load-balancer step stalling (*"Unable to acquire IP address for network"*,
     KB 442187). The empty-quotes state is a *missing-config* error, not a
     trust/cert error — a cert problem shows as a connection/auth failure instead.
   - **You do not configure the data network** — "Because the VPC handles the Data
     Network Segment, you do not need to configure it" **[documented]**.
2. **The NSX Cloud connector, in VPC mode — confirm vCenter and the template SE
   group** **[documented]**. Beyond the management network above, verify the cloud
   has a **vCenter registered for SE placement** (where the SE *VMs* land — the
   workload cluster; VCF Ops usually sets this, but confirm it), and set the
   **Template Service Engine Group** on the cloud. **Infrastructure → Clouds**.
3. **The Service Engine Group — configure the Default-Group as the template**
   **[documented]**. "vSphere Supervisor uses the Default-Group as a template to
   configure a Service Engine Group per Supervisor … If no template Service Engine
   Group is configured in the cloud, the Default-Group is used." Set the **vSphere
   storage policy** (SEs are VMs — no policy, nowhere to deploy), placement, HA
   mode and scaling **before** activation — AKO clones it per Supervisor and will
   not retro-apply later changes (see [§4.3](#43-service-engine-group--set-it-before-activation)).

> **IPAM is NOT required for VPC networking** **[documented]** — an earlier draft
> of this guide listed a placeholder IPAM profile as mandatory; that is wrong for
> the VPC path. The VPC-specific docs state plainly *"IPAM profiles are: Not
> required for VPC networking"*, because **the VIP comes from the VPC External IP
> Block, not from Avi IPAM**. That External IP Block is therefore a real
> pre-activation dependency — it is the VIP source — and it lives in the **VPC
> connectivity profile you build in [§3.3](#33-the-ip-blocks-and-the-16-question)**,
> not in the activation wizard (the wizard only *selects* it; an empty *VPC
> Connectivity Profile* dropdown means it was never built). The generic *Getting
> Started* page's "placeholder IPAM" line applies to non-VPC clouds.

**Optional — skip for a basic Supervisor:**

- **DNS profile + an Avi DNS listener virtual service + external DNS delegation**
  to the Avi VIP — only if you want Avi as a DNS provider or you need GSLB. A
  Supervisor VIP is reached by IP, so none of this is required to activate.
- **The VCF Operations Avi Management Pack** — monitoring/observability
  integration; useful, not a Supervisor prerequisite.
- **The single-node feature flag** (SSH to SDDC Manager) — only if you are
  deliberately deploying a single-node Controller instead of a cluster.

> **The short version:** SE management network on NSX (built there, selected in the
> Avi cloud) + confirm vCenter + Service Engine Group Default-Group with a storage
> policy. VIPs come from the VPC External IP Block ([§3.3](#33-the-ip-blocks-and-the-16-question)),
> not IPAM. Everything else a fuller walkthrough shows is done for you by VCF
> Operations or optional.

*Post-deploy config sources: [Configure the NSX Cloud connector (Avi 9.1)][avi-nsxcloud] · [Getting Started with Avi (9.1)][avi-gettingstarted] · [Amaya Citta — VKS 9.1 with Avi and NSX VPC][amaya-vks] (the fuller manual walkthrough, incl. the optional DNS/GSLB steps)*

### 4.6 Documented limitations that bite

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

*Sources: [Avi for VCF 9.1 — licence management][avi-lic] · [Avi for VCF 9.1 — deploy from VCF Operations][avi-vcfops] · [Avi for VCF 9.1 — release notes][avi-relnotes] · [Install and configure NSX and Avi (9.0)][avi-install] · [Configure the Service Engine Group][avi-seg] · [Limitations of using Avi][avi-limits] · [Amaya Citta — VKS 9.1 with Avi and NSX VPC][amaya-vks]*

---

## 5. Content libraries for Supervisor and VKS images

**There are two libraries, not one, and only one of them is a prerequisite to
enablement.** Conflating them is easy and expensive, so keep them apart:

| Library | Holds | Needed |
| ------- | ----- | ------ |
| **Supervisor Images** | Supervisor release images (spherelet + Supervisor OVA) | **Before enablement** |
| **VKS** | Kubernetes releases for VKS guest clusters | After — auto-created at first enablement when the depot is configured |

### 5.1 The Supervisor Images library — the one you need first

This is the answer to "what do I need before I can deploy a Supervisor at all".
Verbatim **[documented]**:

> "You can use a subscribed content library for Supervisor enablement and
> upgrade. Starting from VCF 9, the Supervisor releases can be delivered
> separately from vCenter."

That last clause is the change worth internalising: **in VCF 9 the Supervisor
release images no longer ship inside vCenter**. They come from a content library
you point at the Software Depot.

**Get the subscription URL** — Developer Center → **API Explorer** → GET
**`lcm/depot/services`**, then assemble **[documented]**:

```
https://{VcenterLcmDepotServicesAddress}{base_url}/PROD/COMP/SUPERVISOR/lib.json
```

Note the path component: **`SUPERVISOR`**, not `VKR`. That single word is the
difference between the two libraries.

**Create it** — Content Libraries → Create → **Subscribed Content Library** →
subscription URL → sync mode (*Immediately* or *When needed*) → accept the SSL
thumbprint → datastore → Finish.

**Assign it** — **Supervisor Management → Content Distribution → Supervisor
Images Library → Assign**, then select the library **[documented]**. This is a
different screen from where the VKS library is attached
([§5.2](#52-the-vks-library--for-guest-clusters-afterwards)).

> **Do not delete or edit a library while it is assigned.** Verbatim: "Do not
> attempt to delete or edit the content library that is assigned with the
> Supervisor release images. You must unassign the Supervisor release images
> before you attempt to delete or edit the content library." **[documented]**

### 5.2 The VKS library — for guest clusters, afterwards

This is the one the 9.1 release notes describe, and it is **not** a prerequisite
to enablement **[documented]**:

> "Starting with VCF 9.1, the public CDN (wp-content.vmware.com or
> wp-content.broadcom.com) is no longer used to create the default VKS content
> library. Only on vCenter instances where VCF Software Depot is configured in a
> VCF or VVF deployment, the default VKS content library is automatically created
> based on the VCF Software Depot endpoint upon the first Supervisor enablement
> in vCenter."

So with the depot configured you do **not** build this one by hand — it is
created automatically, from the depot endpoint, at first enablement. Building it
manually is the fallback for a deployment without the Software Depot: the depot
path is `.../PROD/COMP/VKR/lib.json`, and without a depot the documented URL is
`https://wp-content.broadcom.com/v2/latest/lib.json` **[documented]**.

**Association:** Supervisor Management → Supervisors → select the Supervisor →
**Configure → General → Kubernetes Service** → **Add** (or *Remove*). Requires
vSphere 9.0+ and VKS 3.3+ **[documented]**. Scope, verbatim:

> "The same content library is used for all vSphere Namespaces on a Supervisor
> instance. For this reason, changing the content library is only allowed at the
> Supervisor level."

Per-Supervisor rather than per-namespace, multiple libraries supported, and
changeable after activation — unlike most choices in this guide, this one is not
one-shot.

> **Two constraints** **[documented]**: do not add the VKS content library to the
> **VM Service** tile; and if a library is deleted from vCenter while still linked
> to VKS, remove the link before other operations will succeed.

### 5.3 Air-gapped: publish locally, and fix the item type

For a full air-gapped site there is a documented publisher flow — build a
**local, published** library on a connected side, then subscribe to it from the
air-gapped vCenter **[documented]**:

> "In a full air-gapped environment, where direct internet access is restricted,
> you must first download the vSphere Supervisor release artifacts on a separate,
> internet-connected host and then manually upload and publish the artifacts in a
> content library in your secure environment."

1. From a connected machine, download the full Supervisor release bundle
   including `lib.json` from `https://wp-content.broadcom.com/supervisor/v1/latest/`.
   The artifacts are spherelet folders per Kubernetes version (v1.28, v1.29,
   v1.30, …) containing `spherelet-depot-<version>.zip`,
   `spherelet-solution-<version>.json`, and the Supervisor OVA parts
   (`.mf`, `.ovf`, `.cert`, `.vmdk`).
2. In the secure environment: Content Libraries → Create → **Local content
   library**, **enable publishing**, set the OVF security policy, pick a
   datastore.
3. Import the items — **lowest version number first** — then the matching OVA
   files.
4. **Fix the item type, or the assign will fail.** Verbatim: "Manually uploaded
   Spherelet artifacts are marked as type file, which causes the Supervisor
   assign operation to fail. To fix this, the item type must be changed to type
   other by using the DCLI tool." **[documented]**
5. On the library, open the **Publication** card and copy the **subscription
   URL**; subscribe to it from the vCenter(s) that need it.

> Step 4 is the one that ambushes people — everything uploads cleanly, the
> library looks healthy, and the assign fails with nothing pointing at item type.

### 5.4 Offline depot: configured is not the same as populated

**The most likely way to end up with a library that syncs cleanly and contains
nothing.** A configured Software Depot gives you the plumbing; it does not follow
that the depot holds the content.

- The offline-depot documentation describes what it downloads as "VCF component
  binaries and ESX component data" and "installation, upgrade binaries, ESX
  binaries, and metadata" — with **no mention** of Supervisor, VKS or Kubernetes
  release images anywhere **[documented, by absence]**.
- Practitioners report that in 9.1 the download tool **does not retrieve the
  Supervisor OVA or the Kubernetes release artifacts**, with a fix expected in
  **9.1.1** **[field-reported]**.

So treat "does the depot actually contain the content?" as its own pre-flight
question. **Check before activation:** fetch the depot `lib.json` for the
**SUPERVISOR** path first (that is the one that blocks enablement), then the
**VKR** path, and confirm each lists items. An empty response is your answer, and
it is far cheaper to find now. If it is empty, either use the air-gapped
publisher flow in [§5.3](#53-air-gapped-publish-locally-and-fix-the-item-type) or
the community script that walks `lib.json` / `items.json`.

> **Credit:** the offline-depot content gap and the download-script workaround
> were documented by the community ahead of the vendor — see
> [Amaya Citta on VKS and Supervisor content libraries with an offline depot](https://amayacitta.co.uk/vcf-9-1-vks-supervisor-content-libraries-with-offline-depot/)
> and [William Lam on HTTP offline depot support in 9.1](https://williamlam.com/2026/05/vcf-9-1-new-http-offline-depot-support-for-vcf-installer-fleet-depot-service.html).

> **A synced library is not a populated one.** Check the item count and that a
> release is actually listed — not just that the sync reported success.

> **It also blocks teardown.** "Supervisor disablement fails and remains stuck in
> a removing phase if an associated Content Library cannot be deleted"
> **[documented]** — delete the content-library usage association via REST.

*Sources: [Supervisor 9.1 release notes][relnotes] · [Configure a subscribed content library for Supervisor images][cl-sup] · [Create a vCenter publisher for the Supervisor releases library (air-gapped)][cl-airgap] · [Create a subscribed content library (VKS)][cl-create] · [Add or update VKS content libraries on a Supervisor][cl-edit]*

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

> **The wizard never asks about content libraries** — which is exactly why the
> Supervisor Images library catches people out. It is assigned beforehand, on a
> different screen (*Supervisor Management → Content Distribution*), so there is
> nothing here to remind you. See [§5.1](#51-the-supervisor-images-library--the-one-you-need-first).

Activation then performs "deployment of control plane VMs, ESX host configuration
as Kubernetes nodes, virtual IP preparation on the load balancer, and core
Supervisor Services deployment" **[documented]**. Status moves through
**Configuring** to **Running** in the Workload Management Supervisor table
(*config status* and *host config status* columns).

*Sources: [Deploy a Supervisor with NSX VPC][deploy-vpc] · [NSX VPC workflow for Supervisor][workflow]*

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

*Sources: [Connect to the Supervisor as a vCenter SSO user][vcf-cli] · [Troubleshooting the core Supervisor][ts-core]*

---

## 8. Field notes

### Failure signatures worth recognising

Each entry is **what you see** followed by **what it is**. All are
**[documented]** in release notes or KBs except where marked otherwise.

**Enablement halts at "Configured Supervisor Control plane VM's Workload
Network".** `eth1` is never configured on the Supervisor nodes, and CoreDNS shows
one pod in CrashLoopBackOff with two Pending.
→ `nsx-ncp` is stuck in "Restore mode" after a previous NSX Manager restore, so
the workload segment is never created. Patch `ncpconfig nsx-restore-status` with
the NSX `restore_end_time` and restart nsx-ncp. (KB 406786)

**Cluster provisioning hangs, and a direct `curl` to the control-plane VM
succeeds.** Logs show *"call timeout expired … http2: client connection lost"*;
Avi raises *"Unable to acquire IP address for network"*.
→ The load balancer, not the Supervisor — the successful `curl` is the tell.
Create a new Service Engine Group and reassign the virtual service to it.
(KB 442187)

**Stuck on the load-balancer step** with *"Configured Load Balancer fronting the
Kubernetes API Server — Timed out waiting for LB service update"*.
→ A Foundation LB instance naming conflict when more than one Supervisor exists
in a single vCenter. (KB 405115)

**Load balancer service traffic fails** when the endpoints sit outside the VPC.
→ A documented 9.1 issue; the workaround is to configure auto-SNAT.

**vSphere Namespace creation fails against a 9.1 NSX.**
→ NSX 9.1 introduces the `cidr_list` parameter on IPBlock while a 9.0 Supervisor
still consumes the old `cidr`. A version mismatch, not a misconfiguration — stop
re-checking your CIDRs.

**Re-enabling a Supervisor on a previously decommissioned cluster fails.**
→ Documented, and the workaround is to build a new cluster. Decommissioning is
one-way for this purpose.

**Deployment never completes at the transit-gateway stage.**
→ Suspect the private transit-gateway block size — see
[§3.3](#33-the-ip-blocks-and-the-16-question). **[field-reported]**

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

*Sources: [Supervisor 9.1 release notes][relnotes] · [KB 442187][kb442187] · [KB 406786][kb406786] · [Troubleshooting the core Supervisor][ts-core]*

---

## 9. The other networking paths

### 9.1 Distributed Transit Gateway

Same VPC wizard and the same Supervisor activation — only [§3](#3-build-the-centralized-transit-gateway)
is replaced. Everything from [§4](#4-avi-load-balancer-only-if-used) onward
(Avi, content library, activation, validation, field notes) applies unchanged.

**What it is** **[documented]**:

> "The Distributed Transit Gateway does not require Edge Nodes, dynamic routing,
> or any specific configuration on the physical network."

> "It allows a distributed model which scales out as you add hosts since traffic
> directly goes from the host to the VLAN."

**What it needs instead of an Edge cluster and Tier-0** **[documented]**:

> "A VPC with a Distributed Transit Gateway requires a VLAN available on all ESX
> hosts spanned by the Transit Gateway and connected VPCs."

That VLAN requirement is the one to check early — it must be present on **every**
host the Transit Gateway and its VPCs span, which on a stretched or multi-cluster
domain means every host on both sites.

**Where the VNA fits.** Not everything is distributed **[documented]**:

> "Services like DHCP or the ability to expose a workload with an external IP
> (1:1 NAT) are also distributed."

> "For networking services like Load Balancer or outbound SNAT, the Virtual
> Network Appliance (VNA) is used."

> "The VNA is multi-tenant and the same VMs can be used for multiple namespaces
> and multiple VCF Automation Organizations."

So DHCP and 1:1 NAT run distributed on the hosts, while **load balancing and
outbound SNAT land on the VNA** — which is therefore in the data path for
anything egressing by SNAT or fronted by the built-in load balancer. Size and
place it accordingly; being multi-tenant, one cluster serves multiple namespaces
and Automation organizations.

**Configuration fields** — the VNA cluster is configured in the **VPC
connectivity profile**; gateway type is **Distributed Connection**
**[documented]**:

| Scope | Fields |
| ----- | ------ |
| VNA cluster | Cluster name, **form factor**, then ADD one or more VNA nodes |
| Per VNA node | Node name, target cluster, resource pool, datastore, management network IP assignment (DHCP or static), management port group |
| External connectivity | **VLAN ID** (0–4094); Gateway CIDR — "must be the same as the VLAN configured for the external router" |
| IP blocks | **External IP Blocks**; **Private - Transit Gateway IP Blocks** |

The same two IP blocks as the centralized path, so the sizing caveat in
[§3.3](#33-the-ip-blocks-and-the-16-question) applies here too.

> **Not documented:** minimum VNA node count, form-factor sizing guidance, and
> the VLAN attachment detail for the VNA cluster itself. The configuration page
> states none of these. Plan for a cluster rather than a single node on anything
> production, and confirm the form factor against the release notes for your
> build.

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

*Sources: [Configure the Distributed Transit Gateway][dtgw] · [Supervisor architecture with VPC networking][arch] · [Deploying Supervisor with a simplified flow][easy] · [Requirements for simplified deployment][easy-req] · [Requirements for Supervisor deployment with NSX (9.0)][req-nsx90]*

---
## 10. References

Each section above ends with a compact **Sources** line naming the exact pages
behind it. This section is the consolidated list — the books to start from when
you need something this page does not cover.

**VCF 9.1 Supervisor** — [Installation and Configuration][book] is the root.
Within it: [Supervisor networking with VPC][vpc-book] (architecture, the
workflow, both Transit Gateway wizards, and the activation wizard),
[connecting to clusters][vcf-cli] (the VCF CLI),
[the stretched-cluster overview][stretched], and [troubleshooting][ts].
The [9.1 release notes][relnotes] carry the two changes that invalidate older
procedures — the classic-NSX UI removal and the content-library move off the
public CDN.

**Avi Load Balancer** — the [9.1 book][avi91] for licence management and the
32.1.1 licence-format transition; the [9.0 book][avi90] for the NSX + Avi
procedure itself, the Service Engine Group and NSX Cloud configuration, and the
documented limitations. The 9.1 Supervisor book points at the 9.0 book by design,
not by oversight.

**Classic NSX segment networking (9.0 sources)** — [requirements][req-nsx90] and
the [three-zone wizard walkthrough][nsx-wizard90]. These are the current
documentation for that path even in 9.1; see [§9.2](#92-classic-nsx-segment-networking-api-only-in-91).

**KBs** — [442187][kb442187] (deployment hangs on Avi virtual-service placement),
[406786][kb406786] (enablement stuck at the workload-network step after an NSX
restore), and KB 405115 / KB 406096 (Foundation LB naming conflict and the
related upgrade timeout).

**In this repo** — [prerequisites.md → vSphere Supervisor](prerequisites.md#vsphere-supervisor-only-if-in-scope)
is the planning-time input gate, [06-deployment-plan.md](06-deployment-plan.md)
carries the E9 stories and their ordering, and [09-binary-depot.md](09-binary-depot.md)
covers the Software Depot that now feeds the VKS content library.

<!-- Link definitions for the per-section Sources lines. Keep alphabetical. -->

[arch]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsphere-supervisor-installation-and-configuration/supervisor-networking-with-virtual-private-clouds/supervisor-architecture-with-vpc-networking.html
[avi-install]: https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/avi-load-balancer/avi-load-balancer-vmware-cloud-foundation/9-0/deploying-supervisor-with-nsx-and-avi-load-balancer/install-and-configure-nsx-and-nsx-advanced-load-balancer.html
[avi-lic]: https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/avi-load-balancer/avi-load-balancer-vmware-cloud-foundation/9-1/build-and-deploy-avi-91/license-management-for-avi-load-balancer.html
[avi-limits]: https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/avi-load-balancer/avi-load-balancer-vmware-cloud-foundation/9-0/deploying-supervisor-with-nsx-and-avi-load-balancer/install-and-configure-nsx-and-nsx-advanced-load-balancer/install-and-configure-the-nsx-advanced-load-balancer-for-nsx/limitations-of-using-the-nsx-advanced-load-balancer.html
[avi-seg]: https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/avi-load-balancer/avi-load-balancer-vmware-cloud-foundation/9-0/deploying-supervisor-with-nsx-and-avi-load-balancer/install-and-configure-nsx-and-nsx-advanced-load-balancer/install-and-configure-the-nsx-advanced-load-balancer-for-nsx/configure-service-engine-group.html
[avi-gettingstarted]: https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/avi-load-balancer/avi-load-balancer-vmware-cloud-foundation/9-1/overview/getting-started-with-avi.html
[avi-nsxcloud]: https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/avi-load-balancer/avi-load-balancer-vmware-cloud-foundation/9-1/build-and-deploy-avi-91/configure-the-cloud-connector-for-the-nsx-cloud.html
[avi-relnotes]: https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/avi-load-balancer/avi-load-balancer-vmware-cloud-foundation/9-1/release-notes/vmware-avi-load-balancer-for-vcf-91-release-notes.html
[avi-vcfops]: https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/avi-load-balancer/avi-load-balancer-vmware-cloud-foundation/9-1/build-and-deploy-avi-91/deploy-avi-load-balancer-from-vcf-operations.html
[amaya-vks]: https://amayacitta.co.uk/vks-9-1-with-avi-load-balancer-and-nsx-vpc/
[avi90]: https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/avi-load-balancer/avi-load-balancer-vmware-cloud-foundation/9-0.html
[avi91]: https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/avi-load-balancer/avi-load-balancer-vmware-cloud-foundation/9-1.html
[book]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsphere-supervisor-installation-and-configuration.html
[cl-create]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-service-administration-and-development/9-1/managing-vsphere-kubernetes-service/administering-kubernetes-releases-for-tkg-service-clusters/create-a-subscribed-content-library.html
[cl-edit]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-service-administration-and-development/9-0/managing-vsphere-kubernetes-service/administering-kubernetes-releases-for-tkg-service-clusters/edit-an-existing-content-library.html
[cl-airgap]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/vsphere-supervisor-installation-and-configuration/updating-vsphere-supervisor/updating-the-vsphere-with-tanzu-environment/configuring-a-subscribed-content-library-for-supervisor-images-in-air-gapped-environment/create-a-vcenter-publisher-for-supervisor-releases-content-library.html
[cl-sup]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsphere-supervisor-installation-and-configuration/updating-vsphere-supervisor/updating-the-vsphere-with-tanzu-environment/create-a-supervisor-asynchrounious-releases-content-library.html
[ctgw]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsphere-supervisor-installation-and-configuration/supervisor-networking-with-virtual-private-clouds/nsx-vpc-workflow-for-supervisor/configure-the-centralized-gateway.html
[deploy-vpc]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsphere-supervisor-installation-and-configuration/supervisor-networking-with-virtual-private-clouds/deploy-a-supervisor-with-nsx-vpc.html
[dtgw]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsphere-supervisor-installation-and-configuration/supervisor-networking-with-virtual-private-clouds/nsx-vpc-workflow-for-supervisor/configure-the-distributed-transit-gateway.html
[easy]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsphere-supervisor-installation-and-configuration/deploying-easy-supervisor.html
[easy-req]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsphere-supervisor-installation-and-configuration/deploying-easy-supervisor/requirements-for-simplified-supervisor-deployment.html
[kb406786]: https://knowledge.broadcom.com/external/article/406786/vks-supervisor-enablement-stuck-at-confi.html
[kb442187]: https://knowledge.broadcom.com/external/article/442187/vks-guest-cluster-deployment-hangs-with.html
[nsx-wizard90]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/vsphere-supervisor-installation-and-configuration/deploying-supervisor-with-nsx-networking/deploy-a-thee-zone-supervisor-with-nsx-t-data-center-networking.html
[relnotes]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-service-administration-and-development/9-1/release-notes/vmware-vsphere-supervisor-release-notes.html
[req-nsx90]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/vsphere-supervisor-installation-and-configuration/deploying-supervisor-with-nsx-networking/requirements-for-cluster-supervisor-deployment-with-nsx.html
[stretched]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsphere-supervisor-installation-and-configuration/overview-of-running-vsphere-iaas-control-plane-on-vsan-stretched-cluster.html
[ts]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsphere-supervisor-installation-and-configuration/troubleshooting-vsphere-with-kubernetes.html
[ts-core]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsphere-supervisor-installation-and-configuration/troubleshooting-vsphere-with-kubernetes/troubleshooting-core-supervisor.html
[vcf-cli]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsphere-supervisor-installation-and-configuration/connecting-to-vsphere-with-tanzu-clusters/connect-to-the-supervisor-cluster-as-a-vcenter-single-sign-on-user.html
[vpc-book]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsphere-supervisor-installation-and-configuration/supervisor-networking-with-virtual-private-clouds.html
[workflow]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsphere-supervisor-installation-and-configuration/supervisor-networking-with-virtual-private-clouds/nsx-vpc-workflow-for-supervisor.html
