/** The small controls the Focus workspace builds its toolbar and panels from. */
import { cssVars } from "../../lib/utils.js";
import { useI18n } from "../../components/I18nProvider.jsx";
import { PEN_PROFILE_OPTIONS } from "./constants.js";

export function WorkspaceIconButton({ label, active = false, children, className = "", ...props }) {
  return <button className={`workspace-v2-icon-button${active ? " is-active" : ""}${className ? ` ${className}` : ""}`} type="button" aria-label={label} title={label} {...props}>
    {children}
  </button>;
}

/**
 * `caption` is a shorter visible label; the accessible name stays `label`.
 * `keyStep` is what one arrow key moves when `step` is a fine drag step.
 */
export function ToolRange({ label, caption = label, value, displayValue = value, min, max, step, keyStep = step, onChange, preview = "stroke", color = "#8b5cf6" }) {
  const { t } = useI18n();
  const ratio = Math.min(1, Math.max(0, (value - min) / Math.max(step, max - min)));
  // Unrounded, so the preview grows smoothly with a continuous slider.
  const previewSize = preview === "opacity" ? 16 : preview === "eraser" ? Math.round(5 + ratio * 13) : 2 + ratio * 10;
  return (
    <label className={`workspace-v2-tool-range is-${preview}`} aria-label={label} style={cssVars({ "--workspace-range-progress": `${ratio * 100}%` })}>
      <span className="workspace-v2-range-heading"><span>{caption}</span><output dir="ltr" aria-label={t("focus.currentValue", { name: label.toLowerCase() })}>{displayValue}</output></span>
      <span className="workspace-v2-range-control">
        <span className="workspace-v2-range-preview" aria-hidden="true" style={cssVars({ "--workspace-range-size": `${previewSize}px`, "--workspace-range-color": color, "--workspace-range-opacity": preview === "opacity" ? value : 1 })} />
        <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(event) => onChange(Number(event.target.value))} onKeyDown={keyStep === step ? undefined : (event) => {
          const rtl = window.getComputedStyle(event.currentTarget).direction === "rtl";
          const direction = { ArrowUp: 1, ArrowDown: -1, ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[event.key];
          if (!direction) return;
          event.preventDefault();
          onChange(Math.min(max, Math.max(min, Math.round((value + direction * keyStep) / keyStep) * keyStep)));
        }} />
      </span>
    </label>
  );
}

export function IconChoiceGroup({ label, value, options, onChange }) {
  const { t } = useI18n();
  return <div className="workspace-v2-icon-choices" role="group" aria-label={label}>
    {options.map(([optionValue, optionKey, OptionIcon, shortKey = optionKey]) => <button
      key={optionValue}
      type="button"
      className={value === optionValue ? "is-active" : ""}
      aria-label={t(optionKey)}
      title={t(optionKey)}
      aria-pressed={value === optionValue}
      onClick={() => onChange(optionValue)}
    ><OptionIcon size={17} /><span className="workspace-v5-choice-label">{t(shortKey)}</span></button>)}
  </div>;
}

export function PenProfilePicker({ value, onChange, color }) {
  const { t } = useI18n();
  return <div className="workspace-v4-pen-profiles" role="group" aria-label={t("focus.penType")}>
    {PEN_PROFILE_OPTIONS.map(([optionValue, optionKey, OptionIcon, shortKey]) => <button key={optionValue} type="button" className={value === optionValue ? "is-active" : ""} aria-label={t(optionKey)} aria-pressed={value === optionValue} onClick={() => onChange(optionValue)}>
      <span className={`workspace-v4-nib is-${optionValue}`} style={cssVars({ "--workspace-tool-color": color })}><OptionIcon size={15} /><i /></span><strong>{t(shortKey)}</strong>
    </button>)}
  </div>;
}

export function SettingsToggle({ icon: ToggleIcon, label, description, checked, onChange }) {
  return <button type="button" className="workspace-v2-settings-toggle" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
    <ToggleIcon size={17} aria-hidden="true" />
    <span><strong>{label}</strong><small>{description}</small></span>
    <span className="workspace-v2-switch-track" aria-hidden="true"><span /></span>
  </button>;
}
