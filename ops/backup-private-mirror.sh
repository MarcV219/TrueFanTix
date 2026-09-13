#!/usr/bin/env bash
set -euo pipefail

backup_dir="/home/marc/.openclaw/backups/truefantix-private-mirror"
recipient="5BB50564790D8EDFC8C0A0737B2BA314BA2FDB51"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
artifact="$backup_dir/truefantix-private-mirror-$timestamp.dump.gpg"
temporary="$artifact.tmp"

install -d -m 700 "$backup_dir"
trap 'rm -f "$temporary"' EXIT

docker exec truefantix-private-mirror-db pg_dump \
  --format=custom --no-owner --no-privileges \
  --username=truefantix_mirror --dbname=truefantix_mirror \
  | gpg --batch --yes --trust-model always --recipient "$recipient" --encrypt --output "$temporary"

chmod 600 "$temporary"
mv "$temporary" "$artifact"
sha256sum "$artifact" > "$artifact.sha256"
chmod 600 "$artifact.sha256"
find "$backup_dir" -type f -name 'truefantix-private-mirror-*.dump.gpg*' -mtime +13 -delete
echo "Encrypted private-mirror backup verified: $artifact"
