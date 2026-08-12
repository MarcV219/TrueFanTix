#!/usr/bin/env bash
set -euo pipefail

app_dir=/home/marc/.openclaw/workspace/TrueFanTix/truefantix-web
backup_dir=/home/marc/.openclaw/backups/truefantix
env_dir=$(mktemp -d /tmp/truefantix-backup-env.XXXXXX)
trap 'rm -rf "$env_dir"' EXIT

mkdir -p "$backup_dir"
chmod 700 "$backup_dir"

cd "$app_dir"
/home/marc/.npm-global/bin/vercel env pull "$env_dir/production.env" --environment=production --yes >/dev/null
set -a
source "$env_dir/production.env"
set +a

stamp=$(date -u +%Y%m%dT%H%M%SZ)
filename="truefantix-production-${stamp}.dump"

/usr/bin/docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e DATABASE_URL="$DATABASE_URL" \
  -v "$backup_dir:/backup" \
  postgres:17-alpine \
  pg_dump "$DATABASE_URL" --format=custom --compress=9 --no-owner --no-acl --file="/backup/$filename"

chmod 600 "$backup_dir/$filename"
sha256sum "$backup_dir/$filename" > "$backup_dir/$filename.sha256"
chmod 600 "$backup_dir/$filename.sha256"
sha256sum -c "$backup_dir/$filename.sha256"

# Keep two weeks locally. IDrive independently copies this directory off-machine nightly.
find "$backup_dir" -maxdepth 1 -type f -name 'truefantix-production-*.dump*' -mtime +14 -delete
