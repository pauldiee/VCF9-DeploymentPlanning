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
| 3 | [Step 2 — Configure the identity provider](#step-2--configure-the-identity-provider) | Pointing the broker at AD/LDAP; [on-demand lookup (9.1.1+)](#pre-provisioning-or-on-demand-lookup-911), [getting the LDAPS certificate](#ldaps--the-domain-controller-certificate-and-the-pem-root-ca) and [Microsoft Entra ID](#microsoft-entra-id-instead-of-adldap) |
| 4 | [Step 3 — Federate vCenter and NSX](#step-3--federate-vcenter-and-nsx) | Both need an explicit click — neither auto-configures |
| 5 | [Step 4 — Federate VCF Operations and VCF Automation](#step-4--federate-vcf-operations-and-vcf-automation) | Both need an explicit connect step |
| 6 | [Step 5 — Federate everything else](#step-5--federate-everything-else) | Supervisor, Log Management, and the unsettled VCF Operations for Networks question |
| 7 | [Step 6 — Assign roles per product](#step-6--assign-roles-per-product) | The step every product needs, done separately, every time |
| 7a | [Switching an existing broker from AD/LDAP to Microsoft Entra ID](#switching-an-existing-broker-from-adldap-to-microsoft-entra-id) | The broker already runs on AD/LDAP and you want Entra ID: what's kept, what's lost, procedure, known failures |
| 8 | [Verification & troubleshooting](#8-verification--troubleshooting) | Login loops, invalid redirect URL, all-AD-fails-at-once |
| 9 | [Field notes](#9-field-notes) | Gotchas that don't fit anywhere else above |
| 10 | [References](#10-references) | The TechDocs and community walkthroughs behind the above |

---

## The full sequence, start to finish

The broker is already running (bring-up); this is Day-2 configuration. Do the
[prerequisites](prerequisites.md#identity-source-for-the-vcf-identity-broker)
(bind account, base DN, LDAPS certificate) first. Everything below lives under
*VCF Operations*.

1. **Read what federates and what doesn't**
   ([§1](#1-overview--what-federates-and-what-doesnt)).
2. **Set the deployment mode** ([Step 1](#step-1--deployment-mode)).
3. **Configure the identity provider** ([Step 2](#step-2--configure-the-identity-provider))
   — the AD / LDAPS source on the broker.
4. **Federate vCenter and NSX** ([Step 3](#step-3--federate-vcenter-and-nsx)).
5. **Federate VCF Operations and VCF Automation**
   ([Step 4](#step-4--federate-vcf-operations-and-vcf-automation)).
6. **Federate everything else** ([Step 5](#step-5--federate-everything-else)) —
   Log Management, the SSP Installer, and the rest.
7. **Assign roles per product** ([Step 6](#step-6--assign-roles-per-product)) —
   AD group → product role, one product at a time.
8. **Verify** ([§8](#8-verification--troubleshooting)) — log in as an AD user to
   each product; then the [field notes](#9-field-notes).

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
   then a **User Provisioning** screen (**Base User DN**). On **9.1.1 and
   later** the wizard also shows **On-demand lookup** (*Enable on-demand
   lookup for user and group provisioning*) — see
   [Pre-provisioning or on-demand lookup](#pre-provisioning-or-on-demand-lookup-911)
   below before you tick it.
3. **Review → Finish.** With pre-provisioning (the default), sync starts
   immediately, then runs **weekly** by default — a bind-account password
   expiry quietly stops group updates from here on, same caveat as in the
   prerequisites page.

This step only connects the **directory** to the broker. It does not yet
touch vCenter, NSX, or anything else — that's Steps 3–5.

### Pre-provisioning or on-demand lookup (9.1.1+)

Up to 9.1.0 there is only one model for AD and OpenLDAP: **pre-provisioning**.
The broker copies the users and groups under the Base User DN / Base Group DN
into its own store and authorizes against that copy, which is refreshed by the
(weekly) sync or a manual one. VCF 9.1.1 adds **On-Demand Lookup**: the broker
does not keep a copy, it queries the directory when the user logs in. Per
Broadcom's [9.1.1 announcement](https://blogs.vmware.com/cloud-foundation/?p=34595),
*"authorization is based upon a user's current group membership in the
directory at the time of login."*

| | Pre-provisioning (checkbox off) | On-demand lookup (checkbox on) |
| --- | --- | --- |
| Where group membership is read | The broker's local copy | The directory, at each login |
| An AD group change takes effect | After the next sync (weekly default, or a manual sync) | At the user's next login |
| Fits | Stable admin groups that rarely change | Temporary or frequently changing access (contractors, auditors, cross-team work) |

Broadcom also allows mixing the two: the setting is per directory, so you can
run one directory with on-demand lookup and another pre-provisioned.

Our reading of the trade-off (not tested in a lab yet): with on-demand lookup,
every login depends on a reachable domain controller and a working bind
account. A bind-account password expiry or an expired DC certificate then
breaks logins at once, instead of quietly freezing the group copy as with
pre-provisioning. Pick primary + secondary DCs (or DNS Server Location) and
watch the bind account and the DC certificates accordingly.

### LDAPS — the domain controller certificate and the PEM root CA

Ticking **Encrypted Connection** turns on LDAPS *"for all the connections to
this directory"*, and the wizard then asks for *"the root certificate(s)
required to access the domain controllers over SSL"*, in **PEM** with the
`BEGIN CERTIFICATE` / `END CERTIFICATE` lines
([Configure Active Directory as an Identity Provider Using AD/LDAP](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/managing-identity-and-access-using-vcf-single-sign-on/what-is/setting-up-sso/cofigure-vmware-cloud-foundation-identity-provider/configure-vmware-cloud-foundation-identity-provider-for-ad-ldap(2).html)).
With DNS Server Location, one field takes all root certificates (they're merged
into `{directory-name}-concatenated.pem`). With a primary/secondary DC, each DC
has its own certificate field. Two things have to be true: the DCs actually
serve LDAPS, and you paste the CA that signed their certificates.

**1. Check whether the DCs already serve LDAPS.** Windows has no switch for
LDAPS. A DC listens on **TCP 636** (and **3269** for the Global Catalog) as
soon as it has a suitable certificate
([Microsoft: Enable LDAP over SSL](https://learn.microsoft.com/en-us/troubleshoot/windows-server/active-directory/enable-ldap-over-ssl-3rd-certification-authority)).
Domains with an AD CS **enterprise** CA usually have one already through
domain controller auto-enrollment. Test from a jump host that can reach the DC
(runs on Windows PowerShell 5.1):

```powershell
$dc  = 'dc01.sfo.example.io'
$tcp = New-Object Net.Sockets.TcpClient($dc, 636)
$ssl = New-Object Net.Security.SslStream($tcp.GetStream(), $false, ({ $true }))
$ssl.AuthenticateAsClient($dc)
$crt = New-Object Security.Cryptography.X509Certificates.X509Certificate2($ssl.RemoteCertificate)
$crt | Format-List Subject, Issuer, NotAfter, DnsNameList
$ssl.Dispose(); $tcp.Close()
```

A connection refused or a TLS failure means the DC has no usable LDAPS
certificate: go to step 2. A certificate back: check that **DnsNameList**
contains the DC's FQDN and that **NotAfter** is not close, then go to step 3.
Repeat for every DC the broker can reach (with DNS Server Location that's every
DC the SRV records return), and for port 3269 if you use the Global Catalog.

**2. If a DC has no LDAPS certificate**, issue one. Microsoft's requirements
(same article):

- in the DC's **Local Computer → Personal** store (or the NTDS service store,
  which wins if both have one), with its **private key** present;
- **Enhanced Key Usage** includes **Server Authentication**
  (`1.3.6.1.5.5.7.3.1`);
- the DC's **FQDN** (e.g. `dc01.sfo.example.io`) in the Subject CN or as a DNS
  name in the **Subject Alternative Name**.

With an enterprise CA, enroll the DC from a template with Server Authentication
(the built-in *Kerberos Authentication* / *Domain Controller Authentication*
templates qualify, ideally via auto-enrollment so renewal is automatic). With
another CA, follow Microsoft's `certreq` / `Request.inf` procedure in the
article. Then repeat the step 1 test.

**3. Get the root CA in PEM.** Paste the **CA certificate**, not the DC's own
certificate. Any of these gives you a PEM file:

- **From the vCenter appliance (the quickest).** The VCSA includes `openssl`.
  SSH in as root and save the chain the DC sends. This is Broadcom's own
  method for vCenter LDAPS identity sources
  ([KB 316596](https://knowledge.broadcom.com/external/article/316596)).
  Any Linux shell with `openssl` and a path to the DC on 636 works the same
  way:

  ```bash
  openssl s_client -showcerts -connect dc01.sfo.example.io:636 </dev/null 2>/dev/null \
    | sed -n '/-----BEGIN CERTIFICATE-----/,/-----END CERTIFICATE-----/p' > dc01.cer
  ```

  The file holds the **whole chain**, in PEM, with the DC's own certificate
  first ([KB 380859](https://knowledge.broadcom.com/external/article/380859/adding-a-vcenter-server-single-signon-ac.html)).
  Don't paste all of it. Run the command without `2>/dev/null` and the `sed`
  filter to see each certificate's `s:` (subject) and `i:` (issuer) lines:
  - The **last** certificate has the **same subject and issuer**: that's the
    root. Paste only that `BEGIN`…`END` block.
  - The last certificate's issuer is a **different** name: the DC didn't send
    the root, which is common on Windows (KB 380859's own sample chain stops
    at the issuing CA). Take the root from the CA as in the next bullet.

  Run it once per DC; one DC with a bad certificate is enough to cause
  intermittent failures (KB 380859). Append
  `| openssl x509 -noout -enddate` to see the DC certificate's expiry
  ([KB 445065](https://knowledge.broadcom.com/external/article/445065/an-expired-domain-controller-certificate.html)).
  *"Could not read certificate from stdin"* means the DC sent no usable
  certificate, so go back to step 2
  ([KB 441900](https://knowledge.broadcom.com/external/article/441900/error-could-not-read-certificate-from-st.html)).
- **From the CA** (AD CS): `certutil -ca.cert root-ca.cer` on the CA, then
  `certutil -encode root-ca.cer root-ca.pem`. Or export the root from any
  domain member's *Trusted Root Certification Authorities* store in the
  Certificates MMC as **Base-64 encoded X.509 (.CER)**. That format is PEM;
  only the extension differs.
- **From the step 1 session**, on a machine that trusts the domain's CA (any
  domain member), build the chain and export the top of it:

  ```powershell
  $chain = New-Object Security.Cryptography.X509Certificates.X509Chain
  [void]$chain.Build($crt)
  $root = $chain.ChainElements[$chain.ChainElements.Count - 1].Certificate
  "-----BEGIN CERTIFICATE-----`r`n" +
    [Convert]::ToBase64String($root.RawData, 'InsertLineBreaks') +
    "`r`n-----END CERTIFICATE-----" | Set-Content root-ca.pem -Encoding Ascii
  $root | Format-List Subject, Thumbprint, NotAfter
  ```

Check that the root's **Subject** matches the top of the DC certificate's
issuer chain, then paste the file's whole contents (both marker lines included)
into the wizard. With a **two-tier PKI** (offline root + issuing CA), the
field asks for the root. If the connection still fails, add the issuing CA as
a second certificate. This is our suggestion and not lab-tested; the field
accepts more than one certificate.

**Afterwards:** DC certificates renewed by the same CA need no change on the
broker. If the DCs move to a different CA, or the root itself is renewed with
a new key, update the certificate in the directory configuration **before**
the DCs switch. Otherwise every AD login fails at once (see
[§8](#8-verification--troubleshooting)). Firewall: management → DCs on TCP 636
and, with Global Catalog, 3269 ([`07-firewall-ports.md`](07-firewall-ports.md)).

### Microsoft Entra ID instead of AD/LDAP

The wizard above is the AD/LDAP path. With **Microsoft Entra ID** the broker
federates to a cloud IdP instead of binding to a domain controller. On **Choose
Identity Provider** you pick **Microsoft Entra ID**, then make two separate
choices: the **authentication protocol** and the **user/group provisioning
method**.

**Broker already configured with AD/LDAP?** Then start at
[Switching an existing broker from AD/LDAP to Microsoft Entra ID](#switching-an-existing-broker-from-adldap-to-microsoft-entra-id):
it's a partial reset first, and the provisioning choice changes which unique
identifier you set.

> **Evidence level:** TechDocs (the 9.0 SSO pages, re-checked against the
> 9.1 set, both last updated 2026-11-02) and Broadcom KBs, read 2026-11-05.
> Entra-side provisioning behaviour from Microsoft Learn, read 2026-11-11.
> **Not lab- or field-verified in this repo.**

#### Decide: protocol and provisioning

| Choice | Options | Our take |
| ------ | ------- | -------- |
| Authentication protocol | **OIDC** or **SAML 2.0** ([Entra ID as IdP][entra]) | OIDC is the path most Entra KBs describe; pick SAML only if your Entra team standardises on it |
| Provisioning | **SCIM 2.0** (Entra pushes users and groups), **JIT** (created at first login from the token), or **AD/LDAP** (sync from an on-prem AD that Entra also syncs from) ([protocols][protocols]) | See below |

- **SCIM**: users and groups exist in the broker **before** anyone logs in, so
  you can assign roles to Entra groups up front. vCenter needs the user
  provisioned: a user who authenticates in Entra but wasn't pushed fails with
  *Access denied*, including when SCIM is scoped to a group and that member
  hasn't been pushed yet ([KB 451058][kb451058], written for AVS, same
  mechanism). Entra's SCIM push has to **reach** the broker / vCenter
  endpoint. For an internal endpoint that means the **Entra provisioning
  agent** on a Windows Server on-prem, which must resolve the FQDN, **trust
  your internal CA**, and bypass any web proxy for it ([KB 428509][kb428509]).
- **JIT**: no inbound path from Entra needed. Users and groups appear only
  after a first login, unless you **pre-provision the groups** in the wizard
  (*Groups Pre-Provisioning*). Only pre-provisioned groups can be used for
  role assignments before first login ([protocols][protocols]).
- **AD/LDAP with Entra login**: if your Entra tenant is synced from on-prem
  AD anyway, provisioning from AD keeps group sync independent of Entra. The
  OIDC **unique identifier** must then match the AD value exactly
  ([OIDC page][entraoidc]).

#### Network: the broker needs Entra, Entra may need the broker

- The broker (or vCenter, in embedded mode) talks **outbound** to
  `login.microsoftonline.com:443` for the OIDC token exchange (visible in the
  log excerpt of [KB 431031][kb431031]). Plan internet egress or a proxy. In
  **appliance mode** without direct internet access you must set up an HTTP
  proxy ([KB 393078][kb393078], linked from the [OIDC page][entraoidc]). On
  VCF Operations **9.0.2** the broker's proxy script has a known defect
  ([KB 436607][kb436607]).
- SCIM needs the inbound path described above. JIT does not.
- SAML: if the metadata URL isn't publicly reachable, or its certificate isn't
  signed by a recognised CA, paste the metadata **XML** instead
  ([SAML page][entrasaml]).

#### Entra side

> **With SCIM you need two applications in Entra, not one.** The OIDC login
> runs on an **app registration**; the SCIM push runs on a separate
> **non-gallery enterprise application**. The enterprise app that Entra
> creates automatically next to an app registration has no working
> **Provisioning** page. Microsoft: *"If you create an app registration, the
> corresponding service principal in enterprise apps won't be enabled for
> automatic user provisioning"*, and the remedy is to *"create a second
> non-gallery app for provisioning"*
> ([Entra provisioning known issues][msknown]). JIT and AD/LDAP
> provisioning only need the app registration.

| Entra object | Created via | Used for |
| ------------ | ----------- | -------- |
| App registration | **Entra ID → App registrations → New registration** | OIDC login: redirect URI, client ID, client secret, claims. Also the target for Conditional Access / MFA |
| Non-gallery enterprise application (SCIM only) | **Entra ID → Enterprise applications → New application → Create your own application →** *"Integrate any other application you don't find in the gallery (Non-gallery)"* ([Microsoft SCIM guide][msscim]) | SCIM provisioning: tenant URL, credentials, attribute mappings, scope, and the **users and groups assigned** to it, which are what gets pushed |

1. Create the **app registration** for OIDC. For SAML, Broadcom links to
   Microsoft's
   [Register a SAML app](https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-register-saml-app),
   which is an External ID page, so check that it fits a workforce tenant.
   For SCIM, also create the **non-gallery enterprise application** from the
   table above now, so it's ready when the broker wizard hands you the SCIM
   values.
2. Use the **Redirect URI** (OIDC) or **Entity ID / ACS URL** (SAML) that the
   broker wizard shows you; don't type them by hand. Use FQDNs, not IPs (see
   [§9](#9-field-notes)).
3. Add the claims the broker expects. They are **case-sensitive**:
   - OIDC: `preferred_username`, `email`, `family_name`, `given_name`,
     `groups`, `domain` ([OIDC page][entraoidc])
   - SAML: `userName`, `email`, `domain`, `firstName`, `lastName`, `groups`,
     plus group claims ([SAML page][entrasaml])
   - With JIT, add `given_name` and `family_name` as **optional claims**
     (Token configuration → ID token), or users show up with blank names
     ([KB 419641][kb419641]).
4. Note the **client ID**, the **client secret** and the OpenID configuration
   address. The secret **expires** in Entra; put its expiry date in your
   operations calendar, because an expired secret stops every federated
   login.
5. For SCIM: after the broker wizard, open the **non-gallery enterprise
   application** (not the one that belongs to the app registration) →
   **Provisioning** → mode **Automatic**, and enter the values the wizard
   shows on *Configure SCIM push in your identity provider*: the **SCIM Base
   URL** as *Tenant URL*, plus either the **SCIM bearer token** as *Secret
   Token* or the OAuth **client ID / client secret / token endpoint**. The
   broker offers both and says to use OAuth if the IdP supports it, else the
   bearer token. Run **Test Connection**. Push `userName` and `domain` as
   separate attributes ([OIDC page][entraoidc]). Set the scope to assigned
   users and groups, **assign the VCF groups to this enterprise app**, and
   switch provisioning on. You can regenerate the SCIM values later under
   the VCF instance → **Identity Source** → *Directory Information*.
6. Entra pushes on a fixed cycle of about **40 minutes** that you can't
   change; use **Provision on demand** on the enterprise app to push a
   user or group right away, and the **Provisioning logs** when something
   doesn't arrive ([Microsoft SCIM guide][msscim],
   [known issues][msknown]). A user not yet pushed can't log in to vCenter
   ([KB 451058][kb451058]).

#### Broker side

Same place as AD/LDAP (VCF Operations → Fleet Management → Identity & Access):
**Choose Identity Provider → Microsoft Entra ID → Configure → OIDC or SAML →**
display name, client ID, secret, OpenID address, redirect URI (OIDC) or
metadata, Name ID format/value (SAML) **→ provisioning method → Review →
Finish → SCIM push values → Done → Finish Setup**. Then follow Steps 3–6
below, as for AD.

**Set the unique identifier to `oid`.** Entra identifies a user by the
Object ID in the `oid` claim. With `sub` (or `email`, or a SCIM `externalId`
mapped to `mailNickname`), authentication succeeds in Entra but VCF answers
*"Access denied. Unable to authenticate the user"* ([KB 431031][kb431031],
[KB 412511][kb412511], [KB 441704][kb441704]). KB 441704's fix is to reset
and reconfigure SSO, so get this right the first time. This applies to SCIM
and JIT. With **AD/LDAP provisioning** `oid` doesn't exist on the AD side; use
an attribute both share, such as `email` ↔ `mail` ([KB 386870][kb386870]).

#### MFA: enforce it in Entra, not in VCF

VCF has no MFA setting of its own. The broker hands authentication to the IdP,
so MFA is whatever Entra demands at sign-in. For vCenter federated to Entra,
Broadcom puts it plainly: MFA *"cannot be enabled directly within the vSphere
Client. Instead, it must be configured at the external Identity Provider level
using Conditional Access Policies"*. Without such a policy, users are simply
not prompted ([KB 429082][kb429082]).

1. In the Microsoft Entra admin center (at least *Conditional Access
   Administrator*): **Entra ID → Conditional Access → Create new policy**.
2. **Users:** the VCF admin groups (start with a pilot group). Exclude your
   Entra emergency-access accounts.
3. **Target resources:** the app registration (OIDC) or enterprise app (SAML)
   you created for the **broker**. KB 429082 targets the vCenter app
   registration because it predates the broker; with the broker, the one app
   covers every federated component (our reading, not stated by Broadcom).
4. **Grant → Require multifactor authentication** (or an authentication
   strength). Start in **Report-only**, check the sign-in logs, then switch on.

**What MFA does not cover**, so secure it another way (vault, rotation,
monitoring):

- local accounts: `administrator@vsphere.local`, NSX `admin`, the VCF
  Operations local admin, appliance `root`
- the **SDDC Manager UI** (local accounts only) and **ESX** (not federated)
  ([points to consider][ptc])
- API / CLI automation: an interactive MFA prompt can't be answered by a
  script. Plan service accounts and the 9.1
  [OAuth token support for API and CLI access][oauth] before you switch a
  policy on, so it doesn't break scheduled jobs.

**Keep a tested local way in.** [KB 442644][kb442644] (VCF Operations 9.0.x,
embedded broker, Duo MFA through vCenter SSO, ELM) ends in an HTTP 500
redirect loop with no option to log in as the VCF Operations local admin.
Different IdP, same lesson: know how to reach each product's local login
before you enforce MFA.

[kb429082]: https://knowledge.broadcom.com/external/article?articleNumber=429082
[kb442644]: https://knowledge.broadcom.com/external/article/442644/http-500-error-in-vcf-operations-90x-aft.html
[oauth]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/administration-sdks-cli-and-tools/about-vmware-cloud-foundation-development/oauth-token-support-for-api-and-cli-access.html

#### Gotchas specific to Entra

- **Login name:** users sign in as `userName@domain` as configured in the
  broker, not with an email address that differs from it
  ([KB 393150][kb393150]).
- **No `[` `]` in names:** square brackets in display names or attributes
  aren't supported in 9.0.x and 9.1 and can break authentication
  ([KB 441704][kb441704]). Other special characters, such as `#` in
  usernames, aren't allowed either ([SAML page][entrasaml]).
- **MFA / Conditional Access** are enforced by Entra at sign-in; the broker
  only sees the result. Broadcom documents nothing specific about them, so
  test your Conditional Access policies (device compliance, location) from
  the admin workstations before go-live.
- **Entra unreachable means no federated login.** Keep the local break-glass
  accounts (`administrator@vsphere.local`, `admin` on NSX, the VCF
  Operations local admin) documented and tested. The **SDDC Manager UI**
  takes local accounts only, and **ESX** is not federated at all
  ([points to consider][ptc]).
- **One IdP per broker** ([protocols][protocols]). Entra plus a separate AD
  for other admins needs a second broker.
- **Moving from an existing vCenter Entra federation:** in embedded mode the
  existing OIDC configuration is imported (as OIDC + SCIM); in appliance mode
  you re-enter the shared secret, and users and groups must be provisioned
  again ([OIDC page][entraoidc], [points to consider][ptc]).
- **After upgrading to 9.1.1 (SAML):** re-import the broker's service
  provider metadata into Entra. Broadcom recommends it so the IdP *"reads the
  new encryption hint and switches to SHA-256 OAEP for all subsequent SAML
  assertion encryption"* ([SAML page][entrasaml]).
- **VCF Automation 9.1:** logins via the broker end at `/login/ssoFailure`
  unless VCF SSO is joined and configured from VCF Operations
  ([KB 451738][kb451738]).

[entra]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/managing-identity-and-access-using-vcf-single-sign-on/what-is/setting-up-sso/cofigure-vmware-cloud-foundation-identity-provider/configure-identity-provider-using-microsoft-entra-id.html
[entraoidc]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/managing-identity-and-access-using-vcf-single-sign-on/what-is/setting-up-sso/cofigure-vmware-cloud-foundation-identity-provider/configure-identity-provider-using-microsoft-entra-id/configure-identity-provider-for-microsoft-entra-id-for-oidc.html
[entrasaml]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/managing-identity-and-access-using-vcf-single-sign-on/what-is/setting-up-sso/cofigure-vmware-cloud-foundation-identity-provider/configure-identity-provider-using-microsoft-entra-id/configure-identity-provider-for-microsoft-entra-id-using-saml.html
[protocols]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/managing-identity-and-access-using-vcf-single-sign-on/what-is/protocols-suported-for--sso.html
[ptc]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/managing-identity-and-access-using-vcf-single-sign-on/what-is/points-to-consider-while-setting-up-vmware-cloud-foundation-sso.html
[kb393150]: https://knowledge.broadcom.com/external/article/393150/vcf-sso-login-requires-upndomain.html
[kb393078]: https://knowledge.broadcom.com/external/article/393078
[kb412511]: https://knowledge.broadcom.com/external/article/412511/microsoft-entra-sso-with-oidc-and-scim-d.html
[kb419641]: https://knowledge.broadcom.com/external/article/419641/first-name-and-last-name-shows-empty-for.html
[kb428509]: https://knowledge.broadcom.com/external/article/428509/entra-id-scim-provisioning-fails-with-er.html
[kb431031]: https://knowledge.broadcom.com/external/article/431031/login-to-vcenter-9x-with-entra-account-f.html
[kb436607]: https://knowledge.broadcom.com/external/article/436607/vcf-identity-broker-proxy-configuration.html
[kb441704]: https://knowledge.broadcom.com/external/article/441704/error-access-denied-when-using-microsoft.html
[kb451058]: https://knowledge.broadcom.com/external/article/451058/vcenter-oidc-access-denied-troubleshooti.html
[msknown]: https://learn.microsoft.com/en-us/entra/identity/app-provisioning/known-issues
[msscim]: https://learn.microsoft.com/en-us/entra/identity/app-provisioning/use-scim-to-provision-users-and-groups
[kb451738]: https://knowledge.broadcom.com/external/article/451738/authentication-failure-in-vcfa-91-when-u.html

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

## Switching an existing broker from AD/LDAP to Microsoft Entra ID

Your broker already runs against AD/LDAP, with products federated and roles
assigned, and you now want Entra ID as the identity provider. There is no
migration wizard: you **change the identity provider**, which is a partial
reset of VCF SSO followed by a fresh Step 2 with Entra
([Change the Identity Provider, 9.1][changeidp91]).

> **Evidence level:** TechDocs (9.1 page, Last Updated 2026-11-09) and
> Broadcom KBs, read verbatim 2026-11-10. **Not lab- or field-verified in
> this repo** (#453).

### What you keep and what you lose

| Kept | Lost |
| ---- | ---- |
| The broker's deployment mode (embedded / appliance) | The AD/LDAP identity provider configuration (bind account, base DN, LDAPS certificate) |
| The component configuration: vCenter, NSX, VCF Operations, VCF Automation, HCX, VCF Operations for Networks and Log Management stay connected to the broker, so Steps 3–5 are **not** repeated | All users and groups the broker provisioned from AD |
| | Every role assignment made to those users and groups: VCF Roles and per-product roles must be assigned again ([Step 6](#step-6--assign-roles-per-product)) |

Per TechDocs: *"Since this is a partial reset, the deployment mode and client
component configuration are retained. Therefore, you do not have to
reconfigure the client for vCenter, VCF Operations HCX, VCF Operations, VCF
Automation, VCF Operations for networks, or log management to the specific
identity broker"* ([9.1][changeidp91]).

> **Confirmation text: fixed in the 9.1.1 UI.** The 9.1 TechDocs dialog
> asks you to confirm deletion of *"...the provisioned users and groups, **and
> the component configuration**"*, while the sentence under it says *"The
> components that are configured against this identity broker are
> retained."* The 9.0 dialog text doesn't mention component configuration at
> all ([9.0][changeidp90]). The **9.1.1 UI** (seen 2026-11-11) has reworded
> the checkbox to *"change the identity provider configuration including the
> provisioned users and groups"* and states the components are retained, so
> the contradiction is gone there. Whether every component really stays
> connected after the switch is not yet tested here, so still plan a window
> in which you could repeat Steps 3–5 if one turns out to be disconnected.

**Use *Change the Identity Provider*, not *Delete* or a full reset.** Deleting
the SSO configuration also drops the component side, and KB 438369 describes
what happens when vCenter and NSX keep a stale SSO state after that: the new
configuration won't save (*"The configured credentials do not have sufficient
privileges"*), and the cleanup needs vCenter ownership cleared, an NSX API
call and appliance reboots ([KB 438369][kb438369]).

### Before you start

1. **Build the Entra side first**: app registration, claims, client secret
   with its expiry date, and (for SCIM) the separate non-gallery enterprise
   application plus the provisioning agent path. See
   [Entra side](#entra-side) and [Network](#network-the-broker-needs-entra-entra-may-need-the-broker).
   Everything you can prepare before the reset shortens the time nobody can
   log in.
2. **Write down the current role assignments**: which AD groups hold which
   VCF Role (*Identity & Access → VCF SSO Overview → identity broker → Access
   Management*) and which per-product roles. You assign them again,
   to the new Entra (or re-provisioned AD) groups, afterwards.
3. **Test the break-glass accounts** on every product
   (`administrator@vsphere.local`, `admin` on NSX, the VCF Operations local
   admin). Between the reset and the first working Entra login there is no
   federated access at all.
4. **Has a certificate been replaced on the broker or VCF Operations since
   SSO was set up?** KB 411917 describes a reset that then fails with error
   `150003`, and a cleanup path via snapshots and deleting the broker
   ([KB 411917][kb411917]). Check first, and take a VCF Operations snapshot
   or backup either way.
5. **Pick the provisioning method** (next section).

### Provisioning: keep AD, or move groups to Entra too

Entra login doesn't force Entra provisioning. The choice decides how much
role work you redo and which unique identifier you set:

| Provisioning after the switch | Groups you assign roles to | Unique identifier |
| ----------------------------- | -------------------------- | ----------------- |
| **AD/LDAP** (login via Entra, users and groups still read from on-prem AD) | The same AD groups as before, but they're re-provisioned, so the role assignments are still redone | An attribute that exists **in both** Entra and AD with equal values, e.g. `email` ↔ `mail` or `username` ↔ `sAMAccountName`. **Not `sub`**, and not `oid` either: neither exists in on-prem AD ([KB 386870][kb386870]) |
| **SCIM** or **JIT** | Entra groups (cloud groups, or AD groups synced into Entra) | `oid` ([KB 431031][kb431031], see [Broker side](#broker-side)) |

AD/LDAP provisioning is the smallest change if your Entra tenant is synced
from the same AD: the group names stay the same and no inbound SCIM path is
needed. You do enter the bind account, base DN and LDAPS certificate again,
because the reset removed them ([prerequisites](prerequisites.md#identity-source-for-the-vcf-identity-broker)).

### Procedure (9.1)

From [Change the Identity Provider in VCF Single Sign-On][changeidp91]:

1. In VCF Operations: **Manage → Fleet Management → Identity & Access**.
2. Click **VCF SSO Overview**, then, under **VCF SSO**, the identity broker
   you configured.
3. **Actions → Change the Identity Provider** (top right).
4. Tick the confirmation and click **Change**. The wording differs by
   release:
   - TechDocs 9.1: *"I confirm to delete of all SSO-related configurations,
     including the identity provider configuration, the provisioned users
     and groups, and the component configuration"*.
   - The 9.1.1 UI (seen 2026-11-11): *"I confirm to change the identity
     provider configuration including the provisioned users and groups."*,
     followed by *"The components that are configured against this identity
     broker will be retained. After you configure a new identity provider,
     you may need to assign roles to the newly provisioned users and
     groups."*

   The 9.1.1 text matches what the same TechDocs page says elsewhere: the
   component configuration is kept, users, groups and role assignments are
   not.
5. On **Configure VCF SSO**, go to the second step, **Configure Identity
   Provider**, choose **Microsoft Entra ID** and continue as in
   [Broker side](#broker-side).
6. For SCIM: set up provisioning on the non-gallery enterprise application
   with the new SCIM URL and token (see [Entra side](#entra-side), step 5),
   and wait for the first push or use *Provision on demand*.
7. Assign roles again ([Step 6](#step-6--assign-roles-per-product)).

**9.0** has a different click-path: **Fleet Management → Identity & Access →**
pick the VCF instance → **Identity Source** tab → **Reset SSO** → the first
option, *"I confirm to delete the identity provider configuration including
the provisioned users and groups"* → **Reset** → **Configure Identity
Provider** ([9.0][changeidp90]).

### After the switch: test and known failures

Log in with an Entra account on **every** product, not just VCF Operations.

| Symptom | Cause / fix |
| ------- | ----------- |
| Entra login succeeds, vCenter says *"Access denied. Unable to authenticate the user"* | Unique identifier set to `sub` instead of `oid` (SCIM/JIT) ([KB 431031][kb431031]); or, with AD/LDAP provisioning, the identifier values differ between Entra and AD ([KB 386870][kb386870]) |
| Management domain vCenter: *"VCF Identity Broker encountered an issue during authentication. Message: Invalid access policy."* | The broker kept the old access policy. Deregister the management domain under **Identity & Access → VCF Instances** and configure VCF SSO for it again ([KB 423152][kb423152], written for VCF Operations 9.0.x) |
| New SSO configuration won't save: *"The configured credentials do not have sufficient privileges"* | Stale SSO state on vCenter / NSX after a full reset or delete ([KB 438369][kb438369]) |
| Users show up with empty first/last names (JIT) | Add `given_name` / `family_name` as optional claims ([KB 419641][kb419641]) |

[changeidp91]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/managing-identity-and-access-using-vcf-single-sign-on/what-is/managing-vmware-cloud-foundation-operations-sso/change-the-identity-provider-in-vcf-sso.html
[changeidp90]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/fleet-management/what-is/managing-vmware-cloud-foundation-operations-sso/change-the-identity-provider-in-vcf-sso.html
[kb386870]: https://knowledge.broadcom.com/external/article/386870
[kb411917]: https://knowledge.broadcom.com/external/article/411917/replacing-the-certificate-breaks-the-ide.html
[kb423152]: https://knowledge.broadcom.com/external/article/423152/error-vcf-identity-broker-encountered-an.html
[kb438369]: https://knowledge.broadcom.com/external/article/438369/unable-to-reconfigure-sso-after-sso-rese.html

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
- TechDocs (9.1 doc set, *Managing Identity and Access Using VCF Single
  Sign-On*; until late 2026 only the 9.0 set had these pages — the VCF
  Operations / Automation child pages are merged into one *Join or Add VCF
  Components* page in 9.1):
  [Setting Up SSO](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/managing-identity-and-access-using-vcf-single-sign-on/what-is/setting-up-sso.html),
  [Configure Active Directory as an Identity Provider Using AD/LDAP](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/managing-identity-and-access-using-vcf-single-sign-on/what-is/setting-up-sso/cofigure-vmware-cloud-foundation-identity-provider/configure-vmware-cloud-foundation-identity-provider-for-ad-ldap(2).html),
  [Configure VCF SSO for NSX and vCenter](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/managing-identity-and-access-using-vcf-single-sign-on/what-is/setting-up-sso/connect-components.html),
  [Configure VCF SSO for the Operations and Automation Appliance](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/managing-identity-and-access-using-vcf-single-sign-on/what-is/setting-up-sso/configure-vmware-cloud-foundation-sso-for-the-operations-and-automation-appliance(1).html)
  (with per-product child pages for
  [VCF Operations](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/managing-identity-and-access-using-vcf-single-sign-on/what-is/setting-up-sso/configure-vmware-cloud-foundation-sso-for-the-operations-and-automation-appliance(1)/join-or-add-vcf-components-to-vcf-single-sign-on.html)
  and
  [VCF Automation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/managing-identity-and-access-using-vcf-single-sign-on/what-is/setting-up-sso/configure-vmware-cloud-foundation-sso-for-the-operations-and-automation-appliance(1)/join-or-add-vcf-components-to-vcf-single-sign-on.html)),
  [Configure VCF SSO as a Client for Other Components](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/managing-identity-and-access-using-vcf-single-sign-on/what-is/setting-up-sso/configure-vmware-cloud-foundation-sso--as-a-client-for-other-components.html),
  [Assigning Roles and Permissions](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/managing-identity-and-access-using-vcf-single-sign-on/what-is/setting-up-sso/assign-a-vcf-role.html),
  [VCF 9.1 Release Notes — What's New (VCF Operations)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/release-notes/vmware-cloud-foundation-9-1-0-0-release-notes/what-s-new/whats-new-vcf-ops.html).
- Broadcom KBs (VCF Operations for Networks' own separate LDAP path):
  [Aria/VCF Operations for Networks LDAP authentication troubleshooting (KB 306857)](https://knowledge.broadcom.com/external/article/306857/aria-operations-for-networks-ldap-authen.html),
  [Configuring LDAP/LDAPS in Aria/VCF Operations for Networks (KB 368979)](https://knowledge.broadcom.com/external/article/368979/configuring-ldapldaps-in-aria-operation.html).
- Microsoft (LDAPS on the domain controllers):
  [Enable LDAP over SSL with a third-party certification authority](https://learn.microsoft.com/en-us/troubleshoot/windows-server/active-directory/enable-ldap-over-ssl-3rd-certification-authority)
  — certificate requirements, ports 636/3269, the `certreq` procedure.
- VMware Cloud Foundation blog:
  [On-Demand Lookup for Active Directory and OpenLDAP in VCF 9.1.1](https://blogs.vmware.com/cloud-foundation/?p=34595),
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
