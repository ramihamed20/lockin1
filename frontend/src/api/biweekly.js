import { API_BASE_PATH, request } from "./client.js";

const segment = (value) => encodeURIComponent(String(value));

export const biweeklyApi = {
  history: (type) => request(`/biweekly/${segment(type)}`),
  report: (type, id) => request(`/biweekly/${segment(type)}/${segment(id)}`),
  test: (id) => request(`/biweekly/review/${segment(id)}/test`),
  submitTest: (id, answers) => request(`/biweekly/review/${segment(id)}/test`, {
    method: "POST", body: { answers }
  }),
  pdfUrl: (type, id, preview = false) =>
    `${API_BASE_PATH}/biweekly/${segment(type)}/${segment(id)}/pdf${preview ? "?preview=1" : ""}`
};
