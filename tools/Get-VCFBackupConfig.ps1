#Requires -Version 5.1
<#
.SYNOPSIS
    Read-only check of the VCF 9.1 "VCF Management" backup configuration via the
    Fleet LCM REST API. Shows what the platform has actually stored -- which is
    not always what was typed into the wizard.

.DESCRIPTION
    In VCF 9.1 the centralized backup (VCF Operations > Build > Lifecycle >
    VCF Management > Backup & Restore) protects the management services: log
    management, identity broker, Salt master, VCF Automation and the software
    depot. It is served by the Fleet lifecycle service, not by SDDC Manager.

    When that configuration misbehaves, the user interface gives you very little:
    a failed sub-task that says "check the errors in the next sub-task(s)", and
    no next sub-task. This script reads the stored configuration straight from
    the API so you can compare it against what you entered:

        GET /fleet-lcm/v1/sddc-lcms
              -> backupConfig.storage.sftp { host, port, username, directory }
                 backupConfig.fullSchedule { enabled, schedule { startTime, days[] } }
                 backupConfig.retention    { maxBackups | days }

        GET /fleet-lcm/v1/sddc-lcms/{sddcLcmId}/backups
              -> backup history (what has actually completed)

    Authentication is a three-call chain through VCF Operations, which is the
    only token issuer the Fleet lifecycle service trusts:

        1. POST https://<VCFOps>/suite-api/api/auth/token/acquire   -> OpsToken
        2. POST https://<VCFOps>/suite-api/api/auth/token/exchange
                with serviceKeys=["fleet-lcm"]                      -> JWT
        3. Bearer <JWT> against https://<FleetLCM>/fleet-lcm/v1/*

    This script only reads. It never writes, and it changes nothing.

.NOTES
    Script  : Get-VCFBackupConfig.ps1
    Version : 1.0.0
    Author  : Paul van Dieen
    Blog    : https://www.hollebollevsan.nl
    Requires: PowerShell 5.1+ (Windows PowerShell) or PowerShell 7+
    Tested  : VCF 9.1

.CHANGELOG
    v1.0.0  2026-07-13  PD  Initial release -- read-only Fleet LCM backup configuration check (#145)

.PARAMETER VCFOps
    Fully qualified domain name of the VCF Operations appliance. This is where
    the token for the Fleet lifecycle service is minted.

.PARAMETER FleetLCM
    Fully qualified domain name of the Fleet lifecycle appliance (fleet-*).

.PARAMETER Credential
    Credentials for VCF Operations. If omitted, you are prompted. Nothing is
    written to disk.

.PARAMETER SkipCertificateValidation
    Skip TLS certificate validation. Use when the appliances still present their
    self-signed certificates.

.PARAMETER Raw
    Also print the full JSON returned by the API, at full depth.

.EXAMPLE
    .\Get-VCFBackupConfig.ps1 -VCFOps ops01.sfo.example.io -FleetLCM fleet01.sfo.example.io -SkipCertificateValidation

    Prompts for the VCF Operations credentials, then prints the stored backup
    target, schedule, retention and history for every VCF instance.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$VCFOps,
    [Parameter(Mandatory)] [string]$FleetLCM,
    [System.Management.Automation.PSCredential]$Credential,
    [switch]$SkipCertificateValidation,
    [switch]$Raw
)

$scriptVersion = '1.0.0'
$scriptAuthor  = 'Paul van Dieen'
$scriptBlogUrl = 'https://www.hollebollevsan.nl'

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host ('=' * 62) -ForegroundColor DarkCyan
Write-Host "  Get-VCFBackupConfig v$scriptVersion" -ForegroundColor Cyan
Write-Host "  $scriptAuthor - $scriptBlogUrl" -ForegroundColor DarkCyan
Write-Host "  VCF Operations : $VCFOps" -ForegroundColor Cyan
Write-Host "  Fleet lifecycle: $FleetLCM" -ForegroundColor Cyan
Write-Host ('=' * 62) -ForegroundColor DarkCyan

# --- TLS handling -------------------------------------------------------------
# PowerShell 7 has -SkipCertificateCheck; Windows PowerShell 5.1 does not, and
# needs a certificate policy instead.
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

    $exchangeBody = @{ serviceKeys = @('fleet-lcm') } | ConvertTo-Json

    $jwt = (Invoke-RestMethod -Uri "https://$VCFOps/suite-api/api/auth/token/exchange" `
        -Method POST -Body $exchangeBody `
        -Headers @{ 'Content-Type' = 'application/json'; Accept = 'application/json'; Authorization = "OpsToken $opsToken" } `
        @restArgs).jwtToken

    Write-Host "`nAuthenticated. Fleet lifecycle token acquired." -ForegroundColor Green
}
catch {
    Write-Host "`nAuthentication failed against $VCFOps" -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor DarkYellow
    Write-Host "`n  Check: the VCF Operations FQDN, the credentials, and whether" -ForegroundColor DarkGray
    Write-Host "  VCF Operations is registered (an unregistered appliance shows a" -ForegroundColor DarkGray
    Write-Host "  banner on its home page and may refuse to issue service tokens)." -ForegroundColor DarkGray
    exit 1
}

$headers = @{ Authorization = "Bearer $jwt"; Accept = 'application/json' }

# --- 1. Instances + inline backup configuration -------------------------------
try {
    $lcms = Invoke-RestMethod -Uri "https://$FleetLCM/fleet-lcm/v1/sddc-lcms" -Headers $headers @restArgs
}
catch {
    Write-Host "`nCould not read /fleet-lcm/v1/sddc-lcms from $FleetLCM" -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor DarkYellow
    exit 1
}

# The response has been seen both as a bare array and wrapped in a collection
# property, so normalise before walking it.
$instances = @()
if ($lcms) {
    if     ($lcms.PSObject.Properties['sddcLcms'] -and $lcms.sddcLcms) { $instances = @($lcms.sddcLcms) }
    elseif ($lcms.PSObject.Properties['elements'] -and $lcms.elements) { $instances = @($lcms.elements) }
    elseif ($lcms -is [array])                                          { $instances = @($lcms) }
    else                                                                { $instances = @($lcms) }
}

if (-not $instances) {
    Write-Host "`nNo VCF instances returned by the Fleet lifecycle service." -ForegroundColor Yellow
    exit 0
}

if ($Raw) {
    Write-Host "`n--- Raw /sddc-lcms response ---" -ForegroundColor Magenta
    Write-Host ($lcms | ConvertTo-Json -Depth 12) -ForegroundColor DarkGray
}

function Get-Prop {
    param($Object, [string]$Name)
    if ($null -ne $Object -and $Object.PSObject.Properties[$Name]) { return $Object.$Name }
    return $null
}

$guidPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

foreach ($instance in $instances) {

    $instanceId   = Get-Prop $instance 'id'
    $instanceName = Get-Prop $instance 'name'
    if (-not $instanceName) { $instanceName = Get-Prop $instance 'fqdn' }
    if (-not $instanceName) { $instanceName = '(unnamed)' }

    Write-Host "`n$('-' * 62)" -ForegroundColor DarkCyan
    Write-Host "VCF instance : $instanceName" -ForegroundColor Cyan
    Write-Host "Instance ID  : $instanceId" -ForegroundColor DarkGray

    $backupConfig = Get-Prop $instance 'backupConfig'
    if (-not $backupConfig) {
        Write-Host "`n  No backup configuration stored for this instance." -ForegroundColor Yellow
        Write-Host "  The management services are NOT being backed up." -ForegroundColor Yellow
        continue
    }

    # --- Target -------------------------------------------------------------
    $storage = Get-Prop $backupConfig 'storage'
    $sftp    = Get-Prop $storage 'sftp'

    Write-Host "`n  Backup target (stored by the platform)" -ForegroundColor White
    if (-not $sftp) {
        Write-Host "    No SFTP target stored." -ForegroundColor Yellow
    }
    else {
        $sftpHost = Get-Prop $sftp 'host'
        $sftpPort = Get-Prop $sftp 'port'
        $sftpUser = Get-Prop $sftp 'username'
        $sftpDir  = Get-Prop $sftp 'directory'

        Write-Host "    Host      : $sftpHost"
        Write-Host "    Port      : $sftpPort"
        Write-Host "    Directory : $sftpDir"

        # The stored username is the field worth staring at. Two failure modes
        # have been seen in the field, and both are invisible in the interface:
        # an empty username, and a credential identifier stored in its place.
        # Either way the platform authenticates to the SFTP server as something
        # that is not the service account, and the server rejects it as an
        # unknown user.
        if ([string]::IsNullOrWhiteSpace([string]$sftpUser)) {
            Write-Host "    Username  : (empty)" -ForegroundColor Red
            Write-Host "`n    No username is stored. The backup will fail to authenticate" -ForegroundColor Red
            Write-Host "    regardless of what was typed into the wizard." -ForegroundColor Red
        }
        elseif ([string]$sftpUser -match $guidPattern) {
            Write-Host "    Username  : $sftpUser" -ForegroundColor Red
            Write-Host "`n    The stored username is an identifier, not an account name." -ForegroundColor Red
            Write-Host "    The platform will present this to the SFTP server as the login" -ForegroundColor Red
            Write-Host "    name, and the server will reject it as an unknown user." -ForegroundColor Red
        }
        else {
            Write-Host "    Username  : $sftpUser" -ForegroundColor Green
        }
    }

    # --- Schedule -----------------------------------------------------------
    $fullSchedule = Get-Prop $backupConfig 'fullSchedule'
    Write-Host "`n  Schedule" -ForegroundColor White
    if (-not $fullSchedule) {
        Write-Host "    No schedule stored. Backups will not run on their own." -ForegroundColor Yellow
    }
    else {
        $enabled  = Get-Prop $fullSchedule 'enabled'
        $schedule = Get-Prop $fullSchedule 'schedule'
        $start    = Get-Prop $schedule 'startTime'
        $days     = Get-Prop $schedule 'days'

        $enabledColour = if ($enabled) { 'Green' } else { 'Yellow' }
        Write-Host "    Enabled   : $enabled" -ForegroundColor $enabledColour
        if ($start) { Write-Host "    Start time: $start" }
        if ($days)  { Write-Host "    Days      : $($days -join ', ')" }
        if (-not $enabled) {
            Write-Host "    The schedule exists but is disabled - nothing will run." -ForegroundColor Yellow
        }
    }

    # --- Retention ----------------------------------------------------------
    $retention = Get-Prop $backupConfig 'retention'
    Write-Host "`n  Retention" -ForegroundColor White
    if (-not $retention) {
        Write-Host "    No retention policy stored."
    }
    else {
        $maxBackups = Get-Prop $retention 'maxBackups'
        $days       = Get-Prop $retention 'days'
        if ($maxBackups) { Write-Host "    Keep      : $maxBackups backups" }
        if ($days)       { Write-Host "    Keep      : $days days" }
    }

    # --- History ------------------------------------------------------------
    # This endpoint fails until a schedule is configured AND the lifecycle
    # metadata sync has run. "Last sync time: N/A" on the Backup & Restore tab
    # means the sync has not happened yet.
    Write-Host "`n  Backup history" -ForegroundColor White
    try {
        $history = Invoke-RestMethod -Uri "https://$FleetLCM/fleet-lcm/v1/sddc-lcms/$instanceId/backups" `
            -Headers $headers @restArgs

        $backups = Get-Prop $history 'backups'
        if (-not $backups) {
            Write-Host "    No backups have completed yet." -ForegroundColor Yellow
        }
        else {
            foreach ($backup in @($backups)) {
                $name      = Get-Prop $backup 'name'
                $component = Get-Prop $backup 'componentType'
                $points    = Get-Prop $backup 'points'
                $count     = if ($points) { @($points).Count } else { 0 }
                Write-Host "    $component : $name ($count restore point(s))"
            }
        }

        if ($Raw) {
            Write-Host "`n  --- Raw /backups response ---" -ForegroundColor Magenta
            Write-Host ($history | ConvertTo-Json -Depth 12) -ForegroundColor DarkGray
        }
    }
    catch {
        Write-Host "    Could not read the backup history." -ForegroundColor Yellow
        Write-Host "    This endpoint stays unavailable until a backup schedule is" -ForegroundColor DarkGray
        Write-Host "    configured AND the lifecycle metadata sync has run. If the" -ForegroundColor DarkGray
        Write-Host "    Backup & Restore tab shows 'Last sync time: N/A', use the Sync" -ForegroundColor DarkGray
        Write-Host "    link there first, wait for the task, then re-run this script." -ForegroundColor DarkGray
    }
}

Write-Host "`n$('=' * 62)" -ForegroundColor DarkCyan
Write-Host "  Done. Nothing was changed." -ForegroundColor DarkCyan
Write-Host ('=' * 62) -ForegroundColor DarkCyan
