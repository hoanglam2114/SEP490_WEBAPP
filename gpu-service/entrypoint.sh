#!/bin/bash
# entrypoint.sh

# Nếu có NGROK_TOKEN, export nó để Python có thể đọc
if [ ! -z "$NGROK_TOKEN" ]; then
    echo "Using provided NGROK_TOKEN"
    export NGROK_TOKEN=$NGROK_TOKEN
fi

# Chạy ứng dụng Python
exec python3 gpu_service_04_03.py
