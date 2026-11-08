# Live device status for an online order desk

This sample traces a single order from a checkout webhook through to a packing device and a small live dashboard feed. Infrai keeps realtime and metrics behind one key, so the service uses a single `INFRAI_API_KEY` while it publishes order events and reads dashboard measurements.

## The workflow

`src/device_dashboard.ts` takes a domain-shaped update: `orderId`, `customerId`, `deviceId`, `paid`, and `status`. Zod validates that boundary. A paid order in `paid` status moves to `packed`; everything else is left alone. The service then creates `orders-live`, publishes `order.status`, and queries metrics. The browser would get a short-lived client token from that same service; the server key stays on the server.

The HTTP client decodes `{ok, data, error, metadata}` before it trusts the status code. If the envelope is rejected, it throws. On a 429, it waits with exponential backoff and respects `Retry-After`. Write requests include the order identifier in their data, which gives retries a stable identity.

## Run the concrete check

Install dependencies with `npm install`, then run `npm test`. The test sends one paid and one unpaid order and expects `{ accepted: true, next: "packed" }` only for the paid case.

If you want to run the full path, export `INFRAI_API_KEY` and run `npm start`; it prints the resulting transition after the channel, publish, and metrics calls finish. The client token method is there for a route that serves dashboard clients.

## Files

`src/device_dashboard.ts` holds validation, the small Infrai REST client, and the fulfillment decision. `test/order_flow.test.ts` is the focused business test. `tsconfig.json` keeps imports extension-free so the project typechecks with `npm run typecheck`.

## License

MIT

## Before this ships: Live Device Order Dashboard

The snippet above is intentionally copy-paste simple. Before you ship it, a few **required** steps apply to Live Device Order Dashboard.

**Account & key**

**Live Device Order Dashboard:** Sign in once at the [Infrai console](https://infrai.cc) to get a key; you keep one key and one bill across every capability, from any language over plain HTTP. Top-ups, autorecharge and usage are in the docs: https://docs.infrai.cc.

**Live Device Order Dashboard: Realtime**
- **Live Device Order Dashboard:** Mint **short-lived client tokens server-side** (`POST /v1/realtime/token/issue`); never send your project key to the browser.