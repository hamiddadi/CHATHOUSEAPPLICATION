<#
.SYNOPSIS
  Start the ChatHouse backend (Postgres + Redis + API + LiveKit) in Docker.

.DESCRIPTION
  Requires ONLY Docker. Auto-detects your PC's LAN IP and passes it as LAN_IP so
  live audio (LiveKit / mediasoup) is reachable from a phone. The API listens on
  http://<LAN_IP>:4000 ; the DB self-migrates on boot.

.EXAMPLE
  .\scripts\start-backend.ps1
  .\scripts\start-backend.ps1 -LanIp 192.168.1.42
  .\scripts\start-backend.ps1 -Down      # stop everything
#>
param(
  [string]$LanIp,
  [switch]$Down
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$compose = Join-Path $repo "backend\docker-compose.yml"

if ($Down) {
  docker compose -f $compose down
  return
}

if (-not $LanIp) {
  $candidate = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
      $_.IPAddress -notlike '127.*' -and
      $_.IPAddress -notlike '169.254.*' -and
      $_.InterfaceAlias -notmatch 'WSL|Hyper-V|VirtualBox|Loopback|vEthernet'
    } |
    Sort-Object -Property { $_.InterfaceAlias -notlike 'Wi-Fi*' } |
    Select-Object -First 1
  if ($candidate) { $LanIp = $candidate.IPAddress }
  if ($LanIp) { Write-Host "Auto-detected LAN IP: $LanIp  (override with -LanIp <ip>)" -ForegroundColor Cyan }
}
if (-not $LanIp) { throw "Could not auto-detect a LAN IP. Re-run with -LanIp <your PC's Wi-Fi IP>." }

$env:LAN_IP = $LanIp
Write-Host "Starting ChatHouse backend (LAN_IP=$LanIp) ..." -ForegroundColor Green
docker compose -f $compose up -d
if ($LASTEXITCODE -ne 0) { throw "docker compose up failed (exit $LASTEXITCODE)." }

Write-Host "`nBackend up. Verify:  curl http://${LanIp}:4000/health" -ForegroundColor Green
Write-Host "Build a matching APK: .\scripts\build-apk.ps1 -LanIp $LanIp" -ForegroundColor Green
