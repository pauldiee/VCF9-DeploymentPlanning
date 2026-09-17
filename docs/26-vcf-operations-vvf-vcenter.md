# VCF Operations in VVF/Standalone — vCenter Adapter Setup

> Closes #319. Companion to
> [`05-day2-deployments.md`](05-day2-deployments.md) (VCF Operations B.x
> topics for a fleet deployment) and
> [`09-binary-depot.md` §5.1](09-binary-depot.md#51-proxying-vcf-operations-without-a-vcf-management-services-runtime-vvf--standalone)
> (proxying VCF Operations in the same VVF/standalone topology).

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
| 6 | [Field notes](#field-notes) | One account vs. two, verification |
| 7 | [References](#references) | TechDocs/KB behind the above |

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

- [Configuring a vCenter Server Cloud Account in VCF Operations](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/infrastructure-operations/connect-to-data-sources/vsphere/configuring-a-vcenter-server-cloud-account-in-vrealize-operations.html)
- [Privileges Required for Configuring a vCenter Adapter Instance](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/infrastructure-operations/connect-to-data-sources/vsphere/configuring-a-vcenter-server-cloud-account-in-vrealize-operations/privileges-required-for-configuring-a-vcenter-adapter-instance.html)
- [Create a vCenter Server Custom Role](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/7-0/vsphere-security/vsphere-permissions-and-user-management-tasks/using-roles-to-assign-privileges/create-a-custom-role.html)
- [Using vCenter Server Global Permissions](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/8-0/vsphere-security/vsphere-permissions-and-user-management-tasks/global-permissions.html) — why this guide uses a top-level-object permission instead
- [How to change a node hostname in Aria Operations (Broadcom KB 337564)](https://knowledge.broadcom.com/external/article/337564/how-to-change-a-node-hostname-in-vrealiz.html) — source for the "Renaming a node hostname" section, including the VCF-9-unsupported caveat
