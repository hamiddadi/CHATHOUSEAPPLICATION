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
       via ~/.gradle/gradle.properties or ORG_GRADLE_PROJECT_* environment vars.
       Missing values are rejected before Gradle starts; production builds never
       fall back to the shared debug key.

.EXAMPLE
  .\scripts\build-release-aab.ps1 -VersionCode 1 -VersionName 1.0.0
  .\scripts\build-release-aab.ps1 -VersionCode 1 -VersionName 1.0.0 -Apk
#>
param(
  [string]$EnvFile = ".env.production",
  [int]$VersionCode = 0,
  [string]$VersionName = "",
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

function Get-EnvFileValue([string]$Name) {
  $pattern = "^\s*" + [regex]::Escape($Name) + "\s*="
  $line = $envLines | Where-Object { $_ -match $pattern } | Select-Object -First 1
  if (-not $line) { return $null }
  return (($line -replace $pattern, "").Trim().Trim('"').Trim("'"))
}

$apiBaseUrl = Get-EnvFileValue "API_BASE_URL"
$wsBaseUrl = Get-EnvFileValue "WS_BASE_URL"
$liveKitUrl = Get-EnvFileValue "LIVEKIT_URL"
$realtimeEnabled = Get-EnvFileValue "REALTIME_ENABLED"
if (-not $apiBaseUrl -or -not $apiBaseUrl.StartsWith("https://", [StringComparison]::OrdinalIgnoreCase)) {
  throw "API_BASE_URL must be a non-empty public https:// URL in $EnvFile."
}
if (-not $wsBaseUrl -or -not $wsBaseUrl.StartsWith("wss://", [StringComparison]::OrdinalIgnoreCase)) {
  throw "WS_BASE_URL must be a non-empty public wss:// URL in $EnvFile."
}
if (-not $liveKitUrl -or -not $liveKitUrl.StartsWith("wss://", [StringComparison]::OrdinalIgnoreCase)) {
  throw "LIVEKIT_URL must be a non-empty public wss:// URL in $EnvFile."
}
if ($realtimeEnabled -ne "true") {
  throw "REALTIME_ENABLED=true is required for a shippable production build."
}
$forbiddenHost = 'localhost|127\.0\.0\.1|10\.0\.2\.2|0\.0\.0\.0|192\.168\.|::1|CHANGE_ME'
foreach ($url in @($apiBaseUrl, $wsBaseUrl, $liveKitUrl)) {
  if ($url -match $forbiddenHost) {
    throw "Production endpoint is local or a placeholder: $url"
  }
}

# Extract GOOGLE_MAPS_API_KEY for the manifest placeholder (injected via env, not
# the JS bundle - see android/app/build.gradle manifestPlaceholders).
$mapsApiKey = Get-EnvFileValue "GOOGLE_MAPS_API_KEY"
if (-not $mapsApiKey -or $mapsApiKey -notmatch '^AIza[0-9A-Za-z_-]{35}$') {
  throw "GOOGLE_MAPS_API_KEY must be a real Google API key in $EnvFile; Maps cannot be optional in a shippable build."
}

# A compile-only CI build may copy google-services.json.example, but a
# shippable build must target the real Firebase Android app.
$firebasePath = Join-Path $android "app\google-services.json"
if (-not (Test-Path $firebasePath)) {
  throw "android/app/google-services.json is missing. Install the production Firebase Android config."
}
try {
  $firebase = Get-Content -LiteralPath $firebasePath -Raw -Encoding utf8 | ConvertFrom-Json
} catch {
  throw "android/app/google-services.json is not valid JSON."
}
$firebaseClient = @($firebase.client) |
  Where-Object { $_.client_info.android_client_info.package_name -eq "com.chathouse.app" } |
  Select-Object -First 1
if (-not $firebaseClient) {
  throw "google-services.json has no Firebase client for com.chathouse.app."
}
$firebaseProjectId = [string]$firebase.project_info.project_id
$firebaseAppId = [string]$firebaseClient.client_info.mobilesdk_app_id
$firebaseApiKey = [string](@($firebaseClient.api_key) | Select-Object -First 1).current_key
if (
  [string]::IsNullOrWhiteSpace($firebaseProjectId) -or
  $firebaseProjectId -match 'placeholder|CHANGE_ME|example' -or
  $firebaseAppId -notmatch '^\d+:\d+:android:[0-9a-f]+$' -or
  $firebaseApiKey -notmatch '^AIza[0-9A-Za-z_-]{35}$'
) {
  throw "google-services.json is a placeholder or has an invalid project/app/API-key configuration."
}

# A Play versionCode is immutable once uploaded. Require an explicit choice
# instead of silently falling back to 1/1.0.0.
if ($VersionCode -le 0) {
  $rawVersionCode = [Environment]::GetEnvironmentVariable("VERSION_CODE")
  if ($rawVersionCode -match '^[1-9]\d*$') { $VersionCode = [int]$rawVersionCode }
}
if ($VersionCode -le 0) {
  throw "Set -VersionCode (or VERSION_CODE) to a positive, unused Play version code."
}
if ([string]::IsNullOrWhiteSpace($VersionName)) {
  $VersionName = [Environment]::GetEnvironmentVariable("VERSION_NAME")
}
if ([string]::IsNullOrWhiteSpace($VersionName) -or $VersionName -notmatch '^[0-9]+(\.[0-9]+){1,3}([+-][0-9A-Za-z.-]+)?$') {
  throw "Set -VersionName (or VERSION_NAME) to an explicit release version such as 1.0.0."
}

# Fail before the expensive bundle step unless all release-signing values exist.
$gradleUserHome = if ([string]::IsNullOrWhiteSpace($env:GRADLE_USER_HOME)) {
  Join-Path $HOME ".gradle"
} else {
  $env:GRADLE_USER_HOME
}
$userProps = Join-Path $gradleUserHome "gradle.properties"
$projectProps = Join-Path $android "gradle.properties"
$gradleProps = @()
if (Test-Path $userProps) { $gradleProps += Get-Content $userProps }
if (Test-Path $projectProps) { $gradleProps += Get-Content $projectProps }
$signingKeys = @(
  "CHATHOUSE_UPLOAD_STORE_FILE",
  "CHATHOUSE_UPLOAD_STORE_PASSWORD",
  "CHATHOUSE_UPLOAD_KEY_ALIAS",
  "CHATHOUSE_UPLOAD_KEY_PASSWORD"
)
$signingValues = @{}
$missingSigning = foreach ($key in $signingKeys) {
  $envName = "ORG_GRADLE_PROJECT_$key"
  $envValue = [Environment]::GetEnvironmentVariable($envName)
  $pattern = "^\s*" + [regex]::Escape($key) + "\s*=\s*\S+"
  $propertyLine = $gradleProps | Where-Object { $_ -match $pattern } | Select-Object -First 1
  $propertyValue = if ($propertyLine) { ($propertyLine -split "=", 2)[1].Trim() } else { $null }
  # Gradle properties (user home first, then project) outrank
  # ORG_GRADLE_PROJECT_* environment variables.
  $value = if (-not [string]::IsNullOrWhiteSpace($propertyValue)) { $propertyValue } else { $envValue }
  if ([string]::IsNullOrWhiteSpace($value)) {
    $key
  } else {
    $signingValues[$key] = $value
  }
}
if ($missingSigning) {
  throw "Missing release-signing properties: $($missingSigning -join ', '). See docs/RELEASE-SIGNING.md."
}
$storeLeaf = [IO.Path]::GetFileName($signingValues["CHATHOUSE_UPLOAD_STORE_FILE"])
$keyAlias = $signingValues["CHATHOUSE_UPLOAD_KEY_ALIAS"]
if (
  $storeLeaf.Equals("debug.keystore", [StringComparison]::OrdinalIgnoreCase) -or
  $keyAlias.Equals("androiddebugkey", [StringComparison]::OrdinalIgnoreCase)
) {
  throw "The shared Android debug key is forbidden for a shippable release. Configure the real upload keystore and alias."
}

# Tell Gradle and react-native-dotenv exactly which release metadata to inline.
$previousEnvFile = [Environment]::GetEnvironmentVariable("ENVFILE")
$previousMapsKey = [Environment]::GetEnvironmentVariable("GOOGLE_MAPS_API_KEY")
$previousVersionCode = [Environment]::GetEnvironmentVariable("VERSION_CODE")
$previousVersionName = [Environment]::GetEnvironmentVariable("VERSION_NAME")
$env:ENVFILE = $EnvFile
$env:GOOGLE_MAPS_API_KEY = $mapsApiKey
$env:VERSION_CODE = $VersionCode.ToString()
$env:VERSION_NAME = $VersionName
$task = if ($Apk) { "assembleRelease" } else { "bundleRelease" }

Write-Host "Building $task version $VersionName ($VersionCode) with ENVFILE=$EnvFile ..." -ForegroundColor Green
Push-Location $android
try {
  $onWindows = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
    [System.Runtime.InteropServices.OSPlatform]::Windows
  )
  $gradleWrapper = Join-Path $android $(if ($onWindows) { "gradlew.bat" } else { "gradlew" })
  if (-not $onWindows) {
    & chmod +x $gradleWrapper
    if ($LASTEXITCODE -ne 0) { throw "Could not make the Gradle wrapper executable." }
  }
  # Command-line project properties have Gradle's highest priority, so a
  # shippable build cannot inherit the technical debug-signing opt-in.
  & $gradleWrapper $task "-PCHATHOUSE_ALLOW_DEBUG_RELEASE_SIGNING=false"
  if ($LASTEXITCODE -ne 0) { throw "Gradle $task failed (exit $LASTEXITCODE)." }
} finally {
  Pop-Location
  foreach ($entry in @(
    @{ Name = "ENVFILE"; Value = $previousEnvFile },
    @{ Name = "GOOGLE_MAPS_API_KEY"; Value = $previousMapsKey },
    @{ Name = "VERSION_CODE"; Value = $previousVersionCode },
    @{ Name = "VERSION_NAME"; Value = $previousVersionName }
  )) {
    if ($null -eq $entry.Value) {
      [Environment]::SetEnvironmentVariable($entry.Name, $null)
    } else {
      [Environment]::SetEnvironmentVariable($entry.Name, [string]$entry.Value)
    }
  }
}

$outDir = if ($Apk) { "android\app\build\outputs\apk\release" } else { "android\app\build\outputs\bundle\release" }
Write-Host "`nRelease artifact(s) in: $outDir" -ForegroundColor Green
Get-ChildItem (Join-Path $repo $outDir) -ErrorAction SilentlyContinue | Select-Object Name, Length, LastWriteTime
