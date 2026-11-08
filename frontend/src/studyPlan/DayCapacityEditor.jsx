import { useState } from "react";
import { useI18n } from "../components/I18nProvider.jsx";
import { dayWorkload } from "./model.js";

export default function DayCapacityEditor({ day, profile, disabled, onSave }) {
  const { t } = useI18n();
  const [minutes, setMinutes] = useState(dayWorkload(profile, [], day)?.available ?? profile.daily_minutes);
  return <form className="plan-day-capacity" onSubmit={event => { event.preventDefault(); if (!disabled) void onSave(Number(minutes)); }}>
    <label>{t("smart.dayTime", { date: day })}<input type="number" required min="0" max="240" value={minutes} disabled={disabled} onChange={event => setMinutes(event.target.value)} /></label>
    <button className="btn btn-soft" type="submit" disabled={disabled}>{t("smart.updateTime")}</button>
  </form>;
}
