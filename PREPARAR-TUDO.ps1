$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$Host.UI.RawUI.WindowTitle = 'Construir Juntos - Configuracao automatica'

function Stop-WithMessage([string]$Message) {
  Write-Host "`nERRO: $Message" -ForegroundColor Red
  Write-Host 'Corrija o item informado e execute CONFIGURAR-E-INICIAR.bat novamente.' -ForegroundColor Yellow
  Read-Host 'Pressione Enter para fechar'
  exit 1
}

Write-Host '====================================================' -ForegroundColor Cyan
Write-Host ' CONSTRUIR JUNTOS - CONFIGURACAO AUTOMATICA WINDOWS' -ForegroundColor Cyan
Write-Host '====================================================' -ForegroundColor Cyan
Write-Host 'Este assistente prepara o projeto localmente; nao publica nem ativa pagamentos reais.' -ForegroundColor Yellow

$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $node -or -not $npm) {
  Write-Host 'Node.js 20+ nao foi encontrado.' -ForegroundColor Yellow
  Write-Host 'Abra https://nodejs.org/ e instale a versao LTS 20 ou superior.'
  Write-Host 'Depois feche e abra novamente este instalador.'
  Read-Host 'Pressione Enter para fechar'
  exit 1
}
$nodeVersionText = (& node -p "process.versions.node").Trim()
$nodeMajor = [int]($nodeVersionText.Split('.')[0])
if ($nodeMajor -lt 20) { Stop-WithMessage "Node.js $nodeVersionText encontrado. Este projeto requer Node.js 20 ou superior." }
Write-Host "Node.js: $nodeVersionText" -ForegroundColor Green

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'package.json'))) { Stop-WithMessage 'package.json nao esta na pasta do projeto.' }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'server.js'))) { Stop-WithMessage 'server.js nao esta na pasta do projeto.' }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'private\downloads\guia-pt.pdf'))) { Stop-WithMessage 'PDF privado guia-pt.pdf nao encontrado.' }

# Cria configuracao local apenas se ainda nao existir; preserva um .env existente.
$envPath = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path -LiteralPath $envPath)) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot '.env.example') -Destination $envPath
  Write-Host 'Arquivo .env criado a partir do modelo.' -ForegroundColor Green
}
$envText = Get-Content -LiteralPath $envPath -Raw
if ($envText -match '(?m)^ADMIN_TOKEN=replace_with_a_long_random_secret\s*$') {
  $bytes = New-Object byte[] 48
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
  $rng.Dispose()
  $envText = [regex]::Replace($envText, '(?m)^ADMIN_TOKEN=.*$', "ADMIN_TOKEN=$token")
  Set-Content -LiteralPath $envPath -Value $envText -Encoding utf8
  Write-Host 'Segredo administrativo local gerado automaticamente.' -ForegroundColor Green
}

$dataDir = Join-Path $PSScriptRoot 'data'
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
# Corrige apenas a configuracao DATA_DIR padrao; nao substitui configuracao customizada.
$envText = Get-Content -LiteralPath $envPath -Raw
if ($envText -match '(?m)^DATA_DIR=\./data\s*$') {
  $envText = [regex]::Replace($envText, '(?m)^DATA_DIR=\./data\s*$', 'DATA_DIR=./data')
  Set-Content -LiteralPath $envPath -Value $envText -Encoding utf8
}

Write-Host "`nInstalando dependencias do projeto (pode levar alguns minutos)..." -ForegroundColor Cyan
& npm install
if ($LASTEXITCODE -ne 0) { Stop-WithMessage 'npm install falhou. Verifique a internet e a versao do Node.js.' }

Write-Host "`nVerificando sintaxe do servidor..." -ForegroundColor Cyan
& node --check server.js
if ($LASTEXITCODE -ne 0) { Stop-WithMessage 'A verificacao de sintaxe de server.js falhou.' }

Write-Host "`nPreparacao concluida." -ForegroundColor Green
Write-Host 'Banco SQLite: sera criado automaticamente em data\data.sqlite quando o servidor iniciar.'
Write-Host 'PayPal permanece em SANDBOX; credenciais e SMTP ainda precisam ser configurados.' -ForegroundColor Yellow
Write-Host 'Nao envie o arquivo .env ao GitHub. Ele contem um segredo local.' -ForegroundColor Yellow

$port = 3000
$portLine = Select-String -LiteralPath $envPath -Pattern '^PORT=(\d+)' | Select-Object -First 1
if ($portLine -and $portLine.Matches.Count -gt 0) { $port = [int]$portLine.Matches[0].Groups[1].Value }
$url = "http://localhost:$port"
Write-Host "`nIniciando o site em $url" -ForegroundColor Cyan
try { Start-Process $url } catch { Write-Host "Abra manualmente: $url" -ForegroundColor Yellow }
& npm start
if ($LASTEXITCODE -ne 0) { Write-Host 'O servidor terminou com erro. Confira a mensagem acima.' -ForegroundColor Red }
Read-Host 'Pressione Enter para fechar esta janela'
