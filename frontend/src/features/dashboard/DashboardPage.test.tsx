import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n/I18nProvider";
import { AuthProvider } from "../auth/AuthProvider";
import { DashboardPage } from "./DashboardPage";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("../../api/client", () => ({ apiRequest, refreshCsrfToken: vi.fn() }));

const admin = { id: "a1", email: "admin@example.com", full_name: "Admin User", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student", "administrator"], date_joined: "2026-07-15T00:00:00Z" };
const summary = { roles: ["student", "administrator"], account: { email_verified: true, active_sessions: 2, preferred_language: "en" }, workspaces: ["administrator"], administration: { total: 10, verified: 8, suspended: 1 } };

function renderDashboard() {
  return render(<MemoryRouter><I18nProvider><AuthProvider><DashboardPage /></AuthProvider></I18nProvider></MemoryRouter>);
}

describe("role-aware dashboard", () => {
  beforeEach(() => { localStorage.setItem("lockin.locale", "en"); apiRequest.mockReset(); });

  it("renders real administrator counts and workspaces", async () => {
    apiRequest.mockImplementation((path: string) => path === "/auth/session" ? Promise.resolve({ user: admin }) : Promise.resolve(summary));
    renderDashboard();
    expect(await screen.findByRole("heading", { name: "Platform accounts" })).toBeVisible();
    expect(screen.getByText("10")).toBeVisible();
    expect(screen.getByText("Administrator")).toBeVisible();
  });

  it("recovers after a summary request fails", async () => {
    let attempts = 0;
    apiRequest.mockImplementation((path: string) => {
      if (path === "/auth/session") return Promise.resolve({ user: admin });
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error("offline")) : Promise.resolve(summary);
    });
    renderDashboard();
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Platform accounts" })).toBeVisible();
  });
});
