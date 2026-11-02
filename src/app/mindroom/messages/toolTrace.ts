export type MindroomToolTraceEvent = {
  type?: unknown;
  tool_name?: unknown;
  args_preview?: unknown;
  result_preview?: unknown;
  truncated?: unknown;
  // The latest output a running call reported; only live frames carry it.
  progress?: unknown;
};

export type MindroomToolMetadataStatus = 'loading' | 'unavailable';

type MindroomToolTraceContent = {
  version?: unknown;
  events?: unknown;
};

export const MINDROOM_TOOL_TRACE_KEY = 'io.mindroom.tool_trace';

const asMindroomToolTrace = (trace: unknown): MindroomToolTraceContent | undefined =>
  trace && typeof trace === 'object' ? (trace as MindroomToolTraceContent) : undefined;

const getToolTraceEvents = (
  trace: MindroomToolTraceContent | undefined
): MindroomToolTraceEvent[] | undefined => {
  const eventsRaw = trace?.events;
  if (!Array.isArray(eventsRaw) || eventsRaw.length === 0) return undefined;

  const events = eventsRaw.filter(
    (event): event is MindroomToolTraceEvent => !!event && typeof event === 'object'
  );

  return events.length > 0 ? events : undefined;
};

export const isMindroomToolTraceV2 = (content: Record<string, unknown>): boolean =>
  asMindroomToolTrace(content[MINDROOM_TOOL_TRACE_KEY])?.version === 2;

export const getMindroomToolTraceEvents = (
  content: Record<string, unknown>
): MindroomToolTraceEvent[] | undefined =>
  getToolTraceEvents(asMindroomToolTrace(content[MINDROOM_TOOL_TRACE_KEY]));

/** The events of a tool trace value (`content['io.mindroom.tool_trace']`) when it is version 2. */
export const getMindroomToolTraceV2Events = (
  trace: unknown
): MindroomToolTraceEvent[] | undefined => {
  const toolTrace = asMindroomToolTrace(trace);
  return toolTrace?.version === 2 ? getToolTraceEvents(toolTrace) : undefined;
};

export const getMindroomToolTraceEventByIndex = (
  content: Record<string, unknown>,
  oneBasedIndex: number
): MindroomToolTraceEvent | undefined => {
  if (!Number.isInteger(oneBasedIndex) || oneBasedIndex < 1) return undefined;
  const events = getMindroomToolTraceEvents(content);
  return events?.[oneBasedIndex - 1];
};
