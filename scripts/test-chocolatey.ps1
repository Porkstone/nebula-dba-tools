param(
  [string]$PackagePath = "$PSScriptRoot/../release/chocolatey/nebula-dba-tools.0.1.0.nupkg"
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$sandbox = Join-Path $repoRoot "test-results/chocolatey-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $sandbox -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory((Resolve-Path $PackagePath).Path, $sandbox)
$toolsDir = Join-Path $sandbox 'tools'
$shortcutDir = Join-Path $sandbox 'shortcuts'
New-Item -ItemType Directory -Path $shortcutDir | Out-Null

$previousEnvironment = @{}
$testEnvironment = @{
  ChocolateyPackageName = 'nebula-dba-tools'
  ChocolateyPackageVersion = '0.1.0'
  ChocolateyPackageFolder = $sandbox
  ChocolateyForceX86 = $null
}
foreach ($name in $testEnvironment.Keys) {
  $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
  [Environment]::SetEnvironmentVariable($name, $testEnvironment[$name], 'Process')
}

try {
  Import-Module "$env:ChocolateyInstall/helpers/chocolateyInstaller.psm1" -Force
  & {
    function Join-Path {
      param([string]$Path, [string]$ChildPath)
      if ($Path -eq [Environment]::GetFolderPath('CommonPrograms')) {
        $Path = $shortcutDir
      }
      Microsoft.PowerShell.Management\Join-Path -Path $Path -ChildPath $ChildPath
    }

    $env:ChocolateyForceX86 = 'true'
    $rejectedX86 = $false
    try { & "$toolsDir/chocolateyinstall.ps1" }
    catch {
      if ($_.Exception.Message -notmatch 'requires 64-bit Windows') { throw }
      $rejectedX86 = $true
    }
    if (-not $rejectedX86) { throw 'The package accepted a forced x86 installation.' }
    Remove-Item Env:ChocolateyForceX86

    & "$toolsDir/chocolateyinstall.ps1"
    $executable = Microsoft.PowerShell.Management\Join-Path $toolsDir 'nebula-dba-tools.exe'
    if (-not (Test-Path "$executable.gui")) { throw 'The GUI shim marker is missing.' }
    $shortcutPath = Microsoft.PowerShell.Management\Join-Path $shortcutDir 'Nebula DBA.lnk'
    if (-not (Test-Path $shortcutPath)) { throw 'The Start menu shortcut is missing.' }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    if ($shortcut.TargetPath -ne $executable) { throw 'The shortcut points at the wrong executable.' }
    if ($shortcut.WorkingDirectory -ne $toolsDir) { throw 'The shortcut has the wrong working directory.' }

    $shimPath = Microsoft.PowerShell.Management\Join-Path $sandbox 'nebula-dba-tools.exe'
    & "$env:ChocolateyInstall/tools/shimgen.exe" "--output=$shimPath" "--path=$executable" --gui
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $shimPath)) { throw 'GUI shim generation failed.' }

    & "$toolsDir/chocolateyuninstall.ps1"
    if (Test-Path $shortcutPath) { throw 'Uninstall left the Start menu shortcut behind.' }
    & "$toolsDir/chocolateyuninstall.ps1"
  }
  Write-Output "PASS: real release download and checksum, x86 rejection, shortcut target, GUI shim generation, and repeatable shortcut removal. Artifacts: $sandbox"
  Write-Output 'Shortcut paths were redirected into the sandbox. This does not replace a full elevated Chocolatey install/upgrade/uninstall test in a disposable VM.'
}
finally {
  foreach ($name in $previousEnvironment.Keys) {
    [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
  }
}
