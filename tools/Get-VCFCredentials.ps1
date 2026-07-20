#Requires -Version 5.1
<#
.SYNOPSIS
    Read-only retrieval of the credentials SDDC Manager stores and rotates for
    its managed components (VCF 9.1). Uses the documented Credentials API -- the
    same endpoint PowerVCF's Get-VCFCredential calls -- so an operator can read
    back the passwords the platform manages for ESXi, vCenter, NSX, the backup
    account and the rest, without hunting through the interface.

.DESCRIPTION
    SDDC Manager is the system of record for the accounts it provisions and
    rotates across a workload domain. When you need the current password for a
    managed component -- to log into an ESXi host directly, to hand an auditor
    the service-account inventory, or to confirm a rotation actually took -- the
    supported path is the Credentials API, not a screenshot of the wizard:

        POST https://<SDDCManager>/v1/tokens      { username, password }
              -> accessToken

        GET  https://<SDDCManager>/v1/credentials
              -> elements[] { resource { resourceName, resourceType, resourceIp,
                                         domainName },
                              accountType, credentialType, username, password }

    Authentication is a single call: POST /v1/tokens with an account that holds
    the ADMIN role (or the credentials-read privilege). The returned bearer
    token is used for the read and then discarded -- nothing is written to disk.

    This script only reads. It never rotates, updates or deletes a credential,
    and it changes nothing on the platform.

    Password hygiene: to keep managed passwords out of the scrollback buffer and
    the console transcript, the on-screen table masks them by default. Pass
    -ShowPasswords to reveal them on screen, or -ExportCsv <path> to write the
    full inventory (passwords included) to a file you control. Treat any such
    file as customer data -- it belongs in the engagement's OneDrive folder, not
    in this repo.

.NOTES
    Script  : Get-VCFCredentials.ps1
    Version : 1.0.0
    Author  : Paul van Dieen
    Blog    : https://www.hollebollevsan.nl
    Requires: PowerShell 5.1+ (Windows PowerShell) or PowerShell 7+
    Tested  : VCF 9.1

.CHANGELOG
    v1.0.0  2026-07-20  PD  Initial release -- read-only SDDC Manager credentials retrieval (#188)

.PARAMETER SDDCManager
    Fully qualified domain name of the SDDC Manager appliance.

.PARAMETER Credential
    Credentials for SDDC Manager (an account with the ADMIN role, or the
    credentials-read privilege). If omitted, you are prompted. Nothing is
    written to disk.

.PARAMETER ResourceType
    Return only credentials for this resource type (server-side filter), e.g.
    ESXI, VCENTER, NSXT_MANAGER, NSXT_EDGE, BACKUP, PSC, VRSLCM. Case-insensitive.

.PARAMETER ResourceName
    Return only credentials whose resource name (usually the FQDN) contains this
    value. Client-side, case-insensitive substring match.

.PARAMETER AccountType
    Return only this account type: USER, SYSTEM or SERVICE. Client-side filter.

.PARAMETER CredentialType
    Return only this credential type, e.g. SSH, SSO, API, FTP, AUDIT.
    Client-side, case-insensitive.

.PARAMETER ShowPasswords
    Reveal passwords in the on-screen table. Off by default so managed passwords
    do not land in the console scrollback. -ExportCsv always writes the real
    values regardless of this switch.

.PARAMETER ExportCsv
    Also write the full inventory -- passwords included -- to this CSV path.
    Treat the file as customer data (OneDrive engagement folder, not the repo).

.PARAMETER SkipCertificateValidation
    Skip TLS certificate validation. Use when the appliance still presents its
    self-signed certificate.

.PARAMETER Raw
    Also print the full JSON returned by the API, at full depth.

.EXAMPLE
    .\Get-VCFCredentials.ps1 -SDDCManager sddc01.sfo.example.io -SkipCertificateValidation

    Prompts for credentials, then prints every managed credential with the
    passwords masked.

.EXAMPLE
    .\Get-VCFCredentials.ps1 -SDDCManager sddc01.sfo.example.io -ResourceType ESXI -ShowPasswords -SkipCertificateValidation

    Prints the current root/SSH credentials for every ESXi host, passwords
    visible.

.EXAMPLE
    .\Get-VCFCredentials.ps1 -SDDCManager sddc01.sfo.example.io -ExportCsv "C:\Users\paul\OneDrive - ITQ\Rainpole\VCF9-Deployment\credentials.csv" -SkipCertificateValidation

    Writes the full inventory, passwords included, to the engagement folder.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$SDDCManager,
    [System.Management.Automation.PSCredential]$Credential,
    [string]$ResourceType,
    [string]$ResourceName,
    [ValidateSet('USER', 'SYSTEM', 'SERVICE')] [string]$AccountType,
    [string]$CredentialType,
    [switch]$ShowPasswords,
    [string]$ExportCsv,
    [switch]$SkipCertificateValidation,
    [switch]$Raw
)

$scriptVersion = '1.0.0'
$scriptAuthor  = 'Paul van Dieen'
$scriptBlogUrl = 'https://www.hollebollevsan.nl'

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host ('=' * 62) -ForegroundColor DarkCyan
Write-Host "  Get-VCFCredentials v$scriptVersion" -ForegroundColor Cyan
Write-Host "  $scriptAuthor - $scriptBlogUrl" -ForegroundColor DarkCyan
Write-Host "  SDDC Manager: $SDDCManager" -ForegroundColor Cyan
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
    $Credential = Get-Credential -Message "SDDC Manager credentials for $SDDCManager (ADMIN role)"
}

# --- Authentication -----------------------------------------------------------
try {
    $tokenBody = @{
        username = $Credential.UserName
        password = $Credential.GetNetworkCredential().Password
    } | ConvertTo-Json

    $accessToken = (Invoke-RestMethod -Uri "https://$SDDCManager/v1/tokens" `
        -Method POST -Body $tokenBody `
        -Headers @{ 'Content-Type' = 'application/json'; Accept = 'application/json' } `
        @restArgs).accessToken

    if (-not $accessToken) { throw 'No accessToken in the /v1/tokens response.' }

    Write-Host "`nAuthenticated. Access token acquired." -ForegroundColor Green
}
catch {
    Write-Host "`nAuthentication failed against $SDDCManager" -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor DarkYellow
    Write-Host "`n  Check: the SDDC Manager FQDN, the credentials, and that the" -ForegroundColor DarkGray
    Write-Host "  account holds the ADMIN role (the credentials API is privileged)." -ForegroundColor DarkGray
    exit 1
}

$headers = @{ Authorization = "Bearer $accessToken"; Accept = 'application/json' }

function Get-Prop {
    param($Object, [string]$Name)
    if ($null -ne $Object -and $Object.PSObject.Properties[$Name]) { return $Object.$Name }
    return $null
}

# --- Retrieve credentials (server-side ResourceType filter, paged) ------------
$uri = "https://$SDDCManager/v1/credentials"
if ($ResourceType) { $uri += "?resourceType=$([uri]::EscapeDataString($ResourceType.ToUpper()))" }

$elements = @()
try {
    $response = Invoke-RestMethod -Uri $uri -Headers $headers @restArgs
    if ($response.PSObject.Properties['elements']) { $elements += @($response.elements) }
    else                                           { $elements += @($response) }

    # Walk any further pages the platform reports.
    $meta = Get-Prop $response 'pageMetadata'
    $totalPages = [int](Get-Prop $meta 'totalPages')
    if ($totalPages -gt 1) {
        $joiner = if ($uri.Contains('?')) { '&' } else { '?' }
        for ($page = 1; $page -lt $totalPages; $page++) {
            $pageResp = Invoke-RestMethod -Uri "$uri$joiner`pageNumber=$page" -Headers $headers @restArgs
            if ($pageResp.PSObject.Properties['elements']) { $elements += @($pageResp.elements) }
        }
    }
}
catch {
    Write-Host "`nCould not read /v1/credentials from $SDDCManager" -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor DarkYellow
    Write-Host "`n  A 403 here usually means the account lacks the credentials-read" -ForegroundColor DarkGray
    Write-Host "  privilege even though it can log in. Use an ADMIN account." -ForegroundColor DarkGray
    exit 1
}

if ($Raw) {
    Write-Host "`n--- Raw /v1/credentials response ---" -ForegroundColor Magenta
    Write-Host ($response | ConvertTo-Json -Depth 12) -ForegroundColor DarkGray
}

# --- Flatten + client-side filters --------------------------------------------
$rows = foreach ($element in $elements) {
    $resource = Get-Prop $element 'resource'
    [pscustomobject]@{
        ResourceName   = Get-Prop $resource 'resourceName'
        ResourceType   = Get-Prop $resource 'resourceType'
        ResourceIp     = Get-Prop $resource 'resourceIp'
        Domain         = Get-Prop $resource 'domainName'
        AccountType    = Get-Prop $element 'accountType'
        CredentialType = Get-Prop $element 'credentialType'
        Username       = Get-Prop $element 'username'
        Password       = Get-Prop $element 'password'
    }
}

if ($ResourceName)   { $rows = $rows | Where-Object { "$($_.ResourceName)" -match [regex]::Escape($ResourceName) } }
if ($AccountType)    { $rows = $rows | Where-Object { "$($_.AccountType)"    -eq $AccountType } }
if ($CredentialType) { $rows = $rows | Where-Object { "$($_.CredentialType)" -eq $CredentialType.ToUpper() } }

$rows = @($rows | Sort-Object ResourceType, ResourceName, CredentialType, Username)

if (-not $rows.Count) {
    Write-Host "`nNo credentials matched the given filters." -ForegroundColor Yellow
    exit 0
}

# --- Export (full values) -----------------------------------------------------
if ($ExportCsv) {
    try {
        $rows | Export-Csv -Path $ExportCsv -NoTypeInformation -Encoding UTF8
        Write-Host "`nWrote $($rows.Count) credential(s), passwords included, to:" -ForegroundColor Green
        Write-Host "  $ExportCsv" -ForegroundColor Green
        Write-Host "  Treat this file as customer data -- OneDrive engagement folder," -ForegroundColor DarkYellow
        Write-Host "  never the repo. Delete it when the task is done." -ForegroundColor DarkYellow
    }
    catch {
        Write-Host "`nCould not write the CSV: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# --- On-screen table (passwords masked unless -ShowPasswords) -----------------
$display = $rows | ForEach-Object {
    $shown = if ($ShowPasswords) { $_.Password } else { '********' }
    [pscustomobject]@{
        ResourceName   = $_.ResourceName
        Type           = $_.ResourceType
        Domain         = $_.Domain
        Account        = $_.AccountType
        Credential     = $_.CredentialType
        Username       = $_.Username
        Password       = $shown
    }
}

Write-Host "`n$($rows.Count) credential(s):" -ForegroundColor White
$display | Format-Table -AutoSize | Out-String -Width 4096 | Write-Host

if (-not $ShowPasswords -and -not $ExportCsv) {
    Write-Host "Passwords masked. Re-run with -ShowPasswords to reveal them, or" -ForegroundColor DarkGray
    Write-Host "-ExportCsv <path> to write the full inventory to a file." -ForegroundColor DarkGray
}

Write-Host "`n$('=' * 62)" -ForegroundColor DarkCyan
Write-Host "  Done. Nothing was changed." -ForegroundColor DarkCyan
Write-Host ('=' * 62) -ForegroundColor DarkCyan
