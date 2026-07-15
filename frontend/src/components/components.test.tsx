import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "./Button";
import { EmptyState, Alert, PageSkeleton } from "./Feedback";
import { FormField, SelectField } from "./FormField";
import { formValue } from "./formValue";

describe("accessible design primitives", () => {
  it("connects errors and hints to their fields", () => {
    const { rerender } = render(<FormField id="email" label="Email" error="Invalid address" />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription("Invalid address");

    rerender(<FormField id="email" label="Email" hint="Use your university address" />);
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription("Use your university address");
  });

  it("renders select, button, alert, loading, and empty-state variants", () => {
    render(<><SelectField label="Language"><option>English</option></SelectField><Button variant="secondary" fullWidth>Save</Button><Alert tone="success">Saved</Alert><PageSkeleton label="Loading" /><EmptyState title="Nothing here">Try later</EmptyState></>);
    expect(screen.getByRole("combobox", { name: "Language" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toHaveClass("button--secondary", "button--full");
    expect(screen.getByRole("status", { name: "Loading" })).toBeVisible();
    expect(screen.getByText("Try later")).toBeVisible();
  });

  it("returns an empty string for non-text form data", () => {
    const data = new FormData();
    data.set("asset", new File(["x"], "x.txt"));
    expect(formValue(data, "asset")).toBe("");
    expect(formValue(data, "missing")).toBe("");
  });
});
