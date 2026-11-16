# Jump Host: PowerShell 7 and VCF PowerCLI — Build Guide

The jump host ([`prerequisites.md` → Jump host](prerequisites.md#jump-host))
needs **PowerShell 7** and **VCF PowerCLI** for custom ESX images, day-2
scripts and most community tools. Windows ships only Windows PowerShell 5.1,
and VCF PowerCLI 9.x doesn't work properly on 5.1, so this is the step that
most often goes wrong on a fresh jump host. It goes wrong even more often on a
jump host **without internet access**, where everything has to be carried in
by hand.

This page covers both cases: a jump host with internet access
([§2](#2-with-internet-access)) and one without
([§3](#3-without-internet-access)). It ends with how to check the result
([§4](#4-check-the-result)) and the problems seen on real jump hosts
([§6](#6-pitfalls)).

> **Evidence level:** Broadcom's *PowerCLI Installation Guide*, the VCF
> PowerCLI download page, KB 409981 and KB 428547, the PowerShell Gallery
> page for `VCF.PowerCLI`, and Microsoft Learn (*Install PowerShell 7 on
> Windows*, *PowerShell Support Lifecycle*, *about_PSModulePath*,
> `Install-Module`, `Save-Module`), all read verbatim on 2026-11-16. The
> offline-zip problems in [§6](#6-pitfalls) are **field-verified
> 2026-11-13** on an air-gapped jump host. The manifest and module-path
> checks are **lab-verified 2026-11-16** (PowerShell 7.6.10, VCF.PowerCLI
> 9.1.1.25718932, Windows 11).

---

## 1. What to install

| Component | Pick | Why |
| --- | --- | --- |
| PowerShell | **7.6 (LTS)**, latest patch | Broadcom: *"PowerShell 7.4 or later is officially supported and is our minimum recomended version for use"*. Microsoft ended support for **7.4 and 7.5 on 10-Nov-2026**; 7.6 LTS is supported until **14-Nov-2028** ([support lifecycle](https://learn.microsoft.com/en-us/powershell/scripting/install/powershell-support-lifecycle)). |
| PowerCLI | **VCF.PowerCLI** 9.1.1 (`9.1.1.25718932`) | *"Make sure that you are installing VCF.PowerCLI and not VMware.PowerCLI."* VMware.PowerCLI *"is compatible with vCenter Server 8.0 or earlier"*; for vCenter 9 check the VCF PowerCLI matrix ([KB 428547](https://knowledge.broadcom.com/external/article/428547)). |
| Windows PowerShell 5.1 | Leave it installed, don't use it for PowerCLI | PowerShell 7 *"installs to a new directory and runs side-by-side with Windows PowerShell 5.1"*. VCF PowerCLI 9.x needs *"PowerShell 7.0.13 +"*; on 5.1 it fails at run time with *"Could not load file or assembly 'Newtonsoft.Json…'"* ([KB 409981](https://knowledge.broadcom.com/external/article/409981)). |

Two things to know before you start:

- **The PowerShell Gallery lists `5.1` as the minimum PowerShell version** for
  VCF.PowerCLI, so `Install-Module` happily installs it from Windows
  PowerShell 5.1. The install succeeds; the cmdlets fail later (KB 409981).
  Always install and run it from `pwsh`, not `powershell`.
- **One PowerCLI version per jump host.** VCF.PowerCLI pins every submodule to
  an exact version, and a second PowerCLI anywhere in the module path breaks
  the import ([§6.1](#61-several-powercli-versions-on-one-host)). Remove old
  VMware.PowerCLI 11.x/12.x/13.x copies before you install, unless something
  still needs them.

---

## 2. With internet access

### 2.1 PowerShell 7

Microsoft's options, from
[*Install PowerShell 7 on Windows*](https://learn.microsoft.com/en-us/powershell/scripting/install/install-powershell-on-windows):

| Method | Use on a jump host? |
| --- | --- |
| **MSI package** | **Yes.** *"Best choice for Windows Servers and enterprise deployment scenarios."* Installs to `$Env:ProgramFiles\PowerShell\7`. |
| WinGet | On Windows 11 / Server 2025 (Desktop Experience) only: *"winget isn't available on Windows Server 2022 or earlier versions."* From 7.6.0 it installs the **MSIX** by default; add `--installer-type wix` for the MSI. |
| MSIX / Microsoft Store | No. *"Store-based installations are installed for a single user"* and *"don't support PowerShell remoting."* |
| ZIP package | Only for a second, side-by-side version or Server Core. *"Doesn't check for prerequisites."* |

With WinGet (Windows 11 / Server 2025):

```powershell
winget install --id Microsoft.PowerShell --source winget --installer-type wix
```

Or download `PowerShell-7.6.x-win-x64.msi` from the
[PowerShell releases on GitHub](https://github.com/PowerShell/PowerShell/releases)
and install it silently:

```powershell
$msiParams = @(
  '/package', 'PowerShell-7.6.6-win-x64.msi', '/quiet',
  'ADD_PATH=1', 'USE_MU=1', 'ENABLE_MU=1'
)
msiexec.exe @msiParams
```

`USE_MU=1` / `ENABLE_MU=1` (the defaults) let Microsoft Update, WSUS or
Configuration Manager patch PowerShell 7 later.

> Plan ahead: *"Beginning with the PowerShell 7.7.0 release, there is no MSI
> package available. WinGet only installs the MSIX package."* That affects the
> next upgrade, not 7.6.

### 2.2 VCF PowerCLI

Open **PowerShell 7** (`pwsh`), not Windows PowerShell, and install from the
PowerShell Gallery:

```powershell
Install-Module -Name VCF.PowerCLI -Scope CurrentUser
```

- **Scope.** `CurrentUser` installs to `$HOME\Documents\PowerShell\Modules`
  and needs no elevation. `AllUsers` installs to
  `$Env:ProgramFiles\PowerShell\Modules` and needs an elevated session. On a
  shared jump host, `AllUsers` saves every engineer a separate install.
  Without `-Scope`, PowerShellGet 2.x in PowerShell 7 defaults to
  `CurrentUser`, or `AllUsers` *"if you are running in an elevated session"*.
- **Confirmation prompt.** *"Dependent upon your repository settings, you
  might need to answer a prompt for the module installation to continue."*
  Answer `Y`.
- **Proxy.** If the jump host reaches the internet through a proxy, add
  `-Proxy http://proxy.rainpole.io:3128` (and `-ProxyCredential` if needed).
- **Coming from VMware.PowerCLI 13.3 or earlier.** Broadcom recommends a clean
  install: uninstall VMware.PowerCLI first. If you install over it anyway, you
  may hit *"The following commands are already available on this system"*
  (add `-AllowClobber`) and certificate errors because *"PowerCLI is now signed
  with a Broadcom certificate and not a VMware one"* (add
  `-SkipPublisherCheck`).

Update later with `Update-Module -Name VCF.PowerCLI`.

### 2.3 First run

PowerCLI asks once about the Customer Experience Improvement Program, and
refuses connections to servers whose certificate it doesn't trust. Set both
deliberately:

```powershell
Set-PowerCLIConfiguration -Scope User -ParticipateInCeip $false
```

For certificates, the cleaner answer is to import the fleet CA on the jump
host (Windows certificate store, *Trusted Root Certification Authorities*)
and test `Connect-VIServer` with the default setting (`Unset`, the default, which
acts as `Fail`). `InvalidCertificateAction` on
PowerShell 7 knows only two values: *"On PowerShell Core, only the Fail and
Ignore options are supported."* If you must use `Ignore` (a lab, or before the
certificate pass), keep it to the session:

```powershell
Set-PowerCLIConfiguration -Scope Session -InvalidCertificateAction Ignore -Confirm:$false
```

---

## 3. Without internet access

Everything is fetched on a **connected machine**, checked, carried across, and
installed on the jump host. Bring three things:

| What | Where from | Check |
| --- | --- | --- |
| `PowerShell-7.6.x-win-x64.msi` | [PowerShell releases on GitHub](https://github.com/PowerShell/PowerShell/releases) (Assets of the release tag) | As your transfer policy requires |
| `VCF-PowerCLI-9.1.1-25718932.zip` (168.33 MB) | [developer.broadcom.com → VCF PowerCLI](https://developer.broadcom.com/tools/vcf-powercli/latest) | MD5 on the download page: `11f33c4065214aebfb91dbd80b540bab` |
| The fleet CA certificate | Your PKI team | Thumbprint against the CA |

Check the zip before you carry it:

```powershell
(Get-FileHash .\VCF-PowerCLI-9.1.1-25718932.zip -Algorithm MD5).Hash
# 11F33C4065214AEBFB91DBD80B540BAB
```

**Alternative to the zip: `Save-Module`.** On a connected machine with
PowerShell 7, `Save-Module` *"saves a module and its dependencies on the local
computer but doesn't install the module"*, in versioned folders, ready to be
*"copied into the appropriate $env:PSModulePath location of the offline
machine"*:

```powershell
Save-Module -Name VCF.PowerCLI -RequiredVersion 9.1.1.25718932 -Path C:\Transfer\Modules -Repository PSGallery
```

Then carry `C:\Transfer\Modules\*` instead of the zip, and skip step 3.2.

### 3.1 Install PowerShell 7

On the jump host, as administrator:

```powershell
msiexec.exe /package PowerShell-7.6.6-win-x64.msi /quiet ADD_PATH=1 USE_MU=0 ENABLE_MU=0
```

`USE_MU=0` / `ENABLE_MU=0` because the host can't reach Microsoft Update; if
WSUS or Configuration Manager serves the isolated network, leave them at `1`.
Open a new window and check `pwsh -v`.

### 3.2 Unblock the zip, then extract

Files downloaded with a browser carry a *Mark of the Web*, and everything
extracted from a marked zip inherits it. Blocked module files fail to load.

**Unblock the zip itself before you extract it.** Then nothing extracted from
it is blocked, and you don't need admin rights to unblock files afterwards:

```powershell
Unblock-File .\VCF-PowerCLI-9.1.1-25718932.zip
```

Broadcom's guide unblocks *after* extracting instead
(`Get-ChildItem * -Recurse | Unblock-File` in the modules folder). That works
too, but in `Program Files` it needs an elevated session.

### 3.3 Extract to the PowerShell 7 module path

Broadcom: *"Extract the downloaded .zip file to one of the listed folders"*
of `$env:PSModulePath`. Pick the **PowerShell 7** path:

| Scope | Path | Admin? |
| --- | --- | --- |
| One user | `$HOME\Documents\PowerShell\Modules` | No |
| All users | `$Env:ProgramFiles\PowerShell\Modules` | Yes |
| **Not this** | `$Env:ProgramFiles\WindowsPowerShell\Modules` | — |

The last one is the **Windows PowerShell 5.1** path. PowerShell 7 reads it
too (see [§6.2](#62-pwsh-also-reads-the-windows-powershell-paths)), so a
copy there is found, but it's also the path where old PowerCLI versions tend
to live, and mixing is what breaks the import.

On a jump host where *Documents* is redirected or synced by OneDrive, check
the real location first: `[Environment]::GetFolderPath('MyDocuments')`.

```powershell
$dest = "$Env:ProgramFiles\PowerShell\Modules"      # or "$HOME\Documents\PowerShell\Modules"
Expand-Archive .\VCF-PowerCLI-9.1.1-25718932.zip -DestinationPath $dest
Get-ChildItem $dest | Select-Object Name
```

The module folders (`VCF.PowerCLI`, `VMware.VimAutomation.Sdk`,
`VMware.VimAutomation.Core`, …) must land **directly** in that path, not in an
extra subfolder named after the zip. Move them up a level if they did.

### 3.4 Updating later

*"You cannot update the PowerCLI module online if you have installed it by
the offline method. In this case, perform an offline installation of the
latest PowerCLI version."* Remove the old module folders first, so the new
version doesn't end up next to the old one
([§6.1](#61-several-powercli-versions-on-one-host)).

---

## 4. Check the result

Run these in a **clean** session, `pwsh -NoProfile`, so nothing from a profile
interferes.

```powershell
$PSVersionTable.PSVersion                         # 7.6.x
Get-Module -Name VCF.PowerCLI -ListAvailable | Select-Object Version, ModuleBase
```

**Is every required submodule present at the exact version?** VCF.PowerCLI
9.1.1 lists 36 submodules in its manifest, each with a `RequiredVersion`. This
shows only what's missing; no output means complete:

```powershell
$psd = (Get-Module -ListAvailable VCF.PowerCLI | Sort-Object Version -Descending | Select-Object -First 1).Path
(Import-PowerShellDataFile $psd).RequiredModules | ForEach-Object {
  $req = $_; $all = Get-Module -ListAvailable $req.ModuleName -All
  [pscustomobject]@{ Module = $req.ModuleName; Required = $req.RequiredVersion
    Present = [bool]($all | Where-Object { $_.Version -eq $req.RequiredVersion })
    Found = (($all.Version | Sort-Object -Unique) -join ', ') }
} | Where-Object { -not $_.Present } | Format-Table -AutoSize
```

**Is anything still blocked?** Should print `0`:

```powershell
$dest = "$Env:ProgramFiles\PowerShell\Modules"      # where you extracted
(Get-ChildItem $dest -Recurse -File |
  Where-Object { Get-Item $_.FullName -Stream Zone.Identifier -ErrorAction SilentlyContinue }).Count
```

**Does it load, and from where?**

```powershell
Import-Module VCF.PowerCLI
Get-Module VCF.PowerCLI, VMware.VimAutomation.Sdk, VMware.VimAutomation.Core |
  Select-Object Name, Version, ModuleBase
```

All versions should match the release (`9.1.1.…` for VCF.PowerCLI,
`13.5.1.…` for the VMware.* submodules) and come from the path you chose.

**Can it connect?**

```powershell
Connect-VIServer -Server sfo-m01-vc01.rainpole.io
Get-VMHost | Select-Object Name, ConnectionState, Version
Disconnect-VIServer -Confirm:$false
```

---

## 5. Linux jump host

The same order applies on Linux:

- **PowerShell 7** from Microsoft's repository for your distribution
  ([*Install PowerShell on Linux*](https://learn.microsoft.com/en-us/powershell/scripting/install/install-powershell-on-linux)).
  Without internet, carry the `.rpm` or `.deb`: *"Install package files
  (.rpm) are also available from https://packages.microsoft.com/"*.
- **VCF PowerCLI** with `Install-Module -Name VCF.PowerCLI`, or offline with
  Broadcom's same five steps (download the zip, list `$env:PSModulePath`,
  extract, unblock, check).
- **Module paths:** `$HOME/.local/share/powershell/Modules` for one user,
  `/usr/local/share/powershell/Modules` for all users.

---

## 6. Pitfalls

### 6.1 Several PowerCLI versions on one host

**Field-verified 2026-11-13** on an air-gapped jump host that had PowerCLI
11.5 (in `$PSHOME\Modules`), 13.3 (unversioned folders in
`C:\Program Files\WindowsPowerShell\Modules`) and an incomplete offline
VCF.PowerCLI 9.1.1. The import failed with:

```
The required module 'VMware.VimAutomation.Sdk' with version '13.5.1.25718932' is not loaded.
```

and, after a partial fix:

```
Exception calling "OnImportModule" ... Value cannot be null. (Parameter 'type')
```

Why (manifests **lab-verified 2026-11-16** on VCF.PowerCLI 9.1.1; module
behaviour from *about_PSModulePath*):

- **VCF.PowerCLI pins exact versions.** All 36 entries in `RequiredModules`
  carry a `RequiredVersion`. One missing or shadowed submodule fails the whole
  import.
- **The submodules ask each other only for a minimum.**
  `VMware.VimAutomation.Vds` 13.5.1 requires `VMware.VimAutomation.Storage`
  with only a `ModuleVersion`. *"By default, PowerShell loads the highest
  version number of a module when multiple versions are found"*, so with
  several versions installed a session can end up with a mix.
- **One version of a module per session.** Once a PowerCLI assembly is loaded
  it stays until the session ends, so an old version loaded by a profile or an
  earlier command blocks the new one.
- **Unversioned folders** (`…\Modules\VMware.VimAutomation.Sdk\` with the
  files directly in it, typical after a manual copy) hold one version only,
  and a copy in an earlier `PSModulePath` folder shadows a later one.

What to do:

1. **Keep one PowerCLI version on the jump host.** Check every module path, not
   only the one you installed to:
   ```powershell
   Get-Module -ListAvailable VMware.VimAutomation.Sdk, VMware.VimAutomation.Core -All |
     Select-Object Name, Version, ModuleBase
   ```
2. **Run tools from a clean session:** `pwsh -NoProfile`. Don't import
   PowerCLI from the profile on a shared jump host.
3. **If two versions must stay,** keep them in versioned folders
   (`<Module>\<version>\`) and narrow the search path for one session to the
   folder that holds one complete set:
   ```powershell
   $env:PSModulePath = "$Env:ProgramFiles\PowerShell\Modules;$PSHOME\Modules"
   ```

Scripts can guard against this themselves: from v1.2.1,
[VDSPortGroupManager](https://github.com/pauldiee/VDSPortGroupManager)
loads one complete PowerCLI build from the module manifests and skips an
incomplete set. That helps the script; it doesn't fix the jump host.

### 6.2 pwsh also reads the Windows PowerShell paths

PowerShell 7 builds `$env:PSModulePath` from its own user, system and
`$PSHOME` paths and then appends the machine-wide value, which includes the
Windows PowerShell paths (*about_PSModulePath*, *PowerShell 7 startup*). On
the lab workstation the result was:

```
C:\Users\<user>\Documents\PowerShell\Modules
C:\Program Files\PowerShell\Modules
C:\Program Files\PowerShell\7\Modules
C:\Program Files\WindowsPowerShell\Modules
C:\Windows\system32\WindowsPowerShell\v1.0\Modules
```

So a PowerCLI installed for Windows PowerShell years ago is still in play
under `pwsh`. Remove it, or it takes part in the version mix of
[§6.1](#61-several-powercli-versions-on-one-host).

### 6.3 Blocked files after an offline install

**Field-verified 2026-11-13:** extracting the offline zip straight into
`C:\Program Files\WindowsPowerShell\Modules` left every `.psd1`, `.psm1` and
DLL blocked, and `Unblock-File` there needed admin rights. Unblock the zip
before extracting ([§3.2](#32-unblock-the-zip-then-extract)) and check with
the `Zone.Identifier` count in [§4](#4-check-the-result).

### 6.4 SsoAdmin on PowerShell 7

**Lab-verified:** `Connect-SsoAdminServer` from the `VMware.vSphere.SsoAdmin`
module fails on PowerShell 7.6 with VCF.PowerCLI 9.1.1 (a missing
`System.ServiceModel` type). Create or change SSO users and groups in the
vSphere Client instead.

---

## Sources

Read verbatim on 2026-11-16:

- Broadcom, [PowerCLI Installation Guide](https://developer.broadcom.com/powercli/installation-guide):
  PowerShell 7.4+ minimum, online and offline install, update, migrating from
  VMware.PowerCLI (`-AllowClobber`, `-SkipPublisherCheck`)
- Broadcom, [VCF PowerCLI downloads](https://developer.broadcom.com/tools/vcf-powercli/latest):
  `VCF-PowerCLI-9.1.1-25718932.zip`, size and MD5
- [KB 409981](https://knowledge.broadcom.com/external/article/409981):
  VCF PowerCLI 9.x needs PowerShell 7.0.13+
- [KB 428547](https://knowledge.broadcom.com/external/article/428547):
  VCF PowerCLI, not VMware PowerCLI, for vCenter 9
- PowerShell Gallery, [VCF.PowerCLI](https://www.powershellgallery.com/packages/VCF.PowerCLI/):
  current version 9.1.1.25718932 (2026-09-10), minimum PowerShell 5.1 as listed
- Microsoft Learn, [Install PowerShell 7 on Windows](https://learn.microsoft.com/en-us/powershell/scripting/install/install-powershell-on-windows),
  [PowerShell Support Lifecycle](https://learn.microsoft.com/en-us/powershell/scripting/install/powershell-support-lifecycle),
  [about_PSModulePath](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_psmodulepath),
  [Install-Module](https://learn.microsoft.com/en-us/powershell/module/powershellget/install-module),
  [Save-Module](https://learn.microsoft.com/en-us/powershell/module/powershellget/save-module),
  [Install PowerShell on Linux](https://learn.microsoft.com/en-us/powershell/scripting/install/install-powershell-on-linux)
- Broadcom, [Set-PowerCLIConfiguration](https://developer.broadcom.com/powercli/latest/vmware.vimautomation.core/commands/set-powercliconfiguration):
  `InvalidCertificateAction` on PowerShell Core, `ParticipateInCeip`, scopes
