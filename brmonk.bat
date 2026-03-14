@echo off
REM brmonk — Windows batch wrapper
REM Launches brmonk.ps1 with all passed arguments.
REM
REM Usage:
REM   brmonk                       Default launch
REM   brmonk --stop                Stop all services
REM   brmonk --rebuild             Force rebuild
REM   brmonk --mcp                 Use MCP mode
REM   brmonk --port 8080           Custom web UI port

setlocal

REM Convert batch-style args (--flag) to PowerShell-style (-Flag)
set "ARGS="
:parse
if "%~1"=="" goto run
set "ARG=%~1"
if "%ARG%"=="--stop" (set "ARGS=%ARGS% -Stop" & shift & goto parse)
if "%ARG%"=="--rebuild" (set "ARGS=%ARGS% -Rebuild" & shift & goto parse)
if "%ARG%"=="--mcp" (set "ARGS=%ARGS% -Mcp" & shift & goto parse)
if "%ARG%"=="--help" (set "ARGS=%ARGS% -Help" & shift & goto parse)
if "%ARG%"=="--port" (set "ARGS=%ARGS% -Port %~2" & shift & shift & goto parse)
if "%ARG%"=="--cdp-port" (set "ARGS=%ARGS% -CdpPort %~2" & shift & shift & goto parse)
if "%ARG%"=="--mcp-port" (set "ARGS=%ARGS% -McpPort %~2" & shift & shift & goto parse)
REM Pass through unknown args as-is
set "ARGS=%ARGS% %ARG%"
shift
goto parse

:run
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0brmonk.ps1" %ARGS%
