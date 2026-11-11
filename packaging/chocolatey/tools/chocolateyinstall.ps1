$ErrorActionPreference = 'Stop'

if (-not [Environment]::Is64BitOperatingSystem -or $env:ChocolateyForceX86 -eq 'true') {
  throw 'Nebula DBA requires 64-bit Windows.'
}

$toolsDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$executable = Join-Path $toolsDir 'nebula-dba-tools.exe'
$packageArgs = @{
  packageName    = 'nebula-dba-tools'
  fileFullPath   = $executable
  url64bit       = 'https://github.com/Porkstone/nebula-dba-tools/releases/download/v0.2.0-beta.1/nebula-dba-tools-0.2.0-beta.1.exe'
  checksum64     = '643420a09fa0745deb1946efb94ddf653ac86d4aeed37974bccc4761569a1209'
  checksumType64 = 'sha256'
}

Get-ChocolateyWebFile @packageArgs | Out-Null
New-Item -Path "$executable.gui" -ItemType File -Force | Out-Null

$shortcut = Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'Nebula DBA.lnk'
Install-ChocolateyShortcut -ShortcutFilePath $shortcut -TargetPath $executable -WorkingDirectory $toolsDir
