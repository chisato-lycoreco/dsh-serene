@echo off
chcp 65001 >nul
title 知遥 · 网页版
if /i "%~1"=="--demo" title 知遥 · 演示模式
setlocal
cd /d "%~dp0"

echo.
echo   知遥 · 网页版
echo   ─────────────────────────────
echo   正在启动，稍等两秒，浏览器会自己打开。
echo   想用演示模式（不需要 key）：start-web.cmd demo
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [没有找到 Node.js]
  echo.
  echo   这个程序需要 Node.js 才能跑。
  echo   打开 https://nodejs.org/ ，下载 LTS 版本，一路点“下一步”装好，
  echo   然后重新双击这个文件。
  echo.
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=19)?0:1)"
if errorlevel 1 (
  echo   [Node.js 版本太旧]
  echo.
  echo   现在装的是：
  node -v
  echo   这个网页需要 Node 22.19 或更新版本。
  echo   打开 https://nodejs.org/ ，下载 LTS 覆盖安装，再双击这个文件。
  echo.
  pause
  exit /b 1
)

node "%~dp0web\server.mjs" --open %*
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" (
  echo.
  echo   程序退出了（代码 %CODE%）。
  echo   把上面的报错拍下来，发到仓库的 Issues 就行。
  echo.
  pause
)
endlocal
