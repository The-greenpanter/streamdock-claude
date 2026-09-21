<#
.SYNOPSIS
    Instala el plugin en la carpeta de plugins de StreamDock.

.DESCRIPTION
    StreamDock solo lee de %APPDATA%\HotSpot\StreamDock\plugins. Este script
    copia ahi la carpeta com.greenpanter.claude.sdPlugin del repo, mas las
    dependencias de node_modules (que npm instala en la raiz).

    No hace falta reiniciar la app: el host reintenta cada 60 s y relee el
    manifest. -Restart solo lo acelera.

.EXAMPLE
    .\scripts\deploy.ps1
.EXAMPLE
    .\scripts\deploy.ps1 -Restart
#>

param([switch]$Restart)

$ErrorActionPreference = 'Stop'

$repo   = Split-Path -Parent $PSScriptRoot
$nombre = 'com.greenpanter.claude.sdPlugin'
$src    = Join-Path $repo $nombre
$dst    = Join-Path $env:APPDATA "HotSpot\StreamDock\plugins\$nombre"

if (-not (Test-Path -LiteralPath $src)) {
    throw "No encuentro $src"
}

Write-Host "origen : $src"
Write-Host "destino: $dst"

# OJO: NO se borra el destino.
# El plugin corre con node20.exe y tiene esa carpeta como directorio de
# trabajo, asi que Remove-Item falla con IOException al intentar borrarla —
# y como aborta a medias, deja el plugin destruido. Se copia encima y basta.
New-Item -ItemType Directory -Path $dst -Force | Out-Null

Get-ChildItem -LiteralPath $src | ForEach-Object {
    try {
        Copy-Item -LiteralPath $_.FullName -Destination $dst -Recurse -Force -ErrorAction Stop
        Write-Host "  copiado $($_.Name)" -ForegroundColor Green
    } catch {
        # un archivo suelto bloqueado no debe tumbar el deploy entero
        Write-Host "  parcial $($_.Name) : $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# Dependencias: npm las instala en la raiz del repo, pero en runtime tienen
# que estar dentro de la carpeta del plugin para que require() las resuelva.
$nm = Join-Path $repo 'node_modules'
if (Test-Path -LiteralPath $nm) {
    Copy-Item -LiteralPath $nm -Destination $dst -Recurse -Force
    Write-Host '  copiado node_modules' -ForegroundColor Green
} else {
    Write-Host '  falta node_modules — corre: npm install' -ForegroundColor Yellow
}

$n = (Get-ChildItem -LiteralPath $dst -Recurse -File).Count
Write-Host "$n archivos instalados" -ForegroundColor Cyan

if ($Restart) {
    $proc = Get-Process StreamDock -ErrorAction SilentlyContinue
    if ($proc) {
        Write-Host 'cerrando StreamDock...' -ForegroundColor Yellow
        $proc | Stop-Process -Force
        Start-Sleep -Seconds 2
    }
    $exe = 'C:\Program Files (x86)\StreamDock\StreamDock.exe'
    if (Test-Path -LiteralPath $exe) {
        Start-Process -FilePath $exe
        Write-Host 'StreamDock reiniciado' -ForegroundColor Green
    } else {
        Write-Host "no encontre $exe - abrelo a mano" -ForegroundColor Red
    }
} else {
    Write-Host ''
    Write-Host 'Para recargar solo el plugin (sin reiniciar la app):' -ForegroundColor Yellow
    Write-Host '  Get-Process node20 | Sort-Object StartTime | Select-Object -Last 1 | Stop-Process -Force' -ForegroundColor Gray
}
