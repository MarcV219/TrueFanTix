#!/usr/bin/env bash
set -euo pipefail

app_dir="/home/marc/.openclaw/workspace/TrueFanTix/truefantix-web"
database_url_override="${OUTREACH_DATABASE_URL:-}"
private_mirror_env="/home/marc/truefantix/secrets/private-mirror-db.env"
temp_dir="$(mktemp -d)"
cleanup() {
  rm -f "$temp_dir/production.env"
  rmdir "$temp_dir" 2>/dev/null || true
}
trap cleanup EXIT

cd "$app_dir"
for attempt in 1 2 3; do
  if HOME=/home/marc npx vercel env pull "$temp_dir/production.env" --environment=production --yes >/dev/null; then
    break
  fi
  if [[ "$attempt" == "3" ]]; then
    echo "Unable to download Vercel production environment after 3 attempts" >&2
    exit 1
  fi
  rm -f "$temp_dir/production.env"
  sleep 2
done
set -a
# shellcheck disable=SC1090
source "$temp_dir/production.env"
set +a
if [[ "$database_url_override" == "postgresql://truefantix_mirror@127.0.0.1:55432/truefantix_mirror" ]]; then
  if [[ ! -r "$private_mirror_env" ]]; then
    echo "Missing private mirror database credential: $private_mirror_env" >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  source "$private_mirror_env"
  set +a
  : "${PRIVATE_MIRROR_DATABASE_PASSWORD:?Missing PRIVATE_MIRROR_DATABASE_PASSWORD}"
  database_url_override="postgresql://truefantix_mirror:${PRIVATE_MIRROR_DATABASE_PASSWORD}@127.0.0.1:55432/truefantix_mirror"
fi
if [[ -n "$database_url_override" ]]; then
  export DATABASE_URL="$database_url_override"
fi
npm run db:import-outreach
npx -y tsx -e 'import {PrismaClient} from "@prisma/client"; import {PrismaPg} from "@prisma/adapter-pg"; const p=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL!})}); const run=async()=>{const [count,newest]=await Promise.all([p.outreachContact.count(),p.outreachContact.aggregate({_max:{verifiedAt:true}})]); console.log(JSON.stringify({ok:true,count,newestVerifiedAt:newest._max.verifiedAt}));}; run().finally(()=>p.$disconnect())'
