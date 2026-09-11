/**
 * Turns the existing cohort records into the three choices a student makes.
 * The cohort UUID remains the only value submitted to the server; these
 * fields make that deliberate choice understandable without creating another
 * education hierarchy in the client.
 */
export function isSelectableStudyPath(cohort) {
  return cohort?.code !== "year-3";
}

export function educationPathFor(cohort, locale = "en") {
  const program = cohort?.program || {};
  const code = String(program.code || "");
  const programName = locale === "ar" ? program.name_ar : program.name_en;
  const collegeMatch = code.match(/(?:^|-)\b(tripoli|benghazi|zawiya)$/);
  const collegeId = code === "human-medicine" ? "tripoli" : collegeMatch?.[1] || code || "other";
  const collegeLabels = { tripoli: "Tripoli", benghazi: "Benghazi", zawiya: "Zawiya" };
  const specialtyId = code.startsWith("dentistry-") ? "dentistry" : code || "other";
  const specialtyLabel = code.startsWith("dentistry-")
    ? "Dentistry"
    : code === "human-medicine"
      ? "Human Medicine"
      : programName || "Other";
  return {
    collegeId,
    collegeLabel: collegeLabels[collegeId] || programName || "Other",
    specialtyId,
    specialtyLabel,
    yearLabel: (locale === "ar" ? cohort?.name_ar : cohort?.name_en) || cohort?.code || ""
  };
}

export function uniqueEducationOptions(cohorts, property) {
  const options = new Map();
  cohorts.filter(isSelectableStudyPath).forEach((cohort) => {
    const path = educationPathFor(cohort);
    const id = path[`${property}Id`];
    if (id && !options.has(id)) options.set(id, { id, label: path[`${property}Label`] });
  });
  return [...options.values()];
}
