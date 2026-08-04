export default [
  {
    ignores: ["dist/**", "dev-dist/**", "node_modules/**"]
  },
  {
    files: [
      "vite.config.js",
      "src/App.jsx",
      "src/api/**/*.js",
      "src/components/community/**/*.jsx",
      "src/components/creator/**/*.jsx",
      "src/components/account/**/*.jsx",
      "src/components/auth/AuthPage.jsx",
      "src/components/auth/ProtectedRoute.jsx",
      "src/components/auth/TokenActionPage.jsx",
      "src/components/layout/index.jsx",
      "src/components/learning/**/*.jsx",
      "src/components/assessment/**/*.jsx",
      "src/components/shared/ForbiddenState.jsx",
      "src/components/shared/index.jsx",
      "src/components/ui/index.jsx",
      "src/lib/api.js",
      "src/lib/authz.js",
      "src/hooks/useAsyncData.js",
      "src/pages/Dashboard.jsx",
      "src/pages/Materials.jsx",
      "src/pages/Bookmarks.jsx",
      "src/pages/LearningObjectStudy.jsx",
      "src/pages/FocusWorkspace.jsx",
      "src/pages/CatalogFocusWorkspace.jsx",
      "src/pages/LockInMode.jsx",
      "src/pages/SheetStudy.jsx",
      "src/pages/Search.jsx",
      "src/pages/Questions.jsx",
      "src/pages/QuizDetail.jsx",
      "src/pages/Attempt.jsx",
      "src/pages/AssessmentResult.jsx",
      "src/pages/Review.jsx",
      "src/pages/Community.jsx",
      "src/pages/Discussion.jsx",
      "src/pages/CommunitySpace.jsx",
      "src/pages/CommunityReport.jsx",
      "src/pages/Profile.jsx",
      "src/pages/Progress.jsx",
      "src/pages/Achievements.jsx",
      "src/pages/Ranked.jsx",
      "src/pages/Notifications.jsx",
      "src/pages/Store.jsx",
      "src/pages/Settings.jsx",
      "src/pages/Analytics.jsx",
      "src/pages/CreatorEducation.jsx",
      "src/pages/CreatorContent.jsx",
      "src/pages/CreatorAssessments.jsx",
      "src/service-worker.js",
      "tests/**/*.js"
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true }
      },
      globals: {
        AbortSignal: "readonly",
        Blob: "readonly",
        File: "readonly",
        cancelAnimationFrame: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        FormData: "readonly",
        Headers: "readonly",
        Notification: "readonly",
        Response: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        caches: "readonly",
        document: "readonly",
        fetch: "readonly",
        localStorage: "readonly",
        navigator: "readonly",
        process: "readonly",
        requestAnimationFrame: "readonly",
        self: "readonly",
        window: "readonly"
      }
    },
    rules: {
      "no-undef": "error"
    }
  },
  {
    files: ["src/api/**/*.js", "src/lib/api.js", "src/lib/authz.js", "tests/**/*.js"],
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }]
    }
  }
];
