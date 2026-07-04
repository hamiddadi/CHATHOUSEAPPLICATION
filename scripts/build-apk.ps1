<#
.SYNOPSIS
  Build a ChatHouse APK entirely inside Docker (no Java / Android SDK / Node.js).

.DESCRIPTION
  Auto-detects your PC's LAN IP (so the phone can reach the Dockerized backend),
  then runs the containerized builder. The finished APK lands in .\artifacts\.

.EXAMPLE
  .\scripts\build-apk.ps1
  .\scripts\build-apk.ps1 -LanIp 192.168.1.42
  .\scripts\build-apk.ps1 -LanIp 127.0.0.1 -Abis "arm64-v8a,armeabi-v7a"
#>
param(
  [string]$LanIp,
  [string]$Abis = "arm64-v8a",
  [string]$GoogleMapsApiKey = ""
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot

if (-not $LanIp) {
  # Pick a real LAN IPv4: skip loopback, link-local (169.254), and virtual
  # adapters (WSL/Hyper-V/VirtualBox) that a phone can't route to.
  $candidate = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
      $_.IPAddress -notlike '127.*' -and
      $_.IPAddress -notlike '169.254.*' -and
      $_.InterfaceAlias -notmatch 'WSL|Hyper-V|VirtualBox|Loopback|vEthernet'
    } |
    Sort-Object -Property { $_.InterfaceAlias -notlike 'Wi-Fi*' } |
    Select-Object -First 1
  if ($candidate) { $LanIp = $candidate.IPAddress }
  if ($LanIp) {
    Write-Host "Auto-detected LAN IP: $LanIp  (override with -LanIp <ip>)" -ForegroundColor Cyan
  }
}
if (-not $LanIp) {
  throw "Could not auto-detect a LAN IP. Re-run with -LanIp <your PC's Wi-Fi IP>."
}

New-Item -ItemType Directory -Force -Path (Join-Path $repo "artifacts") | Out-Null

$env:BACKEND_HOST = $LanIp
$env:APK_ABIS = $Abis
$env:GOOGLE_MAPS_API_KEY = $GoogleMapsApiKey

Write-Host "Building ChatHouse APK -> backend http://${LanIp}:4000  (ABIs: $Abis)" -ForegroundColor Green
docker compose -f (Join-Path $repo "docker-compose.apk.yml") run --rm apk-builder
if ($LASTEXITCODE -ne 0) { throw "APK build failed (exit $LASTEXITCODE)." }

Write-Host "`nAPK ready in: $(Join-Path $repo 'artifacts')" -ForegroundColor Green
Get-ChildItem (Join-Path $repo "artifacts") -Filter *.apk | Select-Object Name, Length, LastWriteTime
