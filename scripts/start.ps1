# CyberAnalytics: запуск сервера + туннеля + обновление кнопки бота
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

# Токен бота из .env
$botToken = ((Get-Content "$root\.env") | Where-Object { $_ -match '^TELEGRAM_BOT_TOKEN=' }) -replace '^TELEGRAM_BOT_TOKEN=', ''
if (-not $botToken) { Write-Host "В .env нет TELEGRAM_BOT_TOKEN"; pause; exit 1 }

# 1) Сервер приложения (если ещё не запущен)
$portBusy = Test-NetConnection -ComputerName localhost -Port 3000 -InformationLevel Quiet -WarningAction SilentlyContinue
if (-not $portBusy) {
    Write-Host "Запускаю сервер приложения..."
    Start-Process -FilePath "cmd" -ArgumentList "/k", "npm run start" -WorkingDirectory $root -WindowStyle Minimized
    Start-Sleep -Seconds 6
} else {
    Write-Host "Сервер уже работает на порту 3000."
}

# 2) Туннель Cloudflare (даёт публичный HTTPS-адрес)
$cf = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
if (-not (Test-Path $cf)) { Write-Host "Не найден cloudflared: $cf"; pause; exit 1 }
$log = Join-Path $env:TEMP "cyberanalytics-tunnel.log"
Remove-Item $log -Force -ErrorAction SilentlyContinue
Write-Host "Поднимаю туннель..."
Start-Process -FilePath $cf -ArgumentList "tunnel", "--url", "http://localhost:3000", "--logfile", "`"$log`"" -WindowStyle Minimized

# 3) Ждём публичный адрес из лога туннеля
$url = $null
foreach ($i in 1..40) {
    Start-Sleep -Seconds 1
    if (Test-Path $log) {
        $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($m) { $url = $m.Matches[0].Value; break }
    }
}
if (-not $url) { Write-Host "Туннель не дал адрес за 40 секунд. Проверь интернет и перезапусти."; pause; exit 1 }

# 4) Привязываем адрес к кнопке бота
$body = @{ menu_button = @{ type = "web_app"; text = "Матчи"; web_app = @{ url = $url } } } | ConvertTo-Json -Depth 5
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
try {
    $resp = Invoke-RestMethod -Uri "https://api.telegram.org/bot$botToken/setChatMenuButton" -Method Post -ContentType "application/json; charset=utf-8" -Body $bytes
    if ($resp.ok) { Write-Host "Кнопка бота обновлена." } else { Write-Host "Telegram ответил ошибкой: $($resp | ConvertTo-Json)" }
} catch {
    Write-Host "Не удалось обновить кнопку бота: $_"
}

Write-Host ""
Write-Host "=========================================================="
Write-Host "  ГОТОВО! Приложение доступно: $url"
Write-Host "  Открой бота в Telegram и нажми кнопку [Матчи]."
Write-Host "  Свёрнутые окна (сервер и туннель) НЕ закрывай."
Write-Host "=========================================================="
