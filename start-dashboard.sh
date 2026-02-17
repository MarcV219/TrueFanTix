#!/bin/bash
cd /home/marc/.openclaw/workspace
if lsof -i :8080 > /dev/null 2>&1; then
    echo "Dashboard already running at http://localhost:8080/dashboard.html"
else
    nohup python3 -m http.server 8080 > /dev/null 2>&1 &
    echo "Dashboard started at http://localhost:8080/dashboard.html"
fi
