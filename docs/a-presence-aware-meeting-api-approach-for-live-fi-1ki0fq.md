# A Presence-Aware Meeting API Approach for Live Financial Captions

| Choice | Caption path | Presence role | Best fit |
|---|---|---|---|
| Transcribe, persist, then publish | Separate from meeting media | Gates ephemeral delivery, never the record | Financial meetings that need accurate recovery |
| Transcribe and publish directly | Coupled to the live session | Usually inferred from the open stream | Short, disposable sessions with no replay requirement |

**TL;DR:** I'd choose the first path. A meeting API should move audio to a transcription worker, commit each finalized caption segment with a stable sequence, and then publish it to viewers who are actually present. Presence may decide who receives the fast path. It must not decide whether a caption exists.

This is the useful boundary for a financial advisory meeting because a read receipt and a typing indicator are hints, while a caption is part of the meeting record. Mixing those meanings creates a system that looks live on a good connection and becomes ambiguous after a reconnect. The revenue-per-hour lens points the same way: build one durable caption contract, then outsource undifferentiated media transport and speech recognition behind interfaces. Ship the smallest version weekly, but keep the record correct from week one.

## How should a meeting API transcribe and publish live captions?

Presence answers a narrow question: which participant appears reachable now? It cannot prove that a viewer received, rendered, or read a caption. A laptop can sleep after joining. A mobile radio can disappear before the server notices. Two tabs can represent one person. Those are normal distributed-system states, not exceptional bugs.

The distinction matters more in fintech than in casual chat. Consider an adviser saying, "The transfer limit is fifteen thousand," while a client briefly changes networks. If delivery is tied only to the current subscriber set, the client may return at segment 184 after missing segment 183. The green presence dot is accurate again, yet the conversation is incomplete.

Use three different signals:

- Presence says a participant currently has a live session eligible for ephemeral updates.
- A delivery acknowledgement says a client received a particular sequence through a particular connection.
- A read receipt says the client displayed up to a sequence, according to the product's declared semantics.

Do not collapse them into one Boolean. A typing indicator can expire after a short interval because it describes fleeting intent. A read receipt should be monotonic: once a participant reports sequence 184 as displayed, a late report for 181 must not move the marker backward. Captions need the strongest contract of the three. Persist first, assign order once, and allow replay from the last acknowledged sequence.

This is the primary criterion: **presence accuracy affects routing, not caption durability**. It keeps fan-out efficient without giving a transient membership view authority over the meeting record.

## The publishing contract that survives reconnects

The transcription boundary should emit finalized segments rather than mutable screen text. Partial hypotheses are useful for responsiveness, but they may change as more audio arrives. Treat them as replaceable UI state. A finalized segment gets a meeting-scoped sequence and becomes replayable.

A compact event is enough:

```ts
type FinalCaption = {
  meetingId: string;
  sequence: number;
  speakerId: string;
  startedAtMs: number;
  endedAtMs: number;
  text: string;
};

type Receipt = {
  meetingId: string;
  participantId: string;
  displayedThrough: number;
};
```

Sequence is the ordering authority. Timestamps remain useful for display and media alignment, but independently produced timestamps are a poor substitute for an assigned order. The publisher should reject or quarantine a finalized event that lacks its meeting identity, speaker identity, or time bounds. It should make duplicate writes harmless by using the pair `(meetingId, sequence)` as the logical identity.

Keep the state machine boring. The worker receives audio, the transcription stage produces hypotheses, and a finalization step writes a segment. Only after that commit does the fan-out layer notify currently present viewers. A reconnecting client asks for every finalized sequence after its local cursor, applies them in order, then resumes the live feed. If live sequence 185 races with a replay containing 184 and 185, logical identity makes 185 a duplicate rather than a second line of dialogue.

Fast is useful. Correct is billable.

The second criterion is operational ownership. A solo SaaS cannot afford three competing definitions of delivery spread across a media callback, a socket handler, and the browser. One publish function should own validation, persistence, and notification order. Speech recognition can be replaced later. The event contract and recovery test stay put.

## A narrow TypeScript implementation

The following example leaves media capture and transcription behind interfaces. That is deliberate. WebRTC defines browser-facing real-time media and data facilities, but it does not define the application's caption durability contract. The application still has to decide when text is final, how it is ordered, and what a reconnect means.

```ts
type DraftCaption = Omit<FinalCaption, "sequence">;

interface CaptionStore {
  append(draft: DraftCaption): Promise<FinalCaption>;
  after(meetingId: string, sequence: number): Promise<FinalCaption[]>;
}

interface PresenceIndex {
  connectionIds(meetingId: string): Promise<string[]>;
}

interface RealtimeBus {
  publish(connectionId: string, caption: FinalCaption): Promise<void>;
}

class CaptionPublisher {
  constructor(
    private readonly store: CaptionStore,
    private readonly presence: PresenceIndex,
    private readonly bus: RealtimeBus,
  ) {}

  async finalize(draft: DraftCaption): Promise<FinalCaption> {
    if (draft.endedAtMs < draft.startedAtMs || draft.text.trim() === "") {
      throw new Error("Invalid finalized caption");
    }

    const caption = await this.store.append(draft);
    const connections = await this.presence.connectionIds(caption.meetingId);

    await Promise.allSettled(
      connections.map((connectionId) =>
        this.bus.publish(connectionId, caption),
      ),
    );

    return caption;
  }

  replay(meetingId: string, displayedThrough: number): Promise<FinalCaption[]> {
    return this.store.after(meetingId, displayedThrough);
  }
}
```

`Promise.allSettled` makes the live notification best-effort across current connections. A failed socket does not undo the committed caption or prevent healthy viewers from receiving it. The next replay closes the gap. This ordering also keeps retry policy out of the speech callback, where backpressure could interfere with audio processing.

The test suite should be heavier around transitions than around the happy-path payload. Disconnect a viewer after the store append but before publish. Deliver the same sequence twice. Return presence entries for two tabs. Reconnect with a cursor behind the current head. Send receipt 181 after receipt 184. Those five cases expose most of the semantic confusion without requiring an elaborate load harness.

For observability, track finalized segments, publish attempts, publish failures, replayed segments, and cursor lag separately. Do not turn them into one "caption success" percentage. A rising replay count with stable transcription output points toward delivery or client lifecycle trouble; missing finalized segments points earlier in the pipeline. Logs should carry the meeting ID and sequence, while access controls and retention rules should treat transcript text as sensitive meeting data.

## When the direct path is the better trade

The runner-up is reasonable when captions are explicitly disposable, a missed line has no later value, and the interface makes that limitation clear. A moderated live event with no transcript, no read state, and no reconnect history may accept direct transcription-to-publish. It has fewer moving pieces and can reach the screen sooner.

It is also a valid prototype boundary. During a one-week validation, direct publish can test whether users want captions before building retention controls. The condition is strict: do not quietly promote that prototype into the record path for advisory meetings. Once users rely on replay, receipts, or audit review, add durable sequencing before adding more presence features.

This choice is less attractive when speakers overlap, connections churn, or clients need consistent accessibility behavior after recovery. Presence precision cannot repair an event that was never stored.

For a one-person company, the decision rule stays compact: spend custom engineering time on the meeting-specific state contract and the tests that protect it. Buy or reuse the commodity layers when that reduces maintenance, but keep adapters around them. That preserves the option to change media or transcription components without rewriting delivery semantics. **The durable segment is the product boundary; presence is an optimization around it.**

## References

- W3C, WebRTC 1.0: Real-Time Communication Between Browsers: https://www.w3.org/TR/webrtc/
