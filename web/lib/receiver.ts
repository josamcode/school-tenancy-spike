export interface ReceiverRecord {
  id: string;
  receivedAt: string;
  signatureValid: boolean;
  verdict: 'accepted' | 'duplicate' | 'bad_signature' | 'stale';
}

// What the fake webhook receiver recorded for an event. Development only:
// the development server is told where the receiver is, a production server
// is not, and then nothing is asked.
export async function receiverRecords(
  eventId: string,
): Promise<ReceiverRecord[] | undefined> {
  const base = process.env.RECEIVER_URL;
  if (process.env.NODE_ENV === 'production' || !base) return undefined;
  try {
    const response = await fetch(
      `${base}/received/${encodeURIComponent(eventId)}`,
      { cache: 'no-store', signal: AbortSignal.timeout(2000) },
    );
    if (!response.ok) return undefined;
    return (await response.json()) as ReceiverRecord[];
  } catch {
    return undefined;
  }
}
