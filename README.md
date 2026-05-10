# Rivus

## Contract: Atomic Deploys

1. **Releases are immutable and content-addressed.** Each deploy creates `domains/<host>/releases/<sha>/...`. Once written, never modified.
2. **Pointer flip is the deploy commit.** The management API does NOT update `domains/<host>/current.json` until all blobs of the new release have been confirmed written on BOTH primary and secondary. The pointer flip is the moment the new release becomes live.
3. **Pointer file replication can be async.** Primary's pointer may briefly lead secondary's. The gateway reads `current.json` from the same tier it ends up serving from, so a request is internally consistent (might be on the older release during primary outage, never torn between releases).
4. **Old releases are retained for a grace period** (recommend ≥ 30 minutes after a flip) to absorb in-flight requests still holding the old pointer.
5. **Garbage collection** of old releases is the management API's responsibility, never the gateway's.
