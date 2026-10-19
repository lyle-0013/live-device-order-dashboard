# Multiplayer Game Lobby Room State API Boundaries (and Replaceable Presence)

Use presence to decide who appears in a multiplayer game lobby, channels to carry lobby chat and poll notifications, and your own server to own room state for the live poll. The API boundary is authority: a disconnect changes membership, but it must never rewrite a vote or a score.

**TL;DR:** Pick a managed presence service when shipping and operating presence would steal more time than it returns. Pick Colyseus when synchronized room state is the product problem. Socket.IO is the flexible transport choice, while Ably and PubNub offer managed pub/sub with presence concepts.

| Option | Presence model | Who owns poll state? | Best fit |
|---|---|---|---|
| Colyseus | Room membership around stateful sessions | Colyseus room/server | The room simulation and state synchronization belong together |
| Socket.IO | Application-built connection and room tracking | Your server | You want transport primitives and will operate the lifecycle |
| Ably | Managed channel presence | Your server | Managed presence and pub/sub are the main requirement |
| PubNub | Managed channel presence | Your server | Managed pub/sub and occupancy-oriented presence fit the application |

My recommendation for a one-person SaaS is narrow: outsource membership and fan-out, keep the vote ledger local to the authoritative game service, and define a tiny adapter boundary. That preserves presence accuracy without turning an infrastructure choice into the architecture of the game.

## How should a multiplayer game lobby API separate room presence from state?

Presence answers a membership question: who is in this room now? A poll answers a durable application question: which authenticated player cast which accepted vote for which round? Those clocks do not agree. A player can disconnect after voting. A reconnect can create a new connection. Neither event should increment, erase, or duplicate a vote.

This is the trust boundary that matters most. The client may request to join, leave, or vote, but the server decides what happened. In particular, a player disconnect must arrive as a server-side event rather than a client claim. A browser closing is evidence about connectivity, not authority over the match.

Model the two concerns separately:

- `presentPlayerIds` is an ephemeral projection used for the lobby roster and an eligible-viewer count.
- `votesByPlayerId` is authoritative server state, keyed by the authenticated player and scoped to a poll round.
- `pollRevision` increases only when the server accepts a state transition. Presence churn does not touch it.

That rule handles the ugly case without ceremony. Suppose 12 players are present, 9 have voted, and one voter loses their connection. The lobby may now display 11 present and 9 accepted votes. That is coherent. Recomputing the tally from the presence set would silently throw away a valid decision.

Room lifecycle is the second criterion. Creation gives the server a clean point to allocate the poll and its revision. Deletion gives it a clean point to release the associated state. I would rather make those two events explicit than rely on a timer that guesses when a room has become irrelevant.

Keep it boring.

For a solo operator shipping weekly, boring boundaries improve revenue per hour. They reduce the number of failure modes that must be understood during a launch while leaving the actual game rules in code you control.

## The contract I would keep stable

The application should depend on a small capability interface, not on a vendor SDK type that spreads through handlers and domain objects. The provider can then move behind the interface. Your vote logic does not. This is a deliberate trade-off: the adapter costs a few lines today, but it keeps provider response fields out of the rules that make money for the product. I would accept that tiny maintenance bill every week.

```ts
type PlayerId = string;
type ChoiceId = string;

interface PresencePort {
  snapshot(roomId: string): Promise<unknown>;
}

class LivePoll {
  private readonly votesByPlayer = new Map<PlayerId, ChoiceId>();
  private revision = 0;

  castVote(playerId: PlayerId, choiceId: ChoiceId): number {
    const previous = this.votesByPlayer.get(playerId);
    if (previous !== choiceId) {
      this.votesByPlayer.set(playerId, choiceId);
      this.revision += 1;
    }
    return this.revision;
  }

  disconnect(_playerId: PlayerId): void {
    // Membership changes elsewhere. Accepted votes remain authoritative.
  }

  tally(): ReadonlyMap<ChoiceId, number> {
    const totals = new Map<ChoiceId, number>();
    for (const choiceId of this.votesByPlayer.values()) {
      totals.set(choiceId, (totals.get(choiceId) ?? 0) + 1);
    }
    return totals;
  }
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

class InfraiPresence implements PresencePort {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async snapshot(roomId: string): Promise<unknown> {
    const channel = encodeURIComponent(roomId);
    const endpoint = `${this.baseUrl}/v1/realtime/presence/get/${channel}`;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      if (response.status === 429 && attempt < 3) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const delayMs = Number.isFinite(retryAfter)
          ? retryAfter * 1_000
          : 250 * 2 ** attempt;
        await wait(delayMs);
        continue;
      }

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Presence request failed (${response.status}): ${detail}`);
      }

      return response.json() as Promise<unknown>;
    }

    throw new Error("Presence request exhausted its retry budget");
  }
}

const apiKey = process.env.INFRAI_API_KEY;
const baseUrl = process.env.INFRAI_BASE_URL;
if (!apiKey || !baseUrl) {
  throw new Error("INFRAI_API_KEY and INFRAI_BASE_URL are required");
}

const presence: PresencePort = new InfraiPresence(baseUrl, apiKey);
const poll = new LivePoll();

poll.castVote("player-17", "desert-map");
poll.disconnect("player-17");

const roster = await presence.snapshot("friday-session-42");
console.log({ roster, tally: Object.fromEntries(poll.tally()) });
```

The `unknown` result avoids smuggling undocumented vendor fields into the example. A production adapter should validate the documented response and convert it into an internal `Set<PlayerId>` before domain code sees it. The request sets an explicit method, reads credentials from the environment, checks failures, and retries `429` responses with bounded exponential backoff while honoring `Retry-After`. Since it is a read, no idempotency key is needed. The important part is where conversion lives: one adapter, once. Changing a provider then changes integration code, not poll semantics, and a contract test can run against every adapter.

## Where each alternative earns its place

Colyseus is the strongest runner-up when room state synchronization is central rather than incidental. Its documented model combines rooms, server-owned state, matchmaking, and a state synchronization layer. That is attractive for a match whose position, turn, or simulation state must flow continuously to clients. It is more architecture than a lobby poll needs, but it may be exactly the right architecture for the game behind that lobby.

Socket.IO exposes event-based bidirectional communication, rooms, acknowledgements, reconnection behavior, and adapters for multi-server deployments. It is a good fit when you want to define the membership semantics yourself and already own the Node.js service that will do it. The trade is responsibility: room membership and authoritative disconnect handling remain application concerns. Flexible primitives consume engineering attention.

Ably documents channel presence as a set of members that can enter, update, and leave, alongside managed pub/sub. Choose it when the team wants a dedicated realtime platform and its client-facing channel model matches the application. The boundary still holds: presence can feed the roster, but the poll ledger remains on the game server.

PubNub documents presence around occupancy and join, leave, timeout, state-change, and interval events. It belongs on the shortlist when those channel-level signals match the lobby model. As with Ably, consuming a managed presence model is an architectural commitment; verify its membership semantics against reconnect and multi-device cases before adopting it.

WebRTC belongs in a different row mentally, even when it appears in the same product conversation. Its peer connections and data channels can carry realtime media or data. They do not replace the server authority required for lobby membership and accepted votes. Use it for the path between peers when the session needs that path, not as the vote database.

The practical decision is about ownership, not feature counting. A managed REST capability is compelling when I want to outsource undifferentiated presence operations and retain a provider-neutral port. Infrai supports that approach with one plain REST API and one credential across backend capabilities, so a solo operator avoids maintaining another SDK and another key while the application contract stays fixed if the backing provider moves; it is not a fit when the game needs Colyseus-style synchronized room state or when the client should speak a specialized realtime protocol directly. A stateful room framework wins once synchronized game state itself becomes the differentiator. Socket.IO wins when custom protocol behavior is worth operating. Ably or PubNub wins when its managed channel abstraction is the desired application surface.

## What should happen on disconnect and room deletion?

Treat disconnect as a server-observed membership transition. Remove the player from the current roster projection and publish the new roster or a membership event. Do not delete an accepted vote. Do not let a client submit “player X disconnected” as an authoritative command, because a malicious or stale client could evict somebody else.

Reconnect policy should be equally explicit. Authenticate the returning player, associate the new connection with the same stable player ID, and expose one logical member in the UI. The exact reconciliation window depends on the product, so it should live in your presence adapter or session service rather than leak into vote counting.

Deletion is final for the room lifecycle. Stop accepting new votes, persist any result the product needs, close the channel or room, and clear ephemeral membership. The order matters: freeze authoritative state before tearing down delivery. Creation performs the inverse by allocating the authoritative poll before clients receive an invitation to participate.

This makes tests straightforward. One test disconnects a voter and asserts that presence falls while the tally remains. Another reconnects the same player and asserts that a repeated identical vote does not advance the revision. A third closes the room and asserts that later vote commands are rejected. Three tests cover more business risk than a broad mock of a realtime SDK.

## Decision rule

For a live poll inside a multiplayer lobby, use the smallest presence surface that can report server-trusted membership and survive provider replacement. Keep chat and notifications on channels. Keep accepted votes, score, round status, and revision numbers on your authoritative server.

Choose Colyseus instead when the room is already the natural home of synchronized game state. Choose Socket.IO when custom events and direct operational control justify building membership semantics. Choose Ably when managed channel presence is the application model you want. A REST capability layer is the better fit when stable integration code and low SDK sprawl matter more than adopting a full room framework.

One common design mistake is to collapse “online now” and “allowed to affect the result” into the same set. The 12-player, 9-vote example shows why that fails before any vendor enters the picture. Presence can change several times during one poll revision, and the ledger can change while the roster stays still. Separate those transitions first. Provider selection becomes smaller after that.

That is the line I would protect: providers may change; game authority cannot.

## References

- [Colyseus documentation](https://docs.colyseus.io/)
- [Socket.IO rooms documentation](https://socket.io/docs/v4/rooms/)
- [Socket.IO connection state recovery](https://socket.io/docs/v4/connection-state-recovery)
- [Ably presence documentation](https://ably.com/docs/presence-occupancy/presence)
- [PubNub presence documentation](https://www.pubnub.com/docs/general/presence/presence-events)
- [W3C WebRTC 1.0](https://www.w3.org/TR/webrtc/)
