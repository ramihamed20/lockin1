// Display helpers for "My Group". The timetable itself is resolved by Django
// (apps.class_schedule); this module only lays the resolved sessions out.

export const THEORY_GROUPS = Object.freeze(["A", "B"]);
export const PRACTICAL_GROUPS = Object.freeze(["A1", "A2", "B1", "B2", "C1", "C2", "D1", "D2"]);
export const SUBJECT_KEYS = Object.freeze([
  "general_pathology",
  "microbiology",
  "pharmacology",
  "oral_histology",
  "conservative_endodontics_1",
  "fixed_prosthodontics_1",
  "removable_prosthodontics_1"
]);

export function subjectLabel(t, subject) {
  return t(`myGroup.subject.${subject}`);
}

/** "14:00" -> "2:00 PM" / "2:00 م". Group codes and digits stay Latin in both locales. */
export function clockLabel(t, time) {
  const [hourText, minute = "00"] = String(time).split(":");
  const hour = Number(hourText);
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${minute} ${t(hour < 12 ? "myGroup.am" : "myGroup.pm")}`;
}

export function slotLabel(t, slot) {
  return `${clockLabel(t, slot.start_time)} – ${clockLabel(t, slot.end_time)}`;
}

/** rows[dayIndex][slotIndex] -> sessions starting in that slot (normally zero or one). */
export function timetableGrid(timetable) {
  const days = timetable?.days || [];
  const slots = timetable?.slots || [];
  const rows = days.map(() => slots.map(() => []));
  for (const session of timetable?.sessions || []) {
    const dayIndex = days.indexOf(session.day);
    const slotIndex = slots.findIndex((slot) => slot.start_time === session.start_time);
    if (dayIndex !== -1 && slotIndex !== -1) rows[dayIndex][slotIndex].push(session);
  }
  return rows;
}

/** The effective practical source for every subject, overrides applied. */
export function practicalChoices(draft) {
  const choices = {};
  for (const subject of SUBJECT_KEYS) {
    choices[subject] = draft.practicalOverrides[subject] || { scheduleSet: draft.theoryGroup, practicalGroup: draft.defaultPracticalGroup };
  }
  return choices;
}

export function draftFromPreferences(preferences) {
  const overrides = {};
  for (const [subject, choice] of Object.entries(preferences?.practical_overrides || {})) {
    overrides[subject] = { scheduleSet: choice.schedule_set, practicalGroup: choice.practical_group };
  }
  return {
    theoryGroup: preferences?.theory_group || "",
    defaultPracticalGroup: preferences?.default_practical_group || "",
    practicalOverrides: overrides
  };
}

/** Sets one subject's practical source; choosing the default removes the override. */
export function withPracticalChoice(draft, subject, choice) {
  const overrides = { ...draft.practicalOverrides };
  if (choice.scheduleSet === draft.theoryGroup && choice.practicalGroup === draft.defaultPracticalGroup) {
    delete overrides[subject];
  } else {
    overrides[subject] = choice;
  }
  return { ...draft, practicalOverrides: overrides };
}
