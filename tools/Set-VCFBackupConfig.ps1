#Requires -Version 5.1
<#
.SYNOPSIS
    Sets the VCF 9.1 "VCF Management" backup location through the Fleet LCM API,
    for when the user interface will not accept it.

.DESCRIPTION
    In VCF 9.1 the centralized backup (VCF Operations > Build > Lifecycle >
    VCF Management > Backup & Restore) protects the management services: log
    management, identity broker, Salt master, VCF Automation and the software
    depot.

    This script sends the same payload the Add Backup Location dialog sends, so
    the backup target can be configured when the interface fails or gives no
    usable error:

        PATCH https://<FleetLCM>/fleet-lcm/v1/sddc-lcms/{sddcLcmId}

        {
          "backupConfigSpec": {
            "encryptionPassphrase": "<passphrase>",
            "storage": {
              "sftp": {
                "host":       "<sftp host>",
                "port":       "22",
                "username":   "<service account>",
                "password":   "<password>",
                "directory":  "<path as the SFTP server reports it>",
                "thumbprint": "SHA256:<ssh host key fingerprint>"
              }
            }
          }
        }

    Two things about that request are worth knowing, because both cost time to
    discover:

    - The write wrapper is backupConfigSpec, while the same data reads back as
      backupConfig, and port is a string, not a number.

    - The browser sends this to https://<VCFOps>/vcf-operations/plug/fleet-lcm/...
      but that path is the user interface's SESSION-authenticated route: it works
      because the browser holds a JSESSIONID cookie. A token client gets 405 on a
      PATCH there, and HTML on a GET. The payload copied across from the browser;
      the URL did not. Both the lookup and the write therefore go straight to the
      fleet appliance, where the Bearer token is accepted.

    Authentication is still minted through VCF Operations (below) -- it is the
    only issuer the Fleet lifecycle service trusts.

    The service answers 202 Accepted and does the work asynchronously. Verify
    with Get-VCFBackupConfig.ps1 afterwards -- it shows what was actually
    stored, which is the only thing that matters.

    THIS SCRIPT WRITES TO THE PLATFORM. It supports -WhatIf, which prints the
    exact payload (with the secrets masked) without sending it, and it asks for
    confirmation before it writes.

.NOTES
    Script  : Set-VCFBackupConfig.ps1
    Version : 1.0.3
    Author  : Paul van Dieen
    Blog    : https://www.hollebollevsan.nl
    Requires: PowerShell 5.1+ (Windows PowerShell) or PowerShell 7+
    Tested  : VCF 9.1

.CHANGELOG
    v1.0.3  2026-07-13  PD  The write now goes to the fleet appliance, not the VCF Operations proxy
                            (#150). PATCH on /vcf-operations/plug/fleet-lcm/... returned 405: that path
                            is the UI's session-authenticated route and only works with the JSESSIONID
                            cookie of a logged-in Ops session -- the same reason a GET there returns the
                            Ops web application's HTML (#148). Copying the browser's request wholesale
                            was the error; only the PAYLOAD was portable, not the URL. The Bearer token
                            already works against https://<FleetLCM>/fleet-lcm/v1/, so both the lookup
                            and the write go there. Verified live: 202 Accepted, and the platform starts
                            a ConfigureBackupLocation workflow.
                            -FleetLCM is therefore needed for the write itself, so it is prompted for
                            when missing (#149), with where to find it: VCF Operations > Build >
                            Lifecycle > VCF Management > Components, the "Fleet lifecycle" row. The
                            script already prompted for everything else it needs, so failing here was
                            the odd one out. -SddcLcmId is deliberately not prompted for -- looking up a
                            GUID by hand is a chore; it stays the bypass for anyone who already has it.
    v1.0.2  2026-07-13  PD  Instance discovery threw "The property 'id' cannot be found on this
                            object" (#148). Root cause: the VCF Operations proxy does NOT serve the
                            instance list -- a GET on /vcf-operations/plug/fleet-lcm/v1/sddc-lcms falls
                            through to the VCF Operations web application and returns its HTML, which
                            the script then treated as an instance object. Discovery now runs against
                            the fleet appliance (new -FleetLCM parameter), which is where the list
                            actually lives, while the write still goes through the proxy -- each
                            endpoint used only where it is known to work. Also uses StrictMode-safe
                            property reads and, when no instance is found, says what came back instead
                            of throwing.
    v1.0.1  2026-07-13  PD  -ShowThumbprint: stop swallowing the real error and stop blaming
                            reachability (#147). The in-box Windows OpenSSH client advertises the
                            sntrup761x25519-sha512 key exchange and then cannot perform it, so
                            ssh-keyscan dies during key exchange against a modern server and prints
                            nothing -- a client bug that says nothing about the target. The helper now
                            checks the PATH explicitly, prints what ssh-keyscan actually said, names
                            the Windows bug when it sees it, and always offers the server-side read
                            (ssh-keygen -lf /etc/ssh/ssh_host_*.pub), which needs no SSH client.
    v1.0.0  2026-07-13  PD  Initial release -- PATCH backup location via Fleet LCM (#145)

.PARAMETER VCFOps
    Fully qualified domain name of the VCF Operations appliance. Both the token
    and the API call go through it.

.PARAMETER SddcLcmId
    Identifier of the VCF instance to configure. If omitted, the script looks the
    instance up on the fleet appliance (-FleetLCM) and uses the only one; with
    more than one it stops and asks you to name it. The identifier is also shown
    by Get-VCFBackupConfig.ps1, and appears in the failing task detail in the user
    interface ("SDDC lifecycle with ID ...").

.PARAMETER FleetLCM
    Fully qualified domain name of the Fleet lifecycle appliance (fleet-*). Used
    only to look up the VCF instance when -SddcLcmId is not supplied. If neither is
    given, you are prompted for it. Find it in VCF Operations under

        Build > Lifecycle > VCF Management > Components

    in the "Fleet lifecycle" row, FQDN column (e.g. fleet-01a.site-a.vcf.two).

    Discovery and the write deliberately use different endpoints, each where it is
    known to work: the instance list comes from the fleet appliance, while the
    write goes through the VCF Operations proxy (the path the product's own user
    interface calls). The proxy does not serve the list -- a GET against it falls
    through to the VCF Operations web application and returns HTML.

.PARAMETER SftpHost
    FQDN or IP address of the SFTP backup server.

.PARAMETER SftpPort
    TCP port of the SFTP server. Defaults to 22. Sent as a string, which is what
    the service expects.

.PARAMETER SftpUsername
    The service account on the SFTP server (e.g. vcfbackup).

.PARAMETER SftpPassword
    Password for the service account, as a SecureString.

.PARAMETER SftpDirectory
    Backup directory as the SFTP server reports it. With a chrooted account this
    is the path relative to the chroot (e.g. /backups), not the full path on the
    server's filesystem.

.PARAMETER Thumbprint
    SSH host key fingerprint of the SFTP server, in the form SHA256:<base64>.
    Obtain it with -ShowThumbprint, or -- more reliably -- read it on the SFTP
    server itself, which needs no SSH client:

        ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub

    and take the SHA256:... field. VCF's own Fetch Fingerprint button in the Add
    Backup Location dialog is equally authoritative. If the platform rejects the
    fingerprint, the server offered a different host key type than the one you
    read -- try the others (ecdsa, rsa).

.PARAMETER EncryptionPassphrase
    Passphrase that encrypts the backups, as a SecureString. Store it in a
    password manager with a named owner BEFORE you set it: it cannot be
    recovered from the platform, and without it the backups cannot be restored.

.PARAMETER ShowThumbprint
    Scans the SFTP server's SSH host keys, prints the fingerprint of each type,
    and exits. Nothing is written. Requires ssh-keyscan and ssh-keygen on the
    PATH (bundled with Windows OpenSSH).

.PARAMETER Credential
    Credentials for VCF Operations. If omitted, you are prompted.

.PARAMETER SkipCertificateValidation
    Skip TLS certificate validation. Use when the appliances still present their
    self-signed certificates.

.EXAMPLE
    .\Set-VCFBackupConfig.ps1 -VCFOps ops01.sfo.example.io -SftpHost sftp01.sfo.example.io -ShowThumbprint

    Prints the SSH host key fingerprints of the backup server and exits.

.EXAMPLE
    .\Set-VCFBackupConfig.ps1 -VCFOps ops01.sfo.example.io `
        -SftpHost sftp01.sfo.example.io -SftpUsername vcfbackup `
        -SftpDirectory /backups -Thumbprint 'SHA256:2NYfVq6oG4QM2JU7zXOjf3fBr7B7xwZ6sZGQCuSsFEQ' `
        -SkipCertificateValidation -WhatIf

    Prints the exact payload that would be sent, with the secrets masked, and
    sends nothing.
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)] [string]$VCFOps,
    [Parameter(Mandatory)] [string]$SftpHost,
    [string]$SddcLcmId,
    [string]$FleetLCM,
    [string]$SftpPort = '22',
    [string]$SftpUsername,
    [System.Security.SecureString]$SftpPassword,
    [string]$SftpDirectory,
    [string]$Thumbprint,
    [System.Security.SecureString]$EncryptionPassphrase,
    [switch]$ShowThumbprint,
    [System.Management.Automation.PSCredential]$Credential,
    [switch]$SkipCertificateValidation
)

$scriptVersion = '1.0.3'
$scriptAuthor  = 'Paul van Dieen'
$scriptBlogUrl = 'https://www.hollebollevsan.nl'

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host ('=' * 62) -ForegroundColor DarkCyan
Write-Host "  Set-VCFBackupConfig v$scriptVersion" -ForegroundColor Cyan
Write-Host "  $scriptAuthor - $scriptBlogUrl" -ForegroundColor DarkCyan
Write-Host "  VCF Operations : $VCFOps" -ForegroundColor Cyan
Write-Host "  Backup target  : $SftpHost" -ForegroundColor Cyan
Write-Host ('=' * 62) -ForegroundColor DarkCyan

# --- Thumbprint helper --------------------------------------------------------
# The platform pins the SFTP server's SSH host key. Scanning it here means the
# operator can see every key type the server offers and pick the right one,
# instead of guessing.
function Show-ServerSideFallback {
    param([string]$TargetHost)
    Write-Host "`n  Read the fingerprint on $TargetHost itself instead -- this needs no" -ForegroundColor DarkGray
    Write-Host "  SSH client and is authoritative:" -ForegroundColor DarkGray
    Write-Host "    ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub" -ForegroundColor White
    Write-Host "    ssh-keygen -lf /etc/ssh/ssh_host_ecdsa_key.pub" -ForegroundColor White
    Write-Host "    ssh-keygen -lf /etc/ssh/ssh_host_rsa_key.pub" -ForegroundColor White
    Write-Host "  Take the SHA256:... field. VCF's own Fetch Fingerprint button in the" -ForegroundColor DarkGray
    Write-Host "  Add Backup Location dialog is equally authoritative." -ForegroundColor DarkGray
}

if ($ShowThumbprint) {
    Write-Host "`nScanning SSH host keys on $SftpHost ..." -ForegroundColor Cyan

    $keyscan = Get-Command ssh-keyscan -ErrorAction SilentlyContinue
    $keygen  = Get-Command ssh-keygen  -ErrorAction SilentlyContinue
    if (-not $keyscan -or -not $keygen) {
        Write-Host "`n  ssh-keyscan / ssh-keygen are not on the PATH." -ForegroundColor Yellow
        Write-Host "  On Windows they ship with the OpenSSH client feature." -ForegroundColor DarkGray
        Show-ServerSideFallback -TargetHost $SftpHost
        exit 1
    }

    # Keep stderr: it carries the reason when the scan produces nothing.
    $raw    = & ssh-keyscan -t ed25519,ecdsa,rsa -p $SftpPort $SftpHost 2>&1
    $keys   = @($raw | Where-Object { $_ -notmatch '^\s*#' -and $_ -notmatch 'choose_kex|^\s*$' -and $_ -match '\s(ssh|ecdsa)-' })
    $stderr = @($raw | Where-Object { $_ -match 'choose_kex|refused|timed out|No route|Connection closed' })

    if ($keys.Count -gt 0) {
        $keys | & ssh-keygen -lf - | ForEach-Object { Write-Host "  $_" -ForegroundColor White }
        Write-Host "`nUse the SHA256:... field of the key type the server negotiates." -ForegroundColor DarkGray
        Write-Host "If the platform rejects one, try another type." -ForegroundColor DarkGray
        exit 0
    }

    Write-Host "`n  The scan returned no host keys. What ssh-keyscan actually said:" -ForegroundColor Yellow
    foreach ($line in @($raw | Select-Object -First 6)) { Write-Host "    $line" -ForegroundColor DarkGray }

    # The in-box Windows client (OpenSSH_for_Windows 9.x) advertises the
    # post-quantum sntrup761x25519 key exchange and then cannot perform it, so
    # the scan dies during key exchange against a modern server and prints
    # nothing. That is a client bug -- it says nothing about the target.
    if ($stderr -match 'choose_kex') {
        Write-Host "`n  This is a known bug in the Windows OpenSSH client, NOT a problem with" -ForegroundColor Yellow
        Write-Host "  $SftpHost. It offers the sntrup761x25519-sha512 key exchange, the server" -ForegroundColor Yellow
        Write-Host "  selects it, and the Windows binary cannot complete it. Your target is" -ForegroundColor Yellow
        Write-Host "  almost certainly fine." -ForegroundColor Yellow
    }

    Show-ServerSideFallback -TargetHost $SftpHost
    exit 1
}

# --- Prompt for anything not supplied ----------------------------------------
if (-not $SftpUsername)  { $SftpUsername  = Read-Host "SFTP service account (e.g. vcfbackup)" }
if (-not $SftpDirectory) { $SftpDirectory = Read-Host "Backup directory as the SFTP server reports it (e.g. /backups)" }
if (-not $Thumbprint)    { $Thumbprint    = Read-Host "SSH host key fingerprint (SHA256:...). Re-run with -ShowThumbprint to find it" }
if (-not $SftpPassword)  { $SftpPassword  = Read-Host "Password for $SftpUsername" -AsSecureString }
if (-not $EncryptionPassphrase) {
    Write-Host "`nThe encryption passphrase cannot be recovered from the platform." -ForegroundColor Yellow
    Write-Host "Without it the backups cannot be restored. Store it in a password" -ForegroundColor Yellow
    Write-Host "manager with a named owner before you continue." -ForegroundColor Yellow
    $EncryptionPassphrase = Read-Host "Backup encryption passphrase" -AsSecureString
}

function ConvertFrom-SecureStringPlain {
    param([System.Security.SecureString]$Secure)
    $ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try   { return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

# --- TLS handling -------------------------------------------------------------
$restArgs = @{}
if ($SkipCertificateValidation) {
    if ($PSVersionTable.PSVersion.Major -ge 6) {
        $restArgs['SkipCertificateCheck'] = $true
    }
    else {
        if (-not ('VCFTrustAllCertsPolicy' -as [type])) {
            Add-Type -TypeDefinition @'
using System.Net;
using System.Security.Cryptography.X509Certificates;
public class VCFTrustAllCertsPolicy : ICertificatePolicy {
    public bool CheckValidationResult(ServicePoint sp, X509Certificate cert, WebRequest req, int problem) {
        return true;
    }
}
'@
        }
        [System.Net.ServicePointManager]::CertificatePolicy = New-Object VCFTrustAllCertsPolicy
        [System.Net.ServicePointManager]::SecurityProtocol  = [System.Net.SecurityProtocolType]::Tls12
    }
}

if (-not $Credential) {
    $Credential = Get-Credential -Message "VCF Operations credentials for $VCFOps"
}

# --- Authentication chain -----------------------------------------------------
try {
    $acquireBody = @{
        username = $Credential.UserName
        password = $Credential.GetNetworkCredential().Password
    } | ConvertTo-Json

    $opsToken = (Invoke-RestMethod -Uri "https://$VCFOps/suite-api/api/auth/token/acquire" `
        -Method POST -Body $acquireBody `
        -Headers @{ 'Content-Type' = 'application/json'; Accept = 'application/json' } `
        @restArgs).token

    $jwt = (Invoke-RestMethod -Uri "https://$VCFOps/suite-api/api/auth/token/exchange" `
        -Method POST -Body (@{ serviceKeys = @('fleet-lcm') } | ConvertTo-Json) `
        -Headers @{ 'Content-Type' = 'application/json'; Accept = 'application/json'; Authorization = "OpsToken $opsToken" } `
        @restArgs).jwtToken

    Write-Host "`nAuthenticated. Fleet lifecycle token acquired." -ForegroundColor Green
}
catch {
    Write-Host "`nAuthentication failed against $VCFOps" -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor DarkYellow
    exit 1
}

$headers = @{ Authorization = "Bearer $jwt"; Accept = 'application/json' }

# --- Resolve the instance -----------------------------------------------------
# StrictMode-safe property read: a missing property is $null, not an exception.
function Get-Prop {
    param($Object, [string]$Name)
    if ($null -ne $Object -and $Object.PSObject.Properties[$Name]) { return $Object.$Name }
    return $null
}

# Everything -- the lookup and the write -- talks to the fleet appliance.
#
# The browser calls the write through the VCF Operations proxy
# (/vcf-operations/plug/fleet-lcm/...), but that path is the UI's
# session-authenticated route: it depends on the JSESSIONID cookie of a logged-in
# Ops session. A token client gets no routing to the fleet-lcm backend there -- a
# GET falls through to the VCF Operations web application (HTML) and a PATCH is
# refused with 405. The payload shape was worth copying from the browser; the
# transport was not.
if (-not $FleetLCM) {
    Write-Host "`nThe backup configuration lives on the Fleet lifecycle appliance." -ForegroundColor Cyan
    Write-Host "Find its FQDN in VCF Operations:" -ForegroundColor DarkGray
    Write-Host "  Build > Lifecycle > VCF Management > Components" -ForegroundColor White
    Write-Host "  -> the 'Fleet lifecycle' row, FQDN column (e.g. fleet-01a.site-a.vcf.two)" -ForegroundColor White
    $FleetLCM = (Read-Host "`nFleet lifecycle FQDN").Trim()
    if (-not $FleetLCM) {
        Write-Host "`nNo FQDN given. Re-run with -FleetLCM <fqdn>." -ForegroundColor Yellow
        exit 1
    }
}

$baseUri = "https://$FleetLCM/fleet-lcm/v1"

# --- Resolve the instance -----------------------------------------------------
if (-not $SddcLcmId) {
    try {
        $lcms = Invoke-RestMethod -Uri "$baseUri/sddc-lcms" -Headers $headers @restArgs
    }
    catch {
        Write-Host "`nCould not list the VCF instances from $FleetLCM : $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "  Re-run with -SddcLcmId <guid> to skip the lookup." -ForegroundColor DarkGray
        exit 1
    }

    $candidates = @()
    if ($lcms -is [array]) {
        $candidates = @($lcms)
    }
    else {
        foreach ($key in 'sddcLcms', 'elements', 'content', 'data', 'items', 'results') {
            $value = Get-Prop $lcms $key
            if ($value) { $candidates = @($value); break }
        }
        if (-not $candidates) { $candidates = @($lcms) }
    }

    $instances = @($candidates | Where-Object { Get-Prop $_ 'id' })

    if ($instances.Count -eq 0) {
        Write-Host "`nNo VCF instance found in the response from" -ForegroundColor Red
        Write-Host "  GET $baseUri/sddc-lcms" -ForegroundColor DarkGray
        Write-Host "`n  Re-run with -SddcLcmId <guid> to skip the lookup entirely." -ForegroundColor Yellow
        exit 1
    }

    if ($instances.Count -gt 1) {
        Write-Host "`nMore than one VCF instance. Re-run with -SddcLcmId:" -ForegroundColor Yellow
        foreach ($i in $instances) {
            $iName = Get-Prop $i 'name'
            if (-not $iName) { $iName = Get-Prop $i 'fqdn' }
            Write-Host "  $(Get-Prop $i 'id')  $iName"
        }
        exit 1
    }

    $SddcLcmId = Get-Prop $instances[0] 'id'
    $name = Get-Prop $instances[0] 'name'
    if (-not $name) { $name = Get-Prop $instances[0] 'fqdn' }
    if ($name) { Write-Host "VCF instance   : $name" -ForegroundColor Cyan }
}
Write-Host "Instance ID    : $SddcLcmId" -ForegroundColor DarkGray

# --- Build the payload --------------------------------------------------------
# Field names, nesting and types are taken from the request the Add Backup
# Location dialog makes. Note: the write wrapper is backupConfigSpec (it reads
# back as backupConfig), and port is a string.
$spec = [ordered]@{
    backupConfigSpec = [ordered]@{
        encryptionPassphrase = (ConvertFrom-SecureStringPlain $EncryptionPassphrase)
        storage = [ordered]@{
            sftp = [ordered]@{
                host       = $SftpHost
                port       = [string]$SftpPort
                username   = $SftpUsername
                password   = (ConvertFrom-SecureStringPlain $SftpPassword)
                directory  = $SftpDirectory
                thumbprint = $Thumbprint
            }
        }
    }
}

# The same shape with the secrets masked, for anything that gets displayed.
$masked = [ordered]@{
    backupConfigSpec = [ordered]@{
        encryptionPassphrase = '********'
        storage = [ordered]@{
            sftp = [ordered]@{
                host       = $SftpHost
                port       = [string]$SftpPort
                username   = $SftpUsername
                password   = '********'
                directory  = $SftpDirectory
                thumbprint = $Thumbprint
            }
        }
    }
}

Write-Host "`nPayload to be sent:" -ForegroundColor White
Write-Host ($masked | ConvertTo-Json -Depth 6) -ForegroundColor DarkGray
Write-Host "`nPATCH $baseUri/sddc-lcms/$SddcLcmId" -ForegroundColor White

# --- Write --------------------------------------------------------------------
$target = "VCF instance $SddcLcmId on $VCFOps"
$action = "Set the VCF Management backup location to $SftpUsername@$SftpHost`:$SftpDirectory"

if (-not $PSCmdlet.ShouldProcess($target, $action)) {
    Write-Host "`nNothing was sent." -ForegroundColor Yellow
    exit 0
}

try {
    $body = $spec | ConvertTo-Json -Depth 6
    $response = Invoke-RestMethod -Uri "$baseUri/sddc-lcms/$SddcLcmId" -Method PATCH -Body $body `
        -Headers @{ Authorization = "Bearer $jwt"; Accept = 'application/json'; 'Content-Type' = 'application/json' } `
        @restArgs

    Write-Host "`nAccepted. The platform applies the change asynchronously." -ForegroundColor Green
    if ($response) {
        Write-Host ($response | ConvertTo-Json -Depth 6) -ForegroundColor DarkGray
    }
    Write-Host "`nFollow the task in VCF Operations under Build > Lifecycle > VCF" -ForegroundColor DarkGray
    Write-Host "Management > Tasks, then confirm what was actually stored with:" -ForegroundColor DarkGray
    Write-Host "  .\Get-VCFBackupConfig.ps1 -VCFOps $VCFOps -FleetLCM <fleet appliance>" -ForegroundColor DarkGray
}
catch {
    Write-Host "`nThe backup location was rejected." -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor DarkYellow
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
        Write-Host "`n  Response body:" -ForegroundColor DarkYellow
        Write-Host "  $($_.ErrorDetails.Message)" -ForegroundColor DarkGray
    }
    Write-Host "`n  Things worth checking:" -ForegroundColor DarkGray
    Write-Host "  - the fingerprint matches the host key type the server negotiates" -ForegroundColor DarkGray
    Write-Host "    (-ShowThumbprint lists every type the server offers)" -ForegroundColor DarkGray
    Write-Host "  - the directory is the path as the SFTP server reports it, which" -ForegroundColor DarkGray
    Write-Host "    with a chrooted account is not the path on its filesystem" -ForegroundColor DarkGray
    Write-Host "  - TCP 22 is open from the whole management-services runtime block," -ForegroundColor DarkGray
    Write-Host "    not just from named hosts" -ForegroundColor DarkGray
    exit 1
}

Write-Host "`n$('=' * 62)" -ForegroundColor DarkCyan
Write-Host "  Done." -ForegroundColor DarkCyan
Write-Host ('=' * 62) -ForegroundColor DarkCyan
