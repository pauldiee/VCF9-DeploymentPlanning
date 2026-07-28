#Requires -Version 5.1
<#
.SYNOPSIS
    Configures network coredump (ESXi Dump Collector) on every host in a
    vCenter, or a chosen subset, pointing them at a Dump Collector server.

.DESCRIPTION
    Automates the per-host half of docs/11-esx-coredump.md: for each ESX host
    reachable through the given vCenter, sets the coredump network target
    (esxcli system coredump network set), enables it, and runs the built-in
    check. Confirms the vSphereCoredumpClient firewall ruleset is enabled
    while it is at it.

    THIS SCRIPT DOES NOT ENABLE THE DUMP COLLECTOR SERVICE ON VCENTER. That
    service (VMware vSphere ESXi Dump Collector / vmware-netdumper) ships
    stopped by default and has to be started once, separately, either from
    the vCenter Server Management interface (VAMI, port 5480) or over SSH to
    the VCSA (service-control --start vmware-netdumper; --enable to persist
    across reboot). Do that first -- see docs/11-esx-coredump.md section 1.
    This script assumes it is already running and listening on the target
    you pass in -CollectorAddress.

    Requires the VMware.PowerCLI module (Get-EsxCli -V2). The connection
    itself is left to the caller -- run Connect-VIServer first, or pass
    -VCenter/-Credential and this script connects for you and disconnects
    when it finishes.

    THIS SCRIPT WRITES TO EVERY HOST. It supports -WhatIf, which prints what
    would change per host without sending anything.

.NOTES
    Script  : Set-ESXCoredump.ps1
    Version : 1.1.1
    Author  : Paul van Dieen
    Blog    : https://www.hollebollevsan.nl
    Requires: PowerShell 5.1+ (Windows PowerShell) or PowerShell 7+, VMware.PowerCLI
    Tested  : VCF 9.1

.CHANGELOG
    v1.1.1  2026-07-28  PD  -VCenter now always prompts when not passed on the
                            command line, even with an existing PowerCLI
                            connection, instead of silently reusing it (#221)
    v1.1.0  2026-07-28  PD  Prompt clearly for every input not supplied on the
                            command line, instead of relying on PowerShell's
                            unlabeled default mandatory-parameter prompt (#221)
    v1.0.0  2026-07-27  PD  Initial release -- per-host esxcli coredump network sweep (#221)

.PARAMETER VCenter
    FQDN or IP of the vCenter to connect to. If omitted, the script always
    prompts for it -- even when a PowerCLI connection already exists, so it
    never silently assumes that's the right one. Leave the prompt blank to
    use the existing connection instead (shown in the prompt); in that case
    nothing is disconnected when the script finishes.

.PARAMETER Credential
    Credentials for -VCenter. Prompted for if -VCenter is given (or entered
    at the prompt) without it.

.PARAMETER CollectorAddress
    FQDN or IP of the Dump Collector server every host will be pointed at --
    typically the vCenter itself, or a standalone ESXi Dump Collector.
    Prompted for if not supplied.

.PARAMETER CollectorPort
    UDP port the Dump Collector listens on. Defaults to 6500. Prompted for
    if not supplied (press Enter to accept the default).

.PARAMETER InterfaceName
    VMkernel interface each host sends coredump traffic from. Defaults to
    vmk0 (the usual management interface) -- override if the management
    VMkernel is not vmk0 on this build. Prompted for if not supplied (press
    Enter to accept the default).

.PARAMETER VMHost
    One or more host names/FQDNs to target instead of every host in the
    vCenter. Accepts pipeline input. If not supplied (and nothing is piped
    in), the script prompts whether to target every host or a comma-
    separated subset.

.PARAMETER SkipFirewallCheck
    Skip confirming/enabling the vSphereCoredumpClient firewall ruleset per
    host.

.EXAMPLE
    .\Set-ESXCoredump.ps1 -VCenter vc01.sfo.example.io -CollectorAddress vc01.sfo.example.io -WhatIf

    Connects to vc01, shows what would be set on every host (pointing them
    back at vc01's own Dump Collector service), and changes nothing.

.EXAMPLE
    .\Set-ESXCoredump.ps1 -VCenter vc01.sfo.example.io -CollectorAddress collector01.sfo.example.io -CollectorPort 6500

    Connects to vc01 and points every host at a standalone Dump Collector.

.EXAMPLE
    Get-VMHost -Location Cluster01 | .\Set-ESXCoredump.ps1 -CollectorAddress vc01.sfo.example.io

    Uses an existing PowerCLI session (already connected) and only touches
    the hosts in Cluster01, piped in.
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [string]$VCenter,
    [System.Management.Automation.PSCredential]$Credential,
    [string]$CollectorAddress,
    [int]$CollectorPort,
    [string]$InterfaceName,
    [Parameter(ValueFromPipeline)] [string[]]$VMHost,
    [switch]$SkipFirewallCheck
)

begin {
    $scriptVersion = '1.1.1'
    $scriptAuthor  = 'Paul van Dieen'
    $scriptBlogUrl = 'https://www.hollebollevsan.nl'

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    Write-Host ('=' * 62) -ForegroundColor DarkCyan
    Write-Host "  Set-ESXCoredump v$scriptVersion" -ForegroundColor Cyan
    Write-Host "  $scriptAuthor - $scriptBlogUrl" -ForegroundColor DarkCyan
    Write-Host ('=' * 62) -ForegroundColor DarkCyan

    Write-Host "`nAssumes the Dump Collector SERVICE is already enabled on the vCenter/collector" -ForegroundColor Yellow
    Write-Host "side (VAMI > Services > VMware vSphere ESXi Dump Collector > Start, or" -ForegroundColor Yellow
    Write-Host "'service-control --start vmware-netdumper' over SSH). This script only" -ForegroundColor Yellow
    Write-Host "configures the per-host client side. See docs/11-esx-coredump.md." -ForegroundColor Yellow

    if (-not (Get-Module -ListAvailable -Name VMware.PowerCLI -ErrorAction SilentlyContinue) -and
        -not (Get-Module -Name VMware.VimAutomation.Core -ErrorAction SilentlyContinue)) {
        Write-Host "`nVMware.PowerCLI is not available. Install it first:" -ForegroundColor Red
        Write-Host "  Install-Module VMware.PowerCLI -Scope CurrentUser" -ForegroundColor White
        exit 1
    }

    Write-Host "`n--- Inputs ---" -ForegroundColor White

    # -VCenter: always prompt if not passed on the command line, even when a
    # PowerCLI connection already exists -- don't silently assume it's the
    # right one.
    if (-not $PSBoundParameters.ContainsKey('VCenter')) {
        $existing = $global:DefaultVIServers -join ', '
        $prompt = if ($existing) {
            "vCenter FQDN or IP to connect to (leave blank to use the existing connection: $existing)"
        }
        else {
            "vCenter FQDN or IP to connect to (REQUIRED -- no existing PowerCLI connection found)"
        }
        $VCenter = Read-Host $prompt
        while (-not $VCenter -and -not $existing) {
            $VCenter = Read-Host $prompt
        }
    }

    $ownsConnection = $false
    if ($VCenter) {
        if (-not $Credential) {
            $Credential = Get-Credential -Message "vCenter credentials for $VCenter"
        }
        try {
            Connect-VIServer -Server $VCenter -Credential $Credential -ErrorAction Stop | Out-Null
            $ownsConnection = $true
            Write-Host "Connected to $VCenter." -ForegroundColor Green
        }
        catch {
            Write-Host "`nCould not connect to $VCenter : $($_.Exception.Message)" -ForegroundColor Red
            exit 1
        }
    }
    elseif (-not $global:DefaultVIServers -or $global:DefaultVIServers.Count -eq 0) {
        Write-Host "`nNo vCenter given and no existing PowerCLI connection found." -ForegroundColor Red
        Write-Host "  Either pass -VCenter, or run Connect-VIServer first." -ForegroundColor DarkGray
        exit 1
    }
    else {
        Write-Host "Using existing PowerCLI connection: $($global:DefaultVIServers -join ', ')" -ForegroundColor Green
    }

    # -CollectorAddress: mandatory, so keep prompting until something is entered.
    if (-not $PSBoundParameters.ContainsKey('CollectorAddress') -or -not $CollectorAddress) {
        while (-not $CollectorAddress) {
            $CollectorAddress = Read-Host "Dump Collector server address (FQDN or IP) -- this is REQUIRED"
        }
    }

    # -CollectorPort: optional, defaults to 6500.
    if (-not $PSBoundParameters.ContainsKey('CollectorPort')) {
        $portInput = Read-Host "Dump Collector UDP port [default: 6500]"
        $CollectorPort = if ($portInput) { [int]$portInput } else { 6500 }
    }
    elseif (-not $CollectorPort) {
        $CollectorPort = 6500
    }

    # -InterfaceName: optional, defaults to vmk0.
    if (-not $PSBoundParameters.ContainsKey('InterfaceName')) {
        $ifaceInput = Read-Host "VMkernel interface to send coredump traffic from [default: vmk0]"
        $InterfaceName = if ($ifaceInput) { $ifaceInput } else { 'vmk0' }
    }
    elseif (-not $InterfaceName) {
        $InterfaceName = 'vmk0'
    }

    Write-Host "`n--- Confirmed settings ---" -ForegroundColor White
    Write-Host "  vCenter        : $(if ($VCenter) { $VCenter } else { '(existing connection)' })" -ForegroundColor Cyan
    Write-Host "  Collector      : $CollectorAddress`:$CollectorPort" -ForegroundColor Cyan
    Write-Host "  Interface      : $InterfaceName" -ForegroundColor Cyan
    Write-Host ('=' * 62) -ForegroundColor DarkCyan

    $targets = New-Object System.Collections.Generic.List[object]
    $results = New-Object System.Collections.Generic.List[object]
    $vmHostParamBound = $PSBoundParameters.ContainsKey('VMHost')
}

process {
    if ($VMHost) {
        foreach ($h in $VMHost) { $targets.Add($h) }
    }
}

end {
    try {
        if ($targets.Count -eq 0 -and -not $vmHostParamBound) {
            $scopeInput = Read-Host "Target ALL hosts in the vCenter, or a SUBSET? Enter 'A' for all, or a comma-separated list of host names/FQDNs [default: A]"
            if ($scopeInput -and $scopeInput.Trim() -notmatch '^(a|all)$') {
                foreach ($h in ($scopeInput -split ',')) {
                    $h = $h.Trim()
                    if ($h) { $targets.Add($h) }
                }
            }
        }

        if (-not $PSBoundParameters.ContainsKey('SkipFirewallCheck')) {
            $fwInput = Read-Host "Confirm/enable the vSphereCoredumpClient firewall ruleset on each host? (Y/n) [default: Y]"
            if ($fwInput -and $fwInput.Trim() -match '^n') { $SkipFirewallCheck = $true }
        }

        if ($targets.Count -gt 0) {
            $hosts = $targets | ForEach-Object { Get-VMHost -Name $_ }
        }
        else {
            $hosts = Get-VMHost
        }

        if (-not $hosts -or @($hosts).Count -eq 0) {
            Write-Host "`nNo hosts found to configure." -ForegroundColor Yellow
            return
        }

        Write-Host "`nHosts to configure: $(@($hosts).Count)" -ForegroundColor Cyan

        foreach ($esxHost in $hosts) {
            $hostName = $esxHost.Name
            $status   = 'OK'
            $detail   = ''

            $action = "Set coredump network target to $CollectorAddress`:$CollectorPort on $InterfaceName, enable it$(if (-not $SkipFirewallCheck) { ', confirm firewall ruleset' })"
            if (-not $PSCmdlet.ShouldProcess($hostName, $action)) {
                $results.Add([pscustomobject]@{ Host = $hostName; Status = 'Skipped (WhatIf)'; Detail = $action })
                continue
            }

            try {
                $esxcli = Get-EsxCli -VMHost $esxHost -V2 -ErrorAction Stop

                $setArgs = $esxcli.system.coredump.network.set.CreateArgs()
                $setArgs.interfacename = $InterfaceName
                $setArgs.serverip      = $CollectorAddress
                $setArgs.serverport    = $CollectorPort
                $esxcli.system.coredump.network.set.Invoke($setArgs) | Out-Null

                $enableArgs = $esxcli.system.coredump.network.set.CreateArgs()
                $enableArgs.enable = $true
                $esxcli.system.coredump.network.set.Invoke($enableArgs) | Out-Null

                if (-not $SkipFirewallCheck) {
                    $ruleset = $esxcli.network.firewall.ruleset.list.Invoke() |
                        Where-Object { $_.Name -eq 'vSphereCoredumpClient' }
                    if ($ruleset -and $ruleset.Enabled -eq $false) {
                        $fwArgs = $esxcli.network.firewall.ruleset.set.CreateArgs()
                        $fwArgs.rulesetid = 'vSphereCoredumpClient'
                        $fwArgs.enabled   = $true
                        $esxcli.network.firewall.ruleset.set.Invoke($fwArgs) | Out-Null
                        $detail = 'Firewall ruleset was disabled, enabled it.'
                    }
                }

                $checkResult = $esxcli.system.coredump.network.check.Invoke()
                $detail = ($detail + ' ' + ($checkResult -join ' ')).Trim()
            }
            catch {
                $status = 'FAILED'
                $detail = $_.Exception.Message
            }

            $results.Add([pscustomobject]@{ Host = $hostName; Status = $status; Detail = $detail })
        }
    }
    finally {
        if ($ownsConnection -and $VCenter) {
            Disconnect-VIServer -Server $VCenter -Confirm:$false -ErrorAction SilentlyContinue
        }
    }

    Write-Host "`nResults:" -ForegroundColor White
    $results | Format-Table -AutoSize | Out-String | Write-Host

    $failed = @($results | Where-Object { $_.Status -eq 'FAILED' })
    Write-Host "`n$('=' * 62)" -ForegroundColor DarkCyan
    if ($failed.Count -gt 0) {
        Write-Host "  Done with $($failed.Count) failure(s)." -ForegroundColor Red
    }
    else {
        Write-Host "  Done." -ForegroundColor DarkCyan
    }
    Write-Host ('=' * 62) -ForegroundColor DarkCyan

    if ($failed.Count -gt 0) { exit 1 }
}
