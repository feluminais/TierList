/** The most proxies in front of the API that anyone could mean. */
const MAX_TRUSTED_PROXY_HOPS = 8;

/**
 * How many reverse proxies sit in front of this process, from
 * `TRUSTED_PROXY_HOPS`.
 *
 * Unset means none, which makes the rate limiter key on the socket's address
 * and ignore `X-Forwarded-For`. Behind a proxy that address is the proxy's, so
 * a deploy sets this to the number of proxies and the limiter reads the client
 * from the right place. It throws on anything else rather than guess: a wrong
 * count either puts every client in one bucket or lets a client choose its own.
 */
export function parseTrustedProxyHops(raw: string | undefined): number {
  const text = (raw ?? "").trim();
  if (text === "") return 0;
  if (!/^\d+$/.test(text)) {
    throw new Error(`TRUSTED_PROXY_HOPS must be a whole number of proxies, got ${JSON.stringify(raw)}`);
  }
  const hops = Number(text);
  if (hops > MAX_TRUSTED_PROXY_HOPS) {
    throw new Error(
      `TRUSTED_PROXY_HOPS must be at most ${MAX_TRUSTED_PROXY_HOPS}, got ${hops}`,
    );
  }
  return hops;
}
