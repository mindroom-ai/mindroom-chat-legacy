import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/live-frames-v1.json';
import { applyLiveDelta, compareLiveOrder, parseLiveFrame, type LiveDocs } from './liveFrame';

const SID = '1761858000123-0a1b2c3d';
const docs: LiveDocs = { md: 'Hello', reasoning: '', tools: [], status: 'streaming', activity: '' };
const frame = (body: Record<string, unknown>) => ({
  v: 1,
  reply: '$reply',
  sid: SID,
  seq: 1,
  ...body,
});

describe('live reply frames', () => {
  it.each(fixture.cases.map((testCase) => [testCase.name, testCase] as const))(
    'turns the documents before plus the frame into the documents after: %s',
    (_name, testCase) => {
      const parsed = parseLiveFrame(testCase.frame);
      expect(parsed).not.toBeNull();
      if (!parsed) return;

      const after =
        'snapshot' in parsed
          ? parsed.snapshot
          : applyLiveDelta(testCase.before as LiveDocs, parsed.delta);

      expect(after).toEqual(testCase.after);
    }
  );

  it.each([
    ['no version', { reply: '$reply', sid: SID, seq: 0, delta: { activity: '' } }],
    ['another version', frame({ v: 2, delta: { activity: '' } })],
    ['both a snapshot and a delta', frame({ snapshot: docs, delta: { activity: '' } })],
    ['neither a snapshot nor a delta', frame({})],
    ['a negative seq', frame({ seq: -1, delta: { activity: '' } })],
    ['a fractional seq', frame({ seq: 1.5, delta: { activity: '' } })],
    ['a reply that is not a string', frame({ reply: 7, delta: { activity: '' } })],
    ['a malformed sid', frame({ sid: 'publisher', delta: { activity: '' } })],
    ['an empty delta', frame({ delta: {} })],
    ['a snapshot missing a document', frame({ snapshot: { ...docs, activity: undefined } })],
    ['an unknown status', frame({ delta: { status: 'completed' } })],
    ['a tool entry that is not an object', frame({ snapshot: { ...docs, tools: ['x'] } })],
    [
      'a splice starting after the new length',
      frame({ delta: { md: { at: 6, del: 0, ins: '', len: 5 } } }),
    ],
    [
      'a splice inserting past the new length',
      frame({ delta: { md: { at: 4, del: 0, ins: 'abc', len: 5 } } }),
    ],
    ['a negative splice offset', frame({ delta: { md: { at: -1, del: 0, ins: '', len: 5 } } })],
    ['a tool index past the list', frame({ delta: { tools: { len: 1, set: [[1, {}]] } } })],
  ])('rejects a frame with %s', (_name, content) => {
    expect(parseLiveFrame(content)).toBeNull();
  });

  it('rejects content that is not an object', () => {
    expect(parseLiveFrame(null)).toBeNull();
    expect(parseLiveFrame('frame')).toBeNull();
  });

  it('detects a splice that does not fit the document', () => {
    expect(applyLiveDelta(docs, { md: { at: 5, del: 0, ins: '!', len: 7 } })).toBeNull();
    expect(applyLiveDelta(docs, { md: { at: 4, del: 2, ins: '', len: 4 } })).toBeNull();
    expect(applyLiveDelta(docs, { md: { at: 5, del: 0, ins: '!', len: 6 } })).toEqual({
      ...docs,
      md: 'Hello!',
    });
  });

  it('detects a tool list extended without its new entries', () => {
    expect(applyLiveDelta(docs, { tools: { len: 2, set: [[0, {}]] } })).toBeNull();
  });

  it('orders frames by publisher generation, then by seq', () => {
    const older = { sid: '1761858000123-ffffffff', seq: 50 };
    const newer = { sid: '1761858000124-00000000', seq: 0 };

    expect(compareLiveOrder(older, newer)).toBeLessThan(0);
    expect(compareLiveOrder(newer, older)).toBeGreaterThan(0);
    expect(compareLiveOrder({ sid: SID, seq: 2 }, { sid: SID, seq: 10 })).toBeLessThan(0);
    expect(compareLiveOrder({ sid: SID, seq: 3 }, { sid: SID, seq: 3 })).toBe(0);
  });
});
