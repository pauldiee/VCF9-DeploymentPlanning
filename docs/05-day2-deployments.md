# Day-2 / Day-N Fleet Deployments

Not every fleet component has to go in at bring-up. In VCF 9 the management
domain comes up first, and a set of fleet components can be deployed **later**
as Day-2 (Day-N) operations, driven by VCF Operations fleet lifecycle. VCF
Automation in particular is commonly **skipped at bring-up and deployed Day-N**.

This page captures the planning decisions for those Day-2 deployments so the
networking, DNS, and IP prep is ready *before* the deployment runs — the same
"lock it first" idea as the Step 1 network plan. It maps to the workbook's
*Deploy Fleet Management Day-N* sheet.

> **Scope.** This page is the *fleet-management* components (VCF Automation, Log
> Management, Operations for Networks). The **other** kind of Day-N expansion —
> **adding workload domains and clusters** after bring-up, and **stretching**
> them — is covered in [`06-deployment-plan.md`](06-deployment-plan.md) (E9).
> Those SDDC Manager API specs (network pool, workload domain, cluster, vSAN
> stretch) can optionally be built, validated, and submitted with
> [**VCFJsonSpecCreators**](https://github.com/pauldiee/VCFJsonSpecCreators).

> Placeholders below use Rainpole-style values (`sfo.example.io`,
> `10.11.x.x`). Replace consistently. This is a planning checklist, not a
> step-by-step deployment guide — follow the Broadcom deployment guidance for
> the actual procedure.

---

## A. Decision gate — what goes in Day-2 vs. at bring-up?

| # | Question                                                            | Notes                                                                 |
| - | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
|D1 | Which fleet components are deployed at bring-up vs. Day-N?           | **VCF Operations, VCF Management Services (incl. the Identity Broker), the Cloud Proxy and the License Server are bring-up** — the Installer deploys them automatically, no opt-in (or defers Operations + Automation + cloud proxy + license server as a set for **custom network placement** — see C). VCF Automation can be deferred indefinitely; Log Management & Operations for Networks are often Day-N. The Identity Broker's Day-2 part is **configuration only** (AD binding / fleet SSO) plus any additional instance |
|D2 | Reuse an existing VCF Operations (fleet already has one)?           | VCF Operations itself is deployed **at bring-up** (deployment-plan epic E5, `06-deployment-plan.md`). `useExistingDeployment` connects an **additional** VCF instance to the fleet's existing Ops — no new appliances |
|D3 | Deployment **method** for VCF Automation?                           | Via **SDDC Manager API**, or via **VCF Operations** — see D            |
|D4 | Network placement: Shared Mgmt / Dedicated Mgmt / NSX Overlay Segment / NSX VLAN Segment / **NSX VPC subnet**? | Five options — see C. NSX Overlay needs an Edge cluster + transit gateway; **NSX VPC is not on the sheet and is API-only**. At Day-N *every* non-shared placement is API-only |
|D5 | Every Day-2 appliance has forward + reverse DNS and a reserved IP?  | Fleet Day-2 workflows run a synthetic check that must pass             |

Size the footprint of whatever you choose here on the
[sizing tool](https://vcf-planning.hollebollevsan.nl/tools/mgmt-sizing/)
(`04-sizing.md`) — the Day-2 components are the same optional components the
sizer models.

---

## B. The deployable set

Each of these can be added Day-N from the *Deploy Fleet Management Day-N* sheet.
Capture an FQDN + reserved IP for every appliance (nodes listed), plus the
network placement from section C.

| Component                     | Appliances / nodes                                             | Notes                                                        |
| ----------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------ |
| **VCF Operations**            | Primary, Replica, Data nodes (+ a **VIP** only if an external LB fronts the cluster — see B.1) | **Reuse / additional-instance case only** — a fleet's first VCF Operations is deployed **at bring-up** (see D2); `useExistingDeployment` connects an additional instance to it |
| **Cloud Proxy** (Ops collector)| One or more collector appliances                              | **Additional collectors only** — a unified cloud proxy is configured **by default at bring-up** by the VCF Installer. Stays on the VLAN / VM-mgmt side (`localRegion`) even for NSX-overlay placement |
| **License Server**            | One appliance                                                  | **Additional license server only** — the first one is deployed **automatically at bring-up**. Tied to VCF Operations |
| **VCF Automation**            | VCF Automation appliance(s) + **VCF services runtime** nodes   | Two deployment methods — see D. Needs a node **cluster CIDR** |
| **Identity Broker**           | Appliance mode: a **three-node cluster** ([TechDocs deployment modes](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/fleet-management/what-is/deployment-models-for-sso.html)) | **Additional instance only** — the first broker arrives **at bring-up** with the VCF Management Services (no opt-in; FQDN + services-runtime IP asked by the Installer). A Day-N **appliance-mode** broker is deployed via VCF Operations fleet management, e.g. to serve **up to five VCF instances** from one broker or to create a separate SSO boundary. Day-N work on the bring-up broker itself is configuration: identity provider (AD/LDAP), user/group provisioning |
| **Log Management** (formerly *VCF Operations for Logs* — renamed in 9.1) | Services-runtime **worker nodes** (6 IPs, +2 per extra replica — **allocated from the services-runtime block**) + cluster VIP (**integrated** LB — not external) | Node size + replica count (size it in `04-sizing.md`); size the Step 1 runtime block `/27` to absorb them |
| **VCF Operations for Networks**| Platform node + Collector node                                | Optional dual-stack (IPv4 / IPv6)                             |

### B.1 — VCF Operations load balancer is **external, never served by VCF**

This trips people up, so plan it up front. The VCF Operations analytics cluster
(Primary / Replica / Data) is reached two ways, and **only one of them involves a
load balancer**:

- **No load balancer (default).** There is **no built-in floating or cluster IP**
  for VCF Operations — you reach the cluster directly on the **node FQDNs**.
  Nothing extra to provision. Most deployments use this.
- **Load-balancer VIP (optional).** If you want a real load balancer in front of
  the analytics nodes, **VCF does not deploy or manage one for VCF Operations** —
  you must bring your own **external load balancer** (e.g. F5, or a *standalone*
  Avi/NSX ALB instance you run yourself). The load balancer is **never served
  from VCF**; VCF only records the VIP it points at. Per
  [Broadcom TechDocs](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/design/vmware-cloud-foundation-concepts/vcf-operations.html)
  both the HA and Continuous Availability models *"support an optional external
  load balancer."*

When you do use an external LB, plan for:

- an **extra IP + FQDN** for the VIP (on top of the per-node FQDNs/IPs), and
- **certificate SAN coverage** — every cluster node FQDN **and** the load-balancer
  FQDN must be in the certificate's Subject Alternative Names.

Where the setting lives: the *Deploy Management Domain* and *Deploy Fleet
Management Day-N* sheets carry an **optional "Load Balancer FQDN"** (+ IP) for
VCF Operations — leaving it empty means no LB (node FQDNs only); filling it is
the switch that says an external LB fronts the cluster. Decide it before you
request certificates (the SAN list depends on it).

> **Don't confuse this with Log Management.** The Log Management cluster has an
> **integrated** load balancer (its VIP is handled internally) — that one is not
> external. Nor is it the platform's own **Avi/NSX ALB**, which VCF *can* deploy
> and lifecycle-manage for **tenant / workload** load balancing — that is a
> different service from the LB that fronts VCF Operations itself.

---

## C. Network placement — the options

This is the decision behind the "VCF Automation on a VPC network" question. The
Day-N sheet offers **four** placements and a VPC is **not** one of them — but
that is a limitation of the sheet and the wizard, **not of the platform**, so
the table below carries **five**: the sheet's four, plus the **NSX VPC subnet**
(lab-verified, API-only — see the subsection after the table).

The first four line up
with the Broadcom design library's four *fleet-level components* network models
([Fleet-Level Components Networking Detailed Design](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/fleet-level-components-networking-detailed-design.html))
and the [custom-networking deployment guidance](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/deploying-vcf-operations-and-vcf-automation-on-custom-networking.html):

> **The Installer exposes this same choice at bring-up.** Plan → Network
> Options → Customize → *Management Components Custom Networking* **defers**
> VCF Operations + VCF Automation (plus their cloud proxy and license server);
> after bring-up you run the wizard's third deployment path — *Deploy deferred
> components* — to place them on the vDS / NSX segment you prepared. The
> SDDC Manager API / VCF Operations methods below achieve the same for Day-N.

| Placement (Day-N sheet)          | Design-library model                              | Where components land + key requirements                                                          |
| -------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Shared Management Network**    | Shared VLAN                                       | All fleet components on the **same** vDS port group as vCenter / NSX / SDDC Manager; VCF Automation from the `/29` (intake `B5`). Simplest, no new network. **No logical isolation** (NSX DFW can help); **not suited for DR** — failover testing unsupported. Multi-AZ: stretch the VLAN. |
| **Dedicated Management Network** | Dedicated VLAN                                    | Fleet components on a **separate, dedicated** vDS port group / VLAN — create it first. **Cloud Proxy stays on the VM-mgmt network.** Physical firewall can secure it; for DR/stretched the VLAN must be routable across AZs/regions (IP mobility). |
| **NSX Overlay Segment**          | Dedicated VLAN **+** NSX Overlay Segment (hybrid) | VCF management **services** on a VLAN; **VCF Operations, Automation, Ops-for-Networks, License Server** on an NSX **overlay** (Geneve) segment; **Cloud Proxy stays on VM-mgmt**. Needs an **NSX Edge cluster + Tier-0** (BGP to physical, advertise segments), a **Tier-1** linked to it, and the segment on the management overlay transport zone. |
| **NSX VLAN Segment**             | (VLAN-backed NSX segment)                          | Fleet components on an NSX **VLAN-backed** segment (NSX-managed, no overlay/Edge routing).          |
| **NSX VPC subnet** — **not on the sheet** | VPC-based patterns in the design library (DMZ VPC + Mgmt App VPC + Transit Gateway) | VCF Automation on an **NSX VPC subnet**. **Not offered by the Day-N sheet or the wizard** — deploy via the **Fleet LCM API** (section D). Create the VPC + subnet first and let it realise in vCenter, where it appears as an ordinary **distributed portgroup** with a MoRef. Use when you need VPC isolation or the DMZ / Transit Gateway pattern. **Lab-verified 2026-07-21.** See *NSX VPC — one of the non-management placements* below |

The sheet and the wizard offer no NSX VPC option — but the platform does
support it, via the API (below). The design
library adds a fifth, DR-oriented model — *Dedicated VLAN + NSX **Stretched**
Overlay Segment* — which stretches the overlay via **NSX Federation** with a
**Global Manager** (primary/secondary) so VCF Operations keeps its IP on
region failover (no DNS repoint); see the design library's
[stretched NSX overlay segment model](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/fleet-level-components-networking-detailed-design/fleet-level-components-on-stretched-nsx-overlay-segment-model.html).

The point of the non-shared options is to **separate user-facing networks from
management networks** for regulatory / security requirements.

> **At Day-N, every non-shared placement is API-only.** Lab-verified
> 2026-07-21: the Day-N *Add VCF Automation* wizard (Fleet LCM, via VCF
> Operations) has **no network picker at all** — it asks only for the services
> runtime nodes CIDR and the FQDNs, and always uses the management network. So
> **Dedicated Management Network, NSX Overlay Segment, NSX VLAN Segment and NSX
> VPC alike** have to be deployed through the **Fleet LCM API** once the fleet is
> up. Section D has the procedure; it applies to all four, not just the VPC.
>
> **The exception is the deferred-components path.** The **VCF Installer**'s
> third deployment path — *Deploy deferred components*, unlocked by the
> *Management Components Custom Networking* toggle at bring-up (see the callout
> above) — **does** place VCF Operations + VCF Automation onto a prepared vDS /
> NSX segment from a UI. That is a different wizard at a different point in the
> lifecycle. If you know the placement up front, that route avoids the API
> entirely; decide it **before** bring-up rather than after.

### NSX VPC — one of the non-management placements

The **first four** placements in the table are what the **Day-N sheet and the
deployment wizard** offer. They are not the limit of what the platform supports:
**VCF Automation can be placed on an NSX VPC subnet** — the fifth row — and
Broadcom's own design library builds patterns on exactly that.

A VPC is not a special case mechanically — per the callout above, **all** the
non-shared placements go through the same Fleet LCM API at Day-N. What makes the
VPC worth its own section is that it is the one placement the sheet does not
list at all, so there is nowhere else to record the decision.

From [VCF Automation instance types — deployment](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/vcf-automation-deployment-models-9-x/vcf-automation-instance-types/deployment.html):

> *"To provide an additional layer of network isolation, this deployment pattern
> also uses a second VPC for the VCF Automation instances."*
> *"The DMZ VPC accommodates external facing services (like load balancers) and
> serves as a security barrier between the Internet and the internal application
> network."*
> *"The Transit Gateway routes traffic between the two VPCs and to the upstream
> network, enabling safe channels of communication."*
> *"Provider Admin can apply east/west firewall on the Mgmt App VPC to protect
> access to VCF Automation appliances."*

So the shape is a **DMZ VPC** for external-facing services, a **Mgmt App VPC**
for the VCF Automation appliances, and a **Transit Gateway** routing between
them and upstream — with east/west firewalling available on the app VPC.

**How you actually deploy it:** through the **Fleet LCM API**, exactly like the
other non-management placements — the VPC subnet is referenced by its
`networkMoId` like any portgroup. See *Deploying VCF Automation to a
non-management network — API only* in section D for the full procedure.

> **Lab-verified 2026-07-21.** VCF Automation deployed onto an NSX VPC subnet
> via the Fleet LCM API: validation passed, the node VMs landed on the VPC
> portgroup, the cluster came up and the Provider Management UI serves at
> `/provider`. Budget generous time — the platform returns `404`, then `500`,
> before it finally answers, and that progression is normal rather than a fault.

> **Choosing between them.** If a VPC is not a requirement, one of the four
> sheet placements is the lower-friction path — they are wizard-driven, and the
> workbook has fields for them. Reach for a VPC when you need its isolation or
> the DMZ/Transit Gateway pattern above, and accept the API-only deployment
> route that comes with it.

**Common prerequisites** (all placements): the initial VCF fleet / instance
deployment is complete; component binaries downloaded to VCF Installer; load
balancer deployed if used; every appliance FQDN resolves to a **unique** IP
(dual-stack: both A and AAAA). The **NSX Overlay** path additionally needs the
Edge cluster, Tier-0 (BGP), Tier-1, and overlay segment above; the **Dedicated**
path needs the dedicated port group + VLAN created first.

For any non-shared placement, the sheet splits the network into `localRegion`
(the VLAN side — Ops collectors / Cloud Proxy) and `xRegion` (Ops + Automation),
and asks for:

| Field         | Example / value                                    | Notes                                             |
| ------------- | -------------------------------------------------- | ------------------------------------------------- |
| networkName   | `xregion-vcfa-net`                                 | Overlay-segment / network name                    |
| subnet mask   | `255.255.255.0`                                    | Segment subnet                                    |
| gateway       | `10.11.40.1`                                       | Segment gateway                                   |
| IP pool       | `10.11.40.11 – .20` (5+)                           | Node IP pool (5+ addresses)                       |
| internal cluster CIDR | `198.18.0.0/15` (default; or `240.0.0.0/15` / `250.0.0.0/15`) | VCF Automation **internal** services-runtime node network — `internalClusterCidrIpv4`, set via the **fleet lifecycle API / JSON spec only** (not a wizard field) |
| nodes CIDR / IPs | `/29` (5 IPs) on **VM Management** — see the note below | Routable node addresses; the wizard's *VCF services runtime nodes CIDR*. **Must not overlap** the VCF management-services runtime range |
| DNS (A + PTR) | `sfo-vcfa01.sfo.example.io`                        | Forward + reverse for every appliance             |

> The **cluster CIDR** is the VCF Automation services-runtime *internal* node
> network — pick one of the sheet's reserved ranges (`198.18.0.0/15` default)
> and keep it distinct from every routed subnet in the Step 1 plan.

> **Two different CIDRs — don't confuse them (#190).** VCF Automation has
> **both**, and only one of them appears in the *Add VCF Automation* wizard:
>
> | | What | Where you set it |
> | --- | --- | --- |
> | **Nodes CIDR** (routable) | A dedicated block on the **VM Management** subnet for the Automation nodes — the wizard's **VCF services runtime nodes CIDR** field. Both Automation FQDNs resolve **outside** it | *Add VCF Automation* wizard |
> | **Internal cluster CIDR** | `198.18.0.0/15` (or `240.0.0.0/15` / `250.0.0.0/15`) — platform-internal, never routed | **API / JSON spec only** — `internalClusterCidrIpv4` via the **fleet lifecycle API**. Not exposed in the wizard |
>
> The wizard showing no internal-CIDR field is expected — it defaults. Override
> it only when `198.18.0.0/15` clashes with something you actually route, and
> then you must do it through the API.

---

## D. VCF Automation — deployment method

The Day-N sheet's method dropdown ("Select Option") offers three choices;
capture which one, as they ask for different inputs:

| Option (verbatim from the sheet)         | Deploys                         | Key inputs                                                   |
| ---------------------------------------- | ------------------------------- | ------------------------------------------------------------ |
| **Exclude**                              | Nothing (not deployed Day-2)    | —                                                            |
| **Deploy VCF Operations and Automation** | Both, via **SDDC Manager API**  | `localRegion` + `xRegion` networks, IP pools, cluster CIDR   |
| **Deploy VCF Automation**                | Just Automation, via **VCF Operations** | Installation type (**New** or **Import 8.x appliance**), VCF instance, VCF services-runtime nodes CIDR, FQDNs |

Both deploy paths need: VCF Automation FQDN, VCF services-runtime FQDN, node
prefix, the node IP pool, and the admin password. Decide the method and the
network placement (section C) together.

> **Size *is* the deployment model — they are not separate choices.** TechDocs
> [VCF Automation Models](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/vcf-automation-deployment-models.html):
> the **Simple** model is *"Single node. Applies to small appliance size"* and
> **High Availability** is *"Three node cluster. Applies to medium or large node
> sizes"*. A small deployment *"can be scaled out to the high availability model
> by resizing the node to Medium or Large, which automatically scales the
> deployment out to 3 nodes."*
>
> | Size | Nodes | Model |
> | --- | --- | --- |
> | `small` | 1 | Simple |
> | `medium` | 3 | High Availability |
> | `large` | 3 | High Availability |
>
> This is why the Fleet LCM payload carries only `"size"` and has no HA flag —
> there is nothing else for it to key off. Capture the **size**; the model and
> node count follow from it. Note this also means **you cannot have a
> large single node**, nor a small HA cluster.

> **That services-runtime FQDN is Automation's own — a second one.** TechDocs'
> [FQDN/IP list](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/vcf-components-fqdns-and-ip-addresses/first-vcf-instance-fqdns-and-ip-addresses.html)
> carries *"VCF services runtime — 1 FQDN"* **twice**: once under **VCF
> Automation** (this one — intake `E10`, on a discrete IP **outside** the
> Automation `/29` node range) and once under **VCF Management Services** (the fleet runtime
> created at bring-up — intake `E14`). The workbook repeats the same field
> label the same way. Plan and create **both** A + PTR records; using the
> bring-up fleet FQDN here is a common and confusing failure.

> **Both Automation FQDNs must resolve *outside* the CIDR you provide.** The
> *Add VCF Automation* → **Parameters** step states it inline: *"VCF Automation
> FQDN and VCF services runtime FQDN must resolve to IP addresses that fall
> outside of the provided CIDR."* Lab-confirmed that the **VCF services runtime
> nodes CIDR** field takes a routable **`/29` from the VM Management subnet** —
> so that `/29` covers the **nodes only** (IP-only, no DNS records) and the two
> FQDNs each need their **own discrete VM Mgmt IP on top of it**. Budget
> **`/29` + 2**, and see `01-network-dns-plan.md`.

### Deploying VCF Automation to a non-management network — API only

**The Fleet LCM UI can only place VCF Automation on the management network.**
It also only accepts a **CIDR** for the node addresses, so the smallest legal
input is a `/29` — 8 addresses for a component that needs 5. Placing VCFA on
anything else (a VLAN portgroup, an NSX overlay segment, an **NSX VPC subnet**)
is **API-only**, and the API additionally accepts an explicit list of 5 IPs.

> **Credit.** The API approach, endpoints and payload shape below are William
> Lam's, from [VCF 9.1 — Deploying VCF Automation (VCFA) to non-Management
> Network](https://williamlam.com/2026/06/vcf-9-1-deploying-vcf-automation-vcfa-to-non-management-network.html)
> and his `fleet_lcm_deploy_vcf_automation_to_different_network.ps1`.

**What failure looks like if you try it through the UI.** The bootstrap aborts
at pre-validation:

```
A pre-validation prevented the bootstrap: VCF services runtime FQDN is not on
the management network.
A pre-validation prevented the bootstrap: Not all addresses from the VCF
Management Services IPv4 pool are part of the management network range, which
is from <first> to <last>.
Failed to bootstrap VCF services runtime of type 'CONSUMPTION'.
```

Read that carefully: it is **not** saying your placement is unsupported. It is
saying the fleet is validating against the **management** range — because the
deployment network was never *declared*, and the fields that declare it **do
not exist in the UI**. `CONSUMPTION` is the Automation runtime (as opposed to
the management-services one).

#### Step 0 — the target network must already exist

**Create the NSX VPC subnet or overlay segment first, and let it realise.** The
API takes a *reference* to an existing network (`networkMoId`) — it does not
create one. Nothing downstream works until the network exists **and** vCenter
can see it:

1. **Create the network in NSX** — an **NSX VPC** (its default subnets are
   created for you) or an **overlay segment** on a transport zone the management
   cluster is attached to. Note its **gateway address and prefix** while you are
   there; you need it verbatim later.
2. **Confirm it reached vCenter.** NSX pushes segments to vCenter as
   distributed portgroups, and there is a short lag. Until it appears in
   *vCenter → Networking*, it has no MoRef and cannot be referenced.
3. **Check reachability** from the target network back to SDDC Manager,
   vCenter and VCF Operations. Pre-validation does **not** test this, so a
   one-way route or a missing firewall rule surfaces late, mid-deployment.
4. **Create the DNS records** — A + PTR for both Automation FQDNs, resolving
   onto this network and **outside** the 5-address pool. Pre-validation *does*
   resolve them, so they must exist before you start.

#### Step 1 — get the `networkMoId`

A PowerCLI one-liner is enough:

```powershell
Get-VDPortgroup -Name "vm-default-<hash>" |
    Select-Object Name, @{N='MoRef'; E={$_.ExtensionData.MoRef.Value}}
```

`Get-VirtualPortGroup -Name "<name>"` works too. The value looks like
`dvportgroup-58` — that string is what goes into `networkMoId`.

Without PowerCLI, select the portgroup in the vSphere Client and read the MoRef
out of the browser address bar (`.../dvPortgroup/dvportgroup-58/summary`).

> **NSX VPC default subnets** are named `vm-default-<hash>` and
> `pod-default-<hash>`. The **`vm-default`** one is the VM-facing subnet — that
> is the one to target. They appear as ordinary `DISTRIBUTED_PORTGROUP` entries
> alongside your VLAN portgroups.

#### Step 2 — the fields that declare the network

In `vspClusterSpec`:

| Field | Meaning |
| --- | --- |
| `networkMoId` | vSphere MoRef of the target network, e.g. `dvportgroup-58`. A `Get-VirtualPortGroup` one-liner is enough to find it |
| `gatewayCidrIpv4` | The **gateway address with prefix**, e.g. `172.30.70.1/24` — not the network address |
| `ipv4Pool.addresses` | **Exactly 5** explicit IP addresses — minimum 5, maximum 5, no CIDR |

**The APIs involved** — note the **two different hosts**:

| Call | Purpose |
| --- | --- |
| `POST https://<vcfms-runtime>/api/v1/identity/token` | Auth (form-urlencoded, `grant_type=password`) |
| `GET https://<fleet-lcm>/fleet-lcm/v1/sddc-lcms` | Resolve `sddcLcmId` from the VCF instance name |
| `POST https://<fleet-lcm>/fleet-lcm/v1/components/validations` | Validate the spec |
| `POST https://<fleet-lcm>/fleet-lcm/v1/components` | Deploy |
| `GET https://<fleet-lcm>/fleet-lcm/v1/tasks/{id}` | Poll either task |

Authentication happens on the **VCF management-services runtime**; everything
else on the **fleet lifecycle** appliance. Swapping the two is the most likely
first-run failure.

The token account is **`admin@vsp.local`** — the local admin of the VCF services
runtime (**VSP** = VCF Services Platform, the name that also shows up in the
*"Bootstrap VCF Services Platform"* task). It is **not** vSphere SSO and **not**
the VCF Operations login, and it has no reveal API — it comes from the bring-up
record or gets rotated.

> **Watch the right task list.** An API-initiated deployment appears under
> **SDDC lifecycle**, not Fleet lifecycle where the UI-driven tasks show up:
> **Build → Tasks → VCF Instances → \<instance\>**, as *"Creating VSP Cluster …
> in domain \<domain\>"* / *"Bootstrap VCF Services Platform"*. Looking in the
> Fleet lifecycle list makes a perfectly healthy deployment look like it never
> started.

**Two prerequisites that fail before networking is even reached:**

- **Depot.** The Fleet Depot Service must have synced the VCFA binaries
  **including the VCD Migration Engine** component, or the deployment fails on
  missing binaries whatever the network looks like.
- **New deployments only.** Upgrades of an existing Aria Automation 8.x or VCF
  Automation 9.0.x/9.1.x reuse the network VCFA is already on — this path does
  not move an existing deployment.

#### The script

You do not have to hand-craft the payload — William Lam publishes a script that
does validate-then-deploy, with a `$ValidateOnly` switch that defaults to `$true`.

| Copy | When to use it |
| ---- | -------------- |
| [**GitHub — `lamw/vmware-scripts`**](https://github.com/lamw/vmware-scripts/blob/master/powershell/fleet_lcm_deploy_vcf_automation_to_different_network.ps1) | **Always prefer this.** The canonical, maintained copy |
| [Mirror on this site](https://vcf-planning.hollebollevsan.nl/scripts/fleet_lcm_deploy_vcf_automation_to_different_network.ps1) | Air-gapped or restricted networks that cannot reach GitHub. **Frozen at 2026-07-21** — it does not track upstream |

> **Not our script.** `fleet_lcm_deploy_vcf_automation_to_different_network.ps1`
> is **© 2022 William Lam**, redistributed unmodified under the **BSD 2-Clause
> Licence** ([full text](https://vcf-planning.hollebollevsan.nl/scripts/LICENSE-lamw-vmware-scripts.txt)).
> The mirrored copy adds only a provenance header carrying the copyright notice,
> the upstream URL and the SHA-256 of the pristine file, so it can be verified
> against the original. Everything else in this table of scripts is ours; this
> one is not — please credit William, not this project.

Run it with `$ValidateOnly = $true` first, and set `$OutputJsonPayload = $true`
to inspect the payload before anything is sent — note that the printed payload
contains the passwords in cleartext.

> **Verification status (2026-07-21).** Confirmed in the lab through three
> stages: the validation task returned `SUCCEEDED`, the deployment task was
> accepted and progressed, and **the bootstrap VM appeared in vCenter attached
> to the target VPC portgroup** — which is the stage that actually proves the
> placement was honoured rather than merely accepted. **End-to-end completion of
> the deployment was not yet confirmed when this was written** (#192).

---

## E. DNS / IP checklist (additive to Step 1)

On top of `01-network-dns-plan.md`, for every Day-2 appliance you deploy:

- [ ] Forward (A) + reverse (PTR) DNS for each node / VIP FQDN
- [ ] Reserved IP outside any DHCP scope
- [ ] If NSX Overlay: Edge cluster + centralized transit gateway + Tier-1 (Active/Standby) and the segment exist
- [ ] VCF services-runtime **cluster CIDR** does not overlap any Step 1 subnet
- [ ] Passwords captured with the other fleet credentials (intake section F)
- [ ] The synthetic check prerequisites (DNS/NTP/reachability) are in place

If VCF Automation is going on a **non-management** network (section D):

- [ ] Both Automation FQDNs have A + PTR **before** you start — the
      pre-validation resolves them
- [ ] Both resolve onto the **target** network, outside the 5-address pool
- [ ] The VPC subnet / overlay segment **exists in NSX and is visible in
      vCenter** — it has no MoRef until it has realised there
- [ ] `networkMoId` captured for that network (`Get-VDPortgroup`)
- [ ] `gatewayCidrIpv4` is the **gateway address with prefix**
- [ ] The `admin@vsp.local` password is to hand (no reveal API)
- [ ] Fleet Depot Service has synced VCFA binaries **incl. VCD Migration Engine**
- [ ] Return path from the target network to SDDC Manager / vCenter / VCF
      Operations is open — pre-validation does **not** check it

---

## F. Ownership matrix

| Area                                             | Owner               | Sign-off |
| ------------------------------------------------ | ------------------- | -------- |
| Which components Day-2 vs bring-up (A)            | Architect           |          |
| Network placement (Shared / Dedicated / NSX Overlay / NSX VLAN) (C) | Network + Architect |          |
| Non-shared network CIDR, gateway, pools (C)      | Network             |          |
| VCF Automation method (D)                        | Platform + Architect|          |
| Day-2 FQDNs + PTR records (E)                    | AD/DNS/NTP          |          |
| Appliance passwords (E)                          | Platform / Security |          |

---

## G. Helper scripts

Once the fleet is up, SDDC Manager is the system of record for the accounts it
provisions and rotates across each workload domain. When you need a managed
component's *current* password — to log into an ESXi host directly, to hand an
auditor the service-account inventory, or to confirm a rotation actually took —
read it back from the API rather than hunting through the interface. **Download
the script and run it** (Windows PowerShell 5.1 or PowerShell 7; it prompts for
whatever you don't pass):

| Script | What it does |
| ------ | ------------ |
| [**Get-VCFCredentials.ps1**](https://vcf-planning.hollebollevsan.nl/scripts/Get-VCFCredentials.ps1) | **Read-only.** Lists the credentials SDDC Manager stores and rotates for its managed components (ESXi, vCenter, NSX Manager/Edge, PSC/SSO, backup) via `GET /v1/credentials`. Filters by resource / account / credential type. Passwords are **masked on screen by default** — `-ShowPasswords` reveals them, `-ExportCsv <path>` writes the full inventory. Changes nothing |

```console
.\Get-VCFCredentials.ps1 -SDDCManager sddc01.sfo.example.io -ResourceType ESXI -SkipCertificateValidation
```

> **The VCF Management side is different — those passwords cannot be read.** The
> management-plane accounts (VCF Operations, Automation, VCF services runtime)
> are handled by VCF Operations' *Password Management*, which **rotates and
> tracks expiry** but has **no reveal function** — there is no API that returns
> those plaintext passwords. If you need one of those secrets, rotate it to a
> known value; you cannot retrieve the existing one.
>
> The same script can still **inventory** those accounts (component, username,
> account type, expiry — no secrets) with `-VCFOps`, taking a `-Credential` just
> like the SDDC Manager mode. It reads them from an internal, unsupported VCF
> Operations API (`/suite-api/internal/passwordmanagement`) that Broadcom may
> change between builds.

---

## Sign-off

Once A–G are filled and signed, feed the results back into the single-AZ
planning docs and the workbook:

- Day-2 FQDNs + IPs → the DNS section of `01-network-dns-plan.md`
- Non-shared placement network → the VLAN/subnet table in `01-network-dns-plan.md`
- Decisions + method → intake `A17` / `E15` / `B21` in `02-intake.md`
- All values → the *Deploy Fleet Management Day-N* sheet (see
  `workbook-cell-mapping.md`)
