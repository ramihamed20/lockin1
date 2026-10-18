import { request } from "./client.js";
import { generateIdempotencyKey } from "./pagination.js";

export const refundClaimsApi = {
  async list(finance = false, page = 1, scope = "open") {
    const data = await request(`${finance ? "/operations/admin/refund-requests" : "/refund-requests"}?page=${page}${finance ? `&scope=${encodeURIComponent(scope)}` : ""}`);
    return Array.isArray(data) ? { results: data, count: data.length, next: null, previous: null } : data;
  },
  create(body, key) { return request("/refund-requests", { method: "POST", body, idempotencyKey: key }); },
  contact(id, receiverPhone) { return request(`/refund-requests/${id}`, { method: "PATCH", body: { receiver_phone: receiverPhone } }); },
  review(id, body) { return request(`/operations/admin/refund-requests/${id}`, { method: "POST", body }); },
  recordExternal(body, key = generateIdempotencyKey()) { return request("/operations/admin/refund-requests", { method: "POST", body, idempotencyKey: key }); }
};
