# ============================================================
# create_archive.ps1
# Crée une archive ZIP du projet ChatHouse prête à partager.
# Exécuter depuis la racine du projet :
#   powershell -ExecutionPolicy Bypass -File create_archive.ps1
# ============================================================

$ErrorActionPreference = "Stop"

$projectRoot = $PSScriptRoot
if (-not $projectRoot) { $projectRoot = Get-Location }

$timestamp = Get-Date -Format "yyyy-MM-dd"
$archiveName = "ChatHouse-source-$timestamp"
$tempDir = Join-Path $env:TEMP $archiveName
$zipPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "$archiveName.zip"

Write-Host "`n📦 Création de l'archive ChatHouse..." -ForegroundColor Cyan

# Nettoyage préalable
if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

# Copie avec exclusions (robocopy retourne 0-7 en succès)
Write-Host "  → Copie des fichiers (sans node_modules, .git, logs, APK)..." -ForegroundColor Yellow
$robocopyArgs = @(
    $projectRoot, $tempDir,
    "/E",
    "/XD",
    "node_modules",
    ".git",
    ".expo",
    "coverage",
    "build",
    "dist",
    "backend\node_modules",
    "backend\dist",
    "backend\uploads",
    "__mocks__",
    ".claude",
    ".github",
    ".husky",
    ".vscode",
    "/XF",
    "*.log",
    "*.apk",
    "backend_dev.log",
    "/NFL", "/NDL", "/NJH", "/NJS"
)
& robocopy @robocopyArgs | Out-Null
$exitCode = $LASTEXITCODE
if ($exitCode -ge 8) {
    Write-Host "  ❌ Erreur robocopy (code $exitCode)" -ForegroundColor Red
    exit 1
}

# Vérification des fichiers critiques
Write-Host "  → Vérification des fichiers critiques..." -ForegroundColor Yellow
$criticalFiles = @(
    "package.json",
    "backend\package.json",
    "backend\.env",
    ".env",
    "android\app\google-services.json",
    "react-native.config.js",
    "backend\docker-compose.yml",
    "backend\prisma\schema.prisma"
)
$missing = @()
foreach ($f in $criticalFiles) {
    $fullPath = Join-Path $tempDir $f
    if (-not (Test-Path $fullPath)) { $missing += $f }
}
if ($missing.Count -gt 0) {
    Write-Host "  ⚠️  Fichiers manquants dans l'archive :" -ForegroundColor Red
    $missing | ForEach-Object { Write-Host "     - $_" -ForegroundColor Red }
    Write-Host "  L'archive sera créée mais pourrait être incomplète." -ForegroundColor Yellow
} else {
    Write-Host "  ✅ Tous les fichiers critiques sont présents." -ForegroundColor Green
}

# Création du ZIP
Write-Host "  → Compression en ZIP..." -ForegroundColor Yellow
Compress-Archive -Path "$tempDir\*" -DestinationPath $zipPath -Force

# Nettoyage
Remove-Item $tempDir -Recurse -Force

# Résultat
$sizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host "`n✅ Archive créée avec succès !" -ForegroundColor Green
Write-Host "   📁 Chemin : $zipPath" -ForegroundColor White
Write-Host "   📏 Taille : $sizeMB Mo" -ForegroundColor White
Write-Host "`n⚠️  ATTENTION : l'archive contient des secrets de dev (.env, google-services.json)." -ForegroundColor Yellow
Write-Host "   Ne pas diffuser publiquement.`n" -ForegroundColor Yellow
