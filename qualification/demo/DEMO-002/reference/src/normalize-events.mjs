export function normalizeEvents(events) {
  const seen = new Set()
  const normalized = []
  for (const event of events) {
    const id = text(event?.id ?? event?.eventId)
    if (!id || seen.has(id)) continue
    seen.add(id)
    normalized.push({
      id,
      actor: text(event?.actor ?? event?.actorId) || 'system',
      kind: text(event?.type ?? event?.kind) || 'unknown',
      value: Object.hasOwn(event ?? {}, 'value') ? event.value : event?.payload?.value
    })
  }
  return normalized
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}
