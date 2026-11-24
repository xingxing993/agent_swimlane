@echo off
cd /d "%~dp0"
echo Agent Swimlane: http://127.0.0.1:8765
echo Keep this terminal open. Press Ctrl+C to stop.
python serve.py
pause
