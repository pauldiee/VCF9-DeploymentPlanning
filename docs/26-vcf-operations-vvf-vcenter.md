# VCF Operations in VVF/Standalone — Post-Deployment Configuration

> Closes #319. Companion to
> [`05-day2-deployments.md`](05-day2-deployments.md) (VCF Operations B.x
> topics for a fleet deployment) and
> [`27-vcf-operations-ha-cloud-proxy-vvf.md`](27-vcf-operations-ha-cloud-proxy-vvf.md)
> (deploying VCF Operations itself — nodes, HA, Cloud Proxy, License
> Server — in the same VVF/standalone topology; do that doc first, this
> one second).

**In a full VCF fleet, Fleet LCM registers vCenter with VCF Operations for
you** as part of domain/cluster management — there's no manual adapter setup.
**A VVF deployment with VCF Operations deployed standalone has no Fleet LCM**,
so nothing provisions a vCenter service account or adds the vCenter
connection automatically. You do both by hand, in this order: create a role
in vCenter → create a service account → assign the permission → add the
vCenter adapter instance in VCF Operations.

---

## Contents

| # | Section | Use it when |
| - | ------- | ----------- |
| 1 | [Step 1 — Create the vCenter role](#step-1--create-the-vcenter-role) | Defining what the service account is allowed to do |
| 2 | [Step 2 — Create the service account](#step-2--create-the-service-account) | Local SSO domain, not AD — keeps it independent of your identity provider |
| 3 | [Step 3 — Assign the permission](#step-3--assign-the-permission) | Top-level folder, not Global Permissions |
| 4 | [Step 4 — Add the vCenter adapter in VCF Operations](#step-4--add-the-vcenter-adapter-in-vcf-operations) | Connecting VCF Operations to vCenter |
| 5 | [Renaming a node hostname](#renaming-a-node-hostname) | Fixing a wrong hostname baked in at deploy time — VVF/standalone only |
| 6 | [Configuring an AD/LDAP authentication source](#configuring-an-adldap-authentication-source) | Letting AD users log into VCF Operations without an Identity Broker |
| 7 | [Field notes](#field-notes) | One account vs. two, verification |
| 8 | [References](#references) | TechDocs/KB behind the above |

---

## Step 1 — Create the vCenter role

vSphere Client → **Administration** → **Access Control** → **Roles** →
**New**. TechDocs, verbatim, on the procedure: *"Enter a name for the new
role"*, then *"Scroll the privilege categories and select all privileges or
a subset of privileges for that category"*, then **Add** to save.

Privileges, per Broadcom's
[Privileges Required for Configuring a vCenter Adapter Instance](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/infrastructure-operations/connect-to-data-sources/vsphere/configuring-a-vcenter-server-cloud-account-in-vrealize-operations/privileges-required-for-configuring-a-vcenter-adapter-instance.html):

- **Base (Read Only) — always required:** `System.Anonymous`,
  `System.View`, `System.Read`.
- **Monitoring and data collection — layer on as needed:** Performance
  (Modify intervals), Storage views (View), Datastore (Browse datastore),
  Virtual machine → Guest operations (alias modification/query, guest
  operation modifications, program execution, queries), Virtual machine →
  Service configuration (manage/modify/query/read service configuration),
  Global (Global tag, Health, Manage custom attributes, System tag, Set
  custom attribute), Authorization Manager, `ExternalStatsProvider.Register`
  / `.Unregister` / `.Update`, Storage Resource Manager.
- **Performing vCenter actions (optional) — only if you want VCF Operations
  to act, not just observe:** Virtual machine → Interaction (Power off, and
  similar interaction privileges), `Host.Inventory.EditCluster`, Virtual
  machine → Snapshot management, and the other action-oriented privileges
  TechDocs lists alongside these.

You can put everything in one role for one account, or split monitoring vs.
action privileges into two roles for two accounts — see
[Field notes](#field-notes).

### PowerCLI — create the role

`New-VIRole` does this in one shot instead of the wizard. **Field-verified**
against both a vCenter 8 and a vCenter 9 instance:

```powershell
$vc        = Connect-VIServer -Menu
$resolved  = @()
$missing   = @()
$rolename  = 'VCF_Operations'

# Base (Read Only) + the common monitoring/data-collection set from the
# TechDocs table above. Add ExternalStatsProvider.* / action privileges only
# if VCF Operations needs to write stats or run actions against this vCenter.
$privs = @(
    'System.Anonymous',
    'System.View',
    'System.Read',
    'Datastore.Browse',
    'Performance.ModifyIntervals',
    'VirtualMachine.GuestOperations.Query',
    'VirtualMachine.GuestOperations.Modify',
    'VirtualMachine.GuestOperations.Execute',
    'Global.ManageCustomFields',
    'Global.SetCustomField',
    'ExternalStatsProvider.Register',
    'ExternalStatsProvider.Unregister',
    'ExternalStatsProvider.Update'
)

foreach ($priv in $privs) {
    try     { $resolved += Get-VIPrivilege -Server $vc -Id $priv -ErrorAction Stop }
    catch   { $missing  += $priv }
}

if ($missing) {
    throw "Aborting - not found on this vCenter build: $($missing -join ', '). " +
          "Reconcile against the TechDocs privilege table before re-running; " +
          "do not create the role with a silently reduced privilege set."
}

New-VIRole -Server $vc -Name $rolename -Privilege $resolved
```

**`Connect-VIServer -Menu` is what gives this multiple-vCenter support** —
it prompts an interactive picker (saved/recent connections, or type a new
FQDN) and lets you select more than one vCenter in a single run. `$vc` then
holds every server you picked, and passing `-Server $vc` through
`Get-VIPrivilege`/`New-VIRole` (rather than relying on PowerCLI's default
connection) creates the role on all of them in one pass instead of
re-running the script per vCenter.

The privilege-ID abort-on-missing behavior is unchanged from the design
above: a role with a silently reduced privilege set is worse than a script
that stops and makes you look, because it fails quietly much later (a
metric or action VCF Operations can't perform, with no error pointing back
to the role).

### PowerCLI — add the action privileges (only if you'll use Operational Actions)

**If you leave the role at the base + monitoring set above but toggle
Activate for Operational Actions in Step 4, VCF Operations will validate the
connection fine (read-only is enough for that) and then warn that the
account is missing privileges when it actually tries to act** — the
Validate Connection check and the action-privilege check are not the same
gate. Append this block **before** `New-VIRole` if you want VCF Operations
to act, not just observe (field-reported gap: #350) — it's the same
resolve/abort pattern as the base script above, extended with the
action-oriented privileges from Broadcom's
[Privileges Required for Configuring a vCenter Adapter Instance](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/infrastructure-operations/connect-to-data-sources/vsphere/configuring-a-vcenter-server-cloud-account-in-vrealize-operations/privileges-required-for-configuring-a-vcenter-adapter-instance.html)'s
"Performing vCenter Actions" section. **Field-verified**: all 12 privilege
IDs below resolved against a live vCenter 9 instance, and a role combining
them with the base set created (and removed again) cleanly:

```powershell
$actionPrivs = @(
    'VirtualMachine.Interact.PowerOff',
    'VirtualMachine.Interact.PowerOn',
    'VirtualMachine.Interact.Reset',
    'VirtualMachine.Config.Memory',
    'VirtualMachine.Config.CPUCount',
    'VirtualMachine.State.CreateSnapshot',
    'VirtualMachine.State.RemoveSnapshot',
    'VirtualMachine.Inventory.Delete',
    'Host.Inventory.EditCluster',
    'Resource.AssignVMToPool',
    'Resource.ColdMigrate',
    'Resource.HotMigrate'
)

foreach ($priv in $actionPrivs) {
    try     { $resolved += Get-VIPrivilege -Server $vc -Id $priv -ErrorAction Stop }
    catch   { $missing  += $priv }
}
```

Then run the same `if ($missing) { throw ... }` check and `New-VIRole` from
the base script — `$resolved` now carries both sets into one role. If
you're splitting monitoring vs. action into two accounts (see
[Field notes](#field-notes)), build `$actionPrivs` into a second role
instead of merging it into `$resolved`.

## Step 2 — Create the service account

**Use a local (SSO domain) account, not AD.** This matches how VCF itself
handles every other system-managed service account in the fleet (bind
accounts, depot accounts) — it's a deliberate pattern, not just the path of
least resistance: a local account keeps this integration working
independently of your identity provider. If AD is down, mis-configured, or
the trust relationship breaks, an AD-backed service account takes the
vCenter adapter down with it; a local account doesn't depend on anything
outside vCenter itself. Don't reuse a personal or administrator account
either way. Name it so its purpose is obvious in an audit (e.g.
`svc-vcfops-vc01`).

PowerCLI's `VMware.vSphere.SsoAdmin` module creates it in one line (install
with `Install-Module VMware.vSphere.SsoAdmin -Scope CurrentUser` if it's not
already present):

```powershell
# UNTESTED against a live VCF 9 vCenter - verify before relying on it.
Connect-SsoAdminServer -Server sfo-w01-vc01.sfo.rainpole.io -User 'administrator@vsphere.local' -Password $ssoAdminPassword

New-SsoPersonUser -UserName 'svc-vcfops-vc01' -Password $svcAccountPassword `
    -Description 'VCF Operations vCenter adapter service account'
```

**Optional: set the account's password to never expire.** Left on the
domain default, this service account's password expires like any other
local account and the vCenter adapter integration silently breaks whenever
that happens — the failure shows up as a `PasswordExpiredException` in
`/var/log/vmware/sso/websso.log`, not anywhere in VCF Operations itself.
Whether that's a problem depends on how you handle credential rotation for
this account — if you already rotate it on a schedule shorter than the
domain's password lifetime, you don't need either option below. Two ways to
avoid the silent-break scenario, not mutually exclusive:

- **Raise the domain-wide password policy** (Administration → Single Sign
  On → Configuration → Password Policy in the vSphere Client, or
  `Set-SsoPasswordPolicy -PasswordLifetimeDays <N>` /
  `-PasswordLifetimeDays 0` for no expiry via PowerCLI). Simpler, but it's
  **global** — every local SSO account's password lifetime changes, not
  just this service account's, so only do this if that's an acceptable
  trade-off for the whole `vsphere.local` domain.
- **Override just this one account**, leaving the domain policy untouched.
  There's no per-account toggle in the vSphere Client or in
  `New-SsoPersonUser`/`Set-SsoPersonUser` — per Broadcom's
  [KB 367383 — Set password expiry policy for a specific SSO user in vCenter](https://knowledge.broadcom.com/external/article/367383),
  the only supported way is `dir-cli`, run on the VCSA itself:

  ```
  # SSH into the vCenter Server Appliance, then:
  shell
  /usr/lib/vmware-vmafd/bin/dir-cli user modify --account svc-vcfops-vc01 --password-never-expires
  ```

  **When prompted for a password, use the SSO administrator's
  (`administrator@vsphere.local`) credentials — not the appliance root
  password.** The KB is explicit that using root here fails with
  `ERROR_LOGON_FAILURE (1326)`. Verify the change stuck with
  `dir-cli user find-by-name --account svc-vcfops-vc01 --level 2` — look for
  `Password never expires: TRUE` in the output.

  **Scriptable end-to-end**, per the official
  [dir-cli Command Reference](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere-sdks-tools/8-0/dir-cli-utility.html):
  `dir-cli user modify` takes `--login <admin_user_id>` /
  `--password <admin_password>` to authenticate non-interactively instead
  of prompting, so the whole thing can run unattended:

  ```
  /usr/lib/vmware-vmafd/bin/dir-cli user modify --account svc-vcfops-vc01 --password-never-expires --login administrator@vsphere.local --password '<sso-admin-password>'
  ```

  The remaining manual piece is getting a shell on the VCSA at all — its
  default SSH shell is the restricted `appliancesh`, not BASH, so a
  non-interactive script needs either `ssh <vcsa> "shell dir-cli ..."`
  (passing the command directly to `shell` rather than typing it
  interactively) or BASH set as the SSH account's default shell ahead of
  time (`chsh -s /bin/bash <user>`, a one-time appliance-side change).

## Step 3 — Assign the permission

**Assign the role on the top-level object of the vCenter Server inventory —
not Global Permissions** (Global Permissions spans every vCenter in Enhanced
Linked Mode, broader scope than this needs). In the vSphere Client: select
the vCenter Server object at the root of the inventory tree → **Permissions**
→ **Add Permission** → pick the domain/user and the role you created in Step
1.

TechDocs is explicit on two requirements here, verbatim: *"You must
configure the permission on the top-level folder within the vCenter Server
inventory, and verify that the Propagate to children check box is
selected."* Skipping either — assigning at a datacenter/cluster level
instead, or leaving Propagate to children unchecked — means VCF Operations
can't see everything under that root.

PowerCLI one-liner, continuing the `$vc` / `$rolename` session from Step 1
(this part is **UNTESTED against a live VCF 9 vCenter** — verify before
relying on it, unlike the role-creation script above):

```powershell
$rootFolder = Get-Folder -Server $vc -NoRecursion
New-VIPermission -Server $vc -Entity $rootFolder -Principal 'svc-vcfops-vc01' -Role $rolename -Propagate:$true
```

`Get-Folder -NoRecursion` with no name filter returns the top-level folder
of the connected vCenter's inventory — the same object the vSphere Client
procedure above targets. Confirm it returns exactly one object before
piping it into `New-VIPermission` (it will return more than one if you're
connected to multiple vCenters in the same PowerCLI session).

## Step 4 — Add the vCenter adapter in VCF Operations

Per Broadcom's
[Configuring a vCenter Server Cloud Account in VCF Operations](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/infrastructure-operations/connect-to-data-sources/vsphere/configuring-a-vcenter-server-cloud-account-in-vrealize-operations.html):

1. **VCF Operations → Operate → Administration → Integrations.**
2. **Accounts** tab → **Add** → **vCenter** as the account type.
3. Enter a display name/description, and select the **Physical Data Center**
   to associate with the account.
4. Enter the vCenter **FQDN or IP address**.
5. **Credentials** → **Add** → enter the Step 2 service account's
   username/password. Optionally add a separate **Action User Name /
   Actions Password** if you split monitoring vs. action accounts.
6. **Cloud Proxy/Group** — select the collector for this vCenter account.
7. **Validate Connection**, accept the certificate if it matches your
   target vCenter.
8. Toggle **Activate for Operational Actions**, **Activate Log Collection**,
   **Activate Network and Flow** as needed; expand **Advanced Settings** if
   required.
9. **Add**, then **Start Collecting** from the account menu — collection
   doesn't start automatically on Add.

## Renaming a node hostname

**VVF/standalone only — do not attempt this on a VCF 9 fleet-managed VCF
Operations cluster.** Broadcom's
[KB 337564](https://knowledge.broadcom.com/external/article/337564/how-to-change-a-node-hostname-in-vrealiz.html)
is explicit, verbatim: *"Changing the VCF Operations IP address is only
supported for 'VVF or standalone' Operations clusters. This procedure is
not supported for VCF 9.x environments."* On a fleet deployment, node
identity is Fleet-LCM-managed —
the supported fix there is removing the node from the analytics cluster and
redeploying it with the correct name, not the steps below. This section is
for a standalone/VVF cluster, same scope as the rest of this doc.

**Prerequisite:** create valid forward *and* reverse DNS entries for the new
hostname first — verify both directions with `nslookup` before touching a
node.

### Analytics node (primary, replica, or data)

1. Log in to the VCF Operations admin UI (`https://<node>:5480`).
2. Take the cluster **OFFLINE**.
3. SSH into the node as `root`.
4. `$VMWARE_PYTHON_BIN /usr/lib/vmware-vcopssuite/utilities/bin/sethostname.py <NewHostName>`
5. Restart the node from vCenter.
6. Bring the cluster back **ONLINE** from the admin UI.

If the hostname doesn't stick after the restart in step 5, the KB points to
the version-specific *"Restoring the vApp properties"* article (8.12-and-below
vs. 8.14-and-later have separate sub-articles) and says to retry steps 3-5.

### Cloud Proxy

No cluster offline/online step needed:

1. SSH into the Cloud Proxy as `root`.
2. Same `sethostname.py <NewHostName>` command as above.
3. Restart the node from vCenter (same vApp-properties fallback if it
   doesn't stick).

### If the old hostname was used at cluster enrollment

Changing the OS-level hostname doesn't retroactively fix the cluster's own
record of it — you also need to patch `casa.db.script`, **repeated on every
analytics node** (primary, replica, and each data node):

1. SSH/console in as `root`.
2. `service vmware-casa stop`
3. `cp /storage/db/casa/webapp/hsqldb/casa.db.script /tmp/casa.db.script.old`
4. Edit the file, find the old hostname in the `ip_address` field, replace
   it with the new hostname.
5. `service vmware-casa start`

## Configuring an AD/LDAP authentication source

**VVF/standalone has no Identity Broker** — that's a VCF-fleet-only
component (`12-sso-configuration.md`), not available here. If you want AD
users logging into VCF Operations with their own credentials instead of
sharing the local `admin`/service accounts, VCF Operations has its own
native mechanism for this, independent of the Identity Broker: **Authentication
Sources**. Per Broadcom's
[Authentication Sources: Add Authentication Source for User and Group Import](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/infrastructure-operations/-configuring-administration-settings/managing-user-access-control/authentication-sources-overview/authentication-sources-add-authentication-source-for-user-and-group-import.html):

1. **Operate → Administration → Control Panel → Authentication Sources
   tile → Add.**
2. **Source Display Name** — a name you choose for this source.
3. **Source Type** — for AD, pick **Open LDAP** (the same LDAP-based type
   Active Directory uses here — TechDocs doesn't split out a
   separate "Active Directory" option; **Other** covers non-AD LDAP
   directories like Novell or OpenDJ).
4. Choose an integration mode:
   - **Basic** — give VCF Operations a **Domain/Subdomain** (use the
     **root** domain, e.g. `corp.com`, not a subdomain, or you limit
     visibility to just that subdomain's users/groups) and a **User
     Name**/password that can log in to the LDAP host. VCF Operations
     discovers the **Host** and populates a **Base DN** from that —
     **verify the Base DN before saving**, TechDocs is explicit VCF
     Operations only auto-populates it, an administrator still has to
     confirm it's correct. **Common Name** defaults to
     `userPrincipalName` (the standard AD attribute).
   - **Advanced** — same fields, but you supply **Host** and **Base DN**
     yourself instead of letting VCF Operations derive them.
   - Either mode: check **Use SSL/TLS** for secure LDAP. No certificate
     import needed — VCF Operations prompts you to view/accept the LDAP
     server's certificate thumbprint instead. **If AD uses a self-signed
     certificate, the certificate's Subject Alternative Name must match
     the domain controller's hostname/IP** — a mismatch here is a silent
     integration failure, not an obvious error.
5. **Search Criteria** (both modes) — VCF Operations pre-populates **Group
   Search Criteria**, **Member Attribute**, **User Search Criteria**, and
   **Member Match Field** with sensible LDAP defaults; verify them against
   your directory's actual schema rather than assuming they're right.
6. **Test** — checks the host is reachable with the credentials given.
   **This does not validate the Base DN or Common Name** — a passing test
   doesn't mean the search will actually find your users.
7. **Save.**

**Importing the source doesn't grant anyone access by itself** — it makes
AD/LDAP users and groups available to VCF Operations' Access Control, the
same as local users. Assign them a role (Access Control → Users/User
Groups) same as you would a local account.

> **This is a different mechanism from admin-interface AD/LDAP
> integration.** The steps above are the main VCF Operations product UI
> (regular dashboard/tenant login). There's a **separate**, lower-level AD/LDAP
> integration under the cluster **admin interface**
> (`https://<primary-node>/admin` → **Administration → Control Panel →
> Administrator Settings → Active Directory/Open LDAP Integration**) —
> that one grants AD/LDAP users **administrator access to the cluster
> admin interface itself** (the same admin UI used for HA node management
> in `27-vcf-operations-ha-cloud-proxy-vvf.md` Step 3), a narrower,
> separate concern from regular product login. Don't conflate the two —
> setting up one does not configure the other.

## Field notes

- **One account vs. two.** TechDocs: *"You can configure these permissions
  as a single role in vCenter to be used by a single service account or
  configure them as two independent roles for two separate service
  accounts."* Two accounts (monitoring-only + action-capable) is the
  tighter-blast-radius option if VCF Operations will run remediation actions
  against this vCenter, not just collect metrics.
- **Repeat Steps 1-4 for every additional vCenter** you connect to this
  standalone VCF Operations — Step 1's script handles the role creation for
  several vCenters in one run (`Connect-VIServer -Menu` selects more than
  one), but the service account, permission assignment, and the VCF
  Operations adapter add in Steps 2-4 are still per-vCenter.
- **Verify collection, not just Validate Connection.** A green Validate
  Connection only confirms reachability and credentials; check the account's
  collection state on the Integrations page afterward to confirm data is
  actually flowing.

## References

- [Set password expiry policy for a specific SSO user in vCenter (Broadcom KB 367383)](https://knowledge.broadcom.com/external/article/367383) — source for Step 2's `dir-cli --password-never-expires` guidance
- [dir-cli Command Reference](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere-sdks-tools/8-0/dir-cli-utility.html) — `--login`/`--password` flags for non-interactive `dir-cli` use
- [Configuring a vCenter Server Cloud Account in VCF Operations](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/infrastructure-operations/connect-to-data-sources/vsphere/configuring-a-vcenter-server-cloud-account-in-vrealize-operations.html)
- [Privileges Required for Configuring a vCenter Adapter Instance](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/infrastructure-operations/connect-to-data-sources/vsphere/configuring-a-vcenter-server-cloud-account-in-vrealize-operations/privileges-required-for-configuring-a-vcenter-adapter-instance.html)
- [Create a vCenter Server Custom Role](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/7-0/vsphere-security/vsphere-permissions-and-user-management-tasks/using-roles-to-assign-privileges/create-a-custom-role.html)
- [Using vCenter Server Global Permissions](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/8-0/vsphere-security/vsphere-permissions-and-user-management-tasks/global-permissions.html) — why this guide uses a top-level-object permission instead
- [How to change a node hostname in Aria Operations (Broadcom KB 337564)](https://knowledge.broadcom.com/external/article/337564/how-to-change-a-node-hostname-in-vrealiz.html) — source for the "Renaming a node hostname" section, including the VCF-9-unsupported caveat
- [Authentication Sources: Add Authentication Source for User and Group Import](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/infrastructure-operations/-configuring-administration-settings/managing-user-access-control/authentication-sources-overview/authentication-sources-add-authentication-source-for-user-and-group-import.html) — source for "Configuring an AD/LDAP authentication source"
- [Give Administrator Access to AD or LDAP Users](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/infrastructure-operations/-configuring-administration-settings/managing-user-access-control/authentication-sources-overview/ad-ldap-integration-admin-ui.html) — the separate, admin-interface-level AD/LDAP integration mentioned in that section's callout
