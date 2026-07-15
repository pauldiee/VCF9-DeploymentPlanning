#Requires -Version 5.1
<#
.SYNOPSIS
    Sets the proxy (peerProxy) on the VCF 9.1 VCF services runtime through the
    Fleet LCM API, so the VCF Management Services components can download bundles
    without direct Internet access.

.DESCRIPTION
    When the VCF Management Services components sit behind a proxy, the proxy is
    configured on the VCF services runtime (the VSP component). This script sends
    the same payload the product's Configure Proxy flow sends:

        PATCH https://<FleetLCM>/fleet-lcm/v1/components/{vspId}/config

        {
          "type": "VspClusterConfigSpec",
          "peerProxy": {
            "host": "<proxy host>",
            "port": <proxy port>,
            "tlsEnabled": false,
            "credentialsEnabled": false
          }
        }

    Optional peerProxy fields, added when the matching parameters are supplied:
    username + password (credentialsEnabled becomes true), encodedCertificate
    (with -TlsEnabled and a -CertificateFile), excludeDomains, excludeIpAddresses.
    Note that port is a NUMBER here, unlike the string port in the backup payload.

    Authentication is minted through VCF Operations -- the only issuer the Fleet
    lifecycle service trusts -- then both the component lookup and the write go
    STRAIGHT to the fleet appliance, not the /vcf-operations/plug/fleet-lcm/...
    proxy route the browser uses. That path is the user interface's
    session-authenticated route: a Bearer token gets 405 on a PATCH there. The
    payload was worth copying from the browser; the URL was not. (Same lesson as
    Set-VCFBackupConfig.ps1, #150.)

    The service answers with a task; the work runs asynchronously. Verify with
    Get-VCFProxyConfig.ps1 afterwards -- it shows what was actually stored.

    THIS SCRIPT WRITES TO THE PLATFORM. It supports -WhatIf, which prints the
    exact payload (with the secrets masked) without sending it, and it asks for
    confirmation before it writes.

.NOTES
    Script  : Set-VCFProxyConfig.ps1
    Version : 1.0.0
    Author  : Paul van Dieen
    Blog    : https://www.hollebollevsan.nl
    Requires: PowerShell 5.1+ (Windows PowerShell) or PowerShell 7+
    Tested  : VCF 9.1

.CHANGELOG
    v1.0.0  2026-07-15  PD  Initial release -- PATCH peerProxy on the VCF services runtime via Fleet LCM (#154)

.PARAMETER VCFOps
    Fully qualified domain name of the VCF Operations appliance. The token is
    minted here.

.PARAMETER FleetLCM
    Fully qualified domain name of the Fleet lifecycle appliance (fleet-*). Used
    to look up the VSP component and to write. If omitted, you are prompted. Find
    it in VCF Operations under Build > Lifecycle > VCF Management > Components,
    the "Fleet lifecycle" row, FQDN column.

.PARAMETER VspComponentId
    Identifier of the VCF services runtime (VSP) component to configure. If
    omitted, the script looks it up on the fleet appliance and uses the only VSP
    component; with more than one it stops and asks you to name it.

.PARAMETER ProxyHost
    FQDN or IP address of the proxy server.

.PARAMETER ProxyPort
    TCP port of the proxy server. Defaults to 3128. Sent as a number.

.PARAMETER ProxyUsername
    Username for an authenticating proxy. Supplying it sets credentialsEnabled to
    true and includes the username and password in the payload.

.PARAMETER ProxyPassword
    Password for -ProxyUsername, as a SecureString. Prompted for if -ProxyUsername
    is given without it.

.PARAMETER TlsEnabled
    Mark the proxy as an HTTPS (TLS) proxy. Supply -CertificateFile with it when
    the proxy presents a certificate the runtime must trust.

.PARAMETER CertificateFile
    Path to a PEM certificate for the TLS proxy. Its contents are base64-encoded
    into peerProxy.encodedCertificate. Implies -TlsEnabled.

.PARAMETER ExcludeDomains
    Domains that must bypass the proxy (peerProxy.excludeDomains).

.PARAMETER ExcludeIpAddresses
    IP addresses or CIDRs that must bypass the proxy (peerProxy.excludeIpAddresses).

.PARAMETER Credential
    Credentials for VCF Operations. If omitted, you are prompted.

.PARAMETER SkipCertificateValidation
    Skip TLS certificate validation. Use when the appliances still present their
    self-signed certificates.

.EXAMPLE
    .\Set-VCFProxyConfig.ps1 -VCFOps ops01.sfo.example.io -FleetLCM fleet01.sfo.example.io `
        -ProxyHost 10.11.10.250 -ProxyPort 3128 -SkipCertificateValidation -WhatIf

    Prints the exact payload that would be sent and sends nothing.

.EXAMPLE
    .\Set-VCFProxyConfig.ps1 -VCFOps ops01.sfo.example.io -FleetLCM fleet01.sfo.example.io `
        -ProxyHost proxy01.sfo.example.io -ProxyPort 3128 `
        -ProxyUsername vcfproxy -ExcludeDomains 'sfo.example.io' `
        -ExcludeIpAddresses '10.11.0.0/16' -SkipCertificateValidation

    Configures an authenticating proxy (prompts for the password) that bypasses
    the local domain and management network.
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)] [string]$VCFOps,
    [Parameter(Mandatory)] [string]$ProxyHost,
    [string]$FleetLCM,
    [string]$VspComponentId,
    [int]$ProxyPort = 3128,
    [string]$ProxyUsername,
    [System.Security.SecureString]$ProxyPassword,
    [switch]$TlsEnabled,
    [string]$CertificateFile,
    [string[]]$ExcludeDomains,
    [string[]]$ExcludeIpAddresses,
    [System.Management.Automation.PSCredential]$Credential,
    [switch]$SkipCertificateValidation
)

$scriptVersion = '1.0.0'
$scriptAuthor  = 'Paul van Dieen'
$scriptBlogUrl = 'https://www.hollebollevsan.nl'

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host ('=' * 62) -ForegroundColor DarkCyan
Write-Host "  Set-VCFProxyConfig v$scriptVersion" -ForegroundColor Cyan
Write-Host "  $scriptAuthor - $scriptBlogUrl" -ForegroundColor DarkCyan
Write-Host "  VCF Operations : $VCFOps" -ForegroundColor Cyan
Write-Host "  Proxy          : $ProxyHost`:$ProxyPort" -ForegroundColor Cyan
Write-Host ('=' * 62) -ForegroundColor DarkCyan

function ConvertFrom-SecureStringPlain {
    param([System.Security.SecureString]$Secure)
    $ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try   { return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

# StrictMode-safe property read: a missing property is $null, not an exception.
function Get-Prop {
    param($Object, [string]$Name)
    if ($null -ne $Object -and $Object.PSObject.Properties[$Name]) { return $Object.$Name }
    return $null
}

# --- Gather proxy inputs ------------------------------------------------------
$credentialsEnabled = $false
if ($ProxyUsername) {
    $credentialsEnabled = $true
    if (-not $ProxyPassword) {
        $ProxyPassword = Read-Host "Password for proxy user $ProxyUsername" -AsSecureString
    }
}

$encodedCertificate = $null
if ($CertificateFile) {
    if (-not (Test-Path -LiteralPath $CertificateFile)) {
        Write-Host "`nCertificate file not found: $CertificateFile" -ForegroundColor Red
        exit 1
    }
    $certBytes = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $CertificateFile))
    $encodedCertificate = [System.Convert]::ToBase64String($certBytes)
    $TlsEnabled = $true
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

# --- Resolve the VCF services runtime (VSP) component -------------------------
if (-not $VspComponentId) {
    try {
        $componentsResponse = Invoke-RestMethod -Uri "$baseUri/components" -Headers $headers @restArgs
    }
    catch {
        Write-Host "`nCould not list components from $FleetLCM : $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "  Re-run with -VspComponentId <guid> to skip the lookup." -ForegroundColor DarkGray
        exit 1
    }

    $components = @()
    $wrapped = Get-Prop $componentsResponse 'components'
    if     ($wrapped)                        { $components = @($wrapped) }
    elseif ($componentsResponse -is [array]) { $components = @($componentsResponse) }
    else                                     { $components = @($componentsResponse) }

    $vsp = @($components | Where-Object { (Get-Prop $_ 'componentType') -eq 'VSP' })

    if ($vsp.Count -eq 0) {
        Write-Host "`nNo VSP (VCF services runtime) component found on $FleetLCM." -ForegroundColor Red
        Write-Host "  Re-run with -VspComponentId <guid> if you have it." -ForegroundColor DarkGray
        exit 1
    }
    if ($vsp.Count -gt 1) {
        Write-Host "`nMore than one VCF services runtime. Re-run with -VspComponentId:" -ForegroundColor Yellow
        foreach ($v in $vsp) {
            $vName = Get-Prop $v 'name'
            if (-not $vName) { $vName = Get-Prop $v 'fqdn' }
            Write-Host "  $(Get-Prop $v 'id')  $vName"
        }
        exit 1
    }

    $VspComponentId = Get-Prop $vsp[0] 'id'
    $vspName = Get-Prop $vsp[0] 'name'
    if (-not $vspName) { $vspName = Get-Prop $vsp[0] 'fqdn' }
    if ($vspName) { Write-Host "VCF services runtime : $vspName" -ForegroundColor Cyan }
}
Write-Host "Component ID   : $VspComponentId" -ForegroundColor DarkGray

# --- Build the payload --------------------------------------------------------
# port is a NUMBER here (VspClusterConfigSpec), not a string.
$peerProxy = [ordered]@{
    host               = $ProxyHost
    port               = [int]$ProxyPort
    tlsEnabled         = [bool]$TlsEnabled
    credentialsEnabled = $credentialsEnabled
}
if ($credentialsEnabled) {
    $peerProxy.username = $ProxyUsername
    $peerProxy.password = (ConvertFrom-SecureStringPlain $ProxyPassword)
}
if ($encodedCertificate) { $peerProxy.encodedCertificate = $encodedCertificate }
if ($ExcludeDomains)     { $peerProxy.excludeDomains      = @($ExcludeDomains) }
if ($ExcludeIpAddresses) { $peerProxy.excludeIpAddresses  = @($ExcludeIpAddresses) }

$spec = [ordered]@{
    type      = 'VspClusterConfigSpec'
    peerProxy = $peerProxy
}

# The same shape with the secrets masked, for display.
$maskedProxy = [ordered]@{}
foreach ($k in $peerProxy.Keys) { $maskedProxy[$k] = $peerProxy[$k] }
if ($maskedProxy.Contains('password'))           { $maskedProxy['password'] = '********' }
if ($maskedProxy.Contains('encodedCertificate')) { $maskedProxy['encodedCertificate'] = '<base64 certificate, ' + $encodedCertificate.Length + ' chars>' }
$masked = [ordered]@{ type = 'VspClusterConfigSpec'; peerProxy = $maskedProxy }

Write-Host "`nPayload to be sent:" -ForegroundColor White
Write-Host ($masked | ConvertTo-Json -Depth 6) -ForegroundColor DarkGray
Write-Host "`nPATCH $baseUri/components/$VspComponentId/config" -ForegroundColor White

# --- Write --------------------------------------------------------------------
$target = "VCF services runtime $VspComponentId on $FleetLCM"
$action = "Set the proxy to $ProxyHost`:$ProxyPort"

if (-not $PSCmdlet.ShouldProcess($target, $action)) {
    Write-Host "`nNothing was sent." -ForegroundColor Yellow
    exit 0
}

try {
    $body = $spec | ConvertTo-Json -Depth 6
    $response = Invoke-RestMethod -Uri "$baseUri/components/$VspComponentId/config" -Method PATCH -Body $body `
        -Headers @{ Authorization = "Bearer $jwt"; Accept = 'application/json'; 'Content-Type' = 'application/json' } `
        @restArgs

    $taskId = Get-Prop $response 'id'
    Write-Host "`nAccepted. The platform applies the change asynchronously." -ForegroundColor Green
    if ($taskId) {
        Write-Host "Task ID        : $taskId" -ForegroundColor Cyan
        Write-Host "`nFollow it with:" -ForegroundColor DarkGray
        Write-Host "  GET $baseUri/tasks/$taskId" -ForegroundColor White
    }
    elseif ($response) {
        Write-Host ($response | ConvertTo-Json -Depth 6) -ForegroundColor DarkGray
    }
    Write-Host "`nThen confirm what was actually stored with:" -ForegroundColor DarkGray
    Write-Host "  .\Get-VCFProxyConfig.ps1 -VCFOps $VCFOps -FleetLCM $FleetLCM" -ForegroundColor White
}
catch {
    Write-Host "`nThe proxy configuration was rejected." -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor DarkYellow
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
        Write-Host "`n  Response body:" -ForegroundColor DarkYellow
        Write-Host "  $($_.ErrorDetails.Message)" -ForegroundColor DarkGray
    }
    Write-Host "`n  Things worth checking:" -ForegroundColor DarkGray
    Write-Host "  - the proxy host and port are reachable from the services-runtime block" -ForegroundColor DarkGray
    Write-Host "  - with an authenticating proxy, -ProxyUsername and its password are correct" -ForegroundColor DarkGray
    Write-Host "  - with a TLS proxy, -CertificateFile is the PEM the proxy presents" -ForegroundColor DarkGray
    exit 1
}

Write-Host "`n$('=' * 62)" -ForegroundColor DarkCyan
Write-Host "  Done." -ForegroundColor DarkCyan
Write-Host ('=' * 62) -ForegroundColor DarkCyan
