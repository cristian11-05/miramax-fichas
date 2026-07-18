@echo off
title Fiberlink SIGOST
start "SIGOST Backend" cmd /k "cd /d %~dp0backend && node server.js"
start "SIGOST Admin" cmd /k "cd /d %~dp0frontend-admin && node server.js"
start "SIGOST Tecnico" cmd /k "cd /d %~dp0frontend-tecnico && node server.js"
ping 127.0.0.1 -n 3 > nul
start http://localhost:5173
start http://localhost:5174
