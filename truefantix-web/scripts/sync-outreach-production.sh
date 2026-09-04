#!/usr/bin/env bash
set -euo pipefail

app_dir="/home/marc/.openclaw/workspace/TrueFanTix/truefantix-web"
temp_dir="$(mktemp -d)"
cleanup() {
  rm -f "$temp_dir/production.env"
  rmdir "$temp_dir" 2>/dev/null || true
}
trap cleanup EXIT

cd "$app_dir"
HOME=/home/marc npx vercel env pull "$temp_dir/production.env" --environment=production --yes >/dev/null
set -a
# shellcheck disable=SC1090
source "$temp_dir/production.env"
set +a
npm run db:import-outreach
npx -y tsx -e 'import {PrismaClient} from "@prisma/client"; import {PrismaPg} from "@prisma/adapter-pg"; const p=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL!})}); const run=async()=>{const [count,newest]=await Promise.all([p.outreachContact.count(),p.outreachContact.aggregate({_max:{verifiedAt:true}})]); console.log(JSON.stringify({ok:true,count,newestVerifiedAt:newest._max.verifiedAt}));}; run().finally(()=>p.$disconnect())'
