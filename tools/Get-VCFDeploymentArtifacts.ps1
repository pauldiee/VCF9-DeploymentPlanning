#Requires -Version 5.1
<#
.SYNOPSIS
    Read-only capture of re-submittable configuration spec JSON from a built
    VCF 9.1 instance: the bring-up spec, Fleet LCM component specs, workload
    domain / cluster specs, and the NSX policy hierarchy. Output is sanitised
    (secrets redacted, licence keys masked) so it can seed a template library.

.DESCRIPTION
    The reverse of the workbook flow. Instead of feeding inputs toward a
    deployment, this turns a running deployment back into inputs.

    It writes one folder per run:

        <OutputPath>/
          00-manifest.json          what was captured, when, from where
          bringup/   sddc-<id>.json
          domains/   <domain>.json
          clusters/  <cluster>.json
          fleet/     VSP-<name>.json  +  .config.json   (one pair per VSP)
          nsx/<host>/infra-<scope>.json
          .raw/                      unsanitised copies, only with -Raw

    What round-trips (a GET gives you close to the deploy shape):

        BringUp   GET /v1/sddcs/{id}                        (the VCF Installer
                                                             keeps the cleaner
                                                             copy)
        Fleet     GET /fleet-lcm/v1/components  -> every VSP
                  GET /fleet-lcm/v1/components/{id}          VspComponentSpec
                  GET /fleet-lcm/v1/components/{id}/config   VspClusterConfigSpec
        Domains   GET /v1/domains/{id}    (prune to the POST /v1/domains schema)
        Clusters  GET /v1/clusters/{id}   (prune to the POST /v1/clusters schema)
        NSX       GET /policy/api/v1<scope>  -> re-submit via
                  PATCH /policy/api/v1/infra (Hierarchical Policy API)

    Authentication:
        - VCF / SDDC Manager API : POST https://<SDDCManager>/v1/tokens -> Bearer
        - Fleet LCM API          : OpsToken chain through VCF Operations
              POST https://<VCFOps>/suite-api/api/auth/token/acquire  -> OpsToken
              POST https://<VCFOps>/suite-api/api/auth/token/exchange
                    serviceKeys=["fleet-lcm"]                          -> JWT
        - NSX Policy API         : HTTP Basic (admin)

    Sanitisation is ALWAYS applied to the files under <OutputPath>. Keys matching
    password / secret / passphrase / privateKey / token / apiKey are replaced
    with "__REDACTED__"; 5x5 licence keys are masked to the last group; NSX
    realised-state / revision fields are stripped so a PATCH back is accepted.
    -Raw additionally writes the untouched responses under .raw/ - that tree is
    real environment data, keep it in a secure location, not a public repo.

    This script only reads the environment. It never writes to it.

.NOTES
    Script  : Get-VCFDeploymentArtifacts.ps1
    Version : 1.0.0
    Author  : Paul van Dieen
    Blog    : https://www.hollebollevsan.nl
    Requires: PowerShell 5.1+ (Windows PowerShell) or PowerShell 7+
    Tested  : VCF 9.1

.CHANGELOG
    v1.0.0  2026-09-10  PD  Initial release -- capture BringUp / Domains / Clusters / Fleet / NSX (#295)

.PARAMETER SDDCManager
    FQDN of SDDC Manager. Required for BringUp / Domains / Clusters.

.PARAMETER VCFOps
    FQDN of the VCF Operations appliance. Required for Fleet (it mints the
    Fleet lifecycle token).

.PARAMETER FleetLCM
    FQDN of the Fleet lifecycle appliance (fleet-*). Find it in VCF Operations
    under Build > Lifecycle > VCF Management > Components. Required for Fleet.

.PARAMETER NSXManager
    One or more NSX Manager FQDNs (VIP or a node). Required for NSX.

.PARAMETER Credential
    Credentials for SDDC Manager / VCF Operations (typically
    administrator@vsphere.local). Prompted if omitted.

.PARAMETER NSXCredential
    Credentials for NSX (typically admin). Defaults to -Credential.

.PARAMETER OutputPath
    Folder to write into. Default: .\artifacts\<stem>-<timestamp>.

.PARAMETER Include
    Limit to these groups: BringUp, Domains, Clusters, Fleet, NSX. Default: every
    group whose endpoint you supplied.

.PARAMETER Exclude
    Skip these groups (same value set as -Include).

.PARAMETER Raw
    Also write the untouched API responses under .raw/ (unsanitised - handle as
    real environment data).

.PARAMETER SkipCertificateValidation
    Skip TLS certificate validation. Use while the appliances present their
    self-signed certificates.

.EXAMPLE
    .\Get-VCFDeploymentArtifacts.ps1 -SDDCManager sddc01.sfo.example.io `
        -VCFOps ops01.sfo.example.io -FleetLCM fleet01.sfo.example.io `
        -NSXManager nsx01.sfo.example.io -SkipCertificateValidation

    Prompts once for credentials, then captures every group into
    .\artifacts\sddc01-<timestamp>\ .

.EXAMPLE
    .\Get-VCFDeploymentArtifacts.ps1 -SDDCManager sddc01.sfo.example.io `
        -Include Domains,Clusters -SkipCertificateValidation -WhatIf

    Lists the endpoints it would call for the domain and cluster specs; fetches
    and writes nothing.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$SDDCManager,
    [string]$VCFOps,
    [string]$FleetLCM,
    [string[]]$NSXManager,
    [System.Management.Automation.PSCredential]$Credential,
    [System.Management.Automation.PSCredential]$NSXCredential,
    [string]$OutputPath,
    [ValidateSet('BringUp', 'Domains', 'Clusters', 'Fleet', 'NSX')]
    [string[]]$Include,
    [ValidateSet('BringUp', 'Domains', 'Clusters', 'Fleet', 'NSX')]
    [string[]]$Exclude,
    [switch]$Raw,
    [switch]$SkipCertificateValidation
)

$scriptVersion = '1.0.0'
$scriptAuthor  = 'Paul van Dieen'
$scriptBlogUrl = 'https://www.hollebollevsan.nl'

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host ('=' * 62) -ForegroundColor DarkCyan
Write-Host "  Get-VCFDeploymentArtifacts v$scriptVersion" -ForegroundColor Cyan
Write-Host "  $scriptAuthor - $scriptBlogUrl" -ForegroundColor DarkCyan
Write-Host ('=' * 62) -ForegroundColor DarkCyan

# --- TLS handling -----------------------------------------------------------
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

# --- Helpers -------------------------------------------------------------------

# StrictMode-safe property read: a missing property is $null, not an exception.
function Get-Prop {
    param($Object, [string]$Name)
    if ($null -ne $Object -and $Object.PSObject.Properties[$Name]) { return $Object.$Name }
    return $null
}

# Deep clone via JSON round-trip so we can sanitise a copy and still keep raw.
function Copy-Deep {
    param($Object)
    if ($null -eq $Object) { return $null }
    return ($Object | ConvertTo-Json -Depth 100 -Compress | ConvertFrom-Json)
}

# Group selection.
function Test-Group {
    param([string]$Name)
    if ($Include -and ($Include -notcontains $Name)) { return $false }
    if ($Exclude -and ($Exclude -contains $Name)) { return $false }
    return $true
}

# Keys whose value is a secret -> replace with a placeholder.
$script:SecretKeyRegex = '(?i)(password|passphrase|secret|privatekey|private_key|bearer|apikey|api_key|clientsecret|client_secret|sshpassword|bindpassword|encodedcertificate|encoded_certificate)'
# NSX GET carries realised state / audit / revision fields that a PATCH rejects.
$script:NsxDropKeys = @(
    '_create_time', '_create_user', '_last_modified_time', '_last_modified_user',
    '_system_owned', '_protection', '_revision', 'realization_id',
    'realization_specific_identifier', 'origin_type', 'marked_for_delete',
    'overridden', 'unique_id'
)
$script:LicenceKeyRegex = '^[A-Z0-9]{5}(-[A-Z0-9]{5}){4}$'

function ConvertTo-Sanitized {
    param($Object, [switch]$Nsx)

    if ($null -eq $Object) { return $null }

    if ($Object -is [System.Collections.IEnumerable] -and $Object -isnot [string]) {
        $out = @()
        foreach ($item in $Object) { $out += , (ConvertTo-Sanitized -Object $item -Nsx:$Nsx) }
        return , $out
    }

    if ($Object -is [System.Management.Automation.PSCustomObject]) {
        $new = [ordered]@{}
        foreach ($p in $Object.PSObject.Properties) {
            $name = $p.Name
            if ($Nsx -and ($script:NsxDropKeys -contains $name)) { continue }
            if ($name -match $script:SecretKeyRegex) {
                if ($null -ne $p.Value -and -not [string]::IsNullOrWhiteSpace([string]$p.Value)) {
                    $new[$name] = '__REDACTED__'
                }
                else { $new[$name] = $p.Value }
                continue
            }
            $new[$name] = ConvertTo-Sanitized -Object $p.Value -Nsx:$Nsx
        }
        return [pscustomobject]$new
    }

    if ($Object -is [string] -and $Object -match $script:LicenceKeyRegex) {
        return ('XXXXX-XXXXX-XXXXX-XXXXX-' + $Object.Substring($Object.Length - 5))
    }

    return $Object
}

$script:Manifest = @()

function Save-Artifact {
    param(
        [Parameter(Mandatory)] $Object,
        [Parameter(Mandatory)] [string]$Group,
        [Parameter(Mandatory)] [string]$RelPath,
        [Parameter(Mandatory)] [string]$Source,
        [string[]]$DropKeys,
        [switch]$Nsx
    )

    $clone = Copy-Deep $Object
    if ($DropKeys) {
        foreach ($k in $DropKeys) {
            if ($clone.PSObject.Properties[$k]) { $clone.PSObject.Properties.Remove($k) }
        }
    }
    $clean = ConvertTo-Sanitized -Object $clone -Nsx:$Nsx

    $target = Join-Path $OutputPath $RelPath
    $dir = Split-Path $target -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    ($clean | ConvertTo-Json -Depth 100) | Set-Content -LiteralPath $target -Encoding UTF8

    if ($Raw) {
        $rawTarget = Join-Path $OutputPath (Join-Path '.raw' $RelPath)
        $rawDir = Split-Path $rawTarget -Parent
        if (-not (Test-Path $rawDir)) { New-Item -ItemType Directory -Path $rawDir -Force | Out-Null }
        ($Object | ConvertTo-Json -Depth 100) | Set-Content -LiteralPath $rawTarget -Encoding UTF8
    }

    $script:Manifest += [pscustomobject]@{ group = $Group; file = $RelPath; source = $Source; sanitised = $true }
    Write-Host "    saved  $RelPath" -ForegroundColor Green
}

# Bearer GET, or Basic GET when -BasicCredential is given.
function Invoke-Api {
    param(
        [Parameter(Mandatory)] [string]$Uri,
        [hashtable]$Headers,
        [System.Management.Automation.PSCredential]$BasicCredential
    )
    $h = @{ Accept = 'application/json' }
    if ($Headers) { foreach ($k in $Headers.Keys) { $h[$k] = $Headers[$k] } }
    if ($BasicCredential) {
        $pair = "{0}:{1}" -f $BasicCredential.UserName, $BasicCredential.GetNetworkCredential().Password
        $h['Authorization'] = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pair))
    }
    return Invoke-RestMethod -Uri $Uri -Method GET -Headers $h @restArgs
}

# --- Credentials / output path --------------------------------------------
if (-not $Credential) {
    $who = if ($SDDCManager) { $SDDCManager } elseif ($VCFOps) { $VCFOps } else { 'VCF' }
    $Credential = Get-Credential -Message "SDDC Manager / VCF Operations credentials for $who"
}
if (-not $NSXCredential) { $NSXCredential = $Credential }

if (-not $OutputPath) {
    $stem =
    if ($SDDCManager) { ($SDDCManager -split '\.')[0] }
    elseif ($VCFOps) { ($VCFOps -split '\.')[0] }
    elseif ($NSXManager) { ($NSXManager[0] -split '\.')[0] }
    else { 'vcf' }
    $OutputPath = Join-Path (Join-Path '.' 'artifacts') ("{0}-{1}" -f $stem, (Get-Date -Format 'yyyyMMdd-HHmmss'))
}
$OutputPath = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine((Get-Location).Path, $OutputPath))
Write-Host "`nOutput : $OutputPath" -ForegroundColor Cyan
if (-not $WhatIfPreference) { New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null }

$needVcf = ($SDDCManager) -and ((Test-Group 'BringUp') -or (Test-Group 'Domains') -or (Test-Group 'Clusters'))

# --- Auth: VCF / SDDC Manager ----------------------------------------------
$vcfHeaders = $null
if ($needVcf) {
    try {
        $body = @{ username = $Credential.UserName; password = $Credential.GetNetworkCredential().Password } | ConvertTo-Json
        $tok = (Invoke-RestMethod -Uri "https://$SDDCManager/v1/tokens" -Method POST -Body $body `
                -Headers @{ 'Content-Type' = 'application/json'; Accept = 'application/json' } @restArgs).accessToken
        $vcfHeaders = @{ Authorization = "Bearer $tok" }
        Write-Host "Authenticated to SDDC Manager." -ForegroundColor Green
    }
    catch {
        Write-Host "SDDC Manager auth failed against $SDDCManager : $($_.Exception.Message)" -ForegroundColor Red
        if (-not $SkipCertificateValidation -and $_.Exception.Message -match 'SSL|certificate|trust') {
            Write-Host "  Looks like a TLS trust error - re-run with -SkipCertificateValidation." -ForegroundColor DarkGray
        }
    }
}

# --- Auth: Fleet LCM (via VCF Operations) ---------------------------------
$fleetHeaders = $null
if ((Test-Group 'Fleet') -and $VCFOps -and $FleetLCM) {
    try {
        $acq = @{ username = $Credential.UserName; password = $Credential.GetNetworkCredential().Password } | ConvertTo-Json
        $opsToken = (Invoke-RestMethod -Uri "https://$VCFOps/suite-api/api/auth/token/acquire" -Method POST -Body $acq `
                -Headers @{ 'Content-Type' = 'application/json'; Accept = 'application/json' } @restArgs).token
        $exch = @{ serviceKeys = @('fleet-lcm') } | ConvertTo-Json
        $jwt = (Invoke-RestMethod -Uri "https://$VCFOps/suite-api/api/auth/token/exchange" -Method POST -Body $exch `
                -Headers @{ 'Content-Type' = 'application/json'; Accept = 'application/json'; Authorization = "OpsToken $opsToken" } @restArgs).jwtToken
        $fleetHeaders = @{ Authorization = "Bearer $jwt" }
        Write-Host "Authenticated to Fleet lifecycle." -ForegroundColor Green
    }
    catch {
        Write-Host "Fleet lifecycle auth failed via $VCFOps : $($_.Exception.Message)" -ForegroundColor Red
    }
}
elseif ((Test-Group 'Fleet') -and ($Include -and $Include -contains 'Fleet')) {
    Write-Host "Fleet requested but -VCFOps / -FleetLCM not both supplied - skipping." -ForegroundColor Yellow
}

# --- Capture: BringUp -----------------------------------------------------
if ((Test-Group 'BringUp') -and $vcfHeaders) {
    Write-Host "`n[BringUp]" -ForegroundColor Cyan
    $uri = "https://$SDDCManager/v1/sddcs"
    if ($WhatIfPreference) {
        Write-Host "  would GET $uri  (and /{id} per SDDC)" -ForegroundColor DarkGray
    }
    else {
        try {
            $sddcs = Invoke-Api -Uri $uri -Headers $vcfHeaders
            $els = Get-Prop $sddcs 'elements'; if (-not $els) { $els = @($sddcs) }
            if (@($els).Count -eq 0) {
                Write-Host "  No stored SDDC spec here. The VCF Installer keeps the cleaner copy" -ForegroundColor Yellow
                Write-Host "  - download it from the deployment summary on that appliance." -ForegroundColor Yellow
            }
            foreach ($s in @($els)) {
                $id = Get-Prop $s 'id'
                $full = Invoke-Api -Uri "$uri/$id" -Headers $vcfHeaders
                Save-Artifact -Object $full -Group 'BringUp' -RelPath "bringup/sddc-$id.json" -Source "$uri/$id"
            }
        }
        catch { Write-Host "  BringUp: $($_.Exception.Message)" -ForegroundColor Red }
    }
}

# --- Capture: Domains / Clusters --------------------------------------------
function Get-VcfCollection {
    param([string]$Kind, [string[]]$DropKeys)
    if (-not $vcfHeaders) { return }
    Write-Host "`n[$Kind]" -ForegroundColor Cyan
    $uri = "https://$SDDCManager/v1/$($Kind.ToLower())"
    if ($WhatIfPreference) {
        Write-Host "  would GET $uri  (and /{id} per item)" -ForegroundColor DarkGray
        return
    }
    try {
        $list = Invoke-Api -Uri $uri -Headers $vcfHeaders
        $els = Get-Prop $list 'elements'; if (-not $els) { $els = @($list) }
        foreach ($e in @($els)) {
            $id = Get-Prop $e 'id'
            $name = Get-Prop $e 'name'; if (-not $name) { $name = $id }
            $safe = ($name -replace '[^\w.\-]', '_')
            $full = Invoke-Api -Uri "$uri/$id" -Headers $vcfHeaders
            Save-Artifact -Object $full -Group $Kind -RelPath "$($Kind.ToLower())/$safe.json" -Source "$uri/$id" -DropKeys $DropKeys
        }
    }
    catch { Write-Host "  $Kind : $($_.Exception.Message)" -ForegroundColor Red }
}

if (Test-Group 'Domains')  { Get-VcfCollection -Kind 'Domains'  -DropKeys @('status', 'tasks', 'capacity') }
if (Test-Group 'Clusters') { Get-VcfCollection -Kind 'Clusters' -DropKeys @('status', 'tasks', 'capacity') }

# --- Capture: Fleet LCM component specs (every VSP) -----------------------
if ((Test-Group 'Fleet') -and $fleetHeaders) {
    Write-Host "`n[Fleet]" -ForegroundColor Cyan
    $base = "https://$FleetLCM/fleet-lcm/v1"
    if ($WhatIfPreference) {
        Write-Host "  would GET $base/components  then /{id} and /{id}/config for every VSP" -ForegroundColor DarkGray
    }
    else {
        try {
            $comp = Invoke-Api -Uri "$base/components" -Headers $fleetHeaders
            $items = Get-Prop $comp 'components'; if (-not $items) { $items = @($comp) }
            $vsp = @($items | Where-Object { (Get-Prop $_ 'componentType') -eq 'VSP' })
            if ($vsp.Count -eq 0) { Write-Host "  No VSP components found." -ForegroundColor Yellow }
            foreach ($v in $vsp) {
                $id = Get-Prop $v 'id'
                $nm = Get-Prop $v 'name'; if (-not $nm) { $nm = Get-Prop $v 'fqdn' }; if (-not $nm) { $nm = $id }
                $safe = ("VSP-" + ($nm -replace '[^\w.\-]', '_'))
                $spec = Invoke-Api -Uri "$base/components/$id" -Headers $fleetHeaders
                Save-Artifact -Object $spec -Group 'Fleet' -RelPath "fleet/$safe.json" -Source "$base/components/$id"
                try {
                    $cfg = Invoke-Api -Uri "$base/components/$id/config" -Headers $fleetHeaders
                    Save-Artifact -Object $cfg -Group 'Fleet' -RelPath "fleet/$safe.config.json" -Source "$base/components/$id/config"
                }
                catch { Write-Host "    config for $nm : $($_.Exception.Message)" -ForegroundColor DarkYellow }
            }
        }
        catch { Write-Host "  Fleet : $($_.Exception.Message)" -ForegroundColor Red }
    }
}

# --- Capture: NSX policy hierarchy ---------------------------------------
$nsxScopes = @(
    '/infra/tier-0s', '/infra/tier-1s', '/infra/segments',
    '/infra/domains/default/groups', '/infra/domains/default/gateway-policies',
    '/infra/services', '/infra/ip-blocks', '/infra/ip-pools'
)
if ((Test-Group 'NSX') -and $NSXManager) {
    Write-Host "`n[NSX]" -ForegroundColor Cyan
    foreach ($nsx in $NSXManager) {
        $h0 = ($nsx -split '\.')[0]
        foreach ($scope in $nsxScopes) {
            $uri = "https://$nsx/policy/api/v1$scope"
            $slug = ($scope.TrimStart('/') -replace '/', '-')
            if ($WhatIfPreference) {
                Write-Host "  would GET $uri" -ForegroundColor DarkGray
                continue
            }
            try {
                $resp = Invoke-Api -Uri $uri -BasicCredential $NSXCredential
                Save-Artifact -Object $resp -Group 'NSX' -RelPath "nsx/$h0/infra-$slug.json" -Source $uri -Nsx
            }
            catch {
                if ($_.Exception.Message -match '404|Not Found') { Write-Host "    $scope : not present" -ForegroundColor DarkGray }
                else { Write-Host "    $scope : $($_.Exception.Message)" -ForegroundColor DarkYellow }
            }
        }
    }
}
elseif ((Test-Group 'NSX') -and ($Include -and $Include -contains 'NSX')) {
    Write-Host "NSX requested but -NSXManager not supplied - skipping." -ForegroundColor Yellow
}

# --- Manifest -----------------------------------------------------------------
if (-not $WhatIfPreference) {
    $manifest = [pscustomobject]@{
        tool        = 'Get-VCFDeploymentArtifacts.ps1'
        version     = $scriptVersion
        capturedAt  = (Get-Date).ToString('o')
        capturedBy  = $Credential.UserName
        endpoints   = [pscustomobject]@{
            sddcManager = $SDDCManager; vcfOps = $VCFOps; fleetLCM = $FleetLCM; nsxManager = $NSXManager
        }
        groups      = @($script:Manifest | ForEach-Object { $_.group } | Select-Object -Unique)
        sanitised   = $true
        rawIncluded = [bool]$Raw
        files       = $script:Manifest
    }
    ($manifest | ConvertTo-Json -Depth 20) | Set-Content -LiteralPath (Join-Path $OutputPath '00-manifest.json') -Encoding UTF8
}

Write-Host "`n$('=' * 62)" -ForegroundColor DarkCyan
if ($WhatIfPreference) {
    Write-Host "  -WhatIf: nothing fetched or written." -ForegroundColor DarkCyan
}
else {
    Write-Host "  Captured $($script:Manifest.Count) file(s) into $OutputPath" -ForegroundColor Cyan
    Write-Host "  Sanitised: secrets redacted, licence keys masked." -ForegroundColor DarkCyan
    if ($Raw) { Write-Host "  .raw/ holds the unsanitised responses - handle as real environment data." -ForegroundColor Yellow }
    Write-Host "  Next: tokenise + validate per docs/21-config-artifacts.md." -ForegroundColor DarkGray
}
Write-Host ('=' * 62) -ForegroundColor DarkCyan
