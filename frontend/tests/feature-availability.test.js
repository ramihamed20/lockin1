import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  FEATURE_AVAILABILITY,
  comingSoonFeatures,
  getFeatureForPath,
  isFeatureComingSoon
} from "../src/lib/featureAvailability.js";

test("the feature registry is the authoritative source for every scheduled feature", () => {
  assert.deepEqual(comingSoonFeatures().map((feature) => feature.id), ["study-plan", "rank", "community"]);
  assert.equal(isFeatureComingSoon(getFeatureForPath("/study-plan")), true);
  assert.equal(isFeatureComingSoon(getFeatureForPath("/ranked")), true);
  assert.equal(isFeatureComingSoon(getFeatureForPath("/community/discussions/thread-1")), true);
  assert.equal(getFeatureForPath("/materials"), null);
  assert.equal(FEATURE_AVAILABILITY.COMING_SOON, "coming-soon");
});

test("all scheduled routes terminate at the shared coming-soon surface", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const layout = await readFile(new URL("../src/components/layout/index.jsx", import.meta.url), "utf8");

  assert.match(app, /path="\/study-plan\/\*" element=\{<FeatureComingSoon featureId="study-plan" \/>\}/);
  assert.match(app, /path="\/ranked\/\*" element=\{<FeatureComingSoon featureId="rank" \/>\}/);
  assert.match(app, /path="\/community\/\*" element=\{<FeatureComingSoon featureId="community" \/>\}/);
  assert.match(layout, /getFeatureForNavigationPath/);
  assert.match(layout, /<LockinIcon name="coming-soon" size=\{19\} \/>/);
});
