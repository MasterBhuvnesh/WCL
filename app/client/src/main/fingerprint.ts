import { createHash } from 'crypto'
import { hostname, networkInterfaces, platform } from 'os'

/**
 * Stable per-machine fingerprint for exam session binding. Node stdlib only, no
 * new deps. The server binds the JWT to whatever `deviceId` the client sends at
 * login (see app/api/src/routes/exam.ts), so this only has to be stable across
 * relaunches on the same hardware — not globally unique or unforgeable.
 *
 * Composed from: sorted non-internal MAC addresses + hostname + platform,
 * hashed with sha256. Computed once and cached.
 */
let cached: string | null = null

export function deviceId(): string {
  if (cached) return cached

  const macs = new Set<string>()
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      // Skip loopback/internal and the all-zero placeholder MAC.
      if (iface.internal) continue
      if (!iface.mac || iface.mac === '00:00:00:00:00:00') continue
      macs.add(iface.mac.toLowerCase())
    }
  }

  const material = [...[...macs].sort(), hostname(), platform()].join('|')
  cached = createHash('sha256').update(material).digest('hex')
  return cached
}
