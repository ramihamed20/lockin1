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
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    renderApp("/login");
    fireEvent.change(await screen.findByLabelText("University email"), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "safe-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("heading", { name: "Your Lock-in overview" })).toBeVisible();
    expect(screen.getByText("Your student workspace is ready. Creator and moderator tools appear only when assigned.")).toBeVisible();
    expect(screen.queryByText(/lesson progress/i)).not.toBeInTheDocument();
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
});
