#!/bin/sh
set -eu

if [ "${RENEWED_LINEAGE:-}" = "/etc/letsencrypt/live/contable.app360.com.ar" ]; then
    nginx -t
    systemctl reload nginx
fi
