import assert from "node:assert/strict";
import { decideFulfillment } from "../src/device_dashboard.js";

assert.deepEqual(decideFulfillment({ orderId: "o1", customerId: "c1", deviceId: "d1", paid: true, status: "paid" }), { accepted: true, next: "packed" });
assert.deepEqual(decideFulfillment({ orderId: "o2", customerId: "c1", deviceId: "d1", paid: false, status: "paid" }), { accepted: false, next: "paid" });
console.log("order fulfillment decisions pass");
