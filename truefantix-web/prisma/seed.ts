async function main() {
  console.log("Ticket seeding is disabled. Create tickets through the seller listing flow.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
