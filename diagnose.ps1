# 系统诊断脚本 - diagnose.ps1
Write-Host "=== 系统诊断 === " -ForegroundColor Cyan

Write-Host "1. 检查进程..." -ForegroundColor Yellow
Get-Process -Name "node" | Where-Object { $_.Path -like "*doc-correct*" } | Format-Table Id, Name, Path, StartTime

Write-Host "2. 检查端口..." -ForegroundColor Yellow
$ports = @(3000, 3001, 3002, 5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180)
foreach ($port in $ports) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
        if ($conn) {
            Write-Host "端口 $port 被占用 (PID: $($conn.OwningProcess))" -ForegroundColor Red
            Get-Process -Id $conn.OwningProcess | Select-Object Name, Path, StartTime
        }
    } catch {}
}

Write-Host "3. 检查文件..." -ForegroundColor Yellow
$files = @(
    "index.html",
    "src\main.js",
    "src\App.vue", 
    "src\style.css",
    "vite.config.js",
    "package.json",
    "backend\src\app.js",
    "backend\src\routes.js"
)

foreach ($file in $files) {
    if (Test-Path $file) {
        $size = (Get-Item $file -ErrorAction SilentlyContinue).Length
        Write-Host " $file (${size}字节)" -ForegroundColor Green
    } else {
        Write-Host " $file 不存在" -ForegroundColor Red
    }
}

Write-Host "4. 测试API..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3002/health" -TimeoutSec 3
    Write-Host " 后端API正常: $($health.status)" -ForegroundColor Green
} catch {
    Write-Host " 后端API失败: $_" -ForegroundColor Red
}

Write-Host "5. 测试前端..." -ForegroundColor Yellow
$frontendUrls = @(5173..5180 | ForEach-Object { "http://localhost:$_" })
foreach ($url in $frontendUrls) {
    try {
        $response = Invoke-WebRequest -Uri $url -Method Head -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            Write-Host " 前端服务: $url" -ForegroundColor Green
            break
        }
    } catch {}
}

Write-Host ""
Write-Host "=== 诊断完成 ===" -ForegroundColor Cyan
Write-Host "如果问题仍存在，请提供以下信息:" -ForegroundColor Yellow
Write-Host "1. 浏览器控制台错误 (F12 -> Console)" -ForegroundColor White
Write-Host "2. 终端中的错误信息" -ForegroundColor White
Write-Host "3. 访问的具体URL" -ForegroundColor White
