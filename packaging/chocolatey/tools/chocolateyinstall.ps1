$ErrorActionPreference = 'Stop'

if (-not [Environment]::Is64BitOperatingSystem -or $env:ChocolateyForceX86 -eq 'true') {
  throw 'Nebula DBA requires 64-bit Windows.'
}

$toolsDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$executable = Join-Path $toolsDir 'nebula-dba-tools.exe'
$packageArgs = @{
  packageName    = 'nebula-dba-tools'
  fileFullPath   = $executable
  url64bit       = 'https://github.com/Porkstone/nebula-dba-tools/releases/download/v0.1.0/Nebula-DBA-0.1.0.exe'
  checksum64     = 'dcbea855038c9377a15474a7d50b6069dcadeeabd9b474b90d8e883119d77dcd'
  checksumType64 = 'sha256'
}

Get-ChocolateyWebFile @packageArgs | Out-Null
New-Item -Path "$executable.gui" -ItemType File -Force | Out-Null

$shortcut = Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'Nebula DBA.lnk'
Install-ChocolateyShortcut -ShortcutFilePath $shortcut -TargetPath $executable -WorkingDirectory $toolsDir
