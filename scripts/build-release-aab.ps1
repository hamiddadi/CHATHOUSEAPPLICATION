<#
.SYNOPSIS
  Build a SHIPPABLE production release for Google Play (AAB by default).

.DESCRIPTION
  Bundles the JS with the PRODUCTION front-end env (.env.production) and signs
  with the real upload keystore. This differs from scripts/build-apk.ps1, which
  builds a LAN/dev *test* APK pointed at http://<LAN>:4000.

  Prerequisites (see docs/RELEASE-SIGNING.md):
    1. .env.production - copy from .env.production.example and fill in the REAL
       public https:// / wss:// hosts (the boot guard rejects local/cleartext).
    2. Upload keystore + the four CHATHOUSE_UPLOAD_* Gradle properties, supplied
       via ~/.gradle/gradle.properties, -P flags, or ORG_GRADLE_PROJECT_* env vars.
       Without them the build falls back to DEBUG signing (Play rejects it); this
       script warns loudly in that case.

.EXAMPLE
  .\scripts\build-release-aab.ps1
  .\scripts\build-release-aab.ps1 -Apk          # standalone APK instead of an AAB
#>
param(
  [string]$EnvFile = ".env.production",
  [switch]$Apk
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$android = Join-Path $repo "android"
$envPath = Join-Path $repo $EnvFile

if (-not (Test-Path $envPath)) {
  throw "$EnvFile not found. Copy .env.production.example to $EnvFile and fill in the real public hosts."
}
$envLines = Get-Content $envPath | Where-Object { $_ -match '^\s*[^#].*=' }
if (-not ($envLines | Where-Object { $_ -match '^\s*ENV\s*=\s*production\s*$' })) {
  throw "$EnvFile must contain 'ENV=production' - the boot-time guard (src/config/env.ts) requires it."
}

# Extract GOOGLE_MAPS_API_KEY for the manifest placeholder (injected via env, not
# the JS bundle - see android/app/build.gradle manifestPlaceholders).
$mapsLine = $envLines | Where-Object { $_ -match '^\s*GOOGLE_MAPS_API_KEY\s*=' } | Select-Object -First 1
if ($mapsLine) {
  $env:GOOGLE_MAPS_API_KEY = ($mapsLine -replace '^\s*GOOGLE_MAPS_API_KEY\s*=\s*', '').Trim()
}
if (-not $env:GOOGLE_MAPS_API_KEY -or $env:GOOGLE_MAPS_API_KEY -like '*CHANGE_ME*') {
  Write-Warning "GOOGLE_MAPS_API_KEY is empty/placeholder in $EnvFile - the Map tab will render blank."
}

# Warn if release signing isn't configured (the build would silently debug-sign).
$gradleProps = @()
$userProps = Join-Path $HOME ".gradle\gradle.properties"
if (Test-Path $userProps) { $gradleProps = Get-Content $userProps }
$hasSigning = ($env:ORG_GRADLE_PROJECT_CHATHOUSE_UPLOAD_STORE_FILE) -or
              ($gradleProps | Where-Object { $_ -match '^\s*CHATHOUSE_UPLOAD_STORE_FILE\s*=' })
if (-not $hasSigning) {
  Write-Warning "No CHATHOUSE_UPLOAD_STORE_FILE found - the build will DEBUG-sign and Play will REJECT it. See docs/RELEASE-SIGNING.md."
}

# Tell react-native-dotenv (babel.config.js) which env file to inline.
$env:ENVFILE = $EnvFile
$task = if ($Apk) { "assembleRelease" } else { "bundleRelease" }

Write-Host "Building $task with ENVFILE=$EnvFile ..." -ForegroundColor Green
Push-Location $android
try {
  & (Join-Path $android "gradlew.bat") $task
  if ($LASTEXITCODE -ne 0) { throw "Gradle $task failed (exit $LASTEXITCODE)." }
} finally {
  Pop-Location
  Remove-Item Env:\ENVFILE -ErrorAction SilentlyContinue
}

$outDir = if ($Apk) { "android\app\build\outputs\apk\release" } else { "android\app\build\outputs\bundle\release" }
Write-Host "`nRelease artifact(s) in: $outDir" -ForegroundColor Green
Get-ChildItem (Join-Path $repo $outDir) -ErrorAction SilentlyContinue | Select-Object Name, Length, LastWriteTime
