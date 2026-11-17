// Fictional product data. This deliberately seeded failure is part of the demo.
export const locationMetrics = Object.freeze({
  'All locations': ['£48,260', '1,284'],
  Camden: ['£17,340', '462'],
  Enfield: ['£14,820', '391'],
  Shoreditch: ['£16,100', '431'],
});

export const reportingPeriods = Object.freeze(['2–8 Nov 2026', '26 Oct–1 Nov 2026']);

// BroadcastChannel is a demo transport, not an authenticated source of telemetry.
// Validate messages at the boundary so a malformed message cannot break the UI.
export function readExportMessage(message) {
  if (message?.type !== 'export') return null;

  const event = message.payload;
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  if (typeof event.location !== 'string' || !Object.hasOwn(locationMetrics, event.location))
    return null;
  if (!reportingPeriods.includes(event.period) || typeof event.ok !== 'boolean') return null;
  if (event.ok !== (event.location !== 'All locations')) return null;

  return { location: event.location, period: event.period, ok: event.ok };
}
