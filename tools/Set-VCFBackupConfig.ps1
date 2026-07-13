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

    This script performs the same call the Add Backup Location dialog makes,
    so the backup target can be configured when the interface fails or gives
    no usable error:

        PATCH https://<VCFOps>/vcf-operations/plug/fleet-lcm/v1/sddc-lcms/{sddcLcmId}

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

    Note the call goes through VCF Operations, which reverse-proxies the Fleet
    lifecycle service (/vcf-operations/plug/fleet-lcm/...). That is the path the
    product itself uses. Note also that the write wrapper is backupConfigSpec,
    while the same data reads back as backupConfig, and that port is a string.

    The service answers 202 Accepted and does the work asynchronously. Verify
    with Get-VCFBackupConfig.ps1 afterwards -- it shows what was actually
    stored, which is the only thing that matters.

    THIS SCRIPT WRITES TO THE PLATFORM. It supports -WhatIf, which prints the
    exact payload (with the secrets masked) without sending it, and it asks for
    confirmation before it writes.

.NOTES
    Script  : Set-VCFBackupConfig.ps1
    Version : 1.0.0
    Author  : Paul van Dieen
    Blog    : https://www.hollebollevsan.nl
    Requires: PowerShell 5.1+ (Windows PowerShell) or PowerShell 7+
    Tested  : VCF 9.1

.CHANGELOG
    v1.0.0  2026-07-13  PD  Initial release -- PATCH backup location via Fleet LCM (#145)

.PARAMETER VCFOps
    Fully qualified domain name of the VCF Operations appliance. Both the token
    and the API call go through it.

.PARAMETER SddcLcmId
    Identifier of the VCF instance to configure. If omitted, the script lists the
    instances and uses the only one; with more than one it stops and asks you to
    name it. The identifier also appears in the failing task detail in the user
    interface ("SDDC lifecycle with ID ...").

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
    Obtain it with -ShowThumbprint, or by hand:

        ssh-keyscan -t ed25519 sftp01.sfo.example.io | ssh-keygen -lf -

    and take the SHA256:... field. If the platform rejects the fingerprint, the
    server offered a different host key type than the one you scanned -- try the
    other types (ecdsa, rsa).

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

$scriptVersion = '1.0.0'
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
if ($ShowThumbprint) {
    Write-Host "`nScanning SSH host keys on $SftpHost ..." -ForegroundColor Cyan
    try {
        $scan = & ssh-keyscan -t ed25519,ecdsa,rsa -p $SftpPort $SftpHost 2>$null
        if (-not $scan) { throw "ssh-keyscan returned nothing. Is $SftpHost reachable on port $SftpPort ?" }
        $scan | & ssh-keygen -lf - | ForEach-Object { Write-Host "  $_" -ForegroundColor White }
        Write-Host "`nUse the SHA256:... field of the key type the server negotiates." -ForegroundColor DarkGray
        Write-Host "If the platform rejects one, try another type." -ForegroundColor DarkGray
    }
    catch {
        Write-Host "  Could not scan the host keys: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host "  ssh-keyscan and ssh-keygen must be on the PATH (Windows OpenSSH)." -ForegroundColor DarkGray
    }
    exit 0
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
$baseUri = "https://$VCFOps/vcf-operations/plug/fleet-lcm/v1"

# --- Resolve the instance -----------------------------------------------------
if (-not $SddcLcmId) {
    try {
        $lcms = Invoke-RestMethod -Uri "$baseUri/sddc-lcms" -Headers $headers @restArgs
    }
    catch {
        Write-Host "`nCould not list the VCF instances: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }

    $instances = @()
    if     ($lcms.PSObject.Properties['sddcLcms'] -and $lcms.sddcLcms) { $instances = @($lcms.sddcLcms) }
    elseif ($lcms.PSObject.Properties['elements'] -and $lcms.elements) { $instances = @($lcms.elements) }
    elseif ($lcms -is [array])                                          { $instances = @($lcms) }
    else                                                                { $instances = @($lcms) }

    if ($instances.Count -eq 0) {
        Write-Host "`nNo VCF instances returned." -ForegroundColor Red
        exit 1
    }
    if ($instances.Count -gt 1) {
        Write-Host "`nMore than one VCF instance. Re-run with -SddcLcmId:" -ForegroundColor Yellow
        foreach ($i in $instances) { Write-Host "  $($i.id)  $($i.name)" }
        exit 1
    }

    $SddcLcmId = $instances[0].id
    Write-Host "VCF instance   : $($instances[0].name)" -ForegroundColor Cyan
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
