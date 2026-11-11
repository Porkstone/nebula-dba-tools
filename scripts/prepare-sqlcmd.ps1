$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repoRoot = Split-Path -Parent $PSScriptRoot
$manifestRoot = Join-Path $repoRoot 'third-party/sqlcmd'
$manifest = Get-Content (Join-Path $manifestRoot 'manifest.json') -Raw | ConvertFrom-Json
$outputDir = Join-Path $repoRoot 'vendor/sqlcmd'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$executable = Join-Path $outputDir 'sqlcmd.exe'
$notices = Join-Path $outputDir 'NOTICE.md'
$valid = (Test-Path -LiteralPath $executable) -and (Test-Path -LiteralPath $notices)
if ($valid) {
  $valid = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash -eq $manifest.executableSha256 -and
    (Get-FileHash -LiteralPath $notices -Algorithm SHA256).Hash -eq $manifest.noticeSha256
}
if (-not $valid) {
  $archivePath = Join-Path $outputDir 'sqlcmd-download.zip'
  try {
    Invoke-WebRequest -Uri $manifest.url -OutFile $archivePath -UseBasicParsing
    if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ne $manifest.sha256) {
      throw 'The Microsoft SQLCMD archive failed SHA-256 validation.'
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
      foreach ($name in @('sqlcmd.exe', 'NOTICE.md')) {
        $entry = $archive.GetEntry($name)
        if (-not $entry) { throw "The SQLCMD archive is missing $name." }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $outputDir $name), $true)
      }
    } finally { $archive.Dispose() }
    if ((Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash -ne $manifest.executableSha256 -or
        (Get-FileHash -LiteralPath $notices -Algorithm SHA256).Hash -ne $manifest.noticeSha256) {
      throw 'The extracted SQLCMD files failed SHA-256 validation.'
    }
  } finally {
    if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath -Force }
  }
}
Copy-Item -LiteralPath (Join-Path $manifestRoot 'LICENSE') -Destination (Join-Path $outputDir 'LICENSE') -Force
Write-Output "Microsoft SQLCMD $($manifest.version) is ready (checksums verified)."
