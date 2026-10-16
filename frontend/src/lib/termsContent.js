import { POLICY_SECTIONS, POLICY_VERSION } from "./policyContent.js";
const content = { updated: `2026-10-16 · ${POLICY_VERSION}`, sections: POLICY_SECTIONS.filter((item) => item.group !== "privacy") };
export const TERMS = { ar: content, en: content };
