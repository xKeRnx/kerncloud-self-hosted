$ErrorActionPreference = 'Stop'
if ($env:CI -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Disposable GitHub VM required' }
$fixtureRoot = [IO.Path]::GetFullPath((Join-Path $env:RUNNER_TEMP 'KeRnCloud-upgrade-test'))
if (-not $fixtureRoot.StartsWith([IO.Path]::GetFullPath($env:RUNNER_TEMP) + [IO.Path]::DirectorySeparatorChar)) { throw 'Invalid fixture location' }
$installer = Join-Path $env:GITHUB_WORKSPACE 'desktop-app/dist/KeRnCloud-0.38.2-win-x64.exe'
$result = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$fixtureRoot") -WindowStyle Hidden -Wait -PassThru
if ($result.ExitCode -ne 0) { throw 'Baseline installation failed' }
$env:KERNCLOUD_DESKTOP_DATA_DIR = Join-Path $env:RUNNER_TEMP 'native-update-runtime'
$baselineReport = Join-Path $env:RUNNER_TEMP 'native-upgrade-before.json'
$exe = Join-Path $fixtureRoot 'KeRnCloud.exe'
$result = Start-Process -FilePath $exe -ArgumentList @('--diagnostics-report', $baselineReport) -WindowStyle Hidden -Wait -PassThru
if ($result.ExitCode -ne 0) { throw 'Baseline app launch failed' }
$configuration = Join-Path $env:KERNCLOUD_DESKTOP_DATA_DIR '.env'
$grants = Join-Path $env:KERNCLOUD_DESKTOP_DATA_DIR 'grants.fixture.json'
Set-Content -LiteralPath $grants -Value '{"fixture":"project:read","device":"synthetic"}'
$before = (Get-FileHash -LiteralPath $configuration).Hash
$grantsBefore = (Get-FileHash -LiteralPath $grants).Hash
$client = Join-Path $env:RUNNER_TEMP 'native-updater-client'
New-Item -ItemType Directory -Force -Path $client | Out-Null
@{name='kerncloud-updater-fixture';version='0.38.2';main=(Join-Path $env:GITHUB_WORKSPACE 'desktop-app/tests/native-update.cjs')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $client 'package.json')
Copy-Item -LiteralPath (Join-Path $env:GITHUB_WORKSPACE 'desktop-app/update-native.json') -Destination $client
$electron = Join-Path $env:GITHUB_WORKSPACE 'desktop-app/node_modules/electron/dist/electron.exe'
$result = Start-Process -FilePath $electron -ArgumentList @($client) -WindowStyle Hidden -Wait -PassThru
if ($result.ExitCode -ne 0) { throw 'Native updater failed' }
$expected = $env:RELEASE_TAG.TrimStart('v')
$deadline = (Get-Date).AddMinutes(3)
do {
  Start-Sleep -Seconds 2
  $actual = [Diagnostics.FileVersionInfo]::GetVersionInfo($exe).ProductVersion
} while ($actual -ne $expected -and (Get-Date) -lt $deadline)
if ($actual -ne $expected) { throw "Installed version mismatch: $actual" }
# Only close this disposable test installation after its installer relaunch.
Get-Process | Where-Object { $_.Path -eq $exe } | ForEach-Object { $_.CloseMainWindow() | Out-Null; $_.WaitForExit(15000) | Out-Null }
$afterReport = Join-Path $env:RUNNER_TEMP 'native-upgrade-after.json'
$result = Start-Process -FilePath $exe -ArgumentList @('--diagnostics-report', $afterReport) -WindowStyle Hidden -Wait -PassThru
if ($result.ExitCode -ne 0) { throw 'Updated app launch failed' }
$report = Get-Content -LiteralPath $afterReport -Raw | ConvertFrom-Json
if (-not $report.ok -or $report.version -ne $expected -or -not $report.rendererLoaded) { throw 'Updated app verification failed' }
if ((Get-FileHash -LiteralPath $configuration).Hash -ne $before -or (Get-FileHash -LiteralPath $grants).Hash -ne $grantsBefore) { throw 'Runtime configuration or grants changed' }
$uninstaller = Join-Path $fixtureRoot 'Uninstall KeRnCloud.exe'
$result = Start-Process -FilePath $uninstaller -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
if ($result.ExitCode -ne 0) { throw 'Test uninstall failed' }
if ((Get-FileHash -LiteralPath $configuration).Hash -ne $before -or (Get-FileHash -LiteralPath $grants).Hash -ne $grantsBefore) { throw 'Uninstall removed preserved data' }
Write-Output 'Real Windows native download, installer upgrade, first launch and retained fixture configuration/grants verified.'
