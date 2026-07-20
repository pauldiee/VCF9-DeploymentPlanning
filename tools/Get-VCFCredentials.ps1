#Requires -Version 5.1
<#
.SYNOPSIS
    Read-only retrieval of VCF 9.1 credential information. Two modes:

      -SDDCManager  : the passwords SDDC Manager stores and rotates for its
                      managed components (ESXi, vCenter, NSX, PSC, backup) --
                      the documented Credentials API, the same endpoint
                      PowerVCF's Get-VCFCredential calls. Returns plaintext.

      -VCFOps       : the VCF Management (VCF Operations) password *accounts*
                      inventory -- component, username, account type and
                      expiry. This side has NO reveal: VCF Operations manages
                      rotation/expiry and never returns the plaintext, so this
                      mode lists accounts only. Takes a -Credential just like
                      SDDC Manager mode.

.DESCRIPTION
    SDDC Manager mode (default) is the system of record for the accounts it
    provisions and rotates across a workload domain. When you need the current
    password for a managed component -- to log into an ESXi host directly, to
    hand an auditor the service-account inventory, or to confirm a rotation took
    -- read it back from the Credentials API rather than a screenshot:

        POST https://<SDDCManager>/v1/tokens      { username, password } -> token
        GET  https://<SDDCManager>/v1/credentials
              -> elements[] { resource { resourceName, resourceType, resourceIp,
                                         domainName },
                              accountType, credentialType, username, password }

    VCF Management mode (-VCFOps) lists the management-plane password accounts
    that VCF Operations tracks (VCF Operations, Automation, VCF services
    runtime). The platform deliberately never returns these passwords -- the
    Password Management UI has no "view" action, only rotate/expiry -- so this
    mode returns the *inventory* (component / username / accountType / expiry),
    never a secret:

        POST https://<VCFOps>/suite-api/api/auth/token/acquire  { username, password }
              -> OpsToken

        POST https://<VCFOps>/suite-api/internal/passwordmanagement/passwords/query
              ?page=0&pageSize=100    body {"searchCriteria":{"VCF_COMPONENT_TYPE":"ARIA"}}
              headers: Authorization: OpsToken <token>
                       X-Ops-API-use-unsupported: true
              -> vcfPasswordAccounts[] { displayApplianceType, applianceFqdn,
                                         userName, accountType, status, expiryDate }

    That /suite-api/internal/* namespace is an *internal, unsupported* VCF
    Operations API (the flag header opts in to it); Broadcom may change it
    between builds. The equivalent /vcf-operations/rest/* UI path needs a live
    browser session -- this mode avoids that by using the suite-api OpsToken, so
    a plain -Credential is all it needs. (Recipe borrowed from VCFHealthCheck.)

    This script only reads. It never rotates, updates or deletes anything.

    Password hygiene (SDDC Manager mode): the on-screen table masks passwords by
    default. Pass -ShowPasswords to reveal them, or -ExportCsv <path> to write
    the full inventory. Treat any such file as customer data -- the engagement's
    OneDrive folder, not this repo. (VCF Management mode has no passwords to
    mask.)

.NOTES
    Script  : Get-VCFCredentials.ps1
    Version : 1.2.0
    Author  : Paul van Dieen
    Blog    : https://www.hollebollevsan.nl
    Requires: PowerShell 5.1+ (Windows PowerShell) or PowerShell 7+
    Tested  : VCF 9.1 (both modes verified against a live lab)

.CHANGELOG
    v1.2.0  2026-07-20  PD  VCF Management mode now takes a -Credential: mints an Ops
                            token and calls /suite-api/internal with the
                            X-Ops-API-use-unsupported flag, so no browser session or
                            CSRF is needed. Verified live (#188)
    v1.1.0  2026-07-20  PD  Add VCF Management account-inventory mode (-VCFOps), no secrets (#188)
    v1.0.0  2026-07-20  PD  Initial release -- read-only SDDC Manager credentials retrieval (#188)

.PARAMETER SDDCManager
    SDDC Manager mode. FQDN of the SDDC Manager appliance. Returns the plaintext
    credentials of its managed components.

.PARAMETER Credential
    Credentials for the target appliance. In SDDC Manager mode: an SDDC Manager
    account with the ADMIN role (or the credentials-read privilege). In VCF
    Management mode: a VCF Operations local account (e.g. admin). If omitted, you
    are prompted. Not stored.

.PARAMETER ResourceType
    SDDC Manager mode. Server-side filter by resource type, e.g. ESXI, VCENTER,
    NSXT_MANAGER, NSXT_EDGE, BACKUP, PSC. Case-insensitive.

.PARAMETER ResourceName
    SDDC Manager mode. Client-side, case-insensitive substring match on the
    resource name (usually the FQDN).

.PARAMETER AccountType
    SDDC Manager mode. Client-side filter: USER, SYSTEM or SERVICE.

.PARAMETER CredentialType
    SDDC Manager mode. Client-side filter, e.g. SSH, SSO, API, FTP, AUDIT.

.PARAMETER ShowPasswords
    SDDC Manager mode. Reveal passwords in the on-screen table (off by default).

.PARAMETER VCFOps
    VCF Management mode. FQDN of the VCF Operations appliance. Lists the
    management-plane password accounts (no secrets).

.PARAMETER ExportCsv
    Also write the results to this CSV path. In SDDC Manager mode this includes
    passwords -- treat it as customer data (OneDrive engagement folder, not the
    repo). In VCF Management mode it is the no-secrets account inventory.

.PARAMETER SkipCertificateValidation
    Skip TLS certificate validation (self-signed appliance certificates).

.PARAMETER Raw
    Also print the full JSON returned by the API, at full depth.

.EXAMPLE
    .\Get-VCFCredentials.ps1 -SDDCManager sddc01.sfo.example.io -ResourceType ESXI -ShowPasswords -SkipCertificateValidation

    SDDC Manager mode: the root/SSH credentials for every ESXi host, revealed.

.EXAMPLE
    .\Get-VCFCredentials.ps1 -VCFOps ops01.sfo.example.io -SkipCertificateValidation

    VCF Management mode: prompts for the VCF Operations credentials, then prints
    the management-plane password-account inventory (component / username /
    accountType / expiry). No passwords are returned -- the platform does not
    expose them.
#>
[CmdletBinding(DefaultParameterSetName = 'SDDCManager')]
param(
    [Parameter(ParameterSetName = 'SDDCManager', Mandatory)] [string]$SDDCManager,
    [Parameter(ParameterSetName = 'Management', Mandatory)] [string]$VCFOps,

    [System.Management.Automation.PSCredential]$Credential,

    [Parameter(ParameterSetName = 'SDDCManager')] [string]$ResourceType,
    [Parameter(ParameterSetName = 'SDDCManager')] [string]$ResourceName,
    [Parameter(ParameterSetName = 'SDDCManager')] [ValidateSet('USER', 'SYSTEM', 'SERVICE')] [string]$AccountType,
    [Parameter(ParameterSetName = 'SDDCManager')] [string]$CredentialType,
    [Parameter(ParameterSetName = 'SDDCManager')] [switch]$ShowPasswords,

    [string]$ExportCsv,
    [switch]$SkipCertificateValidation,
    [switch]$Raw
)

$scriptVersion = '1.2.0'
$scriptAuthor  = 'Paul van Dieen'
$scriptBlogUrl = 'https://www.hollebollevsan.nl'

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$mode = $PSCmdlet.ParameterSetName

Write-Host ('=' * 62) -ForegroundColor DarkCyan
Write-Host "  Get-VCFCredentials v$scriptVersion" -ForegroundColor Cyan
Write-Host "  $scriptAuthor - $scriptBlogUrl" -ForegroundColor DarkCyan
if ($mode -eq 'SDDCManager') {
    Write-Host "  Mode        : SDDC Manager (managed-component passwords)" -ForegroundColor Cyan
    Write-Host "  SDDC Manager: $SDDCManager" -ForegroundColor Cyan
}
else {
    Write-Host "  Mode        : VCF Management (account inventory - no secrets)" -ForegroundColor Cyan
    Write-Host "  VCF Ops     : $VCFOps" -ForegroundColor Cyan
}
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

function Get-Prop {
    param($Object, [string]$Name)
    if ($null -ne $Object -and $Object.PSObject.Properties[$Name]) { return $Object.$Name }
    return $null
}

# =============================================================================
#  VCF MANAGEMENT MODE  (account inventory, no secrets)
# =============================================================================
if ($mode -eq 'Management') {

    if (-not $Credential) {
        $Credential = Get-Credential -Message "VCF Operations credentials for $VCFOps (e.g. admin)"
    }

    # Mint an Ops token, then reach the internal password-management namespace
    # with the X-Ops-API-use-unsupported opt-in flag. This is the scriptable path
    # (the /vcf-operations/rest UI path would need a live browser session).
    try {
        $acquireBody = @{
            username = $Credential.UserName
            password = $Credential.GetNetworkCredential().Password
        } | ConvertTo-Json -Compress

        $opsToken = (Invoke-RestMethod -Uri "https://$VCFOps/suite-api/api/auth/token/acquire" `
            -Method POST -Body $acquireBody `
            -Headers @{ 'Content-Type' = 'application/json'; Accept = 'application/json' } `
            @restArgs).token

        if (-not $opsToken) { throw 'No token in the token/acquire response.' }

        Write-Host "`nAuthenticated. Ops token acquired." -ForegroundColor Green
    }
    catch {
        Write-Host "`nAuthentication failed against $VCFOps" -ForegroundColor Red
        Write-Host "  $($_.Exception.Message)" -ForegroundColor DarkYellow
        Write-Host "`n  Check the VCF Operations FQDN and the credentials. Use a local" -ForegroundColor DarkGray
        Write-Host "  account (e.g. admin); an SSO login may need an authSource this" -ForegroundColor DarkGray
        Write-Host "  script does not send." -ForegroundColor DarkGray
        exit 1
    }

    $uriBase     = "https://$VCFOps/suite-api/internal/passwordmanagement/passwords/query"
    $mgmtHeaders = @{
        Authorization              = "OpsToken $opsToken"
        Accept                     = 'application/json'
        'Content-Type'             = 'application/json'
        'X-Ops-API-use-unsupported' = 'true'
    }
    $reqBody = '{"searchCriteria":{"VCF_COMPONENT_TYPE":"ARIA"}}'

    $accounts = @()
    $page     = 0
    $pageSize = 100
    $total    = 0
    $lastJson = $null

    do {
        $pageUri = "$uriBase" + "?page=$page&pageSize=$pageSize"
        try {
            $resp = Invoke-WebRequest -Uri $pageUri -Method POST -Body $reqBody -Headers $mgmtHeaders @restArgs
        }
        catch {
            Write-Host "`nRequest to the Password Management API failed on $VCFOps" -ForegroundColor Red
            Write-Host "  $($_.Exception.Message)" -ForegroundColor DarkYellow
            Write-Host "`n  A 401/403 here usually means the Ops token was rejected, or the" -ForegroundColor DarkGray
            Write-Host "  internal namespace changed in this build (it is unsupported)." -ForegroundColor DarkGray
            exit 1
        }

        # A rejected request is answered with the login page HTML, not JSON.
        if ($resp.Content.TrimStart().StartsWith('<')) {
            Write-Host "`nThe API returned HTML instead of data." -ForegroundColor Red
            Write-Host "  The Ops token was not accepted on the internal namespace. Confirm" -ForegroundColor DarkYellow
            Write-Host "  the credentials and that this build still exposes /suite-api/internal." -ForegroundColor DarkYellow
            exit 1
        }

        $lastJson = $resp.Content | ConvertFrom-Json
        $accounts += @(Get-Prop $lastJson 'vcfPasswordAccounts')
        $pageInfo = Get-Prop $lastJson 'pageInfo'
        $total    = [int](Get-Prop $pageInfo 'totalCount')
        $page++
    } while ($accounts.Count -lt $total -and $total -gt 0 -and $page -lt 100)

    if ($Raw) {
        Write-Host "`n--- Raw last-page response ---" -ForegroundColor Magenta
        Write-Host ($lastJson | ConvertTo-Json -Depth 12) -ForegroundColor DarkGray
    }

    if (-not $accounts.Count) {
        Write-Host "`nNo password accounts returned." -ForegroundColor Yellow
        exit 0
    }

    function ConvertFrom-EpochMillis {
        param($Millis)
        $ms = 0L
        if ($null -ne $Millis) { [void][long]::TryParse([string]$Millis, [ref]$ms) }
        if ($ms -le 0) { return 'No expiry' }
        return ([System.DateTimeOffset]::FromUnixTimeMilliseconds($ms)).UtcDateTime.ToString('yyyy-MM-dd')
    }

    $rows = foreach ($a in $accounts) {
        [pscustomobject]@{
            Component  = Get-Prop $a 'displayApplianceType'
            Fqdn       = Get-Prop $a 'applianceFqdn'
            Username   = Get-Prop $a 'userName'
            Account    = Get-Prop $a 'accountType'
            Status     = Get-Prop $a 'status'
            Expiry     = ConvertFrom-EpochMillis (Get-Prop $a 'expiryDate')
            AccountKey = Get-Prop $a 'passwordAccountKey'
        }
    }
    $rows = @($rows | Sort-Object Component, Fqdn, Username)

    if ($ExportCsv) {
        try {
            $rows | Export-Csv -Path $ExportCsv -NoTypeInformation -Encoding UTF8
            Write-Host "`nWrote $($rows.Count) account(s) to:" -ForegroundColor Green
            Write-Host "  $ExportCsv" -ForegroundColor Green
        }
        catch {
            Write-Host "`nCould not write the CSV: $($_.Exception.Message)" -ForegroundColor Red
        }
    }

    Write-Host "`n$($rows.Count) VCF Management password account(s):" -ForegroundColor White
    $rows | Format-Table Component, Fqdn, Username, Account, Status, Expiry -AutoSize | Out-String -Width 4096 | Write-Host

    Write-Host "No passwords are shown because this API does not expose them: VCF" -ForegroundColor DarkGray
    Write-Host "Operations manages rotation and expiry for these accounts but never" -ForegroundColor DarkGray
    Write-Host "returns the plaintext. To change one, rotate it (Update Password)." -ForegroundColor DarkGray

    Write-Host "`n$('=' * 62)" -ForegroundColor DarkCyan
    Write-Host "  Done. Nothing was changed." -ForegroundColor DarkCyan
    Write-Host ('=' * 62) -ForegroundColor DarkCyan
    return
}

# =============================================================================
#  SDDC MANAGER MODE  (managed-component passwords, plaintext)
# =============================================================================
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
