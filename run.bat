@echo off
echo Closing any existing process on port 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
    taskkill /F /PID %%a 2>nul
)
echo Starting MyTube...
start /b node server.js
timeout /t 2 /nobreak >nul
start http://localhost:3000
echo Server started at http://localhost:3000
pause