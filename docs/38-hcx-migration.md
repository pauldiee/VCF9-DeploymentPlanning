# HCX Migration from a Legacy Environment to VCF 9.1 — Build Guide

This guide sets up **VCF Operations HCX** to move workloads from an existing
("legacy") vSphere or VCF environment into a **VCF 9.1** instance. It covers
the version rules, deploying HCX on both sides, connecting the two sites
(site pair and service mesh), stretching legacy networks into NSX, picking a
migration type per workload, and taking HCX down when the move is finished.

HCX in VCF 9 is a VCF component (*VCF Operations HCX*, the **9.x** branch).
The destination side is deployed and managed from VCF Operations, like Avi Load
Balancer ([`14-avi-load-balancer.md`](14-avi-load-balancer.md)). The legacy side
is still a manual OVA install.

> **Evidence level:** sourced from Broadcom TechDocs (the *VCF Operations HCX*
> user guide for VCF 9.1, pages last updated 2026-10-29, and the VCF 9.1
> release notes), Broadcom KB articles and Broadcom's own *Workload Mobility
> with VCF Operations HCX 9.1* blog series, read on 2026-11-04. **Not lab- or
> field-verified in this repo.** Where a step comes from the blog series rather
> than TechDocs, it says so. HCX changes quickly between releases, so re-check
> the [Interoperability Matrix][interop] and the release notes before you start.

---

## The sequence, end to end

1. [Check the fit and the versions](#1-check-the-fit-and-the-versions): HCX 9.x on **both** sides
2. [Understand the pieces](#2-understand-the-pieces): managers and service mesh appliances
3. [Plan: IPs, DNS, networks, sizing, firewall](#3-plan-ips-dns-networks-sizing-firewall)
4. [Deploy HCX on the VCF 9.1 side (from VCF Operations)](#4-deploy-hcx-on-the-vcf-91-side)
5. [Deploy HCX on the legacy side (OVA)](#5-deploy-hcx-on-the-legacy-side)
6. [Licensing: the legacy side inherits](#6-licensing-the-legacy-side-inherits)
7. [Site pair, profiles and service mesh](#7-site-pair-profiles-and-service-mesh)
8. [Extend networks](#8-extend-networks)
9. [Choose a migration type per workload](#9-choose-a-migration-type-per-workload)
10. [Run the migration waves](#10-run-the-migration-waves)
11. [Decommission HCX](#11-decommission-hcx)
12. [Known issues and field notes](#12-known-issues-and-field-notes)

Steps 1–3 are planning, and belong in the same meeting as the
[network / DNS plan](01-network-dns-plan.md): HCX needs its own IPs on both
sides and firewall flows between the sites.

---

## 1. Check the fit and the versions

### 1.1 Both sides run HCX 9.x

VCF 9.1 is built for the HCX **9.x** branch. Two Broadcom KBs set the rules:

- **HCX 4.x and vCenter 9.1 don't mix.** vCenter 9.1 has a new Envoy-based
  gateway with strict certificate checks. HCX 4.x appliances (including
  4.11.x) present certificates it rejects, and the `vmware-envoy-hgw` service
  crashes. Upgrade HCX Manager and every service mesh appliance to 9.1 or later
  **before** upgrading vCenter to 9.1
  ([KB 450437](https://knowledge.broadcom.com/external/article/450437/vmware-hcx-compatibility-and-upgrade-req.html)).
- **HCX 4.10.x / 4.11.x can't pair with HCX 9.x.** Verbatim: *"HCX may allow
  Site Pairs to be created between HCX 4.10.x/4.11.x versions and HCX 9.x
  versions, but it is not supported. There is no guardrail in the software to
  prohibit this configuration."*
  ([KB 427904](https://knowledge.broadcom.com/external/article/427904)).
  **The UI won't stop you**, so check the version on both managers before you
  pair.

In practice: the legacy side gets an HCX **9.x** Connector too, even when its
vCenter is old. If the legacy side already runs HCX 4.x (for an earlier
migration, or a VMware Cloud on AWS pairing), upgrade it first or replace it.

### 1.2 Upgrading an existing HCX 4.x

Upgrade paths from the [Interoperability Matrix][interop] (HCX, captured
2026-10-01):

| Current version | Direct to 9.1.1? |
| --- | --- |
| 4.10.x | No. Go to 4.11.x first |
| 4.11.0 – 4.11.2 | No. Hop through 4.11.3+ or 9.0.x / 9.1.0.x |
| 4.11.3 – 4.11.5 | Yes |
| 9.0.x | Yes |

After one side is on 9.1.x, every paired appliance must be on HCX 9.0 or
later. Plan the hops for **both** sites, then confirm the path for your exact
build in the matrix on the day.

### 1.3 Source and destination requirements

From [VCF Operations HCX Installations][installs] and
[Software Version Requirements][swreq]:

| | Legacy side (source) | VCF 9.1 side (destination) |
| --- | --- | --- |
| vSphere | *"vSphere versions within Technical Guidance or newer"* | Generally available and the latest version |
| NSX | Not required, except to extend NSX networks | Required (part of VCF) |
| Licence | None needed locally (see [§6](#6-licensing-the-legacy-side-inherits)) | *"must be licensed for VMware Cloud Foundation 9.0 and later"* |
| Starts the tunnels | **Yes**: the source IX and NE are always the tunnel initiators | No |

There is no fixed oldest version: anything still in Broadcom's *Technical
Guidance* support phase can be a source. Look up your legacy vCenter on the
[Product Lifecycle][lifecycle] page and confirm the pair in the
[Interoperability Matrix][interop] (product **VCF Operations HCX**). The
TechDocs pages link KB 82702 for evacuating older versions, but that link
returned 404 on 2026-11-04.

### 1.4 Out of scope: VMware Cloud on AWS

VMware Cloud on AWS doesn't support HCX 9.x. If the environment also pairs with
VMware Cloud on AWS, that pairing stays on HCX 4.x, and KB 450437 says not to
upgrade the on-premises vCenter to 9.1 until Broadcom ships a supported
combination. Settle this before the VCF 9.1 migration is planned.

---

## 2. Understand the pieces

| Piece | Where | What it does |
| --- | --- | --- |
| **HCX Manager (destination)**, often called *HCX Cloud Manager* | VCF 9.1 domain, deployed from VCF Operations | Target of the site pair; registered with that domain's vCenter and NSX |
| **HCX Manager (source)**, often called *HCX Connector* | Legacy vCenter, deployed from the OVA | Starts the site pair, network extensions and migrations |
| **HCX-IX** (Interconnect) | Both sides, deployed by the service mesh | Migration and replication traffic, tunnelled between the sites |
| **HCX-NET-EXT** (Network Extension) | Both sides, deployed by the service mesh | Layer 2 extension of legacy networks into NSX |
| **HCX-WAN-OPT** | Optional, both sides | WAN optimisation for the IX traffic |
| **HCX-SGW / HCX-SDR** | Source / destination, only for OS Assisted Migration | Moves guests from non-vSphere sources |

Both managers come from the **same OVA**; the role depends on where and how it
is installed.

### 2.1 9.1 changes the appliance architecture

The VCF 9.1 release notes, verbatim: *"Support for self-managed PhotonOS
appliances in VCF Operations HCX is deprecated as of version 9.1.0."* The IX
and NE appliances move to an NSX Edge-based stack, and *"an automated
migration workflow is introduced in HCX 9.1 to move PhotonOS appliances to the
NSX Edge architecture."* Full removal is targeted for VCF 10.0.0
([What's new: VCF Operations 9.1][whatsnew]).

What this means for you:

- A **new** service mesh built on 9.1 gets the new architecture. You only need
  the migration workflow if you carry an older mesh across.
- The *Migrate Service Mesh* workflow fails when the source appliances run
  9.0.x and the targets run 9.1.0 (*"only service meshes with photon backing
  appliances are applicable for transition"*). Broadcom will fix it in a later
  9.1 release; the workaround is a service mesh re-sync
  ([KB 449280](https://knowledge.broadcom.com/external/article/449280/hcx-migrate-service-mesh-fails-when-sour.html)).

---

## 3. Plan: IPs, DNS, networks, sizing, firewall

### 3.1 Names and addresses

Per site:

- [ ] One **HCX Manager** FQDN and IP, with forward and reverse DNS records
      created **before** the deploy. The VCF Operations wizard checks the
      record exists.
- [ ] An **IP range per network profile** (see 3.2) big enough for every IX,
      NE, WAN-OPT and standby NE appliance you plan, plus spare for a
      redeploy.
- [ ] NTP and DNS reachable from both managers.

Example values, Rainpole-style: `hcx01.sfo.rainpole.io` on the VCF 9.1 side,
`hcx01.lax.rainpole.io` on the legacy side, management ranges
`10.11.10.60-10.11.10.69` and `10.12.10.60-10.12.10.69`.

### 3.2 Network profiles

Each site defines network profiles that the service mesh appliances plug into:

| Profile | Carries | Notes |
| --- | --- | --- |
| **Management** | Appliance management, and by default everything else not split out | Must reach the HCX Manager, vCenter and ESX management |
| **Uplink** | The tunnels between the sites | Must reach the other site's uplink addresses; can reuse management on a flat network |
| **vMotion** | vMotion to and from the local hosts | Must reach the ESX vMotion VMkernel ports |
| **vSphere Replication** | Bulk and RAV replication traffic | Optional; falls back to management when not set |
| **Guest Network** | OS Assisted Migration only | Must reach the guests being migrated |

Set the MTU on each profile to match the network it sits on. The uplink path
between the sites usually has the smallest MTU (a WAN or VPN), so check it end
to end.

### 3.3 Sizing

Per appliance, from [System Requirements][sysreq]:

| Appliance | vCPU | Memory | Disk |
| --- | --- | --- | --- |
| HCX Manager | 4 | 12 GB | 60 GB |
| HCX-IX | 8 | 6 GB | 6.5 GB |
| HCX-NET-EXT | 8 | 3 GB | 6.5 GB |
| HCX-WAN-OPT | 16 | 32 GB | 172 GB |
| HCX-SGW (source) / HCX-SDR (destination) | 8 | 8 GB | 17.5 GB |

Count the appliances on **both** sides:

- One IX covers all the clusters in a service mesh by default. Scale out by
  adding service meshes.
- NE scales per vSphere Distributed Switch or NSX transport zone. **NE HA**
  needs at least two NE appliances per switch or zone (one active, one
  standby), and the standby counts toward capacity.
- Destination datastores must be VMFS5, VMFS6, NFS 3, NFS 4.1, or vSAN (OSA or
  ESA). vVols aren't supported for Replication Assisted vMotion.

### 3.4 Firewall flows

The authoritative list is the [Ports and Protocols portal][ports] (product
**VCF Operations HCX**; 9.1.0 has 71 rows and 9.1.1 has 50, so pick your
version). The picture shows the flows below per site; the table is the
reference.

[![HCX firewall flows between the legacy side and the VCF 9.1 side: source HCX Manager to destination HCX Manager on 443 for the site pair, IX and NE uplink tunnels on UDP 4500 started by the source, optional UDP 4500 to 4628 for Application Path Resiliency, and per site HCX Manager to vCenter, NSX and ESX, IX to ESX vMotion on 8000, ESX to IX on 902, 31031 and 32032, and on the VCF 9.1 side HCX Manager to the VCF Identity Broker and License Server](../web/public/diagrams/hcx-firewall-flows.png)](../web/public/diagrams/hcx-firewall-flows.svg)

The flows that most often need a change request:

| Source | Destination | Port(s) | Proto | Purpose |
| --- | --- | --- | --- | --- |
| Source HCX Manager | Destination HCX Manager | 443 | TCP | Site pairing |
| Source IX / NE (uplink) | Destination IX / NE (uplink) | 4500 | UDP | Tunnels (IKEv2) |
| Source IX / NE | Destination IX / NE | 4500–4628 → 4500 | UDP | Application Path Resiliency (optional) |
| HCX Manager | vCenter, NSX Manager, ESX | 443 | TCP | Integration, service mesh deployment |
| HCX Manager | ESX | 80, 902 | TCP | Service mesh deployment |
| HCX-IX | ESX vMotion IPs | 8000 | TCP | vMotion |
| ESX | HCX-IX | 902, 31031, 32032 | TCP | Migration and replication |
| HCX Manager (VCF 9.1 side) | VCF Identity Broker, License Server | 443 | TCP | VCF SSO, licensing |
| Management workstations | HCX Manager | 443, 9443, 22 | TCP | UI, appliance management, SSH |

Because the source starts the tunnels, the inbound rule sits on the **VCF 9.1
side's** perimeter. Add these flows to your copy of
[`07-firewall-ports.md`](07-firewall-ports.md) §G.

---

## 4. Deploy HCX on the VCF 9.1 side

The 9.1 release notes add lifecycle management of VCF Operations HCX to VCF
Operations, with two TechDocs procedures: *Deploy VCF Operations HCX* and
*Import Existing VCF Operations HCX to a VCF Domain*
([What's new: VCF Operations 9.1][whatsnew]). The click-path below follows
Broadcom's blog walkthrough ([part 1][blog1], built on 9.1.0); check it against
the TechDocs procedure for your build.

**Download the binary:**

1. In VCF Operations, go to **Build → Lifecycle → VCF Instances** and open the
   instance.
2. **Binary Management** tab → **INSTALL BINARIES** → select the latest
   **VMware Cloud Foundation Operations HCX** → **DOWNLOAD**.

**Deploy the manager:**

1. Select the **domain** HCX should serve. HCX is installed per domain, next to
   that domain's vCenter and NSX.
2. **Software Versions** tab → **MANAGE COMPONENTS** → **VCF Operations HCX**
   tile → **INSTALL**.
3. **General:** pick the downloaded version.
4. **Deployment Settings:** the HCX Manager FQDN (the DNS record must exist)
   and the admin and root passwords. That's all you enter: the management
   domain components handle placement and the vCenter / NSX registration.
5. **Validation** must pass, then **Summary** → **FINISH**.

HCX is an **optional component**: it's on the Manage Components page next to
Avi, and is included in the VCF entitlement (see
[`14-avi-load-balancer.md`](14-avi-load-balancer.md) for how that page separates
optional components from paid add-ons).

**Certificates:** 9.1 manages HCX certificates from VCF Operations too, so
replace them there, not in the HCX appliance UI. If you **import** an existing
HCX Manager instead, its certificate needs a SAN: one without fails the import
with a CN/SAN mismatch
([KB 445282](https://knowledge.broadcom.com/external/article/445282/vcf-operations-hcx-9100-import-fails-wit.html)).

**SSO:** VCF SSO for HCX goes through the VCF Identity Broker; see
[`12-sso-configuration.md`](12-sso-configuration.md) Step 5.

---

## 5. Deploy HCX on the legacy side

The legacy vCenter isn't part of the VCF instance, so this side is a manual
OVA deploy ([blog part 1][blog1], [installs][installs]):

1. Download the **VCF Operations HCX** OVA (the same file as the destination,
   same version) from the Broadcom Support Portal.
2. Deploy it to a legacy cluster with **Deploy OVF Template**: FQDN, IP,
   gateway, DNS, NTP and passwords.
3. Log in to the appliance management interface (`https://<fqdn>:9443`) and
   connect it to the legacy vCenter and its SSO domain. You need
   `administrator@vsphere.local` or an equivalent account.
4. Connect it to the legacy NSX Manager only if you will extend NSX networks
   from the legacy side.
5. Check the version matches the destination before going on (see
   [§1.1](#11-both-sides-run-hcx-9x)).

---

## 6. Licensing: the legacy side inherits

The legacy side needs **no local licence key**. It inherits the VCF
destination's entitlement through the service mesh. Until the site pair and
service mesh are up, the legacy manager shows **Evaluation Mode**, which is
expected
([KB 440126](https://knowledge.broadcom.com/external/article/440126/hcx-licensing-requirements-for-migrating.html)).

- Optionally register the legacy manager against the **destination vCenter as
  its Entitlement Server**, so it picks up the VCF subscription directly and the
  evaluation banner may clear.
- Keep outbound HTTPS open: if the legacy side loses the destination for more
  than 10 minutes, it can drop back to evaluation status until the next poll.

Licensing problems seen on HCX 9.x:

| Symptom | KB |
| --- | --- |
| HCX doesn't detect a licence assigned through SDDC Manager | [KB 422680](https://knowledge.broadcom.com/external/article/422680) |
| *"Failed to get vCenter license expiry details"* | [KB 445017](https://knowledge.broadcom.com/external/article/445017/hcx-9x-fails-to-discover-vcf-licenses-wi.html) |
| VCF 9 licence can't be activated: the wrong appliance type was deployed; redeploy the VCF-integrated HCX | [KB 437122](https://knowledge.broadcom.com/external/article/437122) |
| Evaluation Mode on the initiator | [KB 418818](https://knowledge.broadcom.com/external/article/418818) |

The hidden *Cross Cloud Mobility* sheet in the P&P workbook still asks for an
*HCX License key*. That field comes from the older VMware Cloud on AWS design
and doesn't apply to HCX 9.x.

---

## 7. Site pair, profiles and service mesh

Done in the **legacy** HCX Manager's UI, because the source starts everything.
Broadcom's [blog part 2][blog2] walks through the screens.

1. **Site pair:** add the destination HCX Manager's URL and credentials. Check
   the versions first: a 4.x/9.x pair is created without warning (KB 427904).
2. **Network profiles** on both sides, from [§3.2](#32-network-profiles).
3. **Compute profiles** on both sides: which clusters and datastores to deploy
   appliances into, which clusters can be migrated, which services to turn on
   (migration types, NE, WAN-OPT), and which network profiles to use for each
   traffic type.
4. **Service mesh:** pair a source compute profile with a destination one, set
   the NE appliance count per switch and turn on NE HA if you want it. HCX
   deploys the IX, NE and WAN-OPT appliances on both sides.
5. Check the service mesh shows all tunnels **up** and run the built-in
   diagnostics before you extend a network or migrate anything.

---

## 8. Extend networks

Network Extension stretches a legacy layer 2 network into NSX on the VCF 9.1
side, so a VM keeps its IP and gateway when it moves.

**What can be extended**, verbatim from
[Requirements for Network Extension][nereq]: *"VCF Operations HCX supports
extending networks from VMware vSphere Distributed Switches, NSX segments under
default project, and NSX Virtual Private Cloud (VPC) subnets. HCX also supports
extending networks to vSphere DVPG as the destination."*

| | Supported | Not supported |
| --- | --- | --- |
| Legacy-side source | vDS port groups; NSX overlay or VLAN segments (NSX 3.2.3+, registered with the same vCenter as HCX, hosts are transport nodes); VPC subnets (HCX and NSX 9.0+ on the source) | vSphere Standard Switch port groups; segments in a **user-created NSX project** |
| VCF 9.1-side target | NSX segment on a Tier-1, **NSX VPC subnet**, or a vDS port group | NSX projects other than the default |

The **default project only** limit is easy to miss on a VCF 9 destination
designed around NSX projects. It was reported on 4.x and 9.0.x
([KB 378638](https://knowledge.broadcom.com/external/article/378638/hcx-unable-to-select-the-destination-fi.html)),
and the 9.1 requirements page still says *"default project"*. Plan the target
VPC or Tier-1 in the default project, or plan a re-IP instead.

**Per extension** you pick the destination first-hop router (a Tier-1 or a VPC)
and enter the gateway IP and prefix length
([blog part 3][blog3]). Up-to-date appliances can carry up to 128 extensions on
a single vNIC.

**Mobility Optimized Networking (MON):** without it, traffic from migrated VMs
goes back through the extension to the legacy gateway. MON routes it locally on
the VCF 9.1 side. Turn it on per extension once the gateway design allows it.

**Cutover:** when every VM on a network has moved, **unextend** it, which moves
the gateway to NSX on the VCF 9.1 side, and remove the legacy gateway. Agree
this window with the network team: it's the moment the routing changes.

---

## 9. Choose a migration type per workload

| Type | Downtime | Use for | Watch out for |
| --- | --- | --- | --- |
| **Bulk** | Reboot at switchover | Most VMs: many in parallel, scheduled switchover window | Replication runs ahead; the VM restarts on the VCF side |
| **HCX vMotion** | None | Single VMs that can't go down | One at a time; needs VM hardware version 9 or later |
| **Replication Assisted vMotion (RAV)** | None | Many VMs without downtime | Replication plus a vMotion switchover; vVols destinations aren't supported |
| **Cold** | VM is off | Powered-off VMs and templates | Nothing runs during the move |
| **OS Assisted (OSAM)** | Reboot | Non-vSphere sources | Needs SGW (source) and SDR (destination) and the Guest Network profile; for single-site use the OSAM service must be at the destination |

The vMotion hardware version rule is quoted from [installs][installs]; the
others are summarised from the user guide, so check the per-type restrictions in
*About Administering VMware Cloud Foundation Operations HCX* for your build.

Check every VM against the destination hosts before it's in a wave
([System Requirements][sysreq]):

- The destination hosts must support the VM's **hardware version** and **VMware
  Tools** version.
- Check the **EVC / CPU** baseline for the vMotion-based types.
- **RDMs**, independent disks, snapshots and attached ISOs block or slow some
  migration types. Clean them up before the wave.

---

## 10. Run the migration waves

1. **Proof of concept first.** TechDocs suggests success criteria like: extend
   two test networks, live-migrate a VM, test L2 connectivity over the
   extension, reverse-migrate a VM, bulk-migrate a VM ([installs][installs]).
2. **Group VMs into waves** by application, network and downtime tolerance.
   Move an application's VMs together so its traffic doesn't cross the
   extension longer than needed.
3. **Schedule switchover windows** for Bulk and RAV; replication can start days
   earlier.
4. **Watch** the migration dashboard and the service mesh health during each
   wave.
5. **Rollback:** a VM can be migrated back the same way (reverse migration).
   Keep the legacy capacity until the wave is signed off.

---

## 11. Decommission HCX

When everything has moved:

1. **Unextend** every extended network (the cutover in [§8](#8-extend-networks)).
2. **Delete the service mesh**, which removes the IX, NE and WAN-OPT appliances
   on both sides.
3. **Remove the site pair.**
4. **Retire the legacy HCX Manager** and the legacy environment.
5. Decide whether to keep the VCF 9.1-side HCX Manager for later migrations, or
   remove it from **Manage Components** in VCF Operations. Close the HCX
   firewall rules either way.

---

## 12. Known issues and field notes

| Issue | Source |
| --- | --- |
| HCX 4.x crashes vCenter 9.1's `vmware-envoy-hgw`: upgrade HCX first | [KB 450437](https://knowledge.broadcom.com/external/article/450437/vmware-hcx-compatibility-and-upgrade-req.html) |
| A 4.x/9.x site pair is created without warning but isn't supported | [KB 427904](https://knowledge.broadcom.com/external/article/427904) |
| *Migrate Service Mesh* fails from 9.0.x to 9.1.0; re-sync the mesh | [KB 449280](https://knowledge.broadcom.com/external/article/449280/hcx-migrate-service-mesh-fails-when-sour.html) |
| Import into VCF Operations fails on a certificate without a SAN | [KB 445282](https://knowledge.broadcom.com/external/article/445282/vcf-operations-hcx-9100-import-fails-wit.html) |
| Tier-1s in user-created NSX projects aren't selectable for NE | [KB 378638](https://knowledge.broadcom.com/external/article/378638/hcx-unable-to-select-the-destination-fi.html) |
| Licensing symptoms on 9.x | [§6](#6-licensing-the-legacy-side-inherits) |

HCX is FIPS 140-3 certified as of 9.1 ([What's new: VCF Operations 9.1][whatsnew]).

### The workbook

The 9.1 P&P workbook (v1.9.1.001) has a **hidden** *Cross Cloud Mobility*
sheet: HCX service account and role, VM folder and resource pool, an inbound
firewall rule, the HCX Connector name / IP / passwords, the remote HCX URL, and
the management and vMotion IP ranges. It was written for the older *Cross
Cloud Mobility for VMware Cloud Foundation* (VMware Cloud on AWS) design: its
example remote URL is a VMware Cloud on AWS SDDC, and it asks for a licence key
HCX 9.x doesn't use. It's a useful checklist of what to collect, which
[`02-intake.md`](02-intake.md) `H15` covers, but don't transfer answers into it.
The 9.1.1 workbook no longer has the sheet.

---

## References

- [VCF Operations HCX Installations][installs] (TechDocs, VCF 9.1)
- [Software Version Requirements][swreq] (TechDocs, VCF 9.1)
- [System Requirements][sysreq] (TechDocs, VCF 9.1)
- [Requirements for Network Extension][nereq] (TechDocs, VCF 9.1)
- [What's new: VCF Operations 9.1][whatsnew] (VCF 9.1.0 release notes)
- Broadcom blog series, *The Complete Guide to Workload Mobility with VMware
  Cloud Foundation Operations HCX 9.1*: [part 1, deployment][blog1];
  [part 2, profiles, site pair and service mesh][blog2];
  [part 3, network extension and migration][blog3]
- [Broadcom Interoperability Matrix][interop], [Ports and Protocols][ports],
  [Product Lifecycle][lifecycle]

[installs]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/workload-mobility/getting-started-with-vmware-hcx-vcf-9-0/introduction-to-hcx-site-manager-deployments/hcx-connector-and-hcx-cloud-sites.html
[swreq]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/workload-mobility/vmware-hcx-user-guide-vcf-9-0/preparing-for-hcx-installations/software-version-requirements.html
[sysreq]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/workload-mobility/vmware-hcx-user-guide-vcf-9-0/preparing-for-hcx-installations/system-requirements-for-hcx.html
[nereq]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/workload-mobility/vmware-hcx-user-guide-vcf-9-0/extending-networks-with-vmware-hcx/about-vmware-hcx-network-extension/requirements-for-network-extension.html
[whatsnew]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/release-notes/vmware-cloud-foundation-9-1-0-0-release-notes/what-s-new/whats-new-vcf-ops.html
[blog1]: https://blogs.vmware.com/cloud-foundation/2026/06/26/vcf-9-operations-hcx-deployment-part-1/
[blog2]: https://blogs.vmware.com/cloud-foundation/2026/07/13/vcf-9-operations-hcx-service-mesh-part-2/
[blog3]: https://blogs.vmware.com/cloud-foundation/2026/09/25/vcf-9-operations-hcx-network-extension-migration-part-3/
[interop]: https://interopmatrix.broadcom.com/
[ports]: https://ports.broadcom.com/
[lifecycle]: https://support.broadcom.com/group/ecx/productlifecycle
