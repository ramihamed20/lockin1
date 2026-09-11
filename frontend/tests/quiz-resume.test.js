import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectFile = (path) => new URL(`../${path}`, import.meta.url);

test("quiz navigation saves a revisioned server resume point and restores it", async () => {
  const [attempt, api] = await Promise.all([
    readFile(projectFile("src/pages/Attempt.jsx"), "utf8"),
    readFile(projectFile("src/api/assessments.js"), "utf8")
  ]);

  assert.match(attempt, /resume_question_position/);
  assert.match(attempt, /resume_client_revision/);
  assert.match(attempt, /assessmentsApi\.saveResume/);
  assert.match(attempt, /clientRevision = resumeRevision\.current \+ 1/);
  assert.match(api, /`\/attempts\/\$\{attemptId\}\/resume`/);
  assert.match(api, /question_position: questionPosition/);
  assert.match(attempt, /queueAttemptChange/);
  assert.match(attempt, /flushAttemptChanges/);
});

test("answering a quiz remains inside the normal shell with an explicit Questions return", async () => {
  const [shell, attempt, styles] = await Promise.all([
    readFile(projectFile("src/components/layout/index.jsx"), "utf8"),
    readFile(projectFile("src/pages/Attempt.jsx"), "utf8"),
    readFile(projectFile("src/styles.css"), "utf8")
  ]);

  assert.doesNotMatch(shell, /is-answering/);
  assert.match(attempt, /assessment\.backToQuizzes/);
  assert.match(attempt, /attempt-workspace/);
  assert.match(styles, /\.attempt-workspace \{[\s\S]*width: min\(100%, 960px\)/);
  assert.match(styles, /@media \(max-width: 720px\) \{[\s\S]*\.attempt-workspace/);
});
