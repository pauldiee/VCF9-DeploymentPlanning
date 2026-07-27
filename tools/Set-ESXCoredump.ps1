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
    Version : 1.0.0
    Author  : Paul van Dieen
    Blog    : https://www.hollebollevsan.nl
    Requires: PowerShell 5.1+ (Windows PowerShell) or PowerShell 7+, VMware.PowerCLI
    Tested  : VCF 9.1

.CHANGELOG
    v1.0.0  2026-07-27  PD  Initial release -- per-host esxcli coredump network sweep (#221)

.PARAMETER VCenter
    FQDN or IP of the vCenter to connect to. If omitted, the script uses an
    existing PowerCLI connection (from Connect-VIServer) instead of making
    its own -- in that case -VCenter is ignored and nothing is disconnected
    when the script finishes.

.PARAMETER Credential
    Credentials for -VCenter. Prompted for if -VCenter is given without it.

.PARAMETER CollectorAddress
    FQDN or IP of the Dump Collector server every host will be pointed at --
    typically the vCenter itself, or a standalone ESXi Dump Collector.

.PARAMETER CollectorPort
    UDP port the Dump Collector listens on. Defaults to 6500.

.PARAMETER InterfaceName
    VMkernel interface each host sends coredump traffic from. Defaults to
    vmk0 (the usual management interface) -- override if the management
    VMkernel is not vmk0 on this build.

.PARAMETER VMHost
    One or more host names/FQDNs to target instead of every host in the
    vCenter. Accepts pipeline input.

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
    [Parameter(Mandatory)] [string]$CollectorAddress,
    [int]$CollectorPort = 6500,
    [string]$InterfaceName = 'vmk0',
    [Parameter(ValueFromPipeline)] [string[]]$VMHost,
    [switch]$SkipFirewallCheck
)

begin {
    $scriptVersion = '1.0.0'
    $scriptAuthor  = 'Paul van Dieen'
    $scriptBlogUrl = 'https://www.hollebollevsan.nl'

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    Write-Host ('=' * 62) -ForegroundColor DarkCyan
    Write-Host "  Set-ESXCoredump v$scriptVersion" -ForegroundColor Cyan
    Write-Host "  $scriptAuthor - $scriptBlogUrl" -ForegroundColor DarkCyan
    Write-Host "  Collector      : $CollectorAddress`:$CollectorPort" -ForegroundColor Cyan
    Write-Host "  Interface      : $InterfaceName" -ForegroundColor Cyan
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

    $ownsConnection = $false
    if ($VCenter) {
        if (-not $Credential) {
            $Credential = Get-Credential -Message "vCenter credentials for $VCenter"
        }
        try {
            Connect-VIServer -Server $VCenter -Credential $Credential -ErrorAction Stop | Out-Null
            $ownsConnection = $true
            Write-Host "`nConnected to $VCenter." -ForegroundColor Green
        }
        catch {
            Write-Host "`nCould not connect to $VCenter : $($_.Exception.Message)" -ForegroundColor Red
            exit 1
        }
    }
    elseif (-not $global:DefaultVIServers -or $global:DefaultVIServers.Count -eq 0) {
        Write-Host "`nNo -VCenter given and no existing PowerCLI connection found." -ForegroundColor Red
        Write-Host "  Either pass -VCenter, or run Connect-VIServer first." -ForegroundColor DarkGray
        exit 1
    }

    $targets = New-Object System.Collections.Generic.List[object]
    $results = New-Object System.Collections.Generic.List[object]
}

process {
    if ($VMHost) {
        foreach ($h in $VMHost) { $targets.Add($h) }
    }
}

end {
    try {
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
