$ErrorActionPreference = "Stop"

function Assert($cond, $msg) {
  if (-not $cond) { throw "ASSERT FAILED: $msg" }
}

Write-Host "1) Seeding fresh..." -ForegroundColor Cyan
$seedRaw = curl.exe -s -X POST "http://localhost:3000/api/debug/seed?fresh=1"
$seed = $seedRaw | ConvertFrom-Json
Assert ($seed.ok -eq $true) "Seed failed: $seedRaw"

# Sold-out ticket is first created ticket in seed output
$ticketId = $seed.createdTickets[0].ticketId
$buyerId  = $seed.buyer.buyerSellerId
$sellerId = $seed.seller.sellerId

Write-Host "   ticketId=$ticketId" -ForegroundColor DarkGray
Write-Host "   buyerId =$buyerId"  -ForegroundColor DarkGray
Write-Host "   sellerId=$sellerId" -ForegroundColor DarkGray

Write-Host "2) Running 20 concurrent purchase attempts..." -ForegroundColor Cyan
cmd /c "del /q load_*.json 2>nul & for /L %i in (1,1,20) do start /b """" curl -s --http1.1 -X POST ""http://localhost:3000/api/tickets/$ticketId/purchase?buyerSellerId=$buyerId"" -H ""Idempotency-Key: reg-so-%i"" > load_%i.json"

Start-Sleep -Seconds 2

$files = Get-ChildItem .\load_*.json -ErrorAction Stop
Assert ($files.Count -eq 20) "Expected 20 output files, got $($files.Count)"

$okCount  = (Select-String -Path .\load_*.json -Pattern '"ok":true' | Measure-Object).Count
$insCount = (Select-String -Path .\load_*.json -Pattern 'Insufficient credits' | Measure-Object).Count
$naCount  = (Select-String -Path .\load_*.json -Pattern 'Ticket not available' | Measure-Object).Count
$missCount= (Select-String -Path .\load_*.json -Pattern 'Missing idempotency key' | Measure-Object).Count

Write-Host "   OK=$okCount  InsufficientCredits=$insCount  NotAvailable=$naCount  MissingKey=$missCount" -ForegroundColor DarkGray

Assert ($missCount -eq 0) "Some requests missed Idempotency-Key header"
Assert ($okCount -eq 1) "Expected exactly 1 success; got $okCount"
Assert (($insCount + $naCount) -eq 19) "Expected remaining 19 to fail; got Ins+$insCount + NA+$naCount"

# Find the one success file and grab orderId
$successFile = (Select-String -Path .\load_*.json -Pattern '"ok":true' | Select-Object -First 1).Path
$successJson = Get-Content $successFile -Raw | ConvertFrom-Json
$orderId = $successJson.order.id

Write-Host "3) Verifying CreditTransactions via API..." -ForegroundColor Cyan
Write-Host "   orderId=$orderId" -ForegroundColor DarkGray

# Seller credits should contain ONE EARNED row for this order
$sellerCredits = (curl.exe -s "http://localhost:3000/api/sellers/$sellerId/credits") | ConvertFrom-Json
Assert ($sellerCredits.ok -eq $true) "Failed to fetch seller credits"
$sellerOrderTx = @($sellerCredits.credits | Where-Object { $_.orderId -eq $orderId })
$sellerEarned  = @($sellerOrderTx | Where-Object { $_.type -eq "EARNED" -and $_.amountCredits -eq 1 })

# Buyer credits should contain ONE SPENT row for this order
$buyerCredits = (curl.exe -s "http://localhost:3000/api/sellers/$buyerId/credits") | ConvertFrom-Json
Assert ($buyerCredits.ok -eq $true) "Failed to fetch buyer credits"
$buyerOrderTx = @($buyerCredits.credits | Where-Object { $_.orderId -eq $orderId })
$buyerSpent   = @($buyerOrderTx | Where-Object { $_.type -eq "SPENT" -and $_.amountCredits -eq -1 })

Write-Host "   seller tx for order: $($sellerOrderTx.Count)  (EARNED +1: $($sellerEarned.Count))" -ForegroundColor DarkGray
Write-Host "   buyer  tx for order: $($buyerOrderTx.Count)   (SPENT  -1: $($buyerSpent.Count))" -ForegroundColor DarkGray

Assert ($sellerOrderTx.Count -eq 1) "Expected seller to have exactly 1 credit tx for order; got $($sellerOrderTx.Count)"
Assert ($sellerEarned.Count  -eq 1) "Expected exactly 1 seller EARNED +1 row; got $($sellerEarned.Count)"

Assert ($buyerOrderTx.Count -eq 1) "Expected buyer to have exactly 1 credit tx for order; got $($buyerOrderTx.Count)"
Assert ($buyerSpent.Count   -eq 1) "Expected exactly 1 buyer SPENT -1 row; got $($buyerSpent.Count)"

Write-Host ""
Write-Host " Regression test PASSED: under concurrency, only ONE order + ONE SPENT(-1) + ONE EARNED(+1)." -ForegroundColor Green
