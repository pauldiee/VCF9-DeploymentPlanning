<#
.SYNOPSIS
  Captures the Planning and Preparation Workbook's own sizing results as a
  golden test set for the sizing engine (web/src/lib/mgmt-sizing.ts).

.DESCRIPTION
  Drives Excel (COM) over a COPY of the workbook. For every scenario in
  scenarios.json it resets the inputs on 'Management Domain Sizing' to the
  baseline, applies the scenario's cells, recalculates, and records every
  component row (J:M, rows 8-30) plus the host / capacity summary (R8,
  R15-R20, row 32 totals). The reference workbook itself is never modified.

  To refresh after a new workbook revision:
    1. python scenarios.py                       (writes scenarios.json)
    2. powershell -File Get-SizerGolden.ps1 -Revision <vX.Y.Z.NNN>
    3. node ../verify-sizer.mjs                 (engine vs. golden)

  Runs under Windows PowerShell 5.1 or 7 with Excel installed. Cell writes go
  through reflection (InvokeMember) because PowerShell's COM binder caches the
  first value type it sees on Range.Value2 and then rejects later types.
  Only the Excel process this script starts is closed afterwards.

.NOTES
  Version: 1.0.0
#>
param(
  [string]$Workbook = (Join-Path $PSScriptRoot '..\..\..\reference\vcf-9.1.1-planning-and-preparation-workbook.xlsx'),
  [string]$Revision = 'v1.9.1.102',
  [string]$OutFile = (Join-Path $PSScriptRoot "..\..\test\sizer-golden-$Revision.json")
)
$ErrorActionPreference = 'Stop'
$copy = Join-Path $env:TEMP ("sizer-golden-" + [guid]::NewGuid() + '.xlsx')
Copy-Item (Resolve-Path $Workbook) $copy -Force
$spec = Get-Content (Join-Path $PSScriptRoot 'scenarios.json') -Raw | ConvertFrom-Json

$before = @(Get-Process EXCEL -ErrorAction SilentlyContinue | ForEach-Object Id)
$xl = New-Object -ComObject Excel.Application
$ownPid = @(Get-Process EXCEL -ErrorAction SilentlyContinue | Where-Object { $before -notcontains $_.Id } | ForEach-Object Id)
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.ScreenUpdating = $false

function Num($v) {
  if ($null -eq $v -or ($v -is [string] -and $v -eq '')) { return 0 }
  if ($v -is [string]) { $d = 0; if ([double]::TryParse(($v -replace '[^0-9.\-]', ''), [ref]$d)) { return $d }; return $v }
  return [double]$v
}

$results = @()
try {
  $wb = $xl.Workbooks.Open($copy)
  $ws = $wb.Worksheets.Item('Management Domain Sizing')
  $xl.Calculation = -4135   # manual while inputs are set

  function Set-Cells($obj) {
    foreach ($p in $obj.PSObject.Properties) {
      $v = $p.Value
      $val = if ($v -is [ValueType]) { [double]$v } else { [string]$v }
      try {
        $rng = $ws.Range([string]$p.Name)
        [void][System.__ComObject].InvokeMember('Value2', [System.Reflection.BindingFlags]::SetProperty, $null, $rng, @($val))
      } catch { throw "cell $($p.Name) value '$v': $($_.Exception.Message)" }
    }
  }

  foreach ($sc in $spec.scenarios) {
    Set-Cells $spec.base
    Set-Cells $sc.cells
    $xl.CalculateFull()
    $rows = @()
    foreach ($r in 8..30) {
      $rows += [pscustomobject]@{ row = $r; label = [string]$ws.Range("G$r").Value2
        nodes = Num $ws.Range("J$r").Value2; cpu = Num $ws.Range("K$r").Value2
        ram = Num $ws.Range("L$r").Value2; disk = Num $ws.Range("M$r").Value2 }
    }
    $sum = [pscustomobject]@{
      hosts = Num $ws.Range('R8').Value2; vmCapacity = Num $ws.Range('R15').Value2; swap = Num $ws.Range('R16').Value2
      interim = Num $ws.Range('R17').Value2; redundancy = Num $ws.Range('R18').Value2
      reserve = Num $ws.Range('R19').Value2; growth = Num $ws.Range('R20').Value2
      totalNodes = Num $ws.Range('J32').Value2; totalCpu = Num $ws.Range('K32').Value2
      totalRam = Num $ws.Range('L32').Value2; totalDisk = Num $ws.Range('M32').Value2 }
    $results += [pscustomobject]@{ name = $sc.name; cells = $sc.cells; rows = $rows; summary = $sum }
  }
  $wb.Close($false)
} finally {
  try { $xl.Quit() } catch {}
  foreach ($id in $ownPid) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  Remove-Item $copy -Force -ErrorAction SilentlyContinue
}
$results | ConvertTo-Json -Depth 6 | Set-Content $OutFile -Encoding utf8
"$($results.Count) scenarios captured -> $OutFile"
