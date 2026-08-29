import { getCatalogSheet } from "./materialCatalog.js";

const DEMO_QUESTIONS = {
  conservative: [
    ["What is the main aim of minimally invasive dentistry?", ["Remove every stained surface", "Preserve healthy tooth structure", "Avoid all restorations", "Use only temporary materials"], 1, "The demo answer emphasizes preserving sound tooth tissue whenever possible."],
    ["Which step comes before placing a restoration?", ["Assess and isolate the tooth", "Polish the final restoration", "Schedule a review only", "Remove adjacent teeth"], 0, "Assessment and isolation are foundational steps in this simplified demo flow."],
    ["Why is moisture control important?", ["It changes the tooth color", "It supports a clean working field", "It replaces diagnosis", "It makes X-rays unnecessary"], 1, "This demo uses moisture control as an example of maintaining a clean working field."]
  ],
  microbiology: [
    ["Which is a useful first step when studying a microorganism?", ["Identify its basic characteristics", "Choose an antibiotic immediately", "Ignore the sample source", "Skip laboratory safety"], 0, "Identification starts with observable and testable characteristics."],
    ["Why is hand hygiene important in microbiology practice?", ["It replaces protective equipment", "It reduces avoidable contamination", "It changes a culture result", "It makes sterilization optional"], 1, "Hand hygiene helps reduce contamination and supports safe practice."],
    ["A culture is mainly used in this demo to:", ["Grow and observe microorganisms", "Measure blood pressure", "Repair a tooth", "Produce radiographs"], 0, "Cultures support observation and identification of microorganisms."]
  ],
  pharmacy: [
    ["Before taking a medicine, what should be reviewed?", ["The label and instructions", "Only the package color", "A random dose", "Nothing if symptoms improve"], 0, "This demo reinforces checking the prescribed label and instructions."],
    ["Why should medicine interactions be considered?", ["They can affect safety and effectiveness", "They change the medicine name", "They remove the need for dosage", "They only affect packaging"], 0, "Interactions can change how medicines work and how safe they are."],
    ["Who should clarify an uncertain medication instruction?", ["A qualified prescriber or pharmacist", "Any online comment", "A classmate only", "No one"], 0, "Medication questions should be clarified with a qualified professional."]
  ],
  "general-pathology": [
    ["What does pathology study?", ["Disease processes and their effects", "Only healthy anatomy", "Sports training", "Dental equipment prices"], 0, "Pathology focuses on disease processes and their effects on the body."],
    ["Inflammation is best described in this demo as:", ["A protective response to injury or infection", "Always a permanent condition", "A type of imaging", "A medication dose"], 0, "Inflammation is a protective biological response, though its effects can vary."],
    ["Why is a clear clinical history useful?", ["It gives context for assessment", "It replaces examination", "It makes records unnecessary", "It determines every treatment alone"], 0, "History provides context but does not replace a full assessment."]
  ],
  "oral-histology": [
    ["Which cells form enamel?", ["Ameloblasts", "Osteoclasts", "Erythrocytes", "Neutrophils"], 0, "Ameloblasts are the enamel-forming cells."],
    ["Dentin is located:", ["Beneath the enamel", "Outside the lips", "Only in bone", "Inside the gingiva"], 0, "Dentin forms the main bulk beneath enamel in a tooth."],
    ["Oral histology mainly examines:", ["Microscopic structure of oral tissues", "Only tooth color", "Appointment scheduling", "Sports nutrition"], 0, "It examines the microscopic structure of tissues in the oral region."]
  ],
  "fixed-prosthodontic": [
    ["A fixed prosthesis is designed to be:", ["Removed daily by the patient", "Attached in place", "Used only as a temporary note", "A diagnostic photograph"], 1, "A fixed prosthesis is attached in place rather than routinely removed by the patient."],
    ["Why is accurate preparation important?", ["It supports fit and function", "It changes the patient's name", "It removes the need for planning", "It makes follow-up unnecessary"], 0, "Preparation supports the fit and function of the planned restoration."],
    ["Which item records a prepared tooth shape?", ["An impression or digital scan", "A toothbrush only", "A pulse oximeter", "A hand mirror only"], 0, "An impression or scan records the prepared tooth for the restoration workflow."]
  ],
  "removeable-prosthodontic": [
    ["A removable prosthesis is intended to be:", ["Removed by the patient when appropriate", "Permanently cemented", "Used only for imaging", "A type of medication"], 0, "A removable prosthesis can be removed by the patient when appropriate."],
    ["Why are follow-up visits useful?", ["They help review fit and comfort", "They eliminate cleaning", "They replace all instructions", "They make adjustments impossible"], 0, "Follow-up helps review fit, comfort, and any necessary adjustments."],
    ["A major connector primarily helps to:", ["Join components of a removable partial denture", "Whiten enamel", "Measure temperature", "Take a radiograph"], 0, "The major connector joins components of a removable partial denture."]
  ]
};

/** Deliberately local sample content for the requested demo quiz experience. */
export function getDemoQuiz(materialSlug, sheetSlug) {
  const { material, sheet } = getCatalogSheet(materialSlug, sheetSlug);
  const source = DEMO_QUESTIONS[materialSlug];
  if (!material || !sheet || !source) return null;
  return {
    material,
    sheet,
    questions: source.map(([prompt, options, answerIndex, explanation], index) => ({
      id: `${materialSlug}-${sheetSlug}-${index + 1}`,
      prompt,
      options,
      answerIndex,
      explanation
    }))
  };
}

export function demoQuestionCount(materialSlug, sheetSlug) {
  return getDemoQuiz(materialSlug, sheetSlug)?.questions.length || 0;
}
