import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n/I18nProvider";
import { ForgotPasswordPage, RegisterPage, ResetPasswordPage, TokenConfirmationPage } from "./AuthPages";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("../../api/client", () => ({ apiRequest, ApiError: class extends Error {} }));

function renderRoute(element: React.ReactNode, path = "/") {
  return render(<MemoryRouter initialEntries={[path]}><I18nProvider><Routes><Route path="*" element={element} /></Routes></I18nProvider></MemoryRouter>);
}

describe("account entry flows", () => {
  beforeEach(() => {
    localStorage.setItem("lockin.locale", "en");
    apiRequest.mockReset();
    apiRequest.mockResolvedValue({ status: "accepted" });
  });

  it("submits the complete registration contract", async () => {
    renderRoute(<RegisterPage />);
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Rami Student" } });
    fireEvent.change(screen.getByLabelText("University email"), { target: { value: "rami@example.com" } });
    const passwords = screen.getAllByLabelText(/Password|Confirm password/);
    for (const field of passwords) fireEvent.change(field, { target: { value: "secure-password" } });
    fireEvent.change(screen.getByLabelText("Preferred language"), { target: { value: "ar" } });
    fireEvent.click(screen.getByLabelText(/agree to the terms/i));
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText(/check your inbox/i)).toBeVisible();
    expect(apiRequest).toHaveBeenCalledWith("/auth/register", {
      method: "POST",
      body: {
        full_name: "Rami Student",
        email: "rami@example.com",
        password: "secure-password",
        password_confirm: "secure-password",
        preferred_language: "ar",
        accept_policies: true
      }
    });
  });

  it("uses a non-disclosing password recovery message", async () => {
    renderRoute(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText("University email"), { target: { value: "missing@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByText(/if the account exists/i)).toBeVisible();
  });

  it("rejects an incomplete reset link and accepts a complete one", async () => {
    const missing = renderRoute(<ResetPasswordPage />, "/reset-password");
    expect(screen.getByRole("alert")).toHaveTextContent(/link is incomplete/i);
    missing.unmount();

    renderRoute(<ResetPasswordPage />, "/reset-password?token=one-use");
    const form = screen.getByRole("button", { name: "Save new password" }).closest("form");
    expect(form).not.toBeNull();
    const inputs = within(form as HTMLFormElement).getAllByLabelText(/password/i);
    for (const input of inputs) fireEvent.change(input, { target: { value: "new-secure-password" } });
    fireEvent.submit(form as HTMLFormElement);
    expect(await screen.findByText(/password is updated/i)).toBeVisible();
    expect(apiRequest).toHaveBeenCalledWith("/auth/password-reset/confirm", {
      method: "POST",
      body: {
        token: "one-use",
        new_password: "new-secure-password",
        new_password_confirm: "new-secure-password"
      }
    });
  });

  it("confirms single-use verification and email-change links", async () => {
    const verification = renderRoute(<TokenConfirmationPage mode="verify" />, "/verify-email?token=verify-token");
    fireEvent.click(screen.getByRole("button", { name: "Verify email" }));
    expect(await screen.findByText(/email is verified/i)).toBeVisible();
    verification.unmount();

    renderRoute(<TokenConfirmationPage mode="email-change" />, "/confirm-email?token=email-token");
    fireEvent.click(screen.getByRole("button", { name: "Verify email" }));
    expect(await screen.findByText(/email address has been updated/i)).toBeVisible();
    await waitFor(() => expect(apiRequest).toHaveBeenLastCalledWith("/account/email/confirm", expect.anything()));
  });

  it("shows a recoverable error when a token request fails", async () => {
    apiRequest.mockRejectedValue(new Error("offline"));
    renderRoute(<TokenConfirmationPage mode="verify" />, "/verify-email?token=bad");
    fireEvent.click(screen.getByRole("button", { name: "Verify email" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/interrupted/i);
  });
});
