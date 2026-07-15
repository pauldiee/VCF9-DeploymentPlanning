#Requires -Version 5.1
<#
.SYNOPSIS
    Read-only check of the proxy (peerProxy) configured on the VCF 9.1 VCF
    services runtime, via the Fleet LCM REST API. Shows what the platform has
    actually stored.

.DESCRIPTION
    When the VCF Management Services components do not have direct Internet
    access, a proxy is configured on the VCF services runtime so the fleet can
    download bundles (VCF Operations > Configure, or the Fleet LCM API). The
    setting lives on the runtime component, not on SDDC Manager, and the user
    interface does not always make the stored value easy to read back.

    This script reads the stored proxy configuration straight from the API:

        GET /fleet-lcm/v1/components
              -> the component whose componentType is VSP (the VCF services
                 runtime); there can be more than one

        GET /fleet-lcm/v1/components/{id}/config
              -> peerProxy { host, port, tlsEnabled, credentialsEnabled,
                             username, excludeDomains, excludeIpAddresses,
                             encodedCertificate }

    Authentication is a two-call chain through VCF Operations, which is the only
    token issuer the Fleet lifecycle service trusts:

        1. POST https://<VCFOps>/suite-api/api/auth/token/acquire   -> OpsToken
        2. POST https://<VCFOps>/suite-api/api/auth/token/exchange
                with serviceKeys=["fleet-lcm"]                      -> JWT
        3. Bearer <JWT> against https://<FleetLCM>/fleet-lcm/v1/*

    Everything -- the component lookup and the config read -- talks to the fleet
    appliance directly. The browser calls these through the VCF Operations proxy
    (/vcf-operations/plug/fleet-lcm/...), but that path is the user interface's
    session-authenticated route and a Bearer-token client cannot use it. Same
    lesson as the backup scripts.

    This script only reads. It never writes, and it changes nothing.

.NOTES
    Script  : Get-VCFProxyConfig.ps1
    Version : 1.0.0
    Author  : Paul van Dieen
    Blog    : https://www.hollebollevsan.nl
    Requires: PowerShell 5.1+ (Windows PowerShell) or PowerShell 7+
    Tested  : VCF 9.1

.CHANGELOG
    v1.0.0  2026-07-15  PD  Initial release -- read-only Fleet LCM proxy (peerProxy) check (#154)

.PARAMETER VCFOps
    Fully qualified domain name of the VCF Operations appliance. This is where
    the token for the Fleet lifecycle service is minted.

.PARAMETER FleetLCM
    Fully qualified domain name of the Fleet lifecycle appliance (fleet-*). Find
    it in VCF Operations under

        Build > Lifecycle > VCF Management > Components

    in the "Fleet lifecycle" row, FQDN column (e.g. fleet-01a.site-a.vcf.two).

.PARAMETER VspComponentId
    Identifier of the VCF services runtime (VSP) component to read. If omitted,
    the script lists the VSP components on the fleet appliance and reads each.

.PARAMETER Credential
    Credentials for VCF Operations. If omitted, you are prompted. Nothing is
    written to disk.

.PARAMETER SkipCertificateValidation
    Skip TLS certificate validation. Use when the appliances still present their
    self-signed certificates.

.PARAMETER Raw
    Also print the full JSON returned by the API, at full depth.

.EXAMPLE
    .\Get-VCFProxyConfig.ps1 -VCFOps ops01.sfo.example.io -FleetLCM fleet01.sfo.example.io -SkipCertificateValidation

    Prompts for the VCF Operations credentials, then prints the proxy stored on
    every VCF services runtime component.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$VCFOps,
    [string]$FleetLCM,
    [string]$VspComponentId,
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
Write-Host "  Get-VCFProxyConfig v$scriptVersion" -ForegroundColor Cyan
Write-Host "  $scriptAuthor - $scriptBlogUrl" -ForegroundColor DarkCyan
Write-Host "  VCF Operations : $VCFOps" -ForegroundColor Cyan
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

# StrictMode-safe property read: a missing property is $null, not an exception.
function Get-Prop {
    param($Object, [string]$Name)
    if ($null -ne $Object -and $Object.PSObject.Properties[$Name]) { return $Object.$Name }
    return $null
}

# --- Resolve the fleet appliance ----------------------------------------------
if (-not $FleetLCM) {
    Write-Host "`nThe proxy configuration lives on the Fleet lifecycle appliance." -ForegroundColor Cyan
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

# --- Resolve the VCF services runtime (VSP) components -------------------------
# When -VspComponentId is given, read only that one. Otherwise list the
# components and keep the VSP ones (the VCF services runtime); there can be more
# than one.
$targets = @()
if ($VspComponentId) {
    $targets = @([pscustomobject]@{ id = $VspComponentId; name = $null })
}
else {
    try {
        $componentsResponse = Invoke-RestMethod -Uri "$baseUri/components" -Headers $headers @restArgs
    }
    catch {
        Write-Host "`nCould not read $baseUri/components : $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "  Re-run with -VspComponentId <guid> to skip the lookup." -ForegroundColor DarkGray
        exit 1
    }

    if ($Raw) {
        Write-Host "`n--- Raw /components response ---" -ForegroundColor Magenta
        Write-Host ($componentsResponse | ConvertTo-Json -Depth 12) -ForegroundColor DarkGray
    }

    $components = @()
    $wrapped = Get-Prop $componentsResponse 'components'
    if     ($wrapped)                        { $components = @($wrapped) }
    elseif ($componentsResponse -is [array]) { $components = @($componentsResponse) }
    else                                     { $components = @($componentsResponse) }

    $targets = @($components | Where-Object { (Get-Prop $_ 'componentType') -eq 'VSP' })

    if ($targets.Count -eq 0) {
        Write-Host "`nNo VSP (VCF services runtime) component found on $FleetLCM." -ForegroundColor Yellow
        Write-Host "  Components seen:" -ForegroundColor DarkGray
        foreach ($c in $components) {
            Write-Host "    $(Get-Prop $c 'componentType')  $(Get-Prop $c 'id')  $(Get-Prop $c 'name')" -ForegroundColor DarkGray
        }
        exit 0
    }
}

# --- Read and show the proxy for each ----------------------------------------
foreach ($target in $targets) {
    $vspId   = Get-Prop $target 'id'
    $vspName = Get-Prop $target 'name'
    if (-not $vspName) { $vspName = Get-Prop $target 'fqdn' }

    Write-Host "`n$('-' * 62)" -ForegroundColor DarkCyan
    Write-Host "VCF services runtime : $(if ($vspName) { $vspName } else { '(unnamed)' })" -ForegroundColor Cyan
    Write-Host "Component ID         : $vspId" -ForegroundColor DarkGray

    try {
        $config = Invoke-RestMethod -Uri "$baseUri/components/$vspId/config" -Headers $headers @restArgs
    }
    catch {
        Write-Host "`n  Could not read the config for this component: $($_.Exception.Message)" -ForegroundColor Red
        continue
    }

    if ($Raw) {
        Write-Host "`n  --- Raw /config response ---" -ForegroundColor Magenta
        Write-Host ($config | ConvertTo-Json -Depth 12) -ForegroundColor DarkGray
    }

    $peerProxy = Get-Prop $config 'peerProxy'
    Write-Host "`n  Proxy (peerProxy, stored by the platform)" -ForegroundColor White
    if (-not $peerProxy) {
        Write-Host "    No proxy configured. The runtime reaches the Internet directly" -ForegroundColor Yellow
        Write-Host "    (or not at all)." -ForegroundColor Yellow
        continue
    }

    $pHost    = Get-Prop $peerProxy 'host'
    $pPort    = Get-Prop $peerProxy 'port'
    $pTls     = Get-Prop $peerProxy 'tlsEnabled'
    $pCreds   = Get-Prop $peerProxy 'credentialsEnabled'
    $pUser    = Get-Prop $peerProxy 'username'
    $pExDom   = Get-Prop $peerProxy 'excludeDomains'
    $pExIp    = Get-Prop $peerProxy 'excludeIpAddresses'
    $pCert    = Get-Prop $peerProxy 'encodedCertificate'

    Write-Host "    Host               : $pHost"
    Write-Host "    Port               : $pPort"
    Write-Host "    TLS enabled        : $pTls"
    Write-Host "    Credentials enabled: $pCreds"
    if (-not [string]::IsNullOrWhiteSpace([string]$pUser)) {
        Write-Host "    Username           : $pUser"
    }
    if ($pExDom) { Write-Host "    Exclude domains    : $((@($pExDom)) -join ', ')" }
    if ($pExIp)  { Write-Host "    Exclude IPs        : $((@($pExIp)) -join ', ')" }
    if (-not [string]::IsNullOrWhiteSpace([string]$pCert)) {
        Write-Host "    TLS certificate    : present (encodedCertificate stored)"
    }
}

Write-Host "`n$('=' * 62)" -ForegroundColor DarkCyan
Write-Host "  Done." -ForegroundColor DarkCyan
Write-Host ('=' * 62) -ForegroundColor DarkCyan
