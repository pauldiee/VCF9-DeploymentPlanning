# Securing the External-Facing VCF Automation Deployment (Pattern 3)

Walkthroughs for Broadcom's [Securing VCF Automation
Deployment](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/application-modernization/multi-tenat-design-for-a-modern-private-cloud/implementation-of-self-service-multi-tenant-private-cloud/securing-vcf-automation.html)
design page — the hardening that goes around an **external-facing (Deployment
Pattern 3)** VCF Automation instance: a **DMZ VPC** for tenant access, an Avi
virtual service in front, and NSX firewalling on every hop.

> **Prerequisites — build these first; this repo has a guide for each.**
> - **The external-facing VCFA virtual service, Avi, and the Service Engine
>   infrastructure** —
>   [`14-avi-load-balancer.md` → VCF Automation (external/customer access)](14-avi-load-balancer.md#vcf-automation-externalcustomer-access)
>   (the DMZ VPC, the SE infrastructure, the VS / pool / health monitor).
>   Everything here layers onto that.
> - **VCF Automation deployed** into the DMZ VPC —
>   [`05-day2-deployments.md`](05-day2-deployments.md) (the Fleet LCM API, the
>   node IP pool, `networkMoId`).
> - **A vSphere Supervisor** for VCFA's compute, and the region that binds it —
>   [`10-supervisor-enablement.md`](10-supervisor-enablement.md) and
>   [`17-vcfa-tenant-config.md`](17-vcfa-tenant-config.md).
> - **NSX Edge cluster + Tier-0** for the Centralized connection the TGW rides
>   (not needed on a Distributed connection) —
>   [`10-supervisor-enablement.md` §3](10-supervisor-enablement.md#3-build-the-centralized-transit-gateway),
>   [`prerequisites.md`](prerequisites.md).
> - **vDefend + Avi licensing via License Hub** — the stateful gateway firewalls
>   (layers 1 and 5), the DFW (layer 2) and the WAF (layer 4) **all** depend on
>   it: [`15-license-hub.md`](15-license-hub.md) (and the SSP Installer it
>   deploys from). Gate on *vDefend **or** Avi in scope*.
> - **vDefend SSP** — only if the plan uses **Security Intelligence**
>   (firewall-rule recommendations) or **NDR** on top of the plain firewall:
>   [`18-vdefend-ssp.md`](18-vdefend-ssp.md).

*Sourcing convention: **[documented]** = stated on the design page (or confirmed
elsewhere in this repo against TechDocs / field observation); **[field
caveat]** = practitioner note added here, not on the design page.*

## Contents

The design page layers the controls outer to inner; so does this guide.

| # | Section | Enforcement point |
| - | ------- | ----------------- |
| 1 | [Segregating tenant traffic at the Transit Gateway](#segregating-tenant-traffic-at-the-transit-gateway-pattern-3-tgw-gateway-firewall) | NSX Transit Gateway — stateful gateway firewall |
| 2 | [Protecting tenant traffic with vDefend and Avi](#protecting-tenant-traffic-with-vdefend-and-avi) | Service Engine placement + NSX DFW exclusion list + licensing |
| 3 | [Locking the portals to known client IPs](#locking-the-portals-to-known-client-ips-pattern-3-avi-http-configuration) | Avi L7 HTTP request policy on the VS |
| 4 | [Web Application Firewall on the VCFA virtual service](#web-application-firewall-on-the-vcfa-virtual-service) | Avi WAF policy on the VS |
| 5 | [Protecting the Avi management plane](#protecting-the-avi-management-plane-pattern-3-gateway-firewall) | NSX Tier-1 — stateful gateway firewall |
| — | [Split DNS and split networking](#split-dns-and-split-networking-optional) | Optional networking prep — internal vs external DNS |
| — | [Validate the whole tenant path](#validate-the-whole-tenant-path) | End-to-end check once all five layers are in |

---

## The full sequence, start to finish

The external-facing VCFA virtual service must already exist
([`14-avi-load-balancer.md`](14-avi-load-balancer.md#vcf-automation-externalcustomer-access)).
Then apply the five layers **outer to inner** — the order the design page uses.
The two gateway-firewall layers (1 and 5) are **staged as Allow + Logging first**
and only switched to deny once the log is clean
([Reading the gateway-firewall log](#reading-the-gateway-firewall-log)).

**Before the layers: the design page's build order.** Since its 2026-10-19
revision, the design page opens with an *Order of Operations Summary* for the
build itself. The parts that shape what follows **[documented]**:

- **A dedicated NSX Project** for the VCF Automation DMZ VPC, with an external
  IP block of at least `/27` and a public subnet of at least `/28` (see
  [IP addressing for the DMZ VPC](#ip-addressing-for-the-dmz-vpc)).
- **The Avi virtual service exists *before* VCF Automation is installed**, as
  **L4 passthrough on port 443** for the VCFA FQDN. Only **after** the install
  is it reconfigured to HTTP/HTTPS with SSL offload (the self-signed certificate
  from the install, or a custom one also applied to VCFA), and only then does
  the WAF go on. [`14-avi-load-balancer.md`](14-avi-load-balancer.md#building-the-virtual-service)
  builds the HTTP/HTTPS virtual service directly; on a fresh build, follow the
  design's passthrough-first order.
- **The Service Engines go on the DFW exclusion list before VCFA is deployed**
  (see [the exclusion-list sequence](#the-dfw-exclusion-list-sequence)).

1. **Settle the licensing gates.** Layers 1 and 5 are *stateful* gateway
   firewalls and need **vDefend** licensing; the WAF (layer 4) and parts of
   layer 2 have their own gates — see
   [Licensing gates](#licensing-gates--all-before-you-start). Do these before
   you build anything.
2. **Segregate tenant traffic at the Transit Gateway**
   ([layer 1](#segregating-tenant-traffic-at-the-transit-gateway-pattern-3-tgw-gateway-firewall))
   — the north-south perimeter; build the groups + services, the `policy-*` allow set, then
   stage and enforce `default-deny`.
3. **Protect tenant traffic with vDefend and Avi**
   ([layer 2](#protecting-tenant-traffic-with-vdefend-and-avi)) — Service Engine
   placement and the NSX DFW exclusion-list sequence.
4. **Lock the portals to known client IPs**
   ([layer 3](#locking-the-portals-to-known-client-ips-pattern-3-avi-http-configuration))
   — the Avi L7 HTTP-request policy on the VS. Keep a way back in.
5. **Add the Web Application Firewall**
   ([layer 4](#web-application-firewall-on-the-vcfa-virtual-service)) — the Avi
   WAF policy on the VS; detection mode first, then enforcing.
6. **Protect the Avi management plane**
   ([layer 5](#protecting-the-avi-management-plane-pattern-3-gateway-firewall))
   — the `policy-avi-ux` Tier-1 gateway firewall; custom L4 services, the allow
   rules, then stage and switch the `default-deny` rule to Drop.
7. **Validate the whole tenant path**
   ([end-to-end check](#validate-the-whole-tenant-path)).

[Split DNS and split networking](#split-dns-and-split-networking-optional) is an
optional networking-prep step done **before** the layers — decide it up front if
you want internal components off the external path.

---

## Split DNS and split networking (optional)

**[documented]**, from the design page's *Optional — Split DNS and Network
Configuration* chapter. A surface-reduction measure taken **before** the five
layers: *"split the communication between internal users and external users so
that the internally facing VCF Automation components are not directly exposed to
external access."*

> **Why it is closer to required than "optional" [field caveat].** Tom Fojta's
> [Load Balancing VCF Automation with Avi](https://fojta.wordpress.com/2025/08/16/load-balancing-vcf-automation-with-avi/):
> there is **no documented way to change a VCF Automation install's FQDN**, so
> the external VIP has to answer on the *same* FQDN as the internal one. Without
> the split-DNS entry pinning that FQDN to the external VIP for outside clients,
> *"the external VIP will start redirecting subsequent calls to the internal
> VIP"* — the first request lands on Avi, then VCFA hands back its own
> (internal) FQDN and the client's next call resolves straight past the DMZ.
> Split-horizon DNS (one FQDN, two answers) is what keeps external traffic on
> the external path.

**How it works** — one FQDN, two answers:

| Resolver | `vcfa01.example.io` resolves to | Used by |
| -------- | ------------------------------ | ------- |
| **External DNS** | the **Avi virtual-service VIP** (from the external IP block) | tenants / the internet — traffic enters through Avi + the DMZ |
| **Internal DNS** | the **VCF Automation IP-pool addresses** (the node IPs) | operators / fleet components on the management network — direct, no DMZ hop |

The **VCF Automation *service runtime* FQDN is advertised by the internal DNS
only** — it is never resolvable off the management network.

### Setting it up

**The VCF Automation deployment JSON is unchanged** — the design page: *"The JSON
file for the split DNS configurations is the same as the standard JSON."* VCF
Operations registers the FQDN against the node IP-pool addresses internally
regardless; the split is entirely in **how you carve the external IP block** and
**what the two DNS resolvers answer**. Nothing NSX-specific beyond the block
split — no extra NAT or routes; the DMZ VPC's existing connectivity profile
(public subnet + default outbound NAT) already covers it.

1. **Split the external IP block into two ranges** when you assign it to the NSX
   Project (design page example CIDRs):

   | Range | Example | Feeds |
   | ----- | ------- | ----- |
   | **Internal** | `172.16.49.0/24` | the VCFA **node IPs**, the VCFA **service-runtime**, and the **Avi SE ingress / VS IP pool** — everything on the private side |
   | **External / public** | `10.200.0.0/24` | the **VCFA FQDN / Avi VS VIP** only |

   In the VPC, the internal range is the private/services subnet allocation; the
   external range is the **public subnet** ([IP addressing](#ip-addressing-for-the-dmz-vpc)
   below for the counts).

2. **Deploy VCF Automation as normal** ([`05-day2-deployments.md`](05-day2-deployments.md))
   — `vspClusterSpec.ipv4Pool.addresses` (the 5 node IPs) and
   `ingress.vcfa.vips` (the 3 ingress IPs) come from the **internal** range.

3. **Build the Avi virtual service** ([`14-avi-load-balancer.md`](14-avi-load-balancer.md#building-the-virtual-service))
   with its **VIP from the external / public range**.

4. **Configure the two DNS views** — same FQDN, different answers:

   | Resolver (view) | Records |
   | --------------- | ------- |
   | **Internal** (management-network clients) | `A vcfa01.example.io → 172.16.49.43, .44, .45` (the node pool) · plus `A <vcfa-service-runtime-fqdn> → <its internal IP>` — **internal only** |
   | **External** (tenant / internet clients) | `A vcfa01.example.io → 10.200.0.100` (the Avi VS VIP) · the service-runtime FQDN is **not** published here |

   Use whatever gives you split-horizon: two DNS zones/views on one server, or a
   management resolver separate from the tenant/public resolver.

5. **Apply the five hardening layers** on top — the TGW / T1 gateway firewalls,
   the Avi HTTP redirect policies, and the WAF still go on exactly as below; the
   split just changes which IP the tenant path resolves to.

**Result** — every user hits the same FQDN; management-side clients reach VCFA
directly on the node IPs, tenants come in through the Avi VIP + the DMZ, and the
service-runtime FQDN is unreachable from outside.

### IP addressing for the DMZ VPC

The design page's sizing for the whole Pattern-3 VS path — **10 IPs total**:

| Purpose | Count |
| ------- | ----- |
| Platform FQDN | 1 |
| VCF Automation FQDN — the Avi virtual-service VIP | 1 |
| Ingress IPs — the Avi SE IP pool | 3 |
| VCF Automation node pool IPs (`ipv4Pool.addresses`, see [`05-day2-deployments.md`](05-day2-deployments.md)) | 5 |

Plus the block sizing: assign the NSX Project an **external IP block of at least
`/27`** (32 IPs), and from it a **public subnet of at least `/28`** (16 IPs) —
*"all the IPs used will be public IPs."*

**Which IP comes from where** (2026-10-19 revision of the design page):

- The **node pool, the ingress IPs and the platform (services runtime) FQDN** all
  come from the **VPC public subnet**.
- The **VCF Automation FQDN** — the Avi virtual-service VIP — is set statically
  in Avi from the **external IP block**, and is *"not an address within the VPC
  public subnet."* The design's example: block `172.16.49.0/24`, public subnet
  `172.16.49.32/28`, VIP `172.16.49.200`.
- The **three ingress IPs** are the `configSpec.ingress.vcfa.vips.ipv4` list in
  the Fleet LCM deployment spec — see
  [`05-day2-deployments.md`](05-day2-deployments.md#step-2--the-fields-that-declare-the-network).

---

## Segregating tenant traffic at the Transit Gateway (Pattern 3 TGW gateway firewall)

**[documented]**, from the *Protecting Tenant Traffic with vDefend Gateway
Firewall on TGW* chapter of the design page. This is the **north-south
perimeter** for everything entering the DMZ VPC: the goal is *"only required
services into the VCF Automation user interface"*, with external tenant traffic
kept off the internal management paths.

**Applied to:** the **Transit Gateway's** built-in **stateful gateway firewall
(GFW)**. On a **CTGW** build the TGW reaches outside via a Tier-0 — the rules go
on the **TGW**, not the Tier-0. On a **DTGW** build there is no Tier-0 in the
path; the TGW GFW is otherwise the same.

> **Connection HA — Active/Standby TGW, Active/Active Tier-0.** The design page
> assumes a **Centralized connection in Active/Standby**: *"In 9.1, TGW HA is
> decoupled from the T-0 (A/S TGW with A/A T-0)."* The stateful services on the
> TGW (this GFW, NAT) require the TGW itself to be **Active/Standby**; the Tier-0
> beneath it runs **Active/Active** for forwarding. Match this — an
> **Active/Active** *connection* has been seen to break an Avi-fronted VCFA in
> the browser (`ERR_CONNECTION_RESET`) even with the Avi pool green, when a
> tenant crosses two VRFs on an active-active Tier-0; the fix is one Tier-0 per
> zone (private / DMZ). **[field caveat]**

> **Licensing.** The stateful GFW / vDefend Gateway Firewall needs
> **vDefend licensing** — plain VCF ships only a *stateless* gateway firewall.
> See [`15-license-hub.md`](15-license-hub.md). Confirm the vDefend firewall
> licence **and** DFW activation (`NSX Manager > Security > Distributed Firewall
> > Settings`, per [layer 2](#protecting-tenant-traffic-with-vdefend-and-avi))
> before you start.

> **Naming convention.** This page follows the design page's NSX naming scheme:
> groups `grp-*`, custom services `svc-*`, firewall policies `policy-*`,
> external-source groups `ext-*`, rules `allow-* / deny-* / reject-*`. NSX
> predefined services (`DNS`, `LDAP`, `HTTPS`, `SSH`, `NTP`) keep their built-in
> names. Where a rule name differs from the design page's rules table, the table
> notes give the design's name.

### Walkthrough — the TGW gateway firewall

#### 1. Confirm the GFW is available on the DMZ TGW

`Security > Gateway Firewall` → select the DMZ project's **Transit Gateway**. If
the stateful rule options are greyed out, the vDefend firewall licence is not
applied yet — fix that first.

#### 2. Build the groups and custom services

`Inventory > Groups`:

| Group | Members |
| ----- | ------- |
| **`grp-dns-servers`**, **`grp-ldap-servers`** | the infra-service endpoints tenants and VCFA resolve / bind against |
| **`grp-avi-se`** | the Service Engine **data / VIP** interfaces in the DMZ VPC services subnet |
| **`grp-vcfa`** | the VCF Automation appliance **node IPs** (the cluster VMs' primary DMZ-VPC addresses) |
| **`grp-vcfa-mgmt`** | the appliance's **management interface(s)** |
| **`grp-vcfa-vip`** | the **external-facing virtual-service VIP** (from the external IP block) |
| **`grp-orchestrator`** | the VCF Automation **Orchestrator** endpoint (workflow engine; embedded or external) |
| **`grp-vsphere-supervisor`** | the Supervisor **control-plane VIP(s)** — WCP authentication on **443** and the Kubernetes API on **6443** |
| **`grp-esx-hosts`** | the management-domain **ESXi hosts** (for the VM web console) |
| **`grp-vcf-mgmt`** | the **VCF management components** VCFA calls into — vCenter, NSX Manager, VCF Operations, SDDC Manager, the fleet services. The design page splits this into `grp-vcenters`, `grp-nsx-managers` and `grp-vcf-fleet`; one group (or those three nested) works the same |
| **`grp-mgmt-admin`** | the **bastion / jump-host** networks operators connect from (the design's *Bastion; Jumphosts*) — for `allow-ssh` / `allow-icmp`, and the optional `policy-mgmt-access` |
| **`ext-<tenant>`** | one group per external tenant client range (design example: `ext-tenant-one`) — *only for `allow-icmp`* |

`Inventory > Services` — the custom L4 services the rules need (NSX has no
predefined entry for these ports):

| Service | Protocol / port | Design name |
| ------- | --------------- | ----------- |
| **`svc-vsphere-supervisor`** | TCP 6443 | `svc-vsphere-supervisor` (the Supervisor **kube API**; the WCP auth on **443** uses the predefined **HTTPS** service — see the note under step 3) |
| **`svc-vcfa-health`** | TCP 8008 | *(design uses the raw port)* |
| **`svc-vcfa-gw-config`** | TCP 22462 | *(design: raw port, rule `Node Health Check - GW Config`)* |
| **`svc-vcfa-synthetic`** | TCP 30005-30006 | *(design: raw ports, rule `Synthetic Checkers`)* |
| **`svc-vcfa-vmsp-gw`** | TCP 30136 | *(design: raw port, rule `Node Health Check - VMSP GW`)* |
| **`svc-vc-webconsole`** | TCP 902 **and** TCP 443 | `svc-vc-webconsole` (TCP 902) — see [§ VM web console ports](#vm-web-console-ports-443-vs-902) |

**How step 3 uses them.** Every rule is one source group → one destination
group, so a system with more than one address gets one group per address:

- **As a source** (traffic originating) — `grp-vcfa` for outbound reconcile
  (`allow-vcfa-orchestrator`, `allow-vcfa-supervisor`); `grp-vcfa-vip` +
  `grp-vcfa-mgmt` for `allow-vcf-management`; `grp-vcfa-mgmt` for the
  VM-console proxy to `grp-esx-hosts`; `grp-mgmt-admin` for `allow-ssh`,
  `allow-icmp` and the optional `allow-mgmt-ssh`; `ext-<tenant>` for
  `allow-icmp`.
- **As a destination** (traffic terminating) — `grp-dns-servers` /
  `grp-ldap-servers`; `grp-avi-se` (`allow-web`, 80/443); `grp-vcfa-vip`
  (external 443, the health / synthetic checks 8008, 22462, 30005-30006,
  30136, ICMP); `grp-vcfa-mgmt` (SSH, ICMP, `allow-web-vcfa`);
  `grp-orchestrator`; `grp-vsphere-supervisor`; `grp-vcf-mgmt`;
  `grp-esx-hosts`.

> **The three VCFA groups are one system, three addresses.** `grp-vcfa` is the
> box **outbound** on its app interface; `grp-vcfa-mgmt` is its **management
> NIC**, outbound to ESXi for the console proxy; `grp-vcfa-vip` is the
> **published address, inbound**. On a single-homed deployment `grp-vcfa` and
> `grp-vcfa-mgmt` hold the same IPs — keep them separate so each rule can be
> tightened on its own.

> **`grp-avi-se` here is the SE *data / VIP* interfaces — not `grp-avi-se-mgmt`**
> from [Protecting the Avi management plane](#protecting-the-avi-management-plane-pattern-3-gateway-firewall),
> which is the SE **management** interfaces on a different firewall.

#### 3. Create the policies and rules on the TGW GFW

**Applied To** = the Transit Gateway for every rule. Policies evaluate
top-down; keep this order.

**`policy-infra-services`**

| Rule | Source | Destination | Service | Action | Design name |
| ---- | ------ | ----------- | ------- | ------ | ----------- |
| `allow-dns` | Any | `grp-dns-servers` | **DNS** | Allow | `DNS` |
| `allow-ldap` | Any | `grp-ldap-servers` | **LDAP** + **LDAP-UDP** | Allow | `LDAP` |

**`policy-avi`**

| Rule | Source | Destination | Service | Action | Design name |
| ---- | ------ | ----------- | ------- | ------ | ----------- |
| `allow-web` | Any | `grp-avi-se` | **HTTP** + **HTTPS** (TCP 80, 443) | Allow | `allow-web` |

**`policy-vcfa`**

| Rule | Source | Destination | Service | Action | Design name |
| ---- | ------ | ----------- | ------- | ------ | ----------- |
| `allow-vcfa-orchestrator` | `grp-vcfa` | `grp-orchestrator` | **HTTPS** | Allow | `VCFA-to-Orchestrator` |
| `allow-vcfa-supervisor` | `grp-vcfa` | `grp-vsphere-supervisor` | **`svc-vsphere-supervisor`** (6443) **+ HTTPS** (443) | Allow | `VCFA-to-Supervisor` |
| `allow-api-server` | Any | `grp-vsphere-supervisor` | **`svc-vsphere-supervisor`** (6443) | Allow | `api-server` |
| `allow-gw-health-check` | Any | `grp-vcfa-vip` | **`svc-vcfa-health`** (8008) | Allow | `gw-health-check` |
| `allow-node-health-gw-config` | Any | `grp-vcfa-vip` | **`svc-vcfa-gw-config`** (22462) | Allow | `Node Health Check - GW Config` |
| `allow-synthetic-checkers` | Any | `grp-vcfa-vip` | **`svc-vcfa-synthetic`** (30005-30006) | Allow | `Synthetic Checkers` |
| `allow-node-health-vmsp-gw` | Any | `grp-vcfa-vip` | **`svc-vcfa-vmsp-gw`** (30136) | Allow | `Node Health Check - VMSP GW` |
| `allow-web-vcfa` | Any *(see note)* | `grp-vcfa-vip`, `grp-vcfa-mgmt` | **HTTP** + **HTTPS** | Allow | `allow-web` (second row) |
| `allow-vcf-management` | `grp-vcfa-vip`, `grp-vcfa-mgmt` | `grp-vcf-mgmt` | **HTTPS** | Allow | `VCF Management` |
| `allow-vc-webconsole` | `grp-vcfa-mgmt` | `grp-esx-hosts` | **`svc-vc-webconsole`** (902 + 443) | Allow | `VC Webconsole` |
| `allow-ssh` | `grp-mgmt-admin` | `grp-vcfa-mgmt` | **SSH** (TCP 22) | Allow | `SSH` |
| `allow-icmp` | `grp-mgmt-admin`, `ext-<tenant>` | `grp-vcfa-vip`, `grp-vcfa-mgmt` | **ICMP** (echo) | Allow | `ICMP Pings` |

> **Seven rows came in with the 2026-10-19 revision of the design page
> (#415):** the three health / synthetic-check rows (22462, 30005-30006,
> 30136), the second `allow-web`, `VCF Management`, `SSH` and `ICMP Pings`. The
> same revision renamed the two reconcile rules to `VCFA-to-Orchestrator` and
> `VCFA-to-Supervisor` (this guide keeps its `allow-*` rule names; the last
> column maps them).

> **`allow-vcf-management` is the row not to miss.** VCF Automation sits in the
> DMZ VPC; vCenter, NSX Manager, VCF Operations and SDDC Manager sit on the
> management network on the other side of the TGW. The design page's own
> management-traffic section says the TGW firewall *"explicitly allows those
> communication channels"* — this is that rule. Without it, `default-deny`
> drops VCFA's calls into the management components.

> **The health / synthetic-check rows: narrow `Any` once you know the source
> [field caveat].** The design page opens TCP 22462, 30005-30006 and 30136
> from `Any` to the VCFA VIP. Broadcom's
> [Ports and Protocols](https://ports.broadcom.com/) data for VCF Automation
> 9.1.0 (queried 2026-10-20) lists **30005** and **30006** with source
> *"VCF Operations Fleet Manager Management IP address"*, destination
> *"VCF Management Services Platform IP addresses"*: *"Validates the Platform
> runtime is healthy prior to invoking lifecycle changes"* and *"Webhooks
> called by Fleet Manager to trigger Day-2 operations on the Platform
> runtime"*. So the initiator is the fleet manager, not a tenant. **22462** and
> **30136** are not listed there at all. Keep the design's `Any` while
> `default-deny` is staged, read the actual sources from the log
> ([Reading the gateway-firewall log](#reading-the-gateway-firewall-log)), and
> narrow each rule to those sources before enforcing.
>
> The same Ports and Protocols listing has two more fleet-manager flows the
> design page leaves out: **TCP 30000** and **30001**, *"Container images and
> Helm charts pushed to the OCI registry"* on the Platform nodes. If the fleet
> manager reaches the VCFA platform across this TGW, a VCFA upgrade needs them;
> expect them in the log during the first lifecycle operation after
> `default-deny` is enforced.

> **The second `allow-web` row opens HTTP/HTTPS straight to the VCFA VIP and
> the management IPs [field caveat].** The design table gives it the
> description *"SSH from Bastion/Jump hosts"*, which does not match its HTTP/HTTPS
> service; read the service as authoritative. From `Any`, it lets a client
> reach VCF Automation **without passing the Avi virtual service**, so around
> the [IP-based portal locking](#locking-the-portals-to-known-client-ips-pattern-3-avi-http-configuration)
> and the [WAF](#web-application-firewall-on-the-vcfa-virtual-service). Scope its
> source to `grp-mgmt-admin` (operators) unless you deliberately want tenants
> on that path; tenant traffic belongs on `allow-web` to `grp-avi-se`.

> **`allow-api-server`** is in the design page's TGW rules table (`api-server` —
> `Any → vSphere Supervisor : TCP 6443`) and lets tenant / `kubectl` traffic
> reach the Supervisor API through the DMZ. It is broader than
> `allow-vcfa-supervisor` (which is VCFA-only); keep it only if tenants consume
> the Supervisor API directly through this path — otherwise the VCFA-scoped rule
> is enough.

> **VCFA → Supervisor needs *two* ports, not just 6443 [field caveat].** The
> design page's rule lists only **TCP 6443** (the Kubernetes API), but VCF
> Automation also authenticates to the Supervisor on **TCP 443** (WCP login /
> token exchange). With only 6443 open, `default-deny` drops the 443 handshake
> and the provider portal's **Services** view fails with *"Services are not
> available for this namespace, try again later or check with your
> administrator"* — [Broadcom KB 449287](https://knowledge.broadcom.com/external/article/449287/error-services-are-not-available-for-thi.html).
> That is why `allow-vcfa-supervisor` above carries **HTTPS (443) + 6443**. The
> `Any`-sourced `allow-api-server` stays 6443-only; widen it to 443 only if
> tenants also drive WCP login directly through this path.

**`policy-mgmt-access`** *(optional — not in the design page; see note)*

| Rule | Source | Destination | Service | Action |
| ---- | ------ | ----------- | ------- | ------ |
| `allow-mgmt-ssh` | `grp-mgmt-admin` | `grp-avi-se` | **SSH** (TCP 22) | Allow |

> **`policy-mgmt-access` now only covers the Service Engines.** Since its
> 2026-10-19 revision, the design page itself allows **SSH** and **ICMP** from
> bastion / jump hosts to VCF Automation (`allow-ssh` / `allow-icmp` in
> `policy-vcfa` above). It still has no operator path to the **Service
> Engines'** data interfaces across the TGW. Add this policy **only if**
> operators SSH to the SEs directly, place it **above `default-deny`**, and
> scope `grp-mgmt-admin` to the jump-host subnets. Web / UI access to the
> provider portal is a **separate matter** — it traverses `allow-web`
> (`Any → grp-avi-se` :80/443) and is restricted to management networks at
> **L7 by the Avi HTTP policy**
> ([Locking the portals to known client IPs](#locking-the-portals-to-known-client-ips-pattern-3-avi-http-configuration)),
> not here.

**`policy-default-deny`**

| Rule | Source | Destination | Service | Action | Design name |
| ---- | ------ | ----------- | ------- | ------ | ----------- |
| `default-deny` | Any | Any | Any | **Deny** (enable **Logging**) | `default-deny` |

The GFW is **stateful** — only the connection-initiation direction is listed;
return traffic is automatic.

#### 4. Stage before enforcing

Set `default-deny` to **Allow + Logging** first. Exercise the full tenant path
— reach the VIP, log in, browse the catalog, deploy a workload, open a VM web
console — then SSH and ping a VCFA node from a jump host, and, if you added
`policy-mgmt-access`, SSH to an SE. Leave it staged long enough to catch the
fleet manager's health and lifecycle checks too (30005-30006, and 30000-30001
during an upgrade). Then read the log (below) for anything the allowlist missed
before switching the rule to **Deny**.

#### Reading the gateway-firewall log

Applies to both firewalls on this page — the TGW GFW here and the `policy-avi-ux`
T1 GFW in [Protecting the Avi management plane](#protecting-the-avi-management-plane-pattern-3-gateway-firewall).
Logging is **per rule** (the `Logging` toggle you set on each staged rule).

- **Tag the staged rules.** On the rule, set the **Tag** field to a short
  string — the policy name works (`default-deny`, `policy-avi-ux`). NSX writes
  that tag into every log line the rule produces, so you can filter on it
  instead of resolving numeric rule IDs.
- **Where the log is.** Gateway-firewall logging runs on the **Edge transport
  nodes** that host the gateway — the Tier-0 the TGW rides for the TGW GFW, the
  Tier-1 for `policy-avi-ux`. If NSX forwards syslog to **VCF Operations for
  Logs** or a SIEM (the usual fleet setup) read it there; otherwise read it on
  the Edge.
- **On an Edge node.** SSHing in as `admin` puts you in the **NSX CLI**, not a
  shell — there is no `grep` and no direct file access. Use the built-in log
  reader and its `find` filter:

  ```
  get log-file syslog | find firewall
  get log-file syslog follow | find <your-tag>     # live tail while you test
  ```

  A real shell (`grep`, `/var/log/syslog`) needs engineering / root mode, which
  is support-gated and usually disabled on a VCF-managed NSX — prefer the CLI
  above or VCF Operations for Logs.

  Each line carries the **action** (`PASS` / `DROP` / `REJECT`), the protocol,
  and the source and destination **`IP:port`** — the 5-tuple you need to write
  the missing allow rule.
- **In VCF Operations for Logs**, filter to the NSX firewall events and your
  tag; each event shows the same action and source/destination address and
  port.
- **What to act on.** While the `default-deny` rule is staged as
  **Allow + Logging**, every line it matches is a flow the allowlist missed —
  note the destination IP, port and protocol, add a rule, and repeat until that
  rule logs only noise. Then switch it to **Deny** / **Drop**. The
  `Security > Gateway Firewall` **hit counters** are the quick "is this rule
  matching" check; the log is where you get the 5-tuple.

#### 5. Validate

- External client → **`grp-vcfa-vip`:443** works; the same client to any other
  port/host is dropped.
- `allow-gw-health-check`: the load-balancer probe to **8008** succeeds and the VS
  stays green.
- The provider portal's **Services** view lists the Supervisor namespaces (no
  *"Services are not available for this namespace"* error) — `allow-vcfa-supervisor`
  is carrying **both** 443 (WCP auth) and 6443 (kube API). See the troubleshooting
  note below if it fails.
- Deploy a test workload — `allow-vcfa-orchestrator` (HTTPS) and
  `allow-vcfa-supervisor` (443 + 6443) carry the reconcile.
- A VM **web console** opens from the VCFA UI (`grp-vcfa-mgmt` →
  `grp-esx-hosts`, 902 / 443).
- `allow-vcf-management`: VCFA reaches vCenter, NSX Manager and VCF Operations —
  provider-portal views that read from them (regions, zones, networks) load,
  and the TGW log shows no drops from `grp-vcfa-vip` / `grp-vcfa-mgmt` to
  `grp-vcf-mgmt`.
- The health / synthetic-check rules (22462, 30005-30006, 30136) show hits, and
  VCF Operations reports the VCFA component healthy.
- `ssh` and `ping` from `grp-mgmt-admin` to a VCFA node still work after
  `default-deny` is set to **Deny**; the same SSH from any other source is
  dropped. If you added `policy-mgmt-access`, SSH to an SE works as well.
- `default-deny` hit counter catches only noise.

> **The port list is the design's example, not a validated superset [field
> caveat].** `TCP 8008` is VCFA's built-in-LB health port; 22462, 30005-30006
> and 30136 are the design's health / synthetic checks (see the note under step
> 3 for what Ports and Protocols says about their source); the Supervisor path
> is **443** (WCP auth) **and 6443** (kube API) — see the KB 449287 note under
> step 3. Cross-check the live set against
> [`07-firewall-ports.md`](07-firewall-ports.md) and the VCFA / Supervisor
> port docs before turning on `default-deny`. On a **CTGW** build do **not**
> re-create these rules on the upstream Tier-0 — enforce once, on the TGW.

> **Confirming a Supervisor-path drop on the runtime deployment model.** VCF
> Automation 9 runs as pods on a services runtime, so an SSH session on the
> runtime node tests the *node's* egress, not the automation pods' path (a
> different egress / SNAT address, plus a sidecar in that namespace). Two
> reliable checks:
> - **Read the TGW GFW log** ([Reading the gateway-firewall log](#reading-the-gateway-firewall-log))
>   with `default-deny` staged as **Allow + Logging**: reproduce the Services
>   view, then filter for `DROP` to the Supervisor control-plane VIP on **dst
>   443**. The source IP in the drop line is what `grp-vcfa` must contain —
>   often the runtime's **egress/SNAT IP**, not a node management address.
> - **Test from the pod's netns** — `kubectl -n <automation-ns> exec` (the
>   Photon-based pods usually have `curl`) or, for a distroless container,
>   `kubectl -n <automation-ns> debug -it <pod> --target=<ctr> --image=<local-registry>/netshoot`
>   then `nc -zv <sup-cp-vip> 443` and `6443`. In an air-gapped site the debug
>   image has to be in the depot / local registry
>   ([`20-supervisor-image-registry.md`](20-supervisor-image-registry.md)).
> - **Check the Supervisor side in isolation** — get a cluster-admin `kubectl` on
>   the Supervisor control plane
>   ([`10-supervisor-enablement.md`](10-supervisor-enablement.md#break-glass-access-to-the-supervisor-control-plane))
>   and confirm `kubectl -n <ns> get svc,supervisorservices` is healthy there. If
>   it is, the break is on the path *to* the Supervisor (this firewall, the DFW,
>   a proxy no-proxy gap, cert trust, or DNS), not on the Supervisor.

#### VM web console ports (443 vs 902)

The design page is inconsistent about the `VC Webconsole` flow: its rules table
lists **HTTPS** (443), while its naming-convention section shows
**`svc-vc-webconsole` = TCP 902**. Both are real — a VM web console (WebMKS)
session opens on **443 to vCenter** for the ticket, then the console stream runs
on **902 to the ESXi host**. Put **both TCP 443 and TCP 902** in
`svc-vc-webconsole`, source `grp-vcfa-mgmt`, destination `grp-esx-hosts` (and
vCenter if it is a separate group), and confirm against the log which the VCFA
UI actually uses in your build before tightening.

---

## Protecting tenant traffic with vDefend and Avi

**[documented]**, from the *Protecting Tenant Traffic with vDefend and Avi*
chapter. Most of that chapter is the **virtual service + HTTP redirect
policies**, covered elsewhere —
[Building the virtual service](14-avi-load-balancer.md#building-the-virtual-service)
and [Locking the portals to known client IPs](#locking-the-portals-to-known-client-ips-pattern-3-avi-http-configuration).
This section captures the parts that are *not* in those: where the Service
Engines sit, the DFW exclusion-list sequence, and the licensing gates.

### Service Engine placement

- The SEs run **one-arm** load balancing for VCF Automation, deployed in the
  **DMZ VPC services subnet**.
- The virtual-service **VIP is a static address from the external IP block**,
  externally facing, and front-ends the **three internal VCF Automation node
  IPs** as pool members (through the internal built-in-LB VIP — see the VS build
  section).
- The design page confirms the field values already documented above:
  **`System-Persistence-Http-Cookie`** persistence on the pool, an **HTTPS
  health monitor hitting `/api/server_status`** (response codes **2xx and
  3xx**), a **`System-Standard` SSL profile with SNI**, the **pool default port
  443**, and the virtual service on **application type HTTP/HTTPS** with the
  **`System-HTTP`** application profile — treat those as **[documented]**.
- **Creating the VS VIP against the VPC's PUBLIC subnet.**
  [`14-avi-load-balancer.md`](14-avi-load-balancer.md#building-the-virtual-service)
  builds the VS through Avi's **Advanced UI wizard**, picking the DMZ VPC's VRF
  context and auto-allocating from the public subnet — the path on a
  **VCF-Operations-managed Avi** (NSX Cloud auto-created, VPC auto-detected), and
  the one to use here. The design page instead hand-builds the VIP from the
  **Avi CLI** (`configure vsvip` → `tier1_lr /orgs/default/projects/<NSX
  project>/vpcs/<VPC>` → `subnet_uuid <NSX
  project>_AVISEPARATOR_<VPC>_AVISEPARATOR_PUBLIC` → `prefix_length 32`); that
  form is only needed for a hand-built NSX-VPC + Avi integration where the
  wizard has no field for the VPC / Tier-1 reference.

### The DFW exclusion-list sequence

**First, activate the DFW.** The Distributed Firewall is not on by default — the
design page: *"DFW must be activated for the vSphere cluster from NSX Manager >
Security > Distributed Firewall > Settings."* Do this before the steps below,
and before it matters the vDefend firewall licence must be applied
([Licensing gates](#licensing-gates--all-before-you-start)).

Then, in order:

1. **Before deploying Service Engines** — add the SEs (by SE segment or a group)
   to the **NSX Distributed Firewall exclusion list**. A partially-configured SE
   with DFW applied can wedge during bring-up.
2. **Deploy the SEs** (or let Avi place them). Confirm they come up
   **Connected** and the VS is green.
3. **Post-install hardening** — **remove the SEs from the exclusion list** so
   DFW policy applies to them again. If your hardening plan calls for policing
   VCF management components with vDefend, this is also where you remove
   **`VCF-Created-Virtual-Machines`** members from the exclusion list — by
   default they stay excluded (see
   [Protecting the Avi management plane](#protecting-the-avi-management-plane-pattern-3-gateway-firewall)).
4. **Re-validate** — SEs still Connected, VS still green, tenant path still works
   with the DFW now enforcing.

> **The design page contradicts itself on what leaves the exclusion list.** Its
> 2026-10-19 *Order of Operations Summary* ends with *"Remove VCF Management
> Components from the distributed firewall exclusion list."* Its own
> *Protecting VCF Automation Management Traffic* section still describes those
> components as staying in `VCF-Created-Virtual-Machines`, excluded from every
> DFW rule, with the TGW firewall carrying VCFA's path to them. This guide
> follows the second reading: take the **SEs** out after install (step 3), and
> take the **VCF management components** out only as part of a planned
> [vDefend lateral security](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/security-modernization/vdefend-lateral-security.html)
> rollout. Removing them without DFW rules for the management plane in place
> puts vCenter, NSX Manager and SDDC Manager behind whatever the DFW default
> rule is.

### Licensing gates — all before you start

Both licence types come through **License Hub** —
[`15-license-hub.md`](15-license-hub.md) (deployed from the SSP Installer);
gate on *vDefend **or** Avi in scope*.

- **Avi needs a valid licence before Service Engines can come online** —
  Enterprise tier. See [`15-license-hub.md`](15-license-hub.md) for the licence
  itself and [`14-avi-load-balancer.md` → Licensing](14-avi-load-balancer.md#licensing)
  for attaching it.
- Avi must be **deployed via VCF Operations fleet management into the VCF
  management domain** and **integrated with that domain's instance** — not a
  standalone Avi.
- **vDefend firewall licensing must be applied before you can configure the DFW**
  or the stateful TGW / T1 gateway firewalls (layers 1, 2 and 5) —
  [`15-license-hub.md`](15-license-hub.md). Security Intelligence / NDR
  additionally need the **vDefend SSP** ([`18-vdefend-ssp.md`](18-vdefend-ssp.md)).

> The WAF Positive-Security-Model detail from this chapter (PSM rules on the
> All-Apps / VM-Apps org endpoints, the safe-character string group, the
> XSS / HTTP-response-splitting rule exceptions) is written up separately in
> [Web Application Firewall on the VCFA virtual service](#web-application-firewall-on-the-vcfa-virtual-service).

> **Finer east-west segmentation for the VCF management components** — beyond
> the exclusion-list on/off decision — is the **vDefend lateral security**
> workflow: [Lateral Security for VMware Cloud Foundation with vDefend](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vvs/9-X/lateral-security-for-vmware-cloud-foundation-with-vmware-vdefend.html).
> Out of scope for this page.

---

## Locking the portals to known client IPs (Pattern 3 "Avi HTTP configuration")

**[documented]**, from the design page's **Avi HTTP Configuration** chapter.
That chapter is *not* TLS/cipher hardening despite the name — it is
**IP-based portal segregation**: L7 HTTP request rules on the VCFA virtual
service that decide *who may reach which login surface*.

What it accomplishes:

- **The Provider (admin) portal is pinned to your management networks.** A
  client whose source IP is **not** in the provider IP group and that asks for
  `/provider` — or `/login?service=provider` — is redirected to the generic
  `automation/` tenant login. The privileged UI is never presented off the
  management network, so recon / credential-stuffing / brute-force against the
  admin login from tenant networks or the internet is turned away at the load
  balancer before it reaches VCFA.
- **(Optional) each tenant portal is pinned to that tenant's client IP
  ranges** — same rule shape on `/tenant/<tenant>` and
  `/login?service=tenant:<tenant>`, redirecting non-matching sources to
  `automation/`. Enforces tenant isolation at the edge.

These are **redirects, not authorization** — a misrouted legitimate user lands
on the standard login rather than an error, and RBAC inside VCFA still makes
the real access decision. It is a surface-reduction control.

> **Scope.** This section covers only the design page's **HTTP configuration**
> (the redirect policies). The WAF policy is a separate object, built in
> [Web Application Firewall on the VCFA virtual service](#web-application-firewall-on-the-vcfa-virtual-service);
> both get attached to the same VS.

### Walkthrough — the redirect policies

> **Keep a way back in.** The provider rule below will redirect *you* too if
> your browser's source IP is not in the provider IP group. Before you attach
> it, confirm the IP group contains the address you are actually browsing from
> (post-NAT — see the caveat at the end), and keep the Avi Controller reachable
> by SSH / a management-IP browser in case you need to detach the policy.

#### 1. Create the IP group(s)

`Templates > Load Balancer > Groups > IP Group > Create`.

- **Provider Users** — add the **management-station subnets / jump-host
  addresses** the provider admins browse from. Prefixes and single IPs both
  work.
- **`<tenant>` Users** (optional, one per tenant) — e.g. **Tenant1 Users** with
  that tenant's known client CIDRs. Skip these if you only want to lock the
  provider portal.

Whatever address the Service Engine actually *sees* as the client is what these
groups are matched against — so populate them with post-NAT addresses if
anything in front of the SE source-NATs.

#### 2. Create the Provider redirect HTTP Policy Set

`Templates > Policies > HTTP Policy Set > Create`. Name it e.g.
**vcfa-provider-redirect**. Add **two HTTP Request** rules (Rules tab → Add
Rule):

**Rule 1 — `Redirect Provider - Path`**

| Part | Setting |
| ---- | ------- |
| Match → **Client IP Address** | Condition **Is Not In**, IP Group **Provider Users** |
| Match → **Path** | Criteria **Begins With**, string **`/provider`** |
| Action → **HTTP Redirect** | **Path** = `automation/` (no leading slash — enter it exactly). **Uncheck "Keep Query"**. Leave Protocol / Host / Port at their defaults (same virtual service); the default **302 (Found)** status is fine. |

**Rule 2 — `Redirect Provider - Query`**

| Part | Setting |
| ---- | ------- |
| Match → **Client IP Address** | **Is Not In** → **Provider Users** |
| Match → **Path** | **Begins With** → **`/login`** |
| Match → **Query** | value **`service=provider`** (use **Equals** if that is the whole query string, otherwise **Contains**) |
| Action → **HTTP Redirect** | **Path** = `automation/`, **uncheck "Keep Query"**, defaults otherwise |

All match elements within a rule are ANDed. The two rules match disjoint URLs
(`/provider` vs `/login?service=provider`), so their order in the set does not
matter here; rules are still evaluated top-down, first match wins.

#### 3. Create a per-tenant redirect HTTP Policy Set (optional, per tenant)

Same shape as step 2, one policy set per tenant, e.g.
**vcfa-tenant1-redirect** with two rules:

| Rule | Match (all of) | Action |
| ---- | -------------- | ------ |
| `Redirect Tenant1 - Path` | Client IP **Is Not In** **Tenant1 Users** · Path **Begins With** **`/tenant/tenant1`** | Redirect Path `automation/`, Keep Query **off** |
| `Redirect Tenant1 - Query` | Client IP **Is Not In** **Tenant1 Users** · Path **Begins With** **`/login`** · Query **`service=tenant:tenant1`** | Redirect Path `automation/`, Keep Query **off** |

(The design page labels these two rules "Provider request rule - Path/Query" —
that is a copy-paste slip in the doc; name them per-tenant so the VS config
stays readable.)

#### 4. Attach the policy sets to the virtual service

A created HTTP Policy Set does nothing until it is bound to the VS. The design
page stresses this: *"Ensure that the newly created ... HTTP policies are
applied to the Virtual service!"*

`Applications > Virtual Services >` the VCFA VS `> edit` → scroll to
**Policies** → add the **provider redirect** policy set and each **per-tenant
redirect** policy set → **Save**.

The redirect rules take effect immediately on save.

#### 5. Validate

- From a **management IP** (in Provider Users): `https://<vcfa-fqdn>/provider`
  loads the provider login normally.
- From an **IP not in any group**: the same URL 302-redirects to
  `https://<vcfa-fqdn>/automation/` (the generic tenant login). Check with
  `curl -sI` and look for `Location: .../automation/`.
- Per tenant: a client outside **Tenant1 Users** hitting `/tenant/tenant1` gets
  the same redirect; a client inside it reaches the tenant login.
- Avi **VS → Logs** (enable non-significant logs) shows the redirected requests
  with the matched rule name.

> **The rules match on client *source* IP — so the SE must see the real
> client [field caveat].** If any hop in front of the Service Engine
> source-NATs the traffic (an upstream firewall, or the VS itself SNAT'ing to
> the pool), every client collapses to one address and these rules either
> allow everyone or lock everyone out. Confirm the VS preserves client IP — or
> that the rules are written against `X-Forwarded-For` — **before** enabling
> the provider rule, especially where the DMZ path crosses a Tier-0 / VRF
> boundary.

> **The rules encode VCFA's URL scheme** (`/provider`, `/tenant/<name>`,
> `/login?service=…`). Re-validate them after a VCFA patch — a routing change
> upstream in the product will silently break the match.

---

## Web Application Firewall on the VCFA virtual service

**[documented]**, from the *Avi Web Application Firewall (WAF) Configuration*
chapter. This adds L7 application-level filtering to the VS: a
**Positive Security Model (PSM)** that validates a set of VCF Automation API
requests against a known-safe character set, with **targeted CRS exceptions**
so VCFA's own JSON/XML API bodies don't trip the signature rules.

It is a **separate object** from the HTTP redirect policies in
[Locking the portals](#locking-the-portals-to-known-client-ips-pattern-3-avi-http-configuration)
— both attach to the same VS. The design page does not define an evaluation
order; the HTTP redirect policies are the coarser control and logically run
first.

> **Licensing.** WAF is an Avi **Enterprise**-tier feature, and *"Avi requires
> a valid license before Service Engines can come online"* — get the licence via
> [`15-license-hub.md`](15-license-hub.md) and attach it per
> [`14-avi-load-balancer.md` → Licensing](14-avi-load-balancer.md#licensing)
> first.

### Walkthrough — the WAF objects

#### 1. Create the WAF Profile

`Templates > WAF > WAF Profile > Create` (clone the system profile). Two
changes for VCFA:

- **Allowed HTTP methods** — add **`PUT`**, **`PATCH`**, **`DELETE`** to the
  defaults (the VCFA API uses all three).
- **Content-Type mapping** — add two entries so structured bodies are parsed,
  not treated as opaque strings:
  - `application/*+json` → Request Parser **JSON**
  - `application/*+xml` → Request Parser **XML**

#### 2. Create the safe-characters String group

`Templates > Groups > String Group > Create`. Name it something explicit
(the design page uses a key like **`VCFA_BLUEPRINTS`**), one entry, the regex
verbatim:

```
^\[0-9A-Za-z.\_ \\t:,!?+\*=@#\\-\\$\\(\\)\\&\\'\\/\\\[\\\]\]\*$
```

This is the same string group the [redirect-policies section](#locking-the-portals-to-known-client-ips-pattern-3-avi-http-configuration)
mentions seeding — one group, reused here.

#### 3. Create the Positive Security group

`Templates > WAF > Positive Security > Create`. Set **Miss Action** =
**`Flag or Reject`** — without it the PSM is defined but not enforced. Add two
location-scoped rules, both matching the **safe-characters string group**:

| Rule ID | Scope (Path) | Match elements |
| ------- | ------------ | -------------- |
| **10001** | `/blueprint/api/blueprints` (All-Apps org) | `ARGS` key `content` · `ARGS_NAMES` key `$select` |
| **10002** | `/project-service/api/projects`, `/provisioning/uerp`, `/form-service/api/forms`, `/provisioning/mgmt`, `/provisioning/resources` (VM-Apps org) | `ARGS` `$filter`, `odataQuery`, `network.instanceAdapterReference`, `size` · `ARGS_NAMES` `$select` · `ARGS` **Contains** `constraints` |

Each listed argument on those paths must match the safe-character regex or the
Miss Action fires.

#### 4. Create the WAF Policy with the VCFA exceptions

`Templates > WAF > WAF Policy > Create` (clone `System-WAF-Policy`). Reference
the WAF Profile from step 1 and the Positive Security group from step 3, then
add the exceptions that keep VCFA's API bodies from false-positiving:

- **Pre-CRS rule** — disable protocol-validation rule **`920600`** for JSON
  requests:
  ```
  SecRule REQUEST_HEADERS:Accept "@beginsWith application/json" \
    "phase:1,id:5000020,nolog,pass,t:lowercase,ctl:ruleRemoveById=920600"
  ```
- **CRS exception — HTTP response splitting** (rule **`921130`**): Subnet
  **Any**, Path **Any**, Match Element **`ARGS:body`**.
- **CRS exception — XSS** (whole **`CRS_941_Application_Attack_XSS`** group):
  Subnet **Any**, Path **Any**, Match Element **`ARGS:body`**.

Both exceptions scope to **`ARGS:body`** specifically — legitimate JSON/XML
payloads VCFA posts there otherwise match XSS / response-splitting signatures.

#### 5. Set the policy mode

The design page sets the policy straight to **Enforcement**.

> **Stage in Detection first anyway [field caveat].** Set **Policy Mode =
> Detection**, attach it (step 6), then exercise VCFA hard — UI in every
> section, a Terraform/API run, a catalog deploy, a large upload. Read
> **VS → Logs → WAF** for `FLAGGED` hits the design's exception list didn't
> anticipate (websocket upgrade, base64 tokens, large bodies), resolve each
> with a rule-level exclusion, then flip to **Enforcement** — or use
> **Allow Mode Delegation** to enforce most rules while holding the noisy ones
> in Detection.

#### 6. Attach to the virtual service

`Applications > Virtual Services >` the VCFA VS `> edit`:

1. **Policies** — the HTTP redirect policy set(s) from the previous section.
2. **Security** — select this **WAF Policy**.
3. **Save.**

Design page, verbatim: *"Ensure that the newly created WAF policies and HTTP
policies are applied to the Virtual service!"*

#### 7. Validate

- A normal VCFA session (login, browse blueprints, create a project, deploy)
  works with no `REJECTED` entries in **VS → Logs → WAF**.
- A request to `/blueprint/api/blueprints` with a disallowed character in
  `content` or `$select` is flagged/rejected per the Miss Action.
- The XSS / response-splitting exceptions show as applied (no false `941xxx` /
  `921130` rejects on legitimate API bodies).

---

## Protecting the Avi management plane (Pattern 3 gateway firewall)

**[documented]**, from the *Protecting Management Traffic* chapter of the design
page. Two distinct problems, solved in two different places:

- **Avi control-plane traffic** (Service Engine ↔ Controller, and SE → the VCFA
  backend) — locked down with a **gateway firewall policy on the NSX Tier-1**
  that the Avi management segment sits behind. *"Avi management network is on a
  NSX segment that is backed by a NSX T1 Gateway which controls traffic to the
  Avi management plane."*
- **VCF Automation management traffic** — the VCFA nodes are VCF-created, so NSX
  puts them in the **`VCF-Created-Virtual-Machines`** User Excluded group and
  *"All of the VCF management components are automatically excluded from any of
  the firewall rules created in DFW"*. You therefore cannot police VCFA east-west
  with the DFW at all — cross-network flows are allowed explicitly on the
  **Transit Gateway gateway firewall** instead (the rules in
  [Segregating tenant traffic at the Transit Gateway](#segregating-tenant-traffic-at-the-transit-gateway-pattern-3-tgw-gateway-firewall)),
  and granular control beyond that is the vDefend lateral-security path.

### Walkthrough — the `policy-avi-ux` T1 gateway firewall

#### 1. Find the Tier-1 the Avi management segment is on

`Networking > Tier-1 Gateways`. The SE management-plane network you built in
[`14-avi-load-balancer.md` → Service Engine infrastructure](14-avi-load-balancer.md#service-engine-infrastructure--cloud-content-library-and-se-group)
is a segment on a T1 — that T1 is where these rules go. **Gateway firewall on
the T1, not DFW** — DFW would not see this traffic consistently and would not
touch VCF-created VMs anyway.

#### 2. Build the NSX groups

`Inventory > Groups > Add Group`:

| Group | Members |
| ----- | ------- |
| **grp-avi-se-mgmt** | the Service Engine **management** interfaces — by the SE mgmt segment, an SE tag, or the SE mgmt subnet CIDR |
| **grp-avi-controllers** | the Controller node IP(s) (1 or 3) **and** the cluster VIP |
| **grp-vcfa-backend** | the VCFA internal built-in-LB VIP **and** the VCFA node IPs (same target the Avi pool uses) |
| **`grp-mgmt-admin`** *(only for the optional SSH rule below — the **same group** as in [Segregating tenant traffic at the Transit Gateway](#segregating-tenant-traffic-at-the-transit-gateway-pattern-3-tgw-gateway-firewall); build it once)* | the management / jump-host networks your operators connect from — a CIDR or IP set |

#### 3. Create the custom L4 services

**NSX ships no predefined service for TCP 8443 or TCP 9001** — both have to be
created before the policy can reference them, or the Service picker in step 4
has nothing to select. **[field-verified]**

`Inventory > Services > Add Service` → **Service Entries > Set > Add Service
Entry**, *Type* = **L4 Port Set**, *Protocol* = **TCP**, *Destination Ports* =
the single port:

| Service | Protocol / port | Used by |
| ------- | --------------- | ------- |
| **`svc-avi-keyx-8443`** | TCP 8443 | rule 1 (SE→Controller keyx channel) and rule 2 (SE→VCFA backend pool) |
| **`svc-avi-objstore-9001`** | TCP 9001 | rule 1 (SE→Controller object store) |

> Any other non-standard TCP/UDP port the *Avi Ports & Protocols* list calls for
> on your version (see step 5) needs the same treatment — predefined services
> exist for the common ones (SSH, NTP, HTTPS, DNS) but not for Avi's
> higher-numbered channels.

#### 4. Create the gateway firewall policy

`Security > Gateway Firewall >` select the **T1** from step 1 `> Add Policy`,
name it **`policy-avi-ux`**. An NSX firewall rule takes a **list** of services, so
each source/destination pair collapses to one rule. Add these rules, **Applied
To** = that T1:

| # | Name | Source | Destination | Service | Action |
| - | ---- | ------ | ----------- | ------- | ------ |
| 1 | `allow-se-to-controller` | grp-avi-se-mgmt | grp-avi-controllers | **`svc-avi-keyx-8443`**, **SSH** (TCP 22), **NTP** (UDP 123), **`svc-avi-objstore-9001`** | Allow |
| 2 | `allow-se-to-vcfa` | grp-avi-se-mgmt | grp-vcfa-backend | **`svc-avi-keyx-8443`** (TCP 8443), **HTTPS** (TCP 443) | Allow |
| 3 | `allow-mgmt-ssh` *(optional)* | `grp-mgmt-admin` | grp-avi-controllers, grp-avi-se-mgmt, grp-vcfa-backend | **SSH** (TCP 22) | Allow |
| 4 | `default-deny` | Any | Any | Any | **Drop** (enable **Logging**) |

Rule 1 is the design page's four SE→Controller flows (keyx channel, SSH, NTP,
object store) as one rule; rule 2 is the SE→VCFA backend path (backend pool +
web). Split them back out into a rule per flow only if you want per-flow hit
counters. The gateway firewall is **stateful**, so return traffic on each
allowed flow is automatic — you only add the connection-initiation direction.

> **Rule 3 is optional and not prescribed by the Broadcom design page.** The
> design page's port set is SE↔Controller and SE→VCFA only — it says nothing
> about operator access. Once the `default-deny` rule is enforcing default-deny, an
> admin on the management network can no longer SSH to the Controllers, SEs or
> VCFA nodes through this T1. Add `allow-mgmt-ssh` **only if** your operators
> connect to those nodes directly (rather than via a bastion inside the
> segment), and scope `grp-mgmt-admin` as tightly as the jump-host subnets
> allow.

#### 5. Before you flip the `default-deny` rule to Drop

> **The design page's list is a template, not a validated exhaustive port set
> [field caveat].** Cross-check the current **Avi Ports & Protocols** for your
> version before enforcing default-deny, and expect to also need SE →
> **DNS**, SE → **NTP** (if your NTP source is not the Controller), SE → the
> segment **gateway**, and possibly a Controller→SE return path for
> SE lifecycle orchestration. Stage the **`default-deny`** rule as **Allow +
> Logging** first, run the validation in step 6 below, read the log
> ([Reading the gateway-firewall log](#reading-the-gateway-firewall-log)) for
> what the allowlist missed, then switch it to **Drop**.

#### 6. Validate

- From a Controller (CLI) or an SE shell, confirm the allowed flows: the
  8443 keyx channel, SSH, TCP 9001, and the backend pool to `grp-vcfa-backend` on
  8443/443.
- `Security > Gateway Firewall >` check the **hit counters** — the allow rules
  incrementing (incl. `allow-mgmt-ssh` if you added it), the `default-deny` rule
  catching only what you expect.
- In Avi, confirm **SEs still show Connected** and the VCFA VS stays **green**
  after the `default-deny` rule is set to Drop — that is the "did I miss a port"
  check.
- If you added `allow-mgmt-ssh`, confirm you can still `ssh` to a Controller,
  an SE and a VCFA node from the management network after the `default-deny` rule
  is Drop.

#### 7. VCF Automation side — nothing to do on the DFW

VCFA's management traffic is already unrestricted between VCF components (the
`VCF-Created-Virtual-Machines` exclusion). The only firewalling that applies to
it is on the **Transit Gateway** — the `policy-vcfa` rules in
[Segregating tenant traffic at the Transit Gateway](#segregating-tenant-traffic-at-the-transit-gateway-pattern-3-tgw-gateway-firewall)
(`allow-vcfa-orchestrator`, `allow-vcfa-supervisor`, and so on). If you need finer
east-west segmentation for VCFA than the exclusion allows, that is **vDefend**
(gateway firewall / distributed IDS-IPS), configured per
[Lateral Security for VMware Cloud Foundation with vDefend](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vvs/9-X/lateral-security-for-vmware-cloud-foundation-with-vmware-vdefend.html)
— out of scope here.

---

## Validate the whole tenant path

Once all five layers are in, run the design page's *Validate Tenant Traffic*
check end to end — it exercises every layer at once:

1. **Reach the tenant portal by the *external* DNS name** —
   `https://<vcfa-fqdn>/` from a tenant-side client resolves (external DNS → the
   Avi VIP) and loads the tenant login. From a **management-side** client the
   same name resolves to the node IPs (internal DNS) and reaches VCFA directly —
   [Split DNS](#split-dns-and-split-networking-optional).
2. **Provider portal is management-only** — `/provider` from a management IP in
   `Provider Users` loads; from anywhere else it 302-redirects to `automation/`
   ([layer 3](#locking-the-portals-to-known-client-ips-pattern-3-avi-http-configuration)).
3. **Tenant access control works** — log in as a tenant user and confirm the
   org's integrated access control (roles, projects, catalog) behaves.
4. **Deploy a workload** — it provisions; `allow-vcfa-orchestrator` and
   `allow-vcfa-supervisor` (443 + 6443) carry the reconcile, the **Services**
   view lists the Supervisor namespaces, and the WAF logs no `REJECTED` on
   the API bodies ([layer 4](#web-application-firewall-on-the-vcfa-virtual-service)).
5. **Open a VM web console** from the VCFA UI — `grp-vcfa-mgmt → grp-esx-hosts`
   on 443 / 902 ([VM web console ports](#vm-web-console-ports-443-vs-902)).
6. **Check the hit counters on all three firewalls** — the DFW, the TGW GFW
   (`policy-*` allow rules incrementing, `default-deny` only noise), and the T1
   GFW (`policy-avi-ux`). Read the log
   ([Reading the gateway-firewall log](#reading-the-gateway-firewall-log)) for
   anything the allowlists missed.
7. **Flip to enforce and re-test** — set the DFW / GFW default rules to
   **Deny / Drop** and repeat 1–5. A tenant login that still works, and a
   from-the-internet probe to any other port/host that is dropped, is the
   pass condition.

---

## References

- **Design page** — [Securing VCF Automation Deployment (Pattern 3) with vDefend and Avi](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/application-modernization/multi-tenat-design-for-a-modern-private-cloud/implementation-of-self-service-multi-tenant-private-cloud/securing-vcf-automation.html)
  — the blueprint this guide implements. Last aligned with its revision of
  2026-10-19 (#415).
- [Broadcom Ports and Protocols](https://ports.broadcom.com/) — VCF Automation
  and VCF Management Services 9.1 rows, for the sources of the health-check and
  lifecycle ports in [layer 1](#segregating-tenant-traffic-at-the-transit-gateway-pattern-3-tgw-gateway-firewall).
- [Lateral Security for VMware Cloud Foundation with vDefend](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vvs/9-X/lateral-security-for-vmware-cloud-foundation-with-vmware-vdefend.html)
  — granular east-west segmentation for the VCF management components.
- [Manage a Firewall Exclusion List](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/vdefend-firewall/9-0/vdefend-distributed-firewall/configuring-distributed-firewall/about-firewall-rules/manage-a-firewall-exclusion-list.html)
  — the DFW exclusion-list operations in [layer 2](#the-dfw-exclusion-list-sequence).
- [Guidance to Write Efficient vDefend Firewall Rules](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/vdefend-firewall/9-0/vdefend-distributed-firewall/configuring-distributed-firewall/about-firewall-rules/guidance-to-write-efficient-and-secure-firewall-rules.html)
- [Broadcom KB 449287 — "Services are not available for this namespace"](https://knowledge.broadcom.com/external/article/449287/error-services-are-not-available-for-thi.html)
  — VCFA cannot reach the Supervisor on **443 (WCP auth) / 6443 (kube API)**; the
  failure mode this guide's `allow-vcfa-supervisor` rule (443 + 6443) prevents.
- **Field write-up** — Tom Fojta, [Load Balancing VCF Automation with Avi](https://fojta.wordpress.com/2025/08/16/load-balancing-vcf-automation-with-avi/)
  — the DMZ VPC + Avi VS build this guide's prerequisites come from, the split-DNS
  "redirects back to the internal VIP" failure mode, and an HTTP/2 (`gRPC` /
  VKS agent) requirement with an Avi 32.1.1 HEAD-request workaround.
- **In this repo** (the *Prerequisites* list at the top of this page links each in build order) —
  [`14-avi-load-balancer.md`](14-avi-load-balancer.md) (the Avi deploy + the VCFA virtual service),
  [`05-day2-deployments.md`](05-day2-deployments.md) (deploying VCF Automation, the Fleet LCM API, the node IP pool),
  [`10-supervisor-enablement.md`](10-supervisor-enablement.md) (the Supervisor VCFA runs on + the Edge cluster / Tier-0 for the Centralized connection),
  [`17-vcfa-tenant-config.md`](17-vcfa-tenant-config.md) (region, external IP block, tenant org),
  [`15-license-hub.md`](15-license-hub.md) (vDefend + Avi licensing),
  [`18-vdefend-ssp.md`](18-vdefend-ssp.md) (the vDefend SSP that backs Security Intelligence / NDR).
