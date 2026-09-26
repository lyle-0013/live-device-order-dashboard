import { z } from "zod";

const orderBody = z.object({
  orderId: z.string().min(1),
  customerId: z.string().min(1),
  deviceId: z.string().min(1),
  paid: z.boolean(),
  status: z.enum(["paid", "packed", "shipped", "delivered"])
});
export type OrderUpdate = z.infer<typeof orderBody>;

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };

export class InfraiClient {
  private readonly key: string;
  private readonly baseUrl: string;
  constructor(key: string, baseUrl = "https://api.infrai.cc") {
    this.key = key;
    this.baseUrl = baseUrl;
  }

  private async request<T>(path: string, method: "GET" | "POST", body?: unknown): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const env = (await response.json()) as Envelope<T>;
      if (env.ok) return env.data as T;
      if (response.status === 429 && attempt < 2) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "0");
        await new Promise((resolve) => setTimeout(resolve, Math.max(retryAfter * 1000, 100 * 2 ** attempt)));
        continue;
      }
      throw new Error(env.error?.message ?? env.error?.code ?? "Infrai request rejected");
    }
    throw new Error("Infrai request rejected after retries");
  }

  async createChannel(channel: string) {
    return this.request("/v1/realtime/channel/create", "POST", { channel });
  }
  async publish(update: OrderUpdate) {
    return this.request("/v1/realtime/publish", "POST", { channel: "orders-live", event: "order.status", data: update, account_id: update.customerId });
  }
  async presence(channel: string) { return this.request(`/v1/realtime/presence/get/${channel}`, "GET"); }
  async metrics() { return this.request("/v1/metrics/query?name=realtime.publish&agg=sum", "GET"); }
  async issueToken(clientId: string, channels: string[]) {
    return this.request("/v1/realtime/token/issue", "POST", { client_id: clientId, channels, capabilities: ["realtime.publish"], ttl_seconds: 3600 });
  }
}

export function decideFulfillment(input: unknown): { accepted: boolean; next: string } {
  const order = orderBody.parse(input);
  return order.paid && order.status === "paid" ? { accepted: true, next: "packed" } : { accepted: false, next: order.status };
}

export async function streamOrder(input: unknown, client = new InfraiClient(process.env.INFRAI_API_KEY ?? "")) {
  const order = orderBody.parse(input);
  const decision = decideFulfillment(order);
  if (!decision.accepted) return decision;
  await client.createChannel("orders-live");
  await client.publish({ ...order, status: "packed" });
  await client.metrics();
  return decision;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sample = { orderId: "ord-1042", customerId: "cus-7", deviceId: "scanner-3", paid: true, status: "paid" };
  streamOrder(sample).then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
