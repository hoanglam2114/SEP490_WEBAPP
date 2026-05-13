# ============================================================
# secrets-setup.ps1 — Tạo secrets/ cho Docker Compose (Windows)
# Chạy: .\secrets-setup.ps1
# ============================================================

$SecretsDir = Join-Path $PSScriptRoot "secrets"

if (-not (Test-Path $SecretsDir)) {
    New-Item -ItemType Directory -Path $SecretsDir | Out-Null
}

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   Thiet lap GPU Service Secrets" -ForegroundColor Cyan
Write-Host "============================================"
Write-Host ""

# ANTHROPIC_API_KEY
$anthropic = Read-Host -Prompt "ANTHROPIC_API_KEY (sk-ant-...)" -AsSecureString
$anthropicPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($anthropic))
[System.IO.File]::WriteAllText("$SecretsDir\ANTHROPIC_API_KEY", $anthropicPlain, [System.Text.Encoding]::UTF8)
Write-Host "  [OK] secrets\ANTHROPIC_API_KEY" -ForegroundColor Green

# HF_TOKEN
$hf = Read-Host -Prompt "HF_TOKEN (hf_...)" -AsSecureString
$hfPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($hf))
[System.IO.File]::WriteAllText("$SecretsDir\HF_TOKEN", $hfPlain, [System.Text.Encoding]::UTF8)
Write-Host "  [OK] secrets\HF_TOKEN" -ForegroundColor Green

# BACKEND_URL
$backendDefault = "http://backend:3000"
$backendInput = Read-Host -Prompt "BACKEND_URL [Enter = $backendDefault]"
$backendUrl = if ($backendInput -eq "") { $backendDefault } else { $backendInput }
[System.IO.File]::WriteAllText("$SecretsDir\BACKEND_URL", $backendUrl, [System.Text.Encoding]::UTF8)
Write-Host "  [OK] secrets\BACKEND_URL = $backendUrl" -ForegroundColor Green

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Xong! Chay tiep:" -ForegroundColor Green
Write-Host "  docker compose up -d --build" -ForegroundColor Yellow
Write-Host "============================================"
