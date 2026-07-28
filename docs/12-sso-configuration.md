# Fleet SSO — Configuring the VCF Identity Broker & Federating Every Product

The **VCF Identity Broker** is what turns a fleet of independently-authenticated
products (vCenter, NSX, VCF Operations, VCF Automation, …) into one where an AD
group logs an operator into all of them. This page is the *configuration*
half — wiring up the identity provider, connecting each product, and mapping
roles. The *preparation* half — what the bind account, base DN and LDAPS
certificate need to look like before you start — is already covered in
[`prerequisites.md` → Identity source for the VCF Identity Broker](prerequisites.md#identity-source-for-the-vcf-identity-broker);
do that first. Deployment-plan pointer: story **E8 8.5**
([`06-deployment-plan.md`](06-deployment-plan.md)).

> **The broker is already running.** It deploys **at bring-up** with the VCF
> Management Services — no opt-in, nothing to install here. Everything below
> is Day-2 *configuration* of an appliance that has been up since bring-up.

> **Navigation confirmed against a real 9.1.0.0200 lab (screenshot-verified
> 2026-07-29).** Everything below lives under one place: **VCF Operations →
> Manage → Fleet Management → Identity & Access**, which has its own sub-nav
> (**VCF SSO Overview**, **VCF Roles**, **vCenter Custom Roles**, **IAM
> Settings** — all four are real, distinct sections, not just release-notes
> vaporware). The **VCF SSO Overview** page itself is one screen with a
> **Config View / Topology View** toggle, summary counters (VCF Instance
> Status / VCF Management Status / Configured Other Components), a **VCF
> SSO** table listing the Identity Broker(s) with a **CONFIGURE NEW VCF SSO**
> button, and three tabs underneath — **VCF Instances**, **VCF Management**,
> **Other Components** — each with its own **JOIN VCF SSO** / **ADD
> COMPONENT** action and a **JOIN VCF SSO** bulk button. Some of the
> per-component click-paths below are still sourced from blog write-ups
> against an earlier UI revision and are flagged where that's the case — the
> overall grouping above is what's actually on screen in 9.1.

## Contents

| # | Section | Use it when |
| - | ------- | ----------- |
| 1 | [Overview — what federates and what doesn't](#1-overview--what-federates-and-what-doesnt) | Deciding what this page will actually change for each product |
| 2 | [Step 1 — Deployment mode](#step-1--deployment-mode) | Embedded vs. appliance-mode broker |
| 3 | [Step 2 — Configure the identity provider](#step-2--configure-the-identity-provider) | Pointing the broker at AD/LDAP |
| 4 | [Step 3 — Federate vCenter and NSX](#step-3--federate-vcenter-and-nsx) | Both need an explicit click — neither auto-configures |
| 5 | [Step 4 — Federate VCF Operations and VCF Automation](#step-4--federate-vcf-operations-and-vcf-automation) | Both need an explicit connect step |
| 6 | [Step 5 — Federate everything else](#step-5--federate-everything-else) | Supervisor, Log Management, and the unsettled VCF Operations for Networks question |
| 7 | [Step 6 — Assign roles per product](#step-6--assign-roles-per-product) | The step every product needs, done separately, every time |
| 8 | [Verification & troubleshooting](#8-verification--troubleshooting) | Login loops, invalid redirect URL, all-AD-fails-at-once |
| 9 | [Field notes](#9-field-notes) | Gotchas that don't fit anywhere else above |
| 10 | [References](#10-references) | The TechDocs and community walkthroughs behind the above |

---

## 1. Overview — what federates and what doesn't

Not every product plugs into the broker the same way, and **the doc set does
not say this plainly in one place** — it's spread across per-component
sub-pages. Decide what you're actually federating before you start clicking:

| Product | Federates with the broker? | Needs its own explicit step? |
| ------- | --------------------------- | ----------------------------- |
| **vCenter** (management domain) | Yes | **Yes** — field-verified 2026-07-29: needs its own explicit click in the Components list, same as NSX; it does **not** auto-configure just because SSO/the IdP is enabled. **Overrides any existing identity-provider config already on that vCenter** once you do configure it |
| **NSX Manager** | Yes | **Yes** — an explicit "Configure Component" click per NSX Manager, separate from vCenter |
| **VCF Operations** | Yes | Yes — its own connect step under Fleet Management |
| **VCF Automation** | Yes | Yes — its own connect step; **also has a separate native-LDAP path independent of the broker** (see §5) |
| **VCF Operations for Logs** (Log Management) | Yes | Yes — an OIDC client generated on the broker side, pasted into the product's own Authentication settings |
| **vSphere Supervisor** | Yes, but **not inherited from vCenter** | Yes — Supervisor has its own external-IdP config, added as a generic "Other Component" on the broker |
| **VCF Operations for Networks** | **Unclear — conflicting evidence** | Community write-ups describe a separate direct LDAP/AD integration (`Profile → Settings → LDAP`) with no broker federation at all. But the live 9.1.0.0200 **Other Components** tab explicitly names *"VCF Operations for Networks"* as an example product you can add there — screenshot-verified 2026-07-29. Don't assume either claim; try adding it as an Other Component first, and confirm in your own environment before writing this off as broker-incompatible |
| **SDDC Manager** | No interactive login via SSO | Only local domain users can log into its UI; its **API** does accept SSO-authenticated tokens |

> **Rainpole-style placeholders throughout:** `vc-mgmt-01.sfo.example.io`,
> `vcf-idb-01.sfo.example.io`, AD group `vcf-sddc-admins@rainpole.io`. No real
> customer values.

---

## Step 1 — Deployment mode

The Identity Broker runs in one of two modes, chosen when you first walk the
wizard:

- **Embedded** — the broker instance deployed with this VCF instance's own VCF
  Management Services. Simplest; scoped to this one instance.
- **Appliance mode** — a standalone 3-node broker cluster, deployed via VCF
  Operations fleet management, that can serve **up to five VCF instances**
  from one broker. Choose this if you're centralizing identity across
  multiple VCF instances, or want SSO to survive one instance's Management
  Services being rebuilt.

Both are configured from the same place: **VCF Operations → Fleet Management
→ Identity & Access → VCF SSO Overview → CONFIGURE NEW VCF SSO**. Pick the
deployment mode before continuing to identity-provider configuration.

---

## Step 2 — Configure the identity provider

Still under **Identity & Access** for the selected VCF instance — this is the
wizard that consumes everything you prepared in
[`prerequisites.md`](prerequisites.md#identity-source-for-the-vcf-identity-broker):

1. **Directory Information** — directory name, DNS server location, whether
   to use the **Global Catalog**, encrypted connection (paste the **PEM** root
   CA if so), primary/secondary domain controller, directory search attribute
   (typically `sAMAccountName`), **Base DN**, bind account name and password.
2. **Configure User and Group Provisioning** — attribute mappings, then a
   **Group Provisioning** screen (**Base Group DN**, and a **Sync Nested
   Groups** toggle — turn it on if admin membership comes via nested groups),
   then a **User Provisioning** screen (**Base User DN**).
3. **Review → Finish.** Sync starts immediately, then runs **weekly** by
   default — a bind-account password expiry quietly stops group updates from
   here on, same caveat as in the prerequisites page.

This step only connects the **directory** to the broker. It does not yet
touch vCenter, NSX, or anything else — that's Steps 3–5.

---

## Step 3 — Federate vCenter and NSX

**VCF SSO Overview → VCF Instances tab** — a bulk **JOIN VCF SSO** button, and
a table of VCF instances with a **# of Components Configured** count. Click
into an instance (e.g. `instance-a`) to see its **Components** list — each
management-domain vCenter and NSX Manager, per VCF domain, each with its own
**Configured / Not configured** status. (This replaces the "Component
Configuration grid" wording from earlier community write-ups — in 9.1.0.0200
it's this per-instance Components list.)

**Field-verified 2026-07-29: neither one auto-configures.** Earlier
community write-ups (and an earlier revision of this page) described vCenter
as auto-configuring the moment SSO/the identity provider is enabled, with
only NSX needing an explicit click. That's **not what happens in
9.1.0.0200** — both vCenter and NSX Manager need their own explicit click in
the Components list; neither one federates on its own.

- **vCenter** — click its row in the Components list to configure it
  explicitly, same as NSX. **Caveat:** once configured, **any existing
  identity-provider configuration already on that vCenter is overridden** by
  the VCF SSO configuration — if you bound vCenter SSO directly to AD earlier
  (the "optional, not recommended" path in
  [`06-deployment-plan.md` story 6.3](06-deployment-plan.md)), this replaces
  it.
- **NSX Manager** — click its row in the Components list to configure it
  explicitly, separate from vCenter. This pushes the identity configuration
  to NSX. **Role assignment for NSX is covered by `VCF Roles` (Step 6,
  confirmed 9.1 behaviour)** — assigning an AD group to a VCF Role there
  grants NSX access directly, without a separate login to NSX Manager. The
  NSX-native manual method below is still documented in community
  write-ups and may still work as a fallback or for finer-grained NSX-only
  roles, but confirm you actually need it before doing both:
  1. Log into NSX Manager directly (switch to the **local account**, e.g.
     `admin`).
  2. **System → User Management → User Role Assignment → Add Role for VCF SSO
     User/Group.**
  3. Search for the AD group (e.g. `vcf-sddc-admins@rainpole.io`), **Set**,
     **Add Role**, **Add**, **Save**.

Both screens require you to check an acknowledgement box (*"I confirm that I
understand the requirement to perform role assignments…"*) before
**Continue → Finish Setup**.

> **Multi-vCenter caution.** If any of your vCenter servers use **Enhanced
> Linked Mode**, disable it on **all** participating vCenters first — ELM and
> VCF SSO don't coexist.

---

## Step 4 — Federate VCF Operations and VCF Automation

Neither inherits SSO automatically; both live together on **VCF SSO Overview
→ VCF Management tab** — a table listing **Automation Appliance** and
**Operations Appliance** side by side, each with its own **Status** (e.g.
*Not configured*) and a **Client Secret** column with a **REGENERATE**
action, plus a bulk **JOIN VCF SSO** button (screenshot-verified
2026-07-29). The per-appliance click-through wizard steps below are still
sourced from community write-ups against an earlier UI and haven't been
walked screen-by-screen against 9.1.0.0200 in this repo yet — the table
layout above is confirmed, the exact wizard screens it opens are not:

**VCF Operations:**
1. Select the **operations appliance** → **Continue**.
2. Pick **Identity Broker** → **Configure**.
3. Acknowledge the role-assignment note → **Continue**.
4. Result: *"VCF Operations Appliance is integrated into VCF Identity
   Broker."* Roles are **not** assigned yet — that's Step 6 below.

**VCF Automation:**
1. Select the **automation appliance** → **Continue**.
2. Pick **Identity Broker** → **Configure**.
3. Acknowledge the role-assignment note → **Continue**.
4. Result: *"VCF Automation Appliance is integrated into VCF Identity
   Broker."*

> **Fork in the road — VCF Automation has a second, independent path.**
> Community write-ups also describe configuring VCF Automation's SSO
> **natively**, bypassing the broker entirely: **Administration → Identity
> Providers → LDAP → Configure → Edit LDAP**, then mapping it to
> tenants/organizations via **Edit LDAP Options → "VCF Automation system LDAP
> service."** Both paths are real; they are not the same thing. **Prefer the
> broker path above** for consistency with the rest of the fleet unless VCF
> Automation's own org/tenant model specifically needs LDAP scoped
> differently from the rest of the fleet — confirm the choice in your own
> environment before committing either way, this distinction is not
> spelled out clearly in the TechDocs sequence.

> **"Invalid redirect URL" on first login?** Almost always caused by browsing
> to the component by short hostname instead of FQDN — always use the FQDN
> in the address bar (`https://vcf-ops-01.sfo.example.io`, never
> `https://vcf-ops-01`).

---

## Step 5 — Federate everything else

The real entry point (screenshot-verified 2026-07-29) is **VCF SSO Overview
→ Other Components tab → ADD COMPONENT** — the tab's own subtitle names
**VCF Operations HCX, Log Management, and VCF Operations for Networks** as
example candidates, confirming this generic path covers more than just
Supervisor. The click-through steps below for each are still sourced from
community write-ups pending a full screen-by-screen walk-through here.

**Log Management (VCF Operations for Logs)** — an OIDC client generated on
the broker side, pasted into the product's own settings:
1. **Other Components → ADD COMPONENT** — name it, pick
   **Identity Broker**, select the VCF instance, set the redirect URI to
   `https://<logs-fqdn>/login?authMethod=VIDB`, **Generate OIDC Client**, copy
   the **Issuer URL / Client ID / Client Secret**, **Save**.
2. In the Log Management UI: **Configuration → Authentication → VCF SSO →
   Edit**, paste the three values, **Test Connection** (accept the
   certificate), **Save**.
3. **Management → Access Control → Users and Groups → + New Group** — pick
   the domain, the AD group name, and a role. Log out and back in via VCF SSO
   to confirm.

**vSphere Supervisor** — has its **own** external-IdP config; it does not
inherit federation from vCenter even when vCenter itself is federated:
1. **vSphere Client → Supervisor Cluster → Configure → Identity Providers** —
   note the callback/redirect URL shown here.
2. **VCF SSO Overview → Other Components tab → ADD COMPONENT** — name it,
   pick the Identity Broker, paste the redirect URL, click **regenerate
   Client ID/Secret**. Record the **Issuer URL**, **Client ID**, **Client
   Secret**.
3. Extract the broker's root CA (adjust for your shell):
   ```bash
   openssl s_client -connect vcf-idb-01.sfo.example.io:443 -showcerts </dev/null 2>/dev/null | openssl x509 -outform PEM
   ```
4. Back on the Supervisor's Identity Provider page: paste the Issuer URL, set
   **username claim = `acct`**, **groups claim = `group_names`**, enter the
   Client ID/Secret, add `group` as an additional scope, paste the root CA.
5. Verify:
   ```console
   vcf context create sup-01 --endpoint <supervisor-endpoint> --username <user> --auth-type oidc
   kubectl auth whoami
   ```
   Role mapping here rides on vCenter Namespace permissions, which
   auto-generate the Kubernetes `ClusterRoleBindings` — there's no separate
   Supervisor RBAC step to configure.

**VCF Operations for Networks — conflicting evidence, not a settled
exception.** Community write-ups describe this product authenticating
against AD directly and separately, under its own **Profile → Settings →
LDAP** (LDAPS port 636), with no broker path at all. But the live 9.1.0.0200
**Other Components** tab explicitly lists **VCF Operations for Networks** as
an example you can add there via the same generic OIDC-client mechanism as
Log Management and Supervisor. **Try the Other Components path first** and
fall back to the direct-LDAP method only if that genuinely doesn't work in
your build — don't assume the older blog claim still holds in 9.1.

**Other components (HCX, VCF Operations Orchestrator) and scripted/PowerCLI
access** follow the same generic pattern as Supervisor above — add them as an
**Other Component** with a generated OIDC client — but are out of scope for
this page; see the References below for their dedicated TechDocs pages.

---

## Step 6 — Assign roles per product

**Connecting a product to the broker does not grant anyone access.** Every
product above warns about this explicitly, and it is easy to walk the whole
wizard, declare victory, and then have nobody able to log in. Plan which AD
groups map to which roles **before** you start federating (§1's table), not
after.

**In 9.1, `VCF Roles` is the confirmed fleet-wide mechanism — not just
release-notes text, and not merely layered on top of per-product logins.**
Screenshot-verified 2026-07-29, build 9.1.0.0200: **Identity & Access → VCF
Roles** states plainly, *"VCF Role defines access across VCF component
including vCenter, NSX, VCF Operations and VCF Automation. Assign roles under
Access Management within the identity broker details on the VCF SSO
Overview."* Assigning an AD group to a VCF Role there is what grants that
group **vCenter and NSX access directly** — you do not have to separately log
into NSX Manager and map the group there as well (superseding the "log into
NSX Manager directly" sub-steps described in Step 3, which may be an
older/9.0 fallback rather than the current recommended path — worth
confirming which one you actually need once you've assigned roles this way).

**Built-in roles** (VCF Roles page, four rows, not user-editable):

| Role | Scope |
| ---- | ----- |
| **SDDC Viewer** | Read-only across SDDC components |
| **SDDC Administrator** | Administrator across SDDC components |
| **VCF Viewer** | Read-only across **all** components **except Automation** |
| **VCF Administrator** | Administrator across **all** components |

**Custom Roles** — a separate section on the same page (**CREATE NEW CUSTOM
ROLE**) for building a role that combines specific permissions rather than
using one of the four built-ins wholesale — this is the mechanism the 9.1
release notes describe as "custom roles built by combining permissions from
multiple components."

**`vCenter Custom Roles` is a different, narrower feature — don't confuse the
two.** It does not assign VCF Roles to AD groups at all. Per its own page
text: *"Configure automatic provisioning of selected roles to vCenters within
your VCF instance. This ensures that any new vCenter added to the instance
will automatically receive the specified roles... This automatic provisioning
also applies to Single Sign-On (SSO) configurations."* It's for **syncing
vCenter's own native custom RBAC roles** across every vCenter in the
instance (via **IMPORT & PROVISION ROLES**) — e.g. so a bespoke vCenter role
you built by hand gets pushed to every new vCenter automatically, rather than
recreating it each time. Confirmed to exist as a real, working provisioning
table; not yet exercised end-to-end in this repo.

---

## 8. Verification & troubleshooting

- **Test a login for every federated product**, not just one — a broken
  federation on product B doesn't announce itself while you're busy
  celebrating that product A works.
- **"Invalid redirect URL"** — see the FQDN-vs-short-hostname note in Step 4.
- **Silent-revert gotcha** — configuring Log Management's OIDC client and
  then going back to re-check VCF Operations' client settings has been
  reported to show the Operations client having silently reverted; re-save it
  if you touch Log Management after Operations was already configured.
- **NSX auto-login inside the same browser session** — if you're already
  logged into another component via VCF SSO in the same browser, NSX Manager
  may log you in automatically without re-prompting; log out of everything to
  test a fresh login path.
- **All AD logins fail at once, everywhere, simultaneously** — this is a
  bind-credential or LDAPS-trust problem, not a per-product config problem.
  See [`prerequisites.md`'s troubleshooting block](prerequisites.md#identity-source-for-the-vcf-identity-broker)
  for the full signature and the direct-bind test — it applies here
  unchanged; the broker doesn't change how that failure looks.
- **Pre-existing PowerCLI scripts / partner integrations** that authenticated
  directly against vCenter's old identity-provider config may need
  redoing once VCF SSO overrides it (Step 3).

---

## 9. Field notes

- **Plan role/group design before you start clicking through the wizard** —
  it is far easier to decide which AD groups map to which roles once, up
  front, than to retrofit it across six separately-configured products.
- **OIDC client redirect URIs default to the appliance's IP address** in some
  of the "Other Components" flows — switch them to FQDN before saving, for
  the same reason every other fleet FQDN in this repo is FQDN-first.
- **VCF Automation requires its own console tab and its built-in admin
  login** the first time you configure it — don't expect the broker
  federation step alone to get you into the Automation UI.
- **Recommended configuration order**, per field reports: Operations →
  Automation → Log Management → (Supervisor / Operations-for-Networks as
  needed). Doing certificates and SSO in the same maintenance window is
  covered by deployment-plan story **E8 8.5**
  ([`06-deployment-plan.md`](06-deployment-plan.md)) — batch the certificate
  rotation first, let it settle, then start this page.

---

## 10. References

- **Screenshot-verified 2026-07-29, build 9.1.0.0200** (Paul's own lab, no
  external URL — this is why some claims above are marked "confirmed" and
  others still "sourced from community write-ups"): the overall
  navigation structure (§ intro), the Other Components tab's example list
  including VCF Operations for Networks (§1, §5), the existence of the
  VCF Roles / vCenter Custom Roles sections and their built-in role list
  (§6), that VCF Roles is the actual mechanism granting vCenter and NSX
  access — not merely per-product logins (§3, §6), and that **vCenter needs
  its own explicit click same as NSX — it does not auto-configure** (§1, §3).
- TechDocs (the 9.1 doc set does not republish the SSO setup section, so
  these are the newest published pages — 9.0 is current for this workflow):
  [Setting Up SSO](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/fleet-management/what-is/setting-up-sso.html),
  [Configure Active Directory as an Identity Provider Using AD/LDAP](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/fleet-management/what-is/setting-up-sso/cofigure-vmware-cloud-foundation-identity-provider/configure-vmware-cloud-foundation-identity-provider-for-ad-ldap(2).html),
  [Configure VCF SSO for NSX and vCenter](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/fleet-management/what-is/setting-up-sso/connect-components.html),
  [Configure VCF SSO for the Operations and Automation Appliance](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/fleet-management/what-is/setting-up-sso/configure-vmware-cloud-foundation-sso-for-the-operations-and-automation-appliance(1).html)
  (with per-product child pages for
  [VCF Operations](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/fleet-management/what-is/setting-up-sso/configure-vmware-cloud-foundation-sso-for-the-operations-and-automation-appliance(1)/configure-vmware-cloud-foundation-sso-for-operations-appliance.html)
  and
  [VCF Automation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/fleet-management/what-is/setting-up-sso/configure-vmware-cloud-foundation-sso-for-the-operations-and-automation-appliance(1)/configure-vmware-cloud-foundation-sso-for-the--automation-appliance.html)),
  [Configure VCF SSO as a Client for Other Components](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/fleet-management/what-is/setting-up-sso/configure-vmware-cloud-foundation-sso--as-a-client-for-other-components.html),
  [Assigning Roles and Permissions](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/fleet-management/what-is/setting-up-sso/assigning-roles-and-permissions.html),
  [VCF 9.1 Release Notes — What's New (VCF Operations)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/release-notes/vmware-cloud-foundation-9-1-0-0-release-notes/what-s-new/whats-new-vcf-ops.html).
- Broadcom KBs (VCF Operations for Networks' own separate LDAP path):
  [Aria/VCF Operations for Networks LDAP authentication troubleshooting (KB 306857)](https://knowledge.broadcom.com/external/article/306857/aria-operations-for-networks-ldap-authen.html),
  [Configuring LDAP/LDAPS in Aria/VCF Operations for Networks (KB 368979)](https://knowledge.broadcom.com/external/article/368979/configuring-ldapldaps-in-aria-operation.html).
- VMware Cloud Foundation blog:
  [Streamline Administrative Access with VMware Cloud Foundation Single Sign-On](https://blogs.vmware.com/cloud-foundation/2025/06/19/streamline-administrative-access-with-vcf-single-sign-on/),
  [Bringing "Out-of-the-Box" Modern Identity to Your Infrastructure with VMware Cloud Foundation 9.0](https://blogs.vmware.com/cloud-foundation/2026/02/18/bringing-out-of-the-box-modern-identity-to-your-infrastructure-with-vmware-cloud-foundation-9-0/).
- Community walkthroughs (Supervisor federation is not in Broadcom's own
  component list — William Lam's is the only documented procedure found for
  it): William Lam's
  [VCF 9.1 — Configuring vSphere Supervisor to use VCF Identity Broker for External Identity Federation](https://williamlam.com/2026/06/vcf-9-1-configuring-vsphere-supervisor-to-use-vcf-identity-broker-idb-for-external-identity-federation.html)
  and
  [VCF 9.1 — Automating VCF SSO with an OIDC-based Identity Provider](https://williamlam.com/2026/05/vcf-9-1-automating-vcf-single-sign-on-sso-with-oidc-based-identity-provider.html);
  BlanketVM's step-by-step series —
  [Part 4: Identity Broker and vCenter](https://blanketvm.com/2025/07/11/vcf-9-deployment-part4-vcf-sso/),
  [Part 5: NSX Manager](https://blanketvm.com/2025/07/14/vcf-9-deployment-part5-vcf-sso-nsx/),
  [Part 7: VCF Operations for Logs](https://blanketvm.com/2025/07/22/vcf-9-deployment-part7-vcf-sso-vcfopsfl/);
  vxworld.co.uk's
  [VCF 9 — Deploying VCF Identity Broker, Part 1](https://vxworld.co.uk/2025/11/11/vcf-9-deploying-vcf-identity-broker/);
  vworld.com.pl's
  [Complete Guide: Configuring SSO in VMware Cloud Foundation with Active Directory and VCF Automation Integration](https://vworld.com.pl/complete-guide-configuring-sso-in-vmware-cloud-foundation-with-active-directory-and-vcf-automation-integration/)
  (the VCF Automation native-LDAP fork in the road, §5); gibsonvirt.com's
  [VCF 9 — Enable and Configure SSO, Part 3 (Operations/Automation/Logs)](https://gibsonvirt.com/2025/06/18/vcf-9-enable-and-configure-sso-part-3-operations-automation-logs/).
