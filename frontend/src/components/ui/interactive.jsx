/**
 * Shared interaction primitives.
 *
 * Every control in the application belongs to exactly one of these families,
 * and each family declares which states it is allowed to hold. That is the
 * rule the old code base lacked: a `<button>` could be styled as "selected"
 * simply because someone added an `.active` class on click, so ordinary
 * actions ended up looking like a chosen tool.
 *
 *   Button          action. hover / pressed / focus / disabled. NEVER selected.
 *   IconButton      action, icon only. Same contract as Button.
 *   ToggleButton    a real two-state control. Owns aria-pressed.
 *   Tab / TabList   one-of-N inside a strip. Owns aria-selected + roving focus.
 *   NavItem         a route destination. Owns aria-current="page".
 *   ToolbarButton   a workspace tool. Toggle when `pressed` is passed, else action.
 *   MenuItem        an action in a menu. NEVER selected.
 *   SelectableRow   a row. Persistent state only when `selected` is passed.
 *
 * The visual treatment for every state lives in styles/interaction.css and is
 * driven by the `data-ix*` attributes emitted here, so no component styles a
 * state for itself.
 */
import { createContext, forwardRef, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

/** @param {(string | false | null | undefined)[]} parts */
function classNames(...parts) {
  return parts.filter(Boolean).join(" ");
}

/**
 * Selection is opt-in. `undefined` means "this control has no selected state",
 * which is different from `false` ("it has one and it is off") — only the
 * latter is announced to assistive technology.
 * @param {boolean | undefined} selected
 */
function selectionAttributes(selected) {
  if (selected === undefined) return {};
  return selected ? { "data-ix-selected": "" } : {};
}

/* ------------------------------------------------------------------ *
 * Button / IconButton — actions, never selected
 * ------------------------------------------------------------------ */

export const Button = forwardRef(
  /**
   * @param {{
   *   children?: import("react").ReactNode,
   *   tone?: "solid" | "soft" | "outline" | "ghost" | "danger",
   *   block?: boolean,
   *   type?: "button" | "submit" | "reset",
   *   className?: string,
   *   to?: string,
   *   href?: string
   * } & Record<string, any>} props
   * @param {import("react").Ref<any>} ref
   */
  function Button({ children, tone = "soft", block = false, type = "button", className = "", to = "", href = "", ...rest }, ref) {
    const shared = {
      ref,
      "data-ix": "button",
      "data-ix-tone": tone,
      "data-ix-block": block ? "true" : undefined,
      className: classNames(className),
      ...rest
    };
    if (to) return <Link {...shared} to={to}>{children}</Link>;
    if (href) return <a {...shared} href={href}>{children}</a>;
    return <button {...shared} type={type}>{children}</button>;
  }
);

export const IconButton = forwardRef(
  /**
   * @param {{ label: string, children?: import("react").ReactNode, tone?: string, className?: string, to?: string, type?: "button" | "submit" | "reset" } & Record<string, any>} props
   * @param {import("react").Ref<any>} ref
   */
  function IconButton({ label, children, tone = "ghost", className = "", to = "", type = "button", ...rest }, ref) {
    const shared = {
      ref,
      "data-ix": "icon-button",
      "data-ix-tone": tone,
      "aria-label": label,
      title: label,
      className: classNames(className),
      ...rest
    };
    if (to) return <Link {...shared} to={to}>{children}</Link>;
    return <button {...shared} type={type}>{children}</button>;
  }
);

/* ------------------------------------------------------------------ *
 * ToggleButton — a genuine on/off control
 * ------------------------------------------------------------------ */

export const ToggleButton = forwardRef(
  /**
   * @param {{ pressed: boolean, onPressedChange?: (next: boolean) => void, children?: import("react").ReactNode, label?: string, className?: string, variant?: "tint" | "solid" | "thumb" } & Record<string, any>} props
   * @param {import("react").Ref<HTMLButtonElement>} ref
   */
  function ToggleButton({ pressed, onPressedChange, children, label = "", className = "", variant = "tint", onClick, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        data-ix="toggle"
        data-ix-variant={variant}
        aria-pressed={pressed}
        aria-label={label || undefined}
        className={classNames(className)}
        onClick={(event) => {
          onClick?.(event);
          onPressedChange?.(!pressed);
        }}
        {...selectionAttributes(pressed)}
        {...rest}
      >
        {children}
      </button>
    );
  }
);

/* ------------------------------------------------------------------ *
 * Tabs — one-of-N with roving focus
 * ------------------------------------------------------------------ */

/** @type {import("react").Context<{ value: string, onChange: (next: string) => void, baseId: string, variant: string, orientation: string, register: (value: string, node: HTMLButtonElement | null) => void, move: (from: string, step: number) => void, fallbackValue?: string }>} */
const TabsContext = createContext(/** @type {any} */ (null));

/**
 * @param {{ value: string, onChange: (next: string) => void, label: string, children: import("react").ReactNode, variant?: "thumb" | "tint", orientation?: "horizontal" | "vertical", className?: string }} props
 */
export function TabList({ value, onChange, label, children, variant = "thumb", orientation = "horizontal", className = "" }) {
  const baseId = useId().replace(/:/g, "");
  const nodes = useRef(/** @type {{ value: string, node: HTMLButtonElement }[]} */ ([]));

  const register = useCallback((tabValue, node) => {
    nodes.current = nodes.current.filter((entry) => entry.value !== tabValue);
    if (node) nodes.current.push({ value: tabValue, node });
  }, []);

  const move = useCallback((from, step) => {
    const ordered = nodes.current
      .slice()
      .sort((a, b) => (a.node.compareDocumentPosition(b.node) & window.Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const index = ordered.findIndex((entry) => entry.value === from);
    if (index === -1) return;
    const next = ordered[(index + step + ordered.length) % ordered.length];
    next.node.focus();
    onChange(next.value);
  }, [onChange]);

  const context = useMemo(
    () => ({ value, onChange, baseId, variant, orientation, register, move }),
    [value, onChange, baseId, variant, orientation, register, move]
  );

  return (
    <TabsContext.Provider value={context}>
      <div className={classNames("ix-tablist", className)} role="tablist" aria-label={label} aria-orientation={orientation}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

/**
 * @param {{ value: string, children: import("react").ReactNode, className?: string, controls?: string } & Record<string, any>} props
 */
export function Tab({ value, children, className = "", controls = "", tabIndex = undefined, ...rest }) {
  const context = useContext(TabsContext);
  if (!context) throw new Error("<Tab> must be rendered inside a <TabList>");
  const selected = context.value === value;
  return (
    <button
      ref={(node) => context.register(value, node)}
      type="button"
      role="tab"
      id={`${context.baseId}-tab-${value}`}
      aria-selected={selected}
      aria-controls={controls || undefined}
      // Roving tabindex: the strip is a single stop, arrows move within it.
      // `tabIndex` is destructured out of the rest props on purpose — spreading
      // an explicit `undefined` over it would put every option back in the tab
      // order. A caller may still pass -1 to park the whole strip.
      tabIndex={tabIndex === -1 ? -1 : selected ? 0 : -1}
      data-ix="tab"
      data-ix-variant={context.variant}
      className={classNames(className)}
      onClick={() => context.onChange(value)}
      onKeyDown={(event) => {
        const forward = context.orientation === "vertical" ? "ArrowDown" : "ArrowRight";
        const backward = context.orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
        if (event.key !== forward && event.key !== backward) return;
        event.preventDefault();
        context.move(value, event.key === forward ? 1 : -1);
      }}
      {...selectionAttributes(selected)}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * RadioGroup — pick exactly one of N
 *
 * The application had five of these built out of plain buttons carrying
 * `aria-pressed`, which announces "toggle button, pressed" for every option
 * and leaves the previous choice sounding equally pressed. A radio group
 * announces the set, the choice, and the position within it.
 * ------------------------------------------------------------------ */

/**
 * @param {{ value: string, onChange: (next: string) => void, label: string, children: import("react").ReactNode, className?: string, orientation?: "horizontal" | "vertical" } & Record<string, any>} props
 */
export function RadioGroup({ value, onChange, label, children, className = "", orientation = "horizontal", ...rest }) {
  const baseId = useId().replace(/:/g, "");
  const nodes = useRef(/** @type {{ value: string, node: HTMLButtonElement }[]} */ ([]));
  const [fallbackValue, setFallbackValue] = useState("");

  const register = useCallback((optionValue, node) => {
    nodes.current = nodes.current.filter((entry) => entry.value !== optionValue);
    if (node) nodes.current.push({ value: optionValue, node });
  }, []);

  // A group with nothing chosen yet — an unanswered question, for instance —
  // would have every option at tabindex -1 and drop out of the tab order
  // entirely. The first option carries the tab stop until a choice is made.
  useEffect(() => {
    const ordered = nodes.current
      .slice()
      .sort((a, b) => (a.node.compareDocumentPosition(b.node) & window.Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const chosen = ordered.some((entry) => entry.value === value);
    setFallbackValue(chosen ? "" : ordered[0]?.value || "");
  }, [value, children]);

  const move = useCallback((from, step) => {
    const ordered = nodes.current
      .slice()
      .sort((a, b) => (a.node.compareDocumentPosition(b.node) & window.Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
      .filter((entry) => !entry.node.disabled);
    const index = ordered.findIndex((entry) => entry.value === from);
    if (index === -1) return;
    const next = ordered[(index + step + ordered.length) % ordered.length];
    next.node.focus();
    onChange(next.value);
  }, [onChange]);

  const context = useMemo(
    () => ({ value, onChange, baseId, variant: "tint", orientation, register, move, fallbackValue }),
    [value, onChange, baseId, orientation, register, move, fallbackValue]
  );

  return (
    <TabsContext.Provider value={context}>
      <div className={classNames(className)} role="radiogroup" aria-label={label} {...rest}>{children}</div>
    </TabsContext.Provider>
  );
}

/**
 * @param {{ value: string, children: import("react").ReactNode, className?: string, disabled?: boolean } & Record<string, any>} props
 */
export function RadioOption({ value, children, className = "", disabled = false, tabIndex = undefined, ...rest }) {
  const context = useContext(TabsContext);
  if (!context) throw new Error("<RadioOption> must be rendered inside a <RadioGroup>");
  const checked = context.value === value;
  return (
    <button
      ref={(node) => context.register(value, node)}
      type="button"
      role="radio"
      aria-checked={checked}
      // Roving tabindex: the group is one tab stop; arrows move the choice.
      // Destructured out of the rest props so a spread `undefined` cannot put
      // every option back in the tab order; -1 parks the whole group.
      tabIndex={tabIndex === -1 ? -1 : checked || context.fallbackValue === value ? 0 : -1}
      disabled={disabled}
      data-ix="radio-option"
      className={classNames(className)}
      onClick={() => context.onChange(value)}
      onKeyDown={(event) => {
        const forward = context.orientation === "vertical" ? "ArrowDown" : "ArrowRight";
        const backward = context.orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
        if (event.key !== forward && event.key !== backward) return;
        event.preventDefault();
        context.move(value, event.key === forward ? 1 : -1);
      }}
      {...selectionAttributes(checked)}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * Convenience wrapper for the common "two or three labelled sections" strip.
 * @param {{ value: string, onChange: (next: string) => void, label: string, options: { id: string, label: import("react").ReactNode }[], variant?: "thumb" | "tint", className?: string }} props
 */
export function SegmentedControl({ value, onChange, label, options, variant = "thumb", className = "" }) {
  return (
    <TabList value={value} onChange={onChange} label={label} variant={variant} className={className}>
      {options.map((option) => <Tab key={option.id} value={option.id}>{option.label}</Tab>)}
    </TabList>
  );
}

/* ------------------------------------------------------------------ *
 * NavItem — route destinations
 * ------------------------------------------------------------------ */

/**
 * The current state comes from the route, never from focus or from a click
 * handler, so clicking elsewhere can neither add nor remove it.
 * @param {{ to: string, current: boolean, children: import("react").ReactNode, className?: string } & Record<string, any>} props
 */
export function NavItem({ to, current, children, className = "", ...rest }) {
  return (
    <Link
      to={to}
      data-ix="nav-item"
      aria-current={current ? "page" : undefined}
      {...(current ? { "data-ix-current": "" } : {})}
      className={classNames(className)}
      draggable="false"
      {...rest}
    >
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------ *
 * ToolbarButton — workspace tools
 * ------------------------------------------------------------------ */

/**
 * Pass `pressed` only for a tool that stays chosen (pen, eraser, highlighter).
 * Leave it out for a one-shot action (undo, zoom in, close) so the button
 * cannot acquire a persistent state.
 * @param {{ label: string, pressed?: boolean, children?: import("react").ReactNode, className?: string } & Record<string, any>} props
 */
export function ToolbarButton({ label, pressed = undefined, children, className = "", ...rest }) {
  return (
    <button
      type="button"
      data-ix="toolbar-button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={classNames(className)}
      {...selectionAttributes(pressed)}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * MenuItem — actions inside a menu, never selected
 * ------------------------------------------------------------------ */

/**
 * @param {{ children: import("react").ReactNode, to?: string, className?: string } & Record<string, any>} props
 */
export function MenuItem({ children, to = "", className = "", ...rest }) {
  const shared = { "data-ix": "menu-item", role: "menuitem", className: classNames(className), ...rest };
  if (to) return <Link {...shared} to={to} draggable="false">{children}</Link>;
  return <button {...shared} type="button">{children}</button>;
}

/* ------------------------------------------------------------------ *
 * SelectableRow — rows that may or may not hold a selection
 * ------------------------------------------------------------------ */

/**
 * A row that only opens something takes no `selected` prop and therefore has
 * no persistent state: press feedback, then navigation. A row inside a
 * master/detail pairing passes `selected` and gets the single accent rail.
 *
 * `aria-current` — not `aria-pressed` — is the correct announcement: the row
 * is not a two-state button, it is the one the detail pane is showing.
 * @param {{ children: import("react").ReactNode, selected?: boolean, to?: string, className?: string } & Record<string, any>} props
 */
export function SelectableRow({ children, selected = undefined, to = "", className = "", ...rest }) {
  const shared = {
    "data-ix": "selectable-row",
    "data-ix-variant": selected === undefined ? undefined : "rail",
    "aria-current": selected ? /** @type {const} */ ("true") : undefined,
    className: classNames(className),
    ...selectionAttributes(selected),
    ...rest
  };
  if (to) return <Link {...shared} to={to} draggable="false">{children}</Link>;
  return <button {...shared} type="button">{children}</button>;
}
