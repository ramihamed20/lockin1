import { materialFor } from "./model.js";

export function taskDestination(item, materials) {
  if (item?.start_url) return item.start_url;
  const material = materialFor(item?.subject || item?.title, materials);
  return material ? `/materials/catalog/${encodeURIComponent(material.slug)}` : "/materials";
}

export function rankToday(items, exams, readiness, today) {
  const dates = new Map();
  for (const exam of exams || []) {
    for (const schedule of exam.schedules || []) {
      const previous = dates.get(schedule.subject_id);
      if (schedule.scheduled_on >= today && (!previous || schedule.scheduled_on < previous)) {
        dates.set(schedule.subject_id, schedule.scheduled_on);
      }
    }
  }
  // Keep each subject's saved activity order, including reading prerequisites.
  const practice = new Set(items.filter(item => item.status === "planned" &&
    item.priority_reasons?.includes("practice_results")).map(item => item.catalog_subject_id));
  const urgency = item => {
    const level = readiness?.[item.material_slug];
    return Number(level === "not_started" || level === "needs_practice" || practice.has(item.catalog_subject_id));
  };
  return [...items].sort((a, b) =>
    Number(a.status !== "planned") - Number(b.status !== "planned") ||
    (dates.get(a.catalog_subject_id) || "9999").localeCompare(dates.get(b.catalog_subject_id) || "9999") ||
    urgency(b) - urgency(a)
  );
}

export function nextSession(items, today) {
  return items.filter(item => item.status === "planned" && item.scheduled_date >= today)
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))[0] || null;
}

export function subjectSections(subjects, items, overdue, materials) {
  const groups = new Map();
  for (const name of [...subjects, ...items.map(item => item.subject), ...overdue.map(item => item.subject)]) {
    if (!name?.trim()) continue;
    const key = name.trim().toLocaleLowerCase();
    if (!groups.has(key)) groups.set(key, { name: name.trim(), items: [], overdue: [], material: materialFor(name, materials) });
  }
  const overdueIds = new Set(overdue.map(item => item.id));
  for (const [source, field] of [[items, "items"], [overdue, "overdue"]]) {
    const seen = new Set();
    for (const item of source) {
      if (field === "items" && overdueIds.has(item.id)) continue;
      const group = groups.get(item.subject?.trim().toLocaleLowerCase());
      if (group && !seen.has(item.id)) { group[field].push(item); seen.add(item.id); }
    }
  }
  return [...groups.values()];
}
