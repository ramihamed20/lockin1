import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n/I18nProvider";
import { AuthProvider } from "../auth/AuthProvider";
import { ProfilePage } from "./ProfilePage";
import { SecurityPage } from "./SecurityPage";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("../../api/client", () => ({ apiRequest, refreshCsrfToken: vi.fn() }));

const user = { id: "u1", email: "student@example.com", full_name: "Student Name", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-07-15T00:00:00Z" };

function renderWithAccount(page: React.ReactNode) {
  return render(<MemoryRouter><I18nProvider><AuthProvider>{page}</AuthProvider></I18nProvider></MemoryRouter>);
}

describe("account settings", () => {
  beforeEach(() => {
    localStorage.setItem("lockin.locale", "en");
    apiRequest.mockReset();
  });

  it("updates only editable profile fields and applies language", async () => {
    apiRequest.mockImplementation((path: string) => path === "/auth/session" ? Promise.resolve({ user }) : Promise.resolve({ user: { ...user, full_name: "Updated Name", preferred_language: "ar" } }));
    renderWithAccount(<ProfilePage />);
    fireEvent.change(await screen.findByLabelText("Full name"), { target: { value: "Updated Name" } });
    fireEvent.change(screen.getByLabelText("Preferred language"), { target: { value: "ar" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("ملفك الشخصي محدّث.")).toBeVisible();
    expect(document.documentElement).toHaveAttribute("dir", "rtl");
  });

  it("changes password, requests email confirmation, and revokes another session", async () => {
    const sessions = [
      { id: "current", device_label: "Chrome on Computer", created_at: "2026-07-15T00:00:00Z", last_seen_at: "2026-07-15T00:00:00Z", expires_at: "2026-08-15T00:00:00Z", is_current: true },
      { id: "other", device_label: "Safari on Tablet", created_at: "2026-07-14T00:00:00Z", last_seen_at: "2026-07-14T00:00:00Z", expires_at: "2026-08-14T00:00:00Z", is_current: false }
    ];
    apiRequest.mockImplementation((path: string) => {
      if (path === "/auth/session") return Promise.resolve({ user });
      if (path === "/account/sessions") return Promise.resolve({ sessions });
      return Promise.resolve({ status: "ok" });
    });
    renderWithAccount(<SecurityPage />);
    expect(await screen.findByText("Safari on Tablet")).toBeVisible();

    const passwordButton = screen.getByRole("button", { name: "Change password" });
    const passwordForm = passwordButton.closest("form") as HTMLFormElement;
    for (const input of within(passwordForm).getAllByLabelText(/password/i)) fireEvent.change(input, { target: { value: "safe-password-2026" } });
    fireEvent.submit(passwordForm);
    expect(await screen.findByText(/other sessions were signed out/i)).toBeVisible();

    const emailButton = screen.getByRole("button", { name: "Change email" });
    const emailForm = emailButton.closest("form") as HTMLFormElement;
    fireEvent.change(within(emailForm).getByLabelText("New email address"), { target: { value: "new@example.com" } });
    fireEvent.change(within(emailForm).getByLabelText("Current password"), { target: { value: "safe-password-2026" } });
    fireEvent.submit(emailForm);
    expect(await screen.findByText(/check the new inbox/i)).toBeVisible();

    const otherSession = screen.getByText("Safari on Tablet").closest("li") as HTMLLIElement;
    fireEvent.click(within(otherSession).getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(screen.queryByText("Safari on Tablet")).not.toBeInTheDocument());
    expect(apiRequest).toHaveBeenCalledWith("/account/sessions/other", { method: "DELETE" });
  });

  it("renders an honest empty-session state", async () => {
    apiRequest.mockImplementation((path: string) => path === "/auth/session" ? Promise.resolve({ user }) : Promise.resolve({ sessions: [] }));
    renderWithAccount(<SecurityPage />);
    expect(await screen.findByRole("heading", { name: "No tracked sessions are active." })).toBeVisible();
  });
});
