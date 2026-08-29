const routeDefinitions = [
  { match: (path) => path === "/" || path === "/dashboard", key: "route.dashboard" },
  { match: (path) => path === "/study-plan", key: "route.studyPlan" },
  { match: (path) => path === "/materials", key: "route.materials" },
  { match: (path) => path === "/materials/catalog", key: "route.notFound" },
  { match: (path) => path.endsWith("/workspace"), key: "route.focus" },
  { match: (path) => path.startsWith("/materials/"), key: "route.material" },
  { match: (path) => path === "/lock-in" || path.startsWith("/lock-in/"), key: "route.lockIn" },
  { match: (path) => path.startsWith("/search"), key: "route.search" },
  { match: (path) => path.startsWith("/questions/results"), key: "route.assessmentResult" },
  { match: (path) => path.startsWith("/questions/attempts") || path.startsWith("/questions/quizzes"), key: "route.assessment" },
  { match: (path) => path.startsWith("/questions"), key: "route.questions" },
  { match: (path) => path.startsWith("/review"), key: "route.review" },
  { match: (path) => path.startsWith("/community/discussions"), key: "route.discussion" },
  { match: (path) => path.startsWith("/community"), key: "route.community" },
  { match: (path) => path.startsWith("/ranked"), key: "route.ranked" },
  { match: (path) => path.startsWith("/bookmarks"), key: "route.bookmarks" },
  { match: (path) => path.startsWith("/progress"), key: "route.progress" },
  { match: (path) => path.startsWith("/achievements"), key: "route.achievements" },
  { match: (path) => path.startsWith("/notifications"), key: "route.notifications" },
  { match: (path) => path.startsWith("/store"), key: "route.store" },
  { match: (path) => path.startsWith("/profile"), key: "route.profile" },
  { match: (path) => path.startsWith("/settings"), key: "route.settings" },
  { match: (path) => path.startsWith("/security"), key: "route.security" },
  { match: (path) => path.startsWith("/subscription"), key: "route.subscription" },
  { match: (path) => path.startsWith("/moderation"), key: "route.moderation" },
  { match: (path) => path.startsWith("/operations") || path.startsWith("/admin"), key: "route.operations" },
  { match: (path) => path.startsWith("/creator"), key: "route.creator" }
];

export function routeMetadata(pathname, t = (key) => key) {
  const definition = routeDefinitions.find((entry) => entry.match(pathname));
  const key = definition?.key || "route.notFound";
  const label = t(key);
  return {
    key,
    shellLabel: label,
    documentTitle: `${label} — Lock-in`,
    h1: label,
    breadcrumbLabel: label
  };
}

export function routeMetadataDefinitions() {
  return [...routeDefinitions];
}
