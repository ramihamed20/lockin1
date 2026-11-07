export const reminderDefaults = {
  enabled: false, time: "18:00", timezone: "Africa/Tripoli", revision: 0,
  weekdays: [0, 1, 2, 3, 4, 5, 6], study_enabled: true, review_enabled: false,
  weekly_enabled: false, weekly_day: 6, skip_if_studied: false,
  quiet_enabled: false, quiet_start: "22:00", quiet_end: "08:00", push_preview: true
};

export function reminderValidation(draft) {
  if (!draft.weekdays.length) return "reminder.chooseDays";
  if (draft.enabled && !draft.study_enabled && !draft.review_enabled && !draft.weekly_enabled) return "reminder.chooseType";
  if (draft.quiet_enabled) {
    if (draft.quiet_start === draft.quiet_end) return "reminder.quietInvalid";
    const quiet = draft.quiet_start < draft.quiet_end
      ? draft.time >= draft.quiet_start && draft.time < draft.quiet_end
      : draft.time >= draft.quiet_start || draft.time < draft.quiet_end;
    if (draft.enabled && quiet) return "reminder.timeInQuiet";
  }
  return "";
}

export function reminderRequest(draft, locale, pauseHours) {
  const value = Object.fromEntries(Object.keys(reminderDefaults).filter(key => key !== "revision").map(key => [key, draft[key]]));
  return { ...value, locale, ...(pauseHours !== undefined ? { pause_hours: pauseHours } : {}) };
}
