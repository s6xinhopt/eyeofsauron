param(
    [switch]$UpdateOnly
)

$ErrorActionPreference = 'Stop'

# ── Configuracao ─────────────────────────────────────────────────────────────

$InstallDir  = "$env:LOCALAPPDATA\EyeOfSauron"
$VersionUrl  = "https://eos-server-sooty.vercel.app/api/version"
$ScriptUrl   = "https://raw.githubusercontent.com/s6xinhopt/eyeofsauron/beta/installer/Install-EyeOfSauron.ps1"
$TaskName    = "EyeOfSauronUpdate"
$LogFile     = "$InstallDir\updater.log"

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-Log($msg) {
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $line = "[$ts] $msg"
    if (-not $UpdateOnly) { Write-Host "  $msg" }
    if (Test-Path (Split-Path $LogFile)) {
        Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue
    }
}

function Compare-SemVer($a, $b) {
    $pa = $a.Split('.') | ForEach-Object { [int]$_ }
    $pb = $b.Split('.') | ForEach-Object { [int]$_ }
    for ($i = 0; $i -lt 3; $i++) {
        if ($pa[$i] -lt $pb[$i]) { return -1 }
        if ($pa[$i] -gt $pb[$i]) { return  1 }
    }
    return 0
}

# ── Banner ───────────────────────────────────────────────────────────────────

if (-not $UpdateOnly) {
    Write-Host ""
    Write-Host "  =============================================" -ForegroundColor DarkYellow
    Write-Host "       EYE OF SAURON - Installer" -ForegroundColor Yellow
    Write-Host "  =============================================" -ForegroundColor DarkYellow
    Write-Host ""
}

# ── Auto-update do updater script ────────────────────────────────────────────

if ($UpdateOnly -and $MyInvocation.MyCommand.Path) {
    try {
        $remoteScript = Invoke-RestMethod $ScriptUrl
        $localScript = Get-Content $MyInvocation.MyCommand.Path -Raw -ErrorAction SilentlyContinue
        if ($remoteScript -and $localScript -and $remoteScript -ne $localScript) {
            Set-Content -Path $MyInvocation.MyCommand.Path -Value $remoteScript -Encoding UTF8 -NoNewline
            Write-Log "Updater auto-atualizado."
        }
    } catch { }
}

# ── Criar pasta de instalacao ────────────────────────────────────────────────

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

# ── Versao local ─────────────────────────────────────────────────────────────

$localVersion = "0.0.0"
$manifestPath = Join-Path $InstallDir "manifest.json"
if (Test-Path $manifestPath) {
    try {
        $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
        $localVersion = $manifest.version
    } catch { }
}

# ── Versao remota ────────────────────────────────────────────────────────────

try {
    $response = Invoke-RestMethod "$VersionUrl`?v=$localVersion"
} catch {
    Write-Log "Erro ao verificar versao: $_"
    if ($UpdateOnly) { exit 1 }
    Write-Host "  Erro ao contactar o servidor." -ForegroundColor Red
    pause
    exit 1
}

$remoteVersion = $response.version
$downloadUrl   = $response.downloadUrl

# ── Comparar versoes ─────────────────────────────────────────────────────────

if ((Compare-SemVer $localVersion $remoteVersion) -ge 0) {
    Write-Log "Versao atual ($localVersion) - sem atualizacoes."
    if ($UpdateOnly) { exit 0 }
    if ($localVersion -ne "0.0.0") {
        Write-Host "  Ja tens a versao mais recente ($localVersion)." -ForegroundColor Green
        Write-Host ""
        # Garante que a tarefa agendada existe
        # (continua para o Step: Scheduled Task)
    }
} else {
    Write-Log "Update: $localVersion -> $remoteVersion"
    if (-not $UpdateOnly) {
        Write-Host "  A instalar versao $remoteVersion..." -ForegroundColor Cyan
        Write-Host ""
    }
}

# ── Download e extrair ───────────────────────────────────────────────────────

if ((Compare-SemVer $localVersion $remoteVersion) -lt 0) {
    $tempZip = Join-Path $env:TEMP "EyeOfSauron_$remoteVersion.zip"
    $tempDir = Join-Path $env:TEMP "EyeOfSauron_extract"

    Write-Log "A descarregar $downloadUrl ..."
    try {
        Invoke-WebRequest -Uri $downloadUrl -OutFile $tempZip -UseBasicParsing
    } catch {
        Write-Log "Erro no download: $_"
        if (-not $UpdateOnly) {
            Write-Host "  Erro ao descarregar." -ForegroundColor Red
            pause
        }
        exit 1
    }

    # Extrair
    if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
    Expand-Archive -Path $tempZip -DestinationPath $tempDir -Force

    # Detetar estrutura do zip (pasta raiz ou ficheiros diretos)
    $items = Get-ChildItem $tempDir
    if ($items.Count -eq 1 -and $items[0].PSIsContainer) {
        $sourceDir = $items[0].FullName
    } else {
        $sourceDir = $tempDir
    }

    # Substituir ficheiros da extensao (preserva log e updater)
    try {
        Get-ChildItem $InstallDir -Exclude "updater.log","Update-EyeOfSauron.ps1" |
            Remove-Item -Recurse -Force
    } catch {
        Write-Log "Ficheiros bloqueados, a tentar novamente..."
        Start-Sleep -Seconds 3
        try {
            Get-ChildItem $InstallDir -Exclude "updater.log","Update-EyeOfSauron.ps1" |
                Remove-Item -Recurse -Force
        } catch {
            Write-Log "ERRO: Fecha o Chrome e tenta novamente."
            if (-not $UpdateOnly) {
                Write-Host "  Erro: fecha o Chrome e tenta novamente." -ForegroundColor Red
                pause
            }
            exit 1
        }
    }

    Copy-Item -Path "$sourceDir\*" -Destination $InstallDir -Recurse -Force

    # Limpar temp
    Remove-Item $tempZip -Force -ErrorAction SilentlyContinue
    Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue

    Write-Log "Versao $remoteVersion instalada em $InstallDir"
}

# ── Tarefa agendada (auto-update a cada 3 horas) ────────────────────────────

if (-not $UpdateOnly) {
    try {
        # Guardar copia local do updater
        $updaterPath = Join-Path $InstallDir "Update-EyeOfSauron.ps1"
        Invoke-WebRequest -Uri $ScriptUrl -OutFile $updaterPath -UseBasicParsing

        # Cria wrapper VBScript que executa o PowerShell completamente invisivel
        # (powershell -WindowStyle Hidden ainda mostra um flash da janela)
        $vbsPath = Join-Path $InstallDir "RunUpdater.vbs"
        $vbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File ""$updaterPath"" -UpdateOnly", 0, False
"@
        Set-Content -Path $vbsPath -Value $vbsContent -Encoding ASCII

        $action = New-ScheduledTaskAction `
            -Execute "wscript.exe" `
            -Argument "`"$vbsPath`""

        $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
            -RepetitionInterval (New-TimeSpan -Minutes 30) `
            -RepetitionDuration (New-TimeSpan -Days 3650)

        $settings = New-ScheduledTaskSettingsSet `
            -AllowStartIfOnBatteries `
            -DontStopIfGoingOnBatteries `
            -StartWhenAvailable `
            -RunOnlyIfNetworkAvailable

        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
        Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
            -Settings $settings -Description "Eye of Sauron auto-updater (verifica a cada 30 min)" | Out-Null

        Write-Log "Tarefa agendada criada (a cada 30 minutos)."
    } catch {
        Write-Log "Aviso: nao foi possivel criar tarefa agendada: $_"
        Write-Host "  Aviso: auto-update nao configurado (sem permissoes?)." -ForegroundColor DarkYellow
    }
}

# ── Mensagem final ───────────────────────────────────────────────────────────

if (-not $UpdateOnly) {
    $currentVersion = $remoteVersion
    if ($localVersion -ne "0.0.0" -and (Compare-SemVer $localVersion $remoteVersion) -ge 0) {
        $currentVersion = $localVersion
    }

    Write-Host ""
    Write-Host "  =============================================" -ForegroundColor Green
    Write-Host "    Eye of Sauron v$currentVersion instalado!" -ForegroundColor Green
    Write-Host "  =============================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Pasta: $InstallDir" -ForegroundColor DarkGray
    Write-Host ""

    if ($localVersion -eq "0.0.0") {
        Write-Host "  Proximos passos:" -ForegroundColor Yellow
        Write-Host "    1. Abre chrome://extensions/" -ForegroundColor White
        Write-Host "    2. Ativa 'Modo de programador'" -ForegroundColor White
        Write-Host "    3. Clica 'Carregar sem compactacao'" -ForegroundColor White
        Write-Host "    4. Seleciona a pasta acima" -ForegroundColor White
    } else {
        Write-Host "  Reinicia o Chrome ou clica 'Reload' na extensao" -ForegroundColor Yellow
        Write-Host "  para ativar a nova versao." -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "  As atualizacoes sao automaticas (a cada 30 min)." -ForegroundColor DarkGray
    Write-Host ""

    # Abre a pasta no explorador (primeira instalacao)
    if ($localVersion -eq "0.0.0") {
        explorer.exe $InstallDir
    }

    pause
}
