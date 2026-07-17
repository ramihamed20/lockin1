import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../features/auth/AuthProvider";
import { I18nProvider } from "../i18n/I18nProvider";
import { App } from "./App";

const { apiRequest, refreshCsrfToken, pwaStatus, applyPwaUpdate } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  refreshCsrfToken: vi.fn(),
  applyPwaUpdate: vi.fn(),
  pwaStatus: { offlineReady: false, updateAvailable: false }
}));

vi.mock("../api/client", () => ({ apiRequest, refreshCsrfToken, ApiError: class extends Error {} }));
vi.mock("../pwa/update", () => ({
  applyPwaUpdate,
  usePwaStatus: () => pwaStatus
}));

const user = {
  id: "user-1",
  email: "student@example.com",
  full_name: "Rami Student",
  preferred_language: "en",
  status: "active",
  is_email_verified: true,
  roles: ["student"],
  date_joined: "2026-07-15T00:00:00Z"
};
const emptyPage = { count: 0, next: null, previous: null, results: [] };
const learningSummary = { next_item: null, bookmark_count: 0, completed_count: 0, recent_content: [], review_due: [] };

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <I18nProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </I18nProvider>
    </MemoryRouter>
  );
}

describe("Lock-in application routes", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    pwaStatus.updateAvailable = false;
    refreshCsrfToken.mockResolvedValue("csrf");
  });

  it("shows the secure sign-in experience to an anonymous visitor", async () => {
    apiRequest.mockRejectedValue(new Error("anonymous"));
    renderApp("/login");

    expect(await screen.findByRole("heading", { name: "Welcome back." })).toBeVisible();
    expect(screen.getByRole("button", { name: "Log in" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/register");
  });

  it("signs in and presents only truthful account readiness data", async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === "/auth/session") return Promise.reject(new Error("anonymous"));
      if (path === "/auth/login") return Promise.resolve({ user });
      if (path === "/dashboard") {
        return Promise.resolve({
          roles: ["student"],
          account: { email_verified: true, active_sessions: 1, preferred_language: "en" },
          workspaces: []
        });
      }
      if (path === "/learning/dashboard") {
        return Promise.resolve({ next_item: null, bookmark_count: 0, completed_count: 0, recent_content: [], review_due: [] });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    renderApp("/login");
    fireEvent.change(await screen.findByLabelText("University email"), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "safe-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("heading", { name: "Good to see you, Rami" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Choose where to begin" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Account ready" })).toBeVisible();
    await waitFor(() => expect(refreshCsrfToken).toHaveBeenCalledOnce());
  });

  it("redirects an anonymous protected route to sign in", async () => {
    apiRequest.mockRejectedValue(new Error("anonymous"));
    renderApp("/security");

    expect(await screen.findByRole("heading", { name: "Welcome back." })).toBeVisible();
  });

  it("renders a stable not-found page and the optional PWA update action", () => {
    pwaStatus.updateAvailable = true;
    apiRequest.mockRejectedValue(new Error("anonymous"));
    renderApp("/unknown-page");
    expect(screen.getByRole("heading", { name: "This page could not be found." })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Update now" }));
    expect(applyPwaUpdate).toHaveBeenCalledOnce();
  });

  it("loads the route-split student learning journey", async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === "/auth/session") return Promise.resolve({ user });
      if (path === "/learning/dashboard") return Promise.resolve(learningSummary);
      if (path === "/education/nodes") return Promise.resolve(emptyPage);
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    renderApp("/learn");

    expect(await screen.findByRole("heading", { name: "What will you master next?" })).toBeVisible();
    expect(screen.getByRole("search")).toBeVisible();
  });

  it("loads the creator content studio but blocks a student from it", async () => {
    const creator = { ...user, roles: ["student", "creator"] };
    apiRequest.mockImplementation((path: string) => {
      if (path === "/auth/session") return Promise.resolve({ user: creator });
      if (path.startsWith("/management/content")) return Promise.resolve(emptyPage);
      if (path.startsWith("/management/education/nodes")) return Promise.resolve(emptyPage);
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    const creatorView = renderApp("/management/content");
    expect(await screen.findByRole("heading", { name: "Content studio" })).toBeVisible();
    creatorView.unmount();

    apiRequest.mockImplementation((path: string) => {
      if (path === "/auth/session") return Promise.resolve({ user });
      if (path === "/dashboard") return Promise.resolve({ roles: ["student"], account: { email_verified: true, active_sessions: 1, preferred_language: "en" } });
      if (path === "/learning/dashboard") return Promise.resolve(learningSummary);
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    renderApp("/management/content");
    expect(await screen.findByRole("heading", { name: "Good to see you, Rami" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Content studio" })).not.toBeInTheDocument();
  });

  it("loads administrator hierarchy management", async () => {
    const administrator = { ...user, roles: ["student", "administrator"] };
    apiRequest.mockImplementation((path: string) => {
      if (path === "/auth/session") return Promise.resolve({ user: administrator });
      if (path.startsWith("/management/education/nodes")) return Promise.resolve(emptyPage);
      if (path.startsWith("/admin/users")) return Promise.resolve(emptyPage);
      if (path === "/management/education/scopes") return Promise.resolve({ scopes: [] });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    renderApp("/admin/education");

    expect(await screen.findByRole("heading", { name: "Learning structure" })).toBeVisible();
    expect(await screen.findByRole("heading", { name: "Creator access" })).toBeVisible();
  });
});
