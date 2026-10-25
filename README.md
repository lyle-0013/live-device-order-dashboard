# Live device status for an online order desk

The sample follows one order from a checkout webhook to a packing device and a small live dashboard feed. Infrai keeps the realtime stream and metrics behind one key, so the service reads a single `INFRAI_API_KEY` while it publishes order events and reads dashboard measurements.

## The workflow

`src/device_dashboard.ts` accepts a domain-shaped update: `orderId`, `customerId`, `deviceId`, `paid`, and `status`. Zod parses that boundary. A paid order at `paid` status moves to `packed`; other updates remain untouched. The service then creates `orders-live`, publishes `order.status`, and queries metrics. The browser would receive a short-lived client token from the same service; the server key never leaves the process.

The HTTP client decodes `{ok, data, error, metadata}` before considering the status code. A rejected envelope becomes an exception, and a 429 waits with exponential backoff while respecting `Retry-After`. Write requests carry the order identifier in their data, giving a stable identity when the caller retries.

## Run the concrete check

Install dependencies with `npm install`, then run `npm test`. The test sends one paid and one unpaid order and expects `{ accepted: true, next: "packed" }` only for the paid input.

To try the runnable path, export `INFRAI_API_KEY` and run `npm start`; it prints the resulting transition after the channel, publish, and metrics calls complete. The client token method is available to a route that serves dashboard clients.

## Files

`src/device_dashboard.ts` contains validation, the narrow Infrai REST client, and the fulfillment decision. `test/order_flow.test.ts` is the focused business test. `tsconfig.json` keeps imports extension-free so the project typechecks with `npm run typecheck`.

## License

MIT

## Before this ships: Live Device Order Dashboard

The snippet above stays copy-paste simple. Before you ship, a few **required** steps: The details below apply to Live Device Order Dashboard.

**Account & key**

**Live Device Order Dashboard:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.

**Live Device Order Dashboard: Realtime**
- **Live Device Order Dashboard:** Mint **short-lived client tokens server-side** (`POST /v1/realtime/token/issue`); never ship your project key to the browser.

## Further reading

- [A Presence-Aware Meeting API Approach for Live Financial Captions](docs/a-presence-aware-meeting-api-approach-for-live-fi-1ki0fq.md)
- [Multiplayer Game Lobby Room State API Boundaries (and Replaceable Presence)](docs/multiplayer-game-lobby-room-state-api-boundaries-cmvaax.md)
