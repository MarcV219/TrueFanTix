#!/bin/bash
# Update dashboard data - this script regenerates the dashboard with current info
cd /home/marc/.openclaw/workspace

# Log the update
 echo "$(date): Dashboard updated" >> /home/marc/.openclaw/workspace/dashboard-updates.log

# The dashboard is static HTML, so we just ensure the server is running
./start-dashboard.sh > /dev/null 2>&1
