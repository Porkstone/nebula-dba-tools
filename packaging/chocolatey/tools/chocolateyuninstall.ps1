$ErrorActionPreference = 'Stop'

$shortcut = Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'Nebula DBA.lnk'
if (Test-Path -LiteralPath $shortcut) {
  Remove-Item -LiteralPath $shortcut -Force
}
