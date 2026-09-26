import { ApiError, request } from "./client.js";

function myGroupPayload(payload) {
  if (!payload || typeof payload !== "object" || typeof payload.configured !== "boolean" || !Array.isArray(payload.timetable?.sessions)) {
    throw new ApiError(500, payload, "The My Group response was incomplete.", "invalid_response");
  }
  return payload;
}

export const myGroupApi = {
  async get(signal) {
    return myGroupPayload(await request("/my-group", { signal }));
  },

  /** Replaces the whole selection; an empty `practicalOverrides` resets every subject to the default. */
  async save({ theoryGroup, defaultPracticalGroup, practicalOverrides = {} }) {
    const overrides = {};
    for (const [subject, choice] of Object.entries(practicalOverrides)) {
      overrides[subject] = { schedule_set: choice.scheduleSet, practical_group: choice.practicalGroup };
    }
    return myGroupPayload(await request("/my-group", {
      method: "PUT",
      body: { theory_group: theoryGroup, default_practical_group: defaultPracticalGroup, practical_overrides: overrides }
    }));
  }
};
