export function groupEvents(events) {
  const groups = []
  for (const event of events) {
    const actor = typeof event.actor === 'string' && event.actor.trim() !== ''
      ? event.actor
      : 'system'
    const previous = groups.at(-1)
    if (previous?.actor === actor) {
      previous.count += 1
      previous.labels.push(event.label)
    } else {
      groups.push({ actor, count: 1, labels: [event.label] })
    }
  }
  return groups
}
