# Native Windows x64 installation. Stop this installation's Host before updating.
[CmdletBinding()]
param(
    [string]$Version = 'latest',
    [string]$FromDirectory,
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Programs\RovaiServer'),
    [switch]$NoModifyPath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([Environment]::OSVersion.Platform -ne 'Win32NT' -or [Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITECTURE') -ne 'AMD64') { throw 'Only native Windows x64 is currently supported.' }
if (-not [IO.Path]::IsPathRooted($InstallDirectory) -or $InstallDirectory -match '(^|[\\/])\.\.?([\\/]|$)') { throw 'InstallDirectory must be a normalized absolute directory.' }
$InstallDirectory = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\')
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$staging = Join-Path ([IO.Path]::GetTempPath()) ('rovai-server-install-' + [Guid]::NewGuid())
[void][IO.Directory]::CreateDirectory($staging)
$lease = $null
$incoming = $null
$releaseTag = $null
function Download([string]$Url, [string]$Path) {
    if (-not $Url.StartsWith('https://')) { throw 'HTTPS is required.' }
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Path -TimeoutSec 600
}
try {
    if ($Version -eq 'latest') {
        if ($FromDirectory) { throw 'FromDirectory requires Version.' }
        Download 'https://raw.githubusercontent.com/murray17/rovai-ai/main/scripts/server-release-tag.txt' (Join-Path $staging 'channel')
        $releaseTag = (Get-Content -Raw (Join-Path $staging 'channel')).Trim()
        if ($releaseTag -eq 'unpublished') { throw 'No official native Server release is published yet. Installation was not changed.' }
        if ($releaseTag -cmatch '^(?:server-v|v)([0-9]+\.[0-9]+\.[0-9]+)$') { $Version = $Matches[1] }
        else { throw 'Invalid Server release tag.' }
    } else {
        $releaseTag = if ($Version -in @('0.4.0', '0.4.1')) { "server-v$Version" } else { "v$Version" }
    }
    if ($Version -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$') { throw 'Invalid Server version.' }
    $asset = "rovai-server-$Version-windows-x64.zip"
    $archive = Join-Path $staging $asset
    $sums = Join-Path $staging 'SHA256SUMS'
    if ($FromDirectory) {
        Copy-Item -LiteralPath (Join-Path $FromDirectory $asset) -Destination $archive
        Copy-Item -LiteralPath (Join-Path $FromDirectory 'SHA256SUMS') -Destination $sums
    } else {
        $release = "https://github.com/murray17/rovai-ai/releases/download/$releaseTag"
        Download "$release/$asset" $archive
        Download "$release/SHA256SUMS" $sums
    }
    $matches_ = @(Get-Content $sums | Where-Object { $_ -cmatch ('^[0-9a-f]{64}  ' + [Regex]::Escape($asset) + '$') })
    if ($matches_.Count -ne 1) { throw 'Missing or duplicate archive checksum.' }
    $expected = $matches_[0].Substring(0, 64)
    # Use the framework directly: Windows PowerShell can inherit a PowerShell 7
    # module path that does not expose the Get-FileHash script module.
    $hasher = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($archive)
    try { $actual = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $hasher.Dispose() }
    if ($actual -cne $expected) { throw 'Archive checksum mismatch; installation unchanged.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try {
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName.Replace('\', '/')
            $unixType = ($entry.ExternalAttributes -shr 16) -band 0xF000
            if ($name -cnotmatch '^rovai-server/[A-Za-z0-9_./-]*$' -or $name -match '(^|/)\.\.?($|/)' -or $unixType -notin @(0, 0x8000, 0x4000)) { throw "Unsafe archive member: $name" }
        }
    } finally { $zip.Dispose() }
    [IO.Compression.ZipFile]::ExtractToDirectory($archive, $staging)
    $payload = Join-Path $staging 'rovai-server'
    $info = @(Get-Content (Join-Path $payload 'package-info'))
    if ($info -cnotcontains "version=$Version" -or $info -cnotcontains 'target=windows-x64' -or -not (Test-Path -LiteralPath (Join-Path $payload 'web-ui\index.html') -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $payload 'skills\cli-operations\SKILL.md') -PathType Leaf)) { throw 'Package version, target, WebUI, or bundled Skills mismatch.' }
    $reportedVersion = & (Join-Path $payload 'rovai-server.exe') --version
    if ($LASTEXITCODE -ne 0 -or $reportedVersion -cne "rovai-server $Version") { throw 'Host/package mismatch or missing native dependency.' }
    $marker = Join-Path $InstallDirectory 'INSTALLER-V1'
    if (Test-Path -LiteralPath $InstallDirectory) {
        if ((Get-Item -LiteralPath $InstallDirectory).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Installation directory cannot be a reparse point.' }
        if (-not (Test-Path -LiteralPath $marker -PathType Leaf) -or (Get-Content -Raw $marker).Trim() -cne 'rovai-server') { throw 'Program directory is not an installer-owned installation.' }
    } else {
        [void][IO.Directory]::CreateDirectory($InstallDirectory)
        [IO.File]::WriteAllText($marker, "rovai-server`n")
    }
    try { $lease = [IO.File]::Open((Join-Path $InstallDirectory '.install-lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
    catch { throw 'Another installation is in progress.' }
    foreach ($process_ in @(Get-Process -Name 'rovai-server', 'rovai-host' -ErrorAction SilentlyContinue)) {
        if ($process_.Path -and $process_.Path.StartsWith($InstallDirectory + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Stop this Server before updating. The installer does not terminate running Hosts.' }
    }
    $current = Join-Path $InstallDirectory 'current'
    if (Test-Path -LiteralPath $current) {
        if ((Get-Item -LiteralPath $current).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Current program directory cannot be a reparse point.' }
    }
    $incoming = Join-Path $InstallDirectory ('.incoming-' + [Guid]::NewGuid())
    Copy-Item -LiteralPath $payload -Destination $incoming -Recurse
    $previous = Join-Path $InstallDirectory ('.previous-' + [Guid]::NewGuid())
    $hadPrevious = Test-Path -LiteralPath $current
    if ($hadPrevious) { [IO.Directory]::Move($current, $previous) }
    try { [IO.Directory]::Move($incoming, $current); $incoming = $null }
    catch { if ($hadPrevious) { [IO.Directory]::Move($previous, $current) }; throw }
    if ($hadPrevious) { Remove-Item -LiteralPath $previous -Recurse -Force }
    if (-not $NoModifyPath) {
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        if (@($userPath -split ';') -notcontains $current) { [Environment]::SetEnvironmentVariable('Path', ($current + ';' + $userPath), 'User') }
        Write-Output "Open a new terminal, or run: `$env:Path = '$current;' + `$env:Path"
    }
    Write-Output "Installed Rovai Server $Version (windows-x64). Run rovai-server. Data is selected at launch with --data-dir; installation does not open it."
} finally {
    if ($incoming -and (Test-Path -LiteralPath $incoming)) { Remove-Item -LiteralPath $incoming -Recurse -Force }
    if ($lease) { $lease.Dispose() }
    Remove-Item -LiteralPath $staging -Recurse -Force
}
