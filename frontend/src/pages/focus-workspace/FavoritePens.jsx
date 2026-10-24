import { useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { useI18n } from "../../components/I18nProvider.jsx";
import { cssVars } from "../../lib/utils.js";
import { PEN_PROFILE_OPTIONS } from "./constants.js";
import { MAX_FAVORITE_PENS } from "./favoritePens.js";
import "./favorite-pens.css";

function favoriteName(t, favorite) {
  const pen = favorite.tool === "highlighter"
    ? t("focus.highlight")
    : t(PEN_PROFILE_OPTIONS.find(([value]) => value === favorite.profile)?.[3] || "focus.tool.pen");
  return t("focus.favoritePenName", { pen, color: favorite.color, width: favorite.width });
}

/**
 * The favorite pens strip. Tapping a favorite takes up that pen; tapping the
 * one in use opens Update and Remove. The plus saves the current pen.
 * @param {{ favorites: any[], activeIndex: number, canSave: boolean, onApply: (index: number) => void, onSave: () => void, onReplace: (index: number) => void, onRemove: (index: number) => void, className?: string }} props
 */
export function FavoritePens({ favorites, activeIndex, canSave, onApply, onSave, onReplace, onRemove, className = "" }) {
  const { t } = useI18n();
  const [menuIndex, setMenuIndex] = useState(null);
  const rootRef = useRef(null);

  useEffect(() => {
    if (menuIndex === null) return undefined;
    const close = (event) => {
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (event.type === "pointerdown" && rootRef.current?.contains(event.target)) return;
      setMenuIndex(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menuIndex]);

  if (!favorites.length && !canSave) return null;
  return <div ref={rootRef} className={`workspace-favorite-pens${className ? ` ${className}` : ""}`} role="group" aria-label={t("focus.favoritePens")} onPointerDown={(event) => event.stopPropagation()}>
    {favorites.map((favorite, index) => {
      const active = index === activeIndex;
      return <span key={`${favorite.tool}-${favorite.profile}-${favorite.color}-${index}`} className="workspace-favorite-pen-slot">
        <button
          type="button"
          className={`workspace-favorite-pen is-${favorite.tool}${active ? " is-active" : ""}`}
          aria-label={favoriteName(t, favorite)}
          title={favoriteName(t, favorite)}
          aria-pressed={active}
          aria-haspopup={active ? "menu" : undefined}
          aria-expanded={active ? menuIndex === index : undefined}
          style={cssVars({ "--favorite-color": favorite.color, "--favorite-size": `${Math.round(5 + favorite.width * 1.1)}px`, "--favorite-opacity": favorite.opacity })}
          onClick={() => {
            if (active) setMenuIndex((current) => current === index ? null : index);
            else { setMenuIndex(null); onApply(index); }
          }}
        ><i aria-hidden="true" /></button>
        {menuIndex === index && <span className="workspace-favorite-pen-menu" role="menu" aria-label={favoriteName(t, favorite)}>
          <button type="button" role="menuitem" onClick={() => { setMenuIndex(null); onReplace(index); }}><RefreshCw size={15} aria-hidden="true" />{t("focus.updateFavoritePen")}</button>
          <button type="button" role="menuitem" className="is-danger" onClick={() => { setMenuIndex(null); onRemove(index); }}><Trash2 size={15} aria-hidden="true" />{t("focus.removeFavoritePen")}</button>
        </span>}
      </span>;
    })}
    {canSave && favorites.length < MAX_FAVORITE_PENS && <button type="button" className="workspace-favorite-pen is-add" aria-label={t("focus.saveFavoritePen")} title={t("focus.saveFavoritePen")} onClick={onSave}><Plus size={16} aria-hidden="true" /></button>}
  </div>;
}
