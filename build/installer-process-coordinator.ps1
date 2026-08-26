[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Status', 'RequestClose', 'WaitForExit', 'ForceClose')]
  [string]$Action,

  [Parameter(Mandatory = $true)]
  [string]$InstallDirectory,

  [Parameter(Mandatory = $true)]
  [string]$ExecutableName,

  [int]$ExcludeProcessId = 0,

  [ValidateRange(0, 60000)]
  [int]$TimeoutMilliseconds = 0,

  [ValidateRange(50, 5000)]
  [int]$PollMilliseconds = 250
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-CoordinatorEvent {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Event,
    [int[]]$ProcessIds = @(),
    [int[]]$UnresolvedProcessIds = @()
  )

  $payload = [ordered]@{
    event = $Event
    action = $Action
    processIds = @($ProcessIds | Sort-Object -Unique)
    unresolvedProcessIds = @($UnresolvedProcessIds | Sort-Object -Unique)
  }
  Write-Output ($payload | ConvertTo-Json -Compress)
}

function Test-PathInsideInstallDirectory {
  param(
    [Parameter(Mandatory = $true)]
    [string]$CandidatePath,
    [Parameter(Mandatory = $true)]
    [string]$InstallPrefix
  )

  try {
    $candidate = [System.IO.Path]::GetFullPath($CandidatePath)
    return $candidate.StartsWith($InstallPrefix, [System.StringComparison]::OrdinalIgnoreCase)
  } catch {
    return $false
  }
}

function Test-ManagedProcessIdentity {
  param(
    [Parameter(Mandatory = $true)]
    [object]$ProcessInfo,
    [Parameter(Mandatory = $true)]
    [string[]]$ManagedNames,
    [Parameter(Mandatory = $true)]
    [string]$InstallPrefix
  )

  return $ManagedNames -contains ([string]$ProcessInfo.Name) -and
    $ProcessInfo.ExecutablePath -and
    (Test-PathInsideInstallDirectory -CandidatePath ([string]$ProcessInfo.ExecutablePath) -InstallPrefix $InstallPrefix)
}

function Get-ManagedProcessSnapshot {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$ManagedNames,
    [Parameter(Mandatory = $true)]
    [string]$InstallPrefix,
    [int]$ExcludedProcessId = 0
  )

  $allProcesses = @(Get-CimInstance -ClassName Win32_Process | Where-Object {
    [int]$_.ProcessId -ne $ExcludedProcessId
  })
  [pscustomobject]@{
    Matched = @($allProcesses | Where-Object {
      Test-ManagedProcessIdentity -ProcessInfo $_ -ManagedNames $ManagedNames -InstallPrefix $InstallPrefix
    })
    Unresolved = @($allProcesses | Where-Object {
      -not $_.ExecutablePath -and $ManagedNames -contains ([string]$_.Name)
    })
  }
}

try {
  $normalizedInstallDirectory = [System.IO.Path]::GetFullPath($InstallDirectory)
  $trimCharacters = [char[]]@(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  )
  $installPrefix = $normalizedInstallDirectory.TrimEnd($trimCharacters) +
    [System.IO.Path]::DirectorySeparatorChar
  $managedNames = @(
    $ExecutableName,
    'rovai-core.exe',
    'rovai.exe'
  ) | Sort-Object -Unique

  if ($Action -eq 'WaitForExit') {
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    while ($true) {
      $inspection = Get-ManagedProcessSnapshot -ManagedNames $managedNames -InstallPrefix $installPrefix -ExcludedProcessId $ExcludeProcessId
      $matchedIds = @($inspection.Matched | ForEach-Object { [int]$_.ProcessId })
      $unresolvedIds = @($inspection.Unresolved | ForEach-Object { [int]$_.ProcessId })
      if ($matchedIds.Count -eq 0 -and $unresolvedIds.Count -eq 0) {
        Write-CoordinatorEvent -Event 'quiescent'
        exit 0
      }
      if ($stopwatch.ElapsedMilliseconds -ge $TimeoutMilliseconds) {
        Write-CoordinatorEvent -Event 'wait_expired' -ProcessIds $matchedIds -UnresolvedProcessIds $unresolvedIds
        if ($unresolvedIds.Count -gt 0) { exit 11 }
        exit 10
      }
      $remainingMilliseconds = $TimeoutMilliseconds - [int]$stopwatch.ElapsedMilliseconds
      Start-Sleep -Milliseconds ([Math]::Min($PollMilliseconds, $remainingMilliseconds))
    }
  }

  $inspection = Get-ManagedProcessSnapshot -ManagedNames $managedNames -InstallPrefix $installPrefix -ExcludedProcessId $ExcludeProcessId
  $matchedIds = @($inspection.Matched | ForEach-Object { [int]$_.ProcessId })
  $unresolvedIds = @($inspection.Unresolved | ForEach-Object { [int]$_.ProcessId })

  if ($Action -eq 'Status') {
    if ($unresolvedIds.Count -gt 0) {
      Write-CoordinatorEvent -Event 'identity_unresolved' -ProcessIds $matchedIds -UnresolvedProcessIds $unresolvedIds
      exit 11
    }
    if ($matchedIds.Count -gt 0) {
      Write-CoordinatorEvent -Event 'running' -ProcessIds $matchedIds
      exit 10
    }
    Write-CoordinatorEvent -Event 'quiescent'
    exit 0
  }

  if ($Action -eq 'RequestClose') {
    $requested = @()
    $requestErrors = @()
    foreach ($processId in $matchedIds) {
      try {
        $current = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $processId"
        if ($null -eq $current) { continue }
        if (-not (Test-ManagedProcessIdentity -ProcessInfo $current -ManagedNames $managedNames -InstallPrefix $installPrefix)) {
          $requestErrors += $processId
          continue
        }
        $process = Get-Process -Id $processId -ErrorAction Stop
        if ($process.MainWindowHandle -ne [IntPtr]::Zero -and $process.CloseMainWindow()) {
          $requested += $processId
        }
      } catch {
        if (Get-Process -Id $processId -ErrorAction SilentlyContinue) {
          $requestErrors += $processId
        }
      }
    }
    Write-CoordinatorEvent -Event 'close_requested' -ProcessIds $requested -UnresolvedProcessIds @($unresolvedIds + $requestErrors)
    if ($unresolvedIds.Count -gt 0 -or $requestErrors.Count -gt 0) { exit 11 }
    exit 0
  }

  $forceErrors = @()
  foreach ($processId in $matchedIds) {
    try {
      $current = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $processId"
      if ($null -eq $current) { continue }
      if (-not (Test-ManagedProcessIdentity -ProcessInfo $current -ManagedNames $managedNames -InstallPrefix $installPrefix)) {
        $forceErrors += $processId
        continue
      }
      Stop-Process -Id $processId -Force -ErrorAction Stop
    } catch {
      if (Get-Process -Id $processId -ErrorAction SilentlyContinue) {
        $forceErrors += $processId
      }
    }
  }
  Write-CoordinatorEvent -Event 'force_close_requested' -ProcessIds $matchedIds -UnresolvedProcessIds @($unresolvedIds + $forceErrors)
  if ($unresolvedIds.Count -gt 0 -or $forceErrors.Count -gt 0) { exit 11 }
  exit 0
} catch {
  Write-Error "Rovai installer process coordination failed: $($_.Exception.Message)"
  exit 20
}
