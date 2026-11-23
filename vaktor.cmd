@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Where code becomes reality

rem Vaktor on coding

set "ROOT=%~dp0"
set "NODE_DIR=%LOCALAPPDATA%\Vaktor\node"

if exist "!NODE_DIR!\node.exe" set "PATH=!NODE_DIR!;!PATH!"

set "NEED_NODE=0"

where node >nul 2>nul
if errorlevel 1 (
  set "NEED_NODE=1"
) else (
  for /f "delims=v." %%a in ('node -v') do set "NODE_MAJOR=%%a"
  if !NODE_MAJOR! LSS 26 set "NEED_NODE=1"
)

if "!NEED_NODE!"=="1" (
  echo.
  echo [Vaktor] Node.js ausente ou desatualizado. Baixando versao portatil...
  echo [Vaktor] Isso acontece apenas na primeira vez.
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }; $v = 'v26.13.0'; $name = 'node-' + $v + '-win-' + $arch; $zip = Join-Path $env:TEMP ($name + '.zip'); $dest = Join-Path $env:LOCALAPPDATA 'Vaktor'; if (Test-Path $zip) { Remove-Item $zip -Force }; Write-Progress -Activity '[Vaktor] Baixando Node.js' -Status 'Fazendo download...' -PercentComplete 30; Invoke-WebRequest -Uri ('https://nodejs.org/dist/' + $v + '/' + $name + '.zip') -OutFile $zip -UseBasicParsing; Write-Progress -Activity '[Vaktor] Extraindo arquivos' -Status 'Instalando Node.js...' -PercentComplete 70; if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }; New-Item -ItemType Directory -Force -Path $dest | Out-Null; Expand-Archive -Path $zip -DestinationPath $dest -Force; Move-Item (Join-Path $dest $name) (Join-Path $dest 'node') -Force; Remove-Item $zip -Force; Write-Progress -Activity '[Vaktor]' -Status 'Concluido!' -Completed"
  if errorlevel 1 (
    echo.
    echo [Vaktor] Falha ao baixar o Node.js. Verifique sua internet
    echo ou instale manualmente em https://nodejs.org
    echo.
    pause
    exit /b 1
  )
  set "PATH=!NODE_DIR!;!PATH!"
)

where node >nul 2>nul
if errorlevel 1 (
  echo [Vaktor] Node.js indisponivel. Instale em https://nodejs.org
  pause
  exit /b 1
)

pushd "%ROOT%"

if not exist "node_modules" (
  echo [Vaktor] Instalando dependencias...
  call npm install
  if errorlevel 1 (
    echo.
    echo [Vaktor] Falha ao instalar dependencias. Verifique sua internet.
    echo.
    pause
    popd
    exit /b 1
  )
)

if not exist ".env" if exist ".env.example" (
  copy /y ".env.example" ".env" >nul
  echo.
  echo [Vaktor] Arquivo .env criado a partir de .env.example.
  echo [Vaktor] Abra o .env e preencha pelo menos uma chave de API.
  echo [Vaktor] Depois rode o vaktor.cmd novamente.
  echo.
  pause
  popd
  exit /b 0
)

if not exist ".env" (
  > ".env" echo # Vaktor - configuracao
  >> ".env" echo # Preencha as chaves dos provedores que for usar.
  >> ".env" echo.
  >> ".env" echo PUTER_API_KEY=
  >> ".env" echo PUTER_BUDGET_USD=0.30
  >> ".env" echo.
  >> ".env" echo AGENTROUTER_API_KEY=
  >> ".env" echo AGENTROUTER_BUDGET_USD=0.30
  >> ".env" echo.
  >> ".env" echo OPENROUTER_API_KEY=
  >> ".env" echo OPENROUTER_BUDGET_USD=0.30
  >> ".env" echo.
  >> ".env" echo REQUESTY_API_KEY=
  >> ".env" echo.
  >> ".env" echo NUMES_API_KEY=
  >> ".env" echo NUMES_DYNAMIC_MODELS=false
  >> ".env" echo.
  >> ".env" echo KILO_API_KEY=
  >> ".env" echo.
  >> ".env" echo FTAI_API_KEY=
  >> ".env" echo.
  >> ".env" echo GROQ_API_KEY=
  >> ".env" echo GROQ_BUDGET_USD=0.30
  >> ".env" echo.
  >> ".env" echo ECHO_API_KEY=
  >> ".env" echo ECHO_BUDGET_USD=0.30
  >> ".env" echo.
  >> ".env" echo NVIDIA_API_KEY=
  >> ".env" echo NVIDIA_BUDGET_USD=0.30
  >> ".env" echo.
  >> ".env" echo OPENCODE_API_KEY=
  >> ".env" echo OPENCODE_BUDGET_USD=0.30
  >> ".env" echo.
  >> ".env" echo HARBOR_API_KEY=
  >> ".env" echo HARBOR_BUDGET_USD=0.30
  >> ".env" echo.
  >> ".env" echo GEMINI_API_KEY=
  >> ".env" echo GEMINI_BUDGET_USD=0.30
  >> ".env" echo GEMINI_MODEL=gemini-2.5-flash
  >> ".env" echo.
  >> ".env" echo ENABLE_RESPONSE_CACHE=true
  >> ".env" echo MAX_CONTEXT_MESSAGES=20
  >> ".env" echo MAX_TOKENS_PER_REQUEST=4096
  >> ".env" echo DEFAULT_MODEL=auto
  >> ".env" echo FALLBACK_MODEL=claude-haiku-4-5-20251001
  >> ".env" echo.
  >> ".env" echo ENABLE_SKILLS=true
  >> ".env" echo SKILLS_MAX_PROMPT_CHARS=3200
  >> ".env" echo SKILLS_MAX_PER_REQUEST=3
  >> ".env" echo.
  >> ".env" echo ENABLE_THINKING=false
  >> ".env" echo THINKING_MODE=auto
  >> ".env" echo THINKING_MIN_COMPLEXITY=normal
  >> ".env" echo THINKING_BUDGET_TOKENS=8000
  >> ".env" echo THINKING_MAX_PASSES=1
  >> ".env" echo THINKING_SHOW=false
  >> ".env" echo.
  >> ".env" echo ENABLE_AGENT=true
  >> ".env" echo AGENT_MAX_ITERATIONS=8
  >> ".env" echo AGENT_MAX_TOOL_CALLS=20
  >> ".env" echo.
  >> ".env" echo TOOLS_ALLOW_WRITE=true
  >> ".env" echo TOOLS_AUTO_APPROVE=false
  >> ".env" echo TOOLS_MAX_FILE_BYTES=204800
  >> ".env" echo TOOLS_MAX_OUTPUT_CHARS=20000
  >> ".env" echo TOOLS_COMMAND_TIMEOUT_MS=120000
  >> ".env" echo TOOLS_ALLOWED_COMMANDS=
  >> ".env" echo.
  >> ".env" echo # Capacidades extras do agente - rede ligada; install/git desligados
  >> ".env" echo TOOLS_ALLOW_NETWORK=true
  >> ".env" echo TOOLS_ALLOW_INSTALL=false
  >> ".env" echo TOOLS_ALLOW_GIT_WRITE=false
  >> ".env" echo TOOLS_ALLOWED_DOMAINS=
  >> ".env" echo.
  >> ".env" echo VERIFY_ENABLED=true
  >> ".env" echo VERIFY_MAX_ATTEMPTS=3
  >> ".env" echo.
  >> ".env" echo CONTEXT_INJECT=true
  >> ".env" echo CONTEXT_MAX_CHARS=4000
  >> ".env" echo MEMORY_FILE=VAKTOR.md
  >> ".env" echo.
  >> ".env" echo SECURITY_ENABLED=false
  >> ".env" echo SECURITY_FILE=SECURITY.md
  >> ".env" echo.
  >> ".env" echo MCP_ENABLED=false
  >> ".env" echo MCP_SERVERS=
  >> ".env" echo.
  >> ".env" echo BEST_OF_N=1
  >> ".env" echo CRITIC_MODEL=
  >> ".env" echo BEST_OF_N_MAX_COST_USD=0.05
  >> ".env" echo ENABLE_DATASET_LOG=false
  echo.
  echo [Vaktor] Arquivo .env criado.
  echo [Vaktor] Abra o .env e preencha pelo menos uma chave de API.
  echo [Vaktor] Depois rode o vaktor.cmd novamente.
  echo.
  pause
  popd
  exit /b 0
)

set "NEED_BUILD=0"
if not exist "dist\index.js" set "NEED_BUILD=1"
if "!NEED_BUILD!"=="0" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=(Get-Item 'dist\index.js').LastWriteTime; $n=Get-ChildItem 'src' -Recurse -File -Include *.ts,*.tsx | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if ($n -and $n.LastWriteTime -gt $d) { exit 1 } else { exit 0 }"
  if errorlevel 1 set "NEED_BUILD=1"
)

if "!NEED_BUILD!"=="1" (
  echo [Vaktor] Compilando...
  call npm run build
  if errorlevel 1 (
    echo.
    echo [Vaktor] Falha na compilacao.
    echo.
    pause
    popd
    exit /b 1
  )
)

popd

powershell -NoProfile -ExecutionPolicy Bypass -Command "$r=(Get-Item -LiteralPath '%ROOT%.').FullName; $p=[Environment]::GetEnvironmentVariable('Path','User'); if (-not $p) { $p='' }; if (($p -split ';') -notcontains $r) { [Environment]::SetEnvironmentVariable('Path', ($p.TrimEnd(';') + ';' + $r), 'User'); exit 10 } else { exit 0 }"
if errorlevel 10 (
  echo.
  echo [Vaktor] Pasta registrada no PATH.
  echo [Vaktor] Abra um NOVO cmd e digite "vaktor" em qualquer pasta.
  echo.
)

REM --- Animação de Carregamento Simples ---
powershell -NoProfile -ExecutionPolicy Bypass -Command "$r=[char]13; for ($i=0; $i -lt 12; $i++) { $dots = '.' * (($i %% 6) + 1); Write-Host -NoNewline ($r + 'Loading to Vaktor' + $dots + '       '); Start-Sleep -Milliseconds 250 }; Write-Host ($r + 'Loading to Vaktor. Ready!       ')"

node --no-warnings --experimental-ffi "%ROOT%dist\index.js" %*
exit /b 0
