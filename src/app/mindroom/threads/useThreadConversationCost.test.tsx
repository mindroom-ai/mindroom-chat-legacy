// @vitest-environment jsdom
import React from 'react';
import { EventEmitter } from 'events';
import { MatrixEvent, MatrixEventEvent } from 'matrix-js-sdk';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { useThreadConversationCostSummary } from './useThreadConversationCost';
import type { ThreadConversationCost } from './threadConversationCost';

const AGENT = '@mindroom_code:example.org';
const VIEWER = '@alice:example.org';

const pricedContent = (usd: string) => ({
  msgtype: 'm.text',
  body: 'reply',
  'io.mindroom.ai_run': { version: 1, status: 'completed', cost: { usd } },
});

// Stands in for an agent reply the SDK has not decrypted yet.
class EncryptedEvent extends EventEmitter {
  type = 'm.room.encrypted';

  content: Record<string, unknown> = { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'x' };

  constructor(private readonly id: string) {
    super();
  }

  getId = () => this.id;

  getType = () => this.type;

  getSender = () => AGENT;

  getContent = () => this.content;

  getRelation = () => null;

  isRedacted = () => false;

  isEncrypted = () => true;

  decryptAs(content: Record<string, unknown>) {
    this.type = 'm.room.message';
    this.content = content;
    this.emit(MatrixEventEvent.Decrypted, this);
  }
}

const options = {
  history: { sdkLoaded: true, canPaginateBack: false, hasMoreCachedBack: false },
  getContent: (event: MatrixEvent) => event.getContent(),
  ignoredUserIds: new Set<string>(),
  viewerId: VIEWER,
};

describe('useThreadConversationCostSummary', () => {
  it('sums an agent reply again once it decrypts', () => {
    const encrypted = new EncryptedEvent('$r1');
    const events = [encrypted as unknown as MatrixEvent];
    const results: (ThreadConversationCost | undefined)[] = [];
    function Harness() {
      results.push(useThreadConversationCostSummary(events, options));
      return null;
    }
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Harness />);
    });
    expect(results.at(-1)).toBeUndefined();

    act(() => encrypted.decryptAs(pricedContent('0.25')));

    expect(results.at(-1)?.replies).toEqual([{ eventId: '$r1', usd: 0.25 }]);
    act(() => renderer.unmount());
  });

  it('sums nothing outside a thread', () => {
    const results: (ThreadConversationCost | undefined)[] = [];
    function Harness() {
      results.push(useThreadConversationCostSummary(undefined, options));
      return null;
    }
    act(() => {
      create(<Harness />);
    });

    expect(results.at(-1)).toBeUndefined();
  });
});
