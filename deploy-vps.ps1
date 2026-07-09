# Деплой приложения на VPS (reshay-istoriyu.ru).
# Выкладывает ПОСЛЕДНИЙ КОММИТ (не рабочую копию) — сначала закоммить изменения.
# Использование: powershell -File deploy-vps.ps1

$ErrorActionPreference = 'Stop'
$vps = 'root@185.198.152.200'
$tar = "$env:TEMP\ege-app-deploy.tar.gz"

Write-Host "Упаковка последнего коммита..."
git archive --format=tar.gz -o $tar HEAD
if (-not $?) { throw 'git archive failed' }

Write-Host "Загрузка на VPS..."
scp $tar "${vps}:/root/ege-app-deploy.tar.gz"
if (-not $?) { throw 'scp failed' }

Write-Host "Распаковка и атомарная замена..."
ssh $vps "rm -rf /var/www/ege-app.new && mkdir -p /var/www/ege-app.new && tar xzf /root/ege-app-deploy.tar.gz -C /var/www/ege-app.new && rm -rf /var/www/ege-app.old && mv /var/www/ege-app /var/www/ege-app.old && mv /var/www/ege-app.new /var/www/ege-app"
if (-not $?) { throw 'remote deploy failed' }

Write-Host "Проверка..."
curl.exe -s -o NUL -w "https://reshay-istoriyu.ru/ -> HTTP %{http_code}`n" https://reshay-istoriyu.ru/

Write-Host "Готово. Не забудь git push origin master (пока GitHub Pages жив как запасной адрес)."
