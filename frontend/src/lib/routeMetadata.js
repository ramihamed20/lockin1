import { translate } from "./i18n.js";

const routeDefinitions = [
  { match: (path) => path === "/" || path === "/dashboard", key: "route.dashboard" },
  { match: (path) => path === "/my-group", key: "route.myGroup" },
  { match: (path) => path === "/study-plan", key: "route.studyPlan" },
  { match: (path) => path === "/materials", key: "route.materials" },
  { match: (path) => path === "/materials/catalog", key: "route.notFound" },
  { match: (path) => path.startsWith("/materials/catalog/") && path.endsWith("/workspace"), key: "route.focus" },
  { match: (path) => path.startsWith("/whiteboards/") && path.endsWith("/workspace"), key: "route.focus" },
  { match: (path) => path.startsWith("/materials/catalog/"), key: "route.material" },
  { match: (path) => path === "/paper-workspace", key: "route.paperWorkspace" },
  { match: (path) => path === "/materials/summaries", key: "summary.mine" },
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
  { match: (path) => path.startsWith("/analysis"), key: "route.analysis" },
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

/**
 * The browser tab's name. A page that passes the route's own English name
 * (most pages do) gets the route name in the reader's language, as its
 * visible heading already does; any other title is shown as given.
 * @param {string} title
 * @param {string} pathname
 * @param {(key: string) => string} t
 */
export function pageDocumentTitle(title, pathname, t) {
  const metadata = routeMetadata(pathname, t);
  if (!title || title === metadata.h1) return metadata.documentTitle;
  if (title === routeMetadata(pathname, (key) => translate("en", key)).h1) return metadata.documentTitle;
  return `${title} — Lock-in`;
}
