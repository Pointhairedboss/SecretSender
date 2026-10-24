#!/usr/bin/env bash
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export TERM=xterm-256color
export COLORTERM=truecolor
cd /app

echo -e "\033[1;33m========================================================================\033[0m"
echo -e "\033[1;33m  BitBop Ephemeral Cloud Agent — Interactive Hermes Terminal (GCP)\033[0m"
echo -e "\033[0;32m  Region   : ${CLOUD_RUN_REGION:-australia-southeast1} (${K_REVISION:-local})\033[0m"
echo -e "\033[0;32m  Endpoint : Google Cloud Vertex AI (gemini-3.8-flash / gemini-3.5-flash-lite)\033[0m"
echo -e "\033[0;36m  Tip      : Type prompts directly to Hermes, or /bash to drop to bash.\033[0m"
echo -e "\033[1;33m========================================================================\033[0m"
echo ""

/usr/local/bin/hermes

exec /bin/bash -i
