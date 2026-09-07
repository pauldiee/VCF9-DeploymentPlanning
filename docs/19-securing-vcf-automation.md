# Securing the External-Facing VCF Automation Deployment (Pattern 3)

Walkthroughs for Broadcom's [Securing VCF Automation
Deployment](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-blueprints-for/application-modernization/multi-tenat-design-for-a-modern-private-cloud/implementation-of-self-service-multi-tenant-private-cloud/securing-vcf-automation.html)
design page — the hardening that goes around an **external-facing (Deployment
Pattern 3)** VCF Automation instance: a **DMZ VPC** for tenant access, an Avi
virtual service in front, and NSX firewalling on every hop.

> **Prerequisite.** This assumes the external-facing VCFA virtual service is
> already built — see
> [`14-avi-load-balancer.md` → VCF Automation (external/customer access)](14-avi-load-balancer.md#vcf-automation-externalcustomer-access)
> for the DMZ VPC, the Service Engine infrastructure, and the VS / pool / health
> monitor. Everything here layers onto that.

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

> **Licensing.** The stateful GFW / vDefend Gateway Firewall needs
> **vDefend licensing** — plain VCF ships only a *stateless* gateway firewall.
> See [`15-license-hub.md`](15-license-hub.md).

### Walkthrough — the TGW gateway firewall

#### 1. Confirm the GFW is available on the DMZ TGW

`Security > Gateway Firewall` → select the DMZ project's **Transit Gateway**. If
the stateful rule options are greyed out, the vDefend firewall licence is not
applied yet — fix that first.

#### 2. Build the groups

`Inventory > Groups`:

| Group | Members |
| ----- | ------- |
| **DNS-Servers**, **LDAP-Servers** | the infra-service endpoints tenants and VCFA resolve/bind against |
| **Avi-SE** | the Service Engine data/VIP interfaces in the DMZ VPC services subnet |
| **VCFA** | the VCF Automation node IPs |
| **VCFA-VIP** | the external-facing virtual-service VIP (from the external IP block) |
| **VCFA-Management-IPs** | the VCFA management interfaces |
| **Orchestrator** | the VCF Automation Orchestrator endpoint |
| **vSphere-Supervisor** | the Supervisor control-plane VIP(s) |
| **ESX-Hosts** | the management-domain ESXi hosts (for the VM web console) |

#### 3. Create the policies and rules on the TGW GFW

**Applied To** = the Transit Gateway for every rule. Policies evaluate
top-down; keep this order.

**`Policy-Infra-Services`**

| Name | Source | Destination | Service | Action |
| ---- | ------ | ----------- | ------- | ------ |
| `DNS` | Any | DNS-Servers | **DNS** | Allow |
| `LDAP` | Any | LDAP-Servers | **LDAP** + **LDAP-UDP** | Allow |

**`Policy-Avi`**

| Name | Source | Destination | Service | Action |
| ---- | ------ | ----------- | ------- | ------ |
| `allow-web` | Any | Avi-SE | **TCP 80, 443** | Allow |

**`Policy-VCFA`**

| Name | Source | Destination | Service | Action |
| ---- | ------ | ----------- | ------- | ------ |
| `VCFA-to-Orchestrator` | VCFA | Orchestrator | **HTTPS** | Allow |
| `VCFA-to-Supervisor` | VCFA | vSphere-Supervisor | **TCP 6443** | Allow |
| `gw-health-check` | Any | VCFA-VIP | **TCP 8008** | Allow |
| `VC Webconsole` | VCFA-Management-IPs | ESX-Hosts | **HTTPS** | Allow |

**`Default-Deny`**

| Name | Source | Destination | Service | Action |
| ---- | ------ | ----------- | ------- | ------ |
| `Default-Deny` | Any | Any | Any | **Deny** (enable **Logging**) |

The GFW is **stateful** — only the connection-initiation direction is listed;
return traffic is automatic.

#### 4. Stage before enforcing

Set `Default-Deny` to **Allow + Logging** first. Exercise the full tenant path
— reach the VIP, log in, browse the catalog, deploy a workload, open a VM web
console — then read the drop log for anything the allowlist missed before
switching the rule to **Deny**.

#### 5. Validate

- External client → **VCFA-VIP:443** works; the same client to any other
  port/host is dropped.
- `gw-health-check`: the load-balancer probe to **8008** succeeds and the VS
  stays green.
- Deploy a test workload — `VCFA-to-Orchestrator` (HTTPS) and
  `VCFA-to-Supervisor` (6443) carry the reconcile.
- A VM **web console** opens from the VCFA UI (`VCFA-Management-IPs → ESX-Hosts`
  on 443).
- `Default-Deny` hit counter catches only noise.

> **The port list is the design's example, not a validated superset [field
> caveat].** `TCP 8008` is VCFA's built-in-LB health port and `6443` the
> Supervisor API, but cross-check the live set against
> [`07-firewall-ports.md`](07-firewall-ports.md) and the VCFA / Supervisor
> port docs before turning on `Default-Deny`. On a **CTGW** build do **not**
> re-create these rules on the upstream Tier-0 — enforce once, on the TGW.

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
  health monitor hitting `/api/server_status`**, and **`System-Standard` SSL
  profile with SNI** — so treat those as **[documented]**, not just
  field-reported.

### The DFW exclusion-list sequence

Do these in order:

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

### Licensing gates — all before you start

- **Avi needs a valid licence before Service Engines can come online** — see
  [`14-avi-load-balancer.md` → Licensing](14-avi-load-balancer.md#licensing)
  (License Hub / Enterprise tier).
- Avi must be **deployed via VCF Operations fleet management into the VCF
  management domain** and **integrated with that domain's instance** — not a
  standalone Avi.
- **vDefend firewall licensing must be applied before you can configure DFW**
  (and the stateful TGW GFW in the section above).

> The WAF Positive-Security-Model detail from this chapter (PSM rules on the
> All-Apps / VM-Apps org endpoints, the safe-character string group, the
> XSS / HTTP-response-splitting rule exceptions) is written up separately in
> [Web Application Firewall on the VCFA virtual service](#web-application-firewall-on-the-vcfa-virtual-service).

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
> a valid license before Service Engines can come online"* — settle
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
    "id:1000,phase:1,pass,nolog,ctl:ruleRemoveById=920600"
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

### Walkthrough — the `plcy-Avi-UX` T1 gateway firewall

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
| **grp-Avi-SE** | the Service Engine **management** interfaces — by the SE mgmt segment, an SE tag, or the SE mgmt subnet CIDR |
| **grp-Avi-Controllers** | the Controller node IP(s) (1 or 3) **and** the cluster VIP |
| **grp-VCFA** | the VCFA internal built-in-LB VIP **and** the VCFA node IPs (same target the Avi pool uses) |

#### 3. Create the gateway firewall policy

`Security > Gateway Firewall >` select the **T1** from step 1 `> Add Policy`,
name it **`plcy-Avi-UX`**. Add these rules, **Applied To** = that T1:

| # | Name | Source | Destination | Service | Action |
| - | ---- | ------ | ----------- | ------- | ------ |
| 1 | `allow-keyx-channel` | grp-Avi-SE | grp-Avi-Controllers | **TCP 8443** | Allow |
| 2 | `allow-ssh` | grp-Avi-SE | grp-Avi-Controllers | **SSH** (TCP 22) | Allow |
| 3 | `allow-NTP` | grp-Avi-SE | grp-Avi-Controllers | **NTP** (UDP 123) | Allow |
| 4 | `SE-object-store` | grp-Avi-SE | grp-Avi-Controllers | **TCP 9001** | Allow |
| 5 | `Avi-backend-pool` | grp-Avi-SE | grp-VCFA | **TCP 8443** | Allow |
| 6 | `SE-to-VCFA-web` | grp-Avi-SE | grp-VCFA | **HTTPS** (TCP 443) | Allow |
| 7 | `default` | Any | Any | Any | **Drop** (enable **Logging**) |

Rules 1–4 are the design page's SE→Controller set; 5–6 are the SE→VCFA backend
path. The gateway firewall is **stateful**, so return traffic on each allowed
flow is automatic — you only add the connection-initiation direction.

#### 4. Before you flip rule 7 to Drop

> **The design page's list is a template, not a validated exhaustive port set
> [field caveat].** Cross-check the current **Avi Ports & Protocols** for your
> version before enforcing default-deny, and expect to also need SE →
> **DNS**, SE → **NTP** (if your NTP source is not the Controller), SE → the
> segment **gateway**, and possibly a Controller→SE return path for
> SE lifecycle orchestration. Stage rule 7 as **Allow + Logging** first, run
> the validation in step 5 below, read the log for what the allowlist
> missed, then switch it to **Drop**.

#### 5. Validate

- From a Controller (CLI) or an SE shell, confirm the allowed flows: the
  8443 keyx channel, SSH, TCP 9001, and the backend pool to `grp-VCFA` on
  8443/443.
- `Security > Gateway Firewall >` check the **hit counters** — rules 1–6
  incrementing, rule 7 catching only what you expect.
- In Avi, confirm **SEs still show Connected** and the VCFA VS stays **green**
  after rule 7 is set to Drop — that is the "did I miss a port" check.

#### 6. VCF Automation side — nothing to do on the DFW

VCFA's management traffic is already unrestricted between VCF components (the
`VCF-Created-Virtual-Machines` exclusion). The only firewalling that applies to
it is on the **Transit Gateway** — the `Policy-VCFA` rules in
[Segregating tenant traffic at the Transit Gateway](#segregating-tenant-traffic-at-the-transit-gateway-pattern-3-tgw-gateway-firewall)
(`VCFA-to-Orchestrator`, `VCFA-to-Supervisor`, and so on). If you need finer
east-west segmentation for VCFA than the exclusion allows, that is **vDefend**
(gateway firewall / distributed IDS-IPS), configured per the lateral-security
guide — out of scope here.
