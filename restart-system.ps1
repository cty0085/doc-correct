# 完整系统重启脚本 - doc-correct-system.ps1
Write-Host "=== 文档错别字识别系统 === " -ForegroundColor Cyan
Write-Host "正在重启完整系统..." -ForegroundColor Yellow

# 1. 停止所有相关进程
Write-Host "停止现有进程..." -ForegroundColor Yellow
Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { 
    $_.Path -like "*backend*" -or $_.Path -like "*vite*" 
} | Stop-Process -Force

Start-Sleep -Seconds 3

# 2. 启动后端
Write-Host "启动后端服务器..." -ForegroundColor Green
$backendProcess = Start-Process -FilePath "node" -ArgumentList "src/app.js" -WorkingDirectory "backend" -PassThru -NoNewWindow

Write-Host "等待后端启动..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# 3. 检查后端状态
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3001/health" -ErrorAction Stop
    Write-Host " 后端启动成功: $($health.status)" -ForegroundColor Green
    Write-Host "   API地址: http://localhost:3001" -ForegroundColor Cyan
} catch {
    Write-Host " 后端启动失败: $_" -ForegroundColor Red
    Write-Host "正在检查错误..." -ForegroundColor Yellow
    exit 1
}

# 4. 启动前端
Write-Host "启动前端开发服务器..." -ForegroundColor Green

# 检查前端目录
if (Test-Path "package.json") {
    # 检查端口5173是否可用
    try {
        $tcpTest = Test-NetConnection -ComputerName localhost -Port 5173 -WarningAction SilentlyContinue
        if ($tcpTest.TcpTestSucceeded) {
            Write-Host "  端口5173被占用，将使用其他端口" -ForegroundColor Yellow
        }
    } catch {}

    $frontendProcess = Start-Process -FilePath "npm" -ArgumentList "run dev" -PassThru -NoNewWindow
    
    Write-Host "等待前端启动..." -ForegroundColor Yellow
    Start-Sleep -Seconds 8
    
    # 尝试查找Vite使用的端口
    $frontendPort = 5173
    $portsToTry = @(5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180)
    
    foreach ($port in $portsToTry) {
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:$port" -Method Head -TimeoutSec 2 -ErrorAction SilentlyContinue
            if ($response.StatusCode -eq 200) {
                $frontendPort = $port
                break
            }
        } catch {}
    }
    
    Write-Host " 前端已启动" -ForegroundColor Green
    Write-Host "   访问地址: http://localhost:$frontendPort" -ForegroundColor Cyan
} else {
    Write-Host " 前端目录错误" -ForegroundColor Red
}

# 5. 测试API
Write-Host "测试系统API..." -ForegroundColor Yellow

# 测试健康检查
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3001/health" -ErrorAction Stop
    Write-Host " 健康检查: $($health.status)" -ForegroundColor Green
} catch {
    Write-Host " 健康检查失败" -ForegroundColor Red
}

# 测试AI检查API
Write-Host "测试AI检查API..." -ForegroundColor Cyan
try {
    $testText = "农甜需要开恳和按装工续"
    $testBody = @{text = $testText} | ConvertTo-Json
    
    $aiResult = Invoke-RestMethod -Uri "http://localhost:3001/api/check/ai" `
        -Method Post `
        -Body $testBody `
        -ContentType "application/json; charset=utf-8" `
        -TimeoutSec 10 `
        -ErrorAction Stop
    
    if ($aiResult.success) {
        Write-Host " AI检查API: 成功 (发现 $($aiResult.data.count) 个错误)" -ForegroundColor Green
        if ($aiResult.data.count -gt 0) {
            Write-Host "   发现的错误:" -ForegroundColor Cyan
            $aiResult.data.errors | ForEach-Object {
                Write-Host "     - '$($_.wrong)'  '$($_.correct)'" -ForegroundColor White
            }
        }
    } else {
        Write-Host "  AI检查API返回失败: $($aiResult.error)" -ForegroundColor Yellow
    }
} catch {
    Write-Host " AI检查API失败: $_" -ForegroundColor Red
}

# 测试手动检查API
Write-Host "测试手动检查API..." -ForegroundColor Cyan
try {
    $testText = "农甜需要开恳和按装工续"
    $testBody = @{text = $testText} | ConvertTo-Json
    
    $manualResult = Invoke-RestMethod -Uri "http://localhost:3001/api/check/manual" `
        -Method Post `
        -Body $testBody `
        -ContentType "application/json; charset=utf-8" `
        -TimeoutSec 5 `
        -ErrorAction Stop
    
    if ($manualResult.success) {
        Write-Host " 手动检查API: 成功 (发现 $($manualResult.data.count) 个错误)" -ForegroundColor Green
    } else {
        Write-Host "  手动检查API返回失败: $($manualResult.error)" -ForegroundColor Yellow
    }
} catch {
    Write-Host " 手动检查API失败: $_" -ForegroundColor Red
}

# 测试文件列表API
Write-Host "测试文件列表API..." -ForegroundColor Cyan
try {
    $filesResult = Invoke-RestMethod -Uri "http://localhost:3001/api/files" -ErrorAction Stop
    if ($filesResult.success) {
        Write-Host " 文件列表API: 成功 (找到 $($filesResult.data.Count) 个文件)" -ForegroundColor Green
    }
} catch {
    Write-Host "  文件列表API失败: $_" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== 系统启动完成 ===" -ForegroundColor Green
Write-Host " 前端地址: http://localhost:$frontendPort" -ForegroundColor Cyan
Write-Host " 后端API: http://localhost:3001" -ForegroundColor Cyan
Write-Host " 健康检查: http://localhost:3001/health" -ForegroundColor Cyan
Write-Host ""
Write-Host " 立即测试步骤:" -ForegroundColor Yellow
Write-Host "1. 打开浏览器访问: http://localhost:$frontendPort" -ForegroundColor White
Write-Host "2. 应该看到'后端状态: 在线'" -ForegroundColor White
Write-Host "3. 上传TXT文件测试" -ForegroundColor White
Write-Host "4. 点击'AI智能识别'按钮" -ForegroundColor White
Write-Host "5. 点击'快速手动检查'按钮" -ForegroundColor White
Write-Host ""
Write-Host "  故障排除:" -ForegroundColor Yellow
Write-Host "- 如果页面空白: 检查浏览器控制台(F12)" -ForegroundColor White
Write-Host "- 如果API失败: 检查后端控制台输出" -ForegroundColor White
Write-Host "- 如果文件上传失败: 检查uploads目录权限" -ForegroundColor White
Write-Host ""
Write-Host "按 Ctrl+C 停止所有服务" -ForegroundColor Red

# 等待用户输入以停止
try {
    Write-Host "按 Enter 键停止系统..." -ForegroundColor Yellow
    $null = Read-Host
} catch {
    # 如果用户按Ctrl+C
}

Write-Host "正在停止所有服务..." -ForegroundColor Yellow

# 停止进程
Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { 
    $_.Path -like "*backend*" -or $_.Path -like "*vite*" 
} | Stop-Process -Force

Write-Host " 系统已停止" -ForegroundColor Green
