/** All limits apply to one window. No retained preview has a wall-clock expiry. */
export const filePreviewRetentionLimits = Object.freeze({
  snapshots: 24,
  hotThreads: 8,
  backgroundBytes: 128 * 1024 * 1024,
  htmlInstances: 4,
  handles: 64
})
