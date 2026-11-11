export function isReservationExpired(
  reservedUntil: Date | null | undefined,
  now: Date,
): boolean {
  return !reservedUntil || reservedUntil.getTime() <= now.getTime();
}
