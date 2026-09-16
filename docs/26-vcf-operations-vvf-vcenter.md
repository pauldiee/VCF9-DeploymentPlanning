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
| 2 | [Step 2 — Create the service account](#step-2--create-the-service-account) | Local SSO domain or AD |
| 3 | [Step 3 — Assign the permission](#step-3--assign-the-permission) | Top-level folder, not Global Permissions |
| 4 | [Step 4 — Add the vCenter adapter in VCF Operations](#step-4--add-the-vcenter-adapter-in-vcf-operations) | Connecting VCF Operations to vCenter |
| 5 | [Field notes](#field-notes) | One account vs. two, verification |
| 6 | [References](#references) | TechDocs behind the above |

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

Create a dedicated local (SSO domain) or AD service account for VCF
Operations to use — don't reuse a personal or administrator account. Name it
so its purpose is obvious in an audit (e.g. `svc-vcfops-vc01`), matching the
service-account convention already used elsewhere in the fleet (bind
accounts, depot accounts).

For a local SSO-domain account, PowerCLI's `VMware.vSphere.SsoAdmin` module
does it in one line (install with
`Install-Module VMware.vSphere.SsoAdmin -Scope CurrentUser` if it's not
already present):

```powershell
# UNTESTED against a live VCF 9 vCenter - verify before relying on it.
Connect-SsoAdminServer -Server sfo-w01-vc01.sfo.rainpole.io -User 'administrator@vsphere.local' -Password $ssoAdminPassword

New-SsoPersonUser -UserName 'svc-vcfops-vc01' -Password $svcAccountPassword `
    -Description 'VCF Operations vCenter adapter service account'
```

For an AD service account, create it through your existing AD provisioning
process instead — same naming convention, no local-SSO step needed.

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
