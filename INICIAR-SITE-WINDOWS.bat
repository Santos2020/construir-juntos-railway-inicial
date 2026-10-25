@echo off
setlocal
cd /d "%~dp0"
title Construir Juntos - Inicializador local

echo ================================================
echo   CONSTRUIR JUNTOS - INICIALIZACAO LOCAL
echo ================================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao foi encontrado.
  echo Instale a versao LTS 20 ou superior em https://nodejs.org/
  echo Depois feche e abra este arquivo novamente.
  pause
  exit /b 1
)
for /f "tokens=1 delims=v." %%a in ('node -v') do set NODEMAJOR=%%a
for /f "tokens=2 delims=v." %%a in ('node -v') do set NODEVER=%%a
if %NODEVER% LSS 20 (
  echo ATENCAO: este projeto requer Node.js 20 ou superior. Versao detectada:
  node -v
  pause
  exit /b 1
)
if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Arquivo .env criado a partir do exemplo.
)
if not exist "node_modules" (
  echo Instalando dependencias. Isso pode levar alguns minutos...
  call npm install
  if errorlevel 1 (
    echo Falha ao instalar dependencias. Verifique sua conexao e tente novamente.
    pause
    exit /b 1
  )
)
echo.
echo O site sera iniciado em http://localhost:3000
echo Para pagamentos reais, ainda sera necessario configurar PayPal, e-mail e hospedagem HTTPS.
echo Mantenha esta janela aberta enquanto usar o site.
echo Pressione Ctrl+C para encerrar o servidor.
echo.
start "" http://localhost:3000
call npm start
pause
