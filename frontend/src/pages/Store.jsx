import { useEffect, useMemo, useState } from "react";
import { Icon } from "../lib/icons.jsx";
import { assetPath } from "../lib/utils.js";
import { COMPACT_SHELL_QUERY } from "../lib/constants.js";
import { Page } from "../components/ui/index.jsx";
import { formatNumber } from "../lib/i18n.js";
import { useVisibleNow } from "../hooks/useVisibleNow.js";
import { ResponsiveMascot } from "../components/shared/ResponsiveMascot.jsx";
import { useMediaQuery } from "../hooks/useMediaQuery.js";
import { useI18n } from "../components/I18nProvider.jsx";

const categories = [
  ["all", "store.categoryAll", "sparkles"],
  ["themes", "store.categoryThemes", "palette"],
  ["bundles", "store.categoryBundles", "package"],
  ["addons", "store.categoryAddons", "wand"],
  ["skins", "store.categorySkins", "shirt"],
  ["limited", "store.categoryLimited", "gift"],
  ["accessories", "store.categoryAccessories", "headphones"]
];

// Badge ids double as the modifier in `store-badge {id}`, so they stay stable
// while only the label follows the interface language.
const BADGE_KEYS = { new: "store.badgeNew", popular: "store.badgePopular", limited: "store.badgeLimited", "best-value": "store.badgeBestValue" };

const themePacks = [
  { id: "sunshine", nameKey: "store.pack.sunshine", detailKey: "store.pack.sunshineDetail", price: 750, preview: "sunshine", badge: "new", glyph: "☀" },
  { id: "forest", nameKey: "store.pack.forest", detailKey: "store.pack.forestDetail", price: 750, preview: "forest", badge: "popular", glyph: "🌲" },
  { id: "halloween", nameKey: "store.pack.halloween", detailKey: "store.pack.halloweenDetail", price: 900, preview: "halloween", badge: "limited", glyph: "🎃" },
  { id: "summer", nameKey: "store.pack.summer", detailKey: "store.pack.summerDetail", price: 750, preview: "summer", badge: "new", glyph: "🏖" },
  { id: "sakura", nameKey: "store.pack.sakura", detailKey: "store.pack.sakuraDetail", price: 800, preview: "sakura", glyph: "🌸" },
  { id: "galaxy", nameKey: "store.pack.galaxy", detailKey: "store.pack.galaxyDetail", price: 950, preview: "galaxy", badge: "popular", glyph: "🌌" },
  { id: "winter", nameKey: "store.pack.winter", detailKey: "store.pack.winterDetail", price: 850, preview: "winter", glyph: "🎄" }
];

const bundles = [
  { id: "student-starter", nameKey: "store.bundle.starter", detailKey: "store.bundle.starterDetail", price: 1350, icon: "gift", accent: "starter", itemKeys: ["store.item.theme", "store.item.profileFrame", "store.item.chatBadge", "store.item.avatar"] },
  { id: "ultimate-study", nameKey: "store.bundle.ultimate", detailKey: "store.bundle.ultimateDetail", price: 2490, icon: "package", accent: "ultimate", badge: "best-value", itemKeys: ["store.item.everyTheme", "store.item.everyAddon", "store.item.exclusiveRewards"] },
  { id: "custom", nameKey: "store.bundle.custom", detailKey: "store.bundle.customDetail", price: 0, icon: "wand", accent: "custom", itemKeys: ["store.item.chooseOwn"] }
];

const addOns = [
  ["profile-frames", "store.addon.profileFrames", "user"],
  ["animated-backgrounds", "store.addon.animatedBackgrounds", "sparkles"],
  ["cursor-effects", "store.addon.cursorEffects", "cursor"],
  ["study-wallpapers", "store.addon.studyWallpapers", "image"],
  ["achievement-effects", "store.addon.achievementEffects", "award"],
  ["level-up", "store.addon.levelUp", "activity"],
  ["focus-timers", "store.addon.focusTimers", "clock"],
  ["notebook-covers", "store.addon.notebookCovers", "book-open"],
  ["bookmarks", "store.addon.bookmarks", "bookmark"],
  ["chat-stickers", "store.addon.chatStickers", "sticker"],
  ["name-colors", "store.addon.nameColors", "palette"],
  ["sound-packs", "store.addon.soundPacks", "volume"]
];

const companionUnlocks = [
  ["store.unlock.outfits", "shirt"],
  ["store.unlock.glasses", "eye"],
  ["store.unlock.headphones", "headphones"],
  ["store.unlock.cap", "award"],
  ["store.unlock.seasonal", "sparkles"],
  ["store.unlock.idle", "activity"],
  ["store.unlock.voice", "volume"],
  ["store.unlock.emotes", "sticker"],
  ["store.unlock.studyAnimations", "book-open"]
];

const tipKeys = ["store.tip1", "store.tip2", "store.tip3"];

function formatLock(value) {
  return formatNumber(value);
}

function timeUntilTomorrow(now) {
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 0, 0, 0);
  const remaining = Math.max(0, tomorrow.getTime() - now.getTime());
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function DailyRewardCountdown({ claimed }) {
  const { t } = useI18n();
  const tick = useVisibleNow(!claimed);

  const now = new Date(tick);
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 0, 0, 0);
  const label = timeUntilTomorrow(now);
  return <time dateTime={tomorrow.toISOString()} dir="auto" aria-label={claimed ? t("store.rewardTomorrow") : t("store.nextReward", { time: label })}>{claimed ? t("store.availableTomorrow") : label}</time>;
}

function LockPrice({ value }) {
  const { t } = useI18n();
  return <span className="store-lock-price" dir="auto"><Icon name="coins" size={17} /><strong>{formatLock(value)}</strong><small>{t("store.lock")}</small></span>;
}

function compactStoreViewport() {
  return typeof window !== "undefined" && window.matchMedia(COMPACT_SHELL_QUERY).matches;
}

export default function Store({ onLockBalanceChange, onCartCountChange }) {
  const { t } = useI18n();
  const [activeCategory, setActiveCategory] = useState(() => compactStoreViewport() ? "themes" : "all");
  const compactStore = useMediaQuery(COMPACT_SHELL_QUERY, compactStoreViewport());
  const [expandedCatalog, setExpandedCatalog] = useState({ themes: false, addons: false });
  const [cart, setCart] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [dailyClaimed, setDailyClaimed] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (compactStore) setActiveCategory((current) => current === "all" ? "themes" : current);
  }, [compactStore]);

  useEffect(() => {
    const rotate = window.setInterval(() => setTipIndex((current) => (current + 1) % tipKeys.length), 6800);
    return () => window.clearInterval(rotate);
  }, []);

  useEffect(() => {
    const openCart = () => setCartOpen(true);
    window.addEventListener("lock-in:open-store-cart", openCart);
    return () => window.removeEventListener("lock-in:open-store-cart", openCart);
  }, []);

  useEffect(() => {
    onCartCountChange?.(cart.length);
  }, [cart.length, onCartCountChange]);

  useEffect(() => () => onCartCountChange?.(0), [onCartCountChange]);

  const cartTotal = useMemo(() => cart.reduce((total, item) => total + item.price, 0), [cart]);
  const isInCart = (id) => cart.some((item) => item.id === id);
  const showThemes = ["all", "themes", "limited"].includes(activeCategory);
  const showBundles = ["all", "bundles"].includes(activeCategory);
  const showAddOns = ["all", "addons", "accessories"].includes(activeCategory);
  const showCompanion = ["all", "skins"].includes(activeCategory);
  const visibleThemePacks = activeCategory === "limited" ? themePacks.filter((pack) => pack.badge === "limited") : themePacks;
  const displayedThemePacks = compactStore && !expandedCatalog.themes ? visibleThemePacks.slice(0, 4) : visibleThemePacks;
  const displayedAddOns = compactStore && !expandedCatalog.addons ? addOns.slice(0, 6) : addOns;

  function addToCart(item) {
    if (isInCart(item.id)) return;
    setCart((current) => [...current, item]);
    setNotice(t("store.addedToCart", { name: item.name }));
  }

  function removeFromCart(itemId) {
    setCart((current) => current.filter((item) => item.id !== itemId));
  }

  function claimDailyReward() {
    if (dailyClaimed) return;
    setDailyClaimed(true);
    onLockBalanceChange?.((current) => current + 25);
    setNotice(t("store.dailyClaimed"));
  }

  function showFullPack() {
    setActiveCategory("bundles");
    window.setTimeout(() => document.getElementById("store-bundles")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  return (
    <Page title="Store" showHeading={false}>
      <section className="store-page" aria-describedby="store-subtitle">
        <header className="store-intro">
          <div>
            <p className="eyebrow">{t("store.lockStore")}</p>
            <h2>{t("store.heading")}</h2>
            <p id="store-subtitle">{t("store.subtitle")}</p>
          </div>
          <button className="store-cart-summary" type="button" onClick={() => setCartOpen(true)} aria-expanded={cartOpen} aria-controls="store-cart">
            <Icon name="shopping-bag" size={18} />
            <span dir="auto">{cart.length ? t("store.cartItems", { count: cart.length }) : t("store.cartEmptyShort")}</span>
            {cart.length > 0 && <LockPrice value={cartTotal} />}
          </button>
        </header>

        <section className="store-hero" aria-labelledby="store-hero-title">
          <picture>
            <source type="image/avif" srcSet={`${assetPath("/assets/store-hero-treasure-480.avif")} 480w, ${assetPath("/assets/store-hero-treasure-960.avif")} 960w`} sizes="(max-width: 639px) 100vw, 960px" />
            <source type="image/webp" srcSet={`${assetPath("/assets/store-hero-treasure-480.webp")} 480w, ${assetPath("/assets/store-hero-treasure-960.webp")} 960w`} sizes="(max-width: 639px) 100vw, 960px" />
            <img src={assetPath("/assets/store-hero-treasure-960.webp")} width="960" height="540" decoding="async" alt={t("store.heroAlt")} />
          </picture>
          <div className="store-hero-copy"><p className="eyebrow">{t("store.featuredBundle")}</p><h2 id="store-hero-title">{t("store.heroTitle")}</h2><p>{t("store.heroCopy")}</p><div className="store-hero-actions"><LockPrice value={2490} /><button className="btn btn-primary" type="button" onClick={showFullPack}>{t("store.exploreBundles")} <Icon name="chevron-right" size={17} /></button></div></div>
        </section>

        <div className="store-body">
          <main className="store-catalogue">
            <label className="field store-mobile-category"><span>{t("store.categoryLabel")}</span><select value={activeCategory} onChange={(event) => setActiveCategory(event.target.value)}>{categories.map(([id, labelKey]) => <option key={id} value={id}>{t(labelKey)}</option>)}</select></label>
            <div className="store-tabs" role="tablist" aria-label={t("store.categoriesLabel")}>
              {categories.map(([id, labelKey, icon]) => (
                <button key={id} type="button" role="tab" aria-selected={activeCategory === id} className={activeCategory === id ? "active" : ""} onClick={() => setActiveCategory(id)}>
                  <Icon name={icon} size={16} /><span>{t(labelKey)}</span>
                </button>
              ))}
            </div>

            {notice && <p className="store-notice" role="status" dir="auto"><Icon name="check" size={16} />{notice}<button type="button" onClick={() => setNotice("")} aria-label={t("store.dismissNotice")}><Icon name="x" size={15} /></button></p>}

            {showThemes && <section className="store-section" aria-labelledby="theme-packs-heading">
              <div className="store-section-heading">
                <div><p className="eyebrow">{t("store.customize")}</p><h2 id="theme-packs-heading">{t(activeCategory === "limited" ? "store.limitedThemePacks" : "store.themePacks")}</h2><p>{t("store.themePacksCopy")}</p></div>
                <span dir="auto">{t("store.available", { count: visibleThemePacks.length })}</span>
              </div>
              <div className="store-theme-grid">
                {displayedThemePacks.map((pack) => <ThemePackCard key={pack.id} pack={pack} inCart={isInCart(pack.id)} onPurchase={() => addToCart({ id: pack.id, name: t(pack.nameKey), price: pack.price, kind: "theme" })} />)}
              </div>
              {displayedThemePacks.length < visibleThemePacks.length && <button className="btn btn-soft store-show-more" type="button" onClick={() => setExpandedCatalog((current) => ({ ...current, themes: true }))}>{t("store.showAllThemes", { count: visibleThemePacks.length })}</button>}
            </section>}

            {showBundles && <section className="store-section" id="store-bundles" aria-labelledby="bundles-heading">
              <div className="store-section-heading">
                <div><p className="eyebrow">{t("store.moreTogether")}</p><h2 id="bundles-heading">{t("store.bundles")}</h2><p>{t("store.bundlesCopy")}</p></div>
              </div>
              <div className="store-bundles-grid">
                {bundles.map((bundle) => <BundleCard key={bundle.id} bundle={bundle} inCart={isInCart(bundle.id)} onPurchase={() => addToCart({ id: bundle.id, name: t(bundle.nameKey), price: bundle.price, kind: "bundle" })} />)}
              </div>
            </section>}

            {showAddOns && <section className="store-section" aria-labelledby="addons-heading">
              <div className="store-section-heading">
                <div><p className="eyebrow">{t("store.smallDetails")}</p><h2 id="addons-heading">{t(activeCategory === "accessories" ? "store.accessories" : "store.addons")}</h2><p>{t("store.addonsCopy")}</p></div>
              </div>
              <div className="store-addons-grid">
                {displayedAddOns.map(([id, nameKey, icon], index) => <AddOnCard key={id} id={id} name={t(nameKey)} icon={icon} price={150 + (index % 4) * 50} inCart={isInCart(id)} onPurchase={() => addToCart({ id, name: t(nameKey), price: 150 + (index % 4) * 50, kind: "addon" })} />)}
              </div>
              {displayedAddOns.length < addOns.length && <button className="btn btn-soft store-show-more" type="button" onClick={() => setExpandedCatalog((current) => ({ ...current, addons: true }))}>{t("store.showAllAddons", { count: addOns.length })}</button>}
            </section>}

            {showCompanion && <section className="store-companion" aria-labelledby="companion-heading">
              <div className="store-companion-copy"><p className="eyebrow">{t("store.aiCompanion")}</p><h2 id="companion-heading">{t("store.companionNames")}</h2><p>{t("store.companionCopy")}</p><button className="btn btn-soft compact" type="button" onClick={() => setNotice(t("store.companionNotice"))}>{t("store.exploreSkins")} <Icon name="chevron-right" size={16} /></button></div>
              <ResponsiveMascot alt={t("store.companionAlt")} sizes="240px" />
              <ul className="store-unlocks">
                {companionUnlocks.map(([labelKey, icon]) => <li key={labelKey}><Icon name={icon} size={15} />{t(labelKey)}</li>)}
              </ul>
            </section>}
          </main>

          <aside className="store-sidebar" aria-label={t("store.extras")}>
            <section className="store-side-card store-daily-card">
              <div className="store-side-icon"><Icon name="gift" size={20} /></div>
              <div><p className="eyebrow">{t("store.dailyReward")}</p><h2>{t(dailyClaimed ? "store.rewardClaimed" : "store.comeBackDaily")}</h2></div>
              <DailyRewardCountdown claimed={dailyClaimed} />
              <p>{t(dailyClaimed ? "store.dailyReadyMidnight" : "store.earnDaily")}</p>
              <button className="btn btn-primary" type="button" disabled={dailyClaimed} onClick={claimDailyReward}>{t(dailyClaimed ? "store.claimed" : "store.claim25")}</button>
            </section>

            <section className="store-side-card store-topup-card" aria-labelledby="topup-heading">
              <div className="store-side-title"><div><p className="eyebrow">{t("store.lockShop")}</p><h2 id="topup-heading">{t("store.topUp")}</h2></div><Icon name="coins" size={19} /></div>
              <div className="store-topup-list">
                {[[500, "$1.99"], [1250, "$3.99", "popular"], [2750, "$7.99"], [6000, "$14.99"]].map(([amount, price, badge]) => <button key={amount} className="store-topup-option" type="button" onClick={() => setNotice(t("store.topUpNotice", { amount: formatLock(amount) }))}><LockPrice value={amount} /><span dir="auto">{price}</span>{badge && <em>{t(BADGE_KEYS[badge])}</em>}</button>)}
              </div>
              <button className="btn btn-soft compact store-full-width" type="button" onClick={() => setNotice(t("store.moreLockOptions"))}>{t("store.viewAll")}</button>
            </section>

            <section className="store-side-card store-tip-card">
              <div className="store-side-title"><div><p className="eyebrow">{t("store.proTip")}</p><h2>{t("store.keepItFresh")}</h2></div><Icon name="sparkles" size={19} /></div>
              <p key={tipIndex} className="store-tip-copy" dir="auto">“{t(tipKeys[tipIndex])}”</p>
              <button className="text-link" type="button" onClick={() => setTipIndex((current) => (current + 1) % tipKeys.length)}>{t("store.nextTip")} <Icon name="chevron-right" size={15} /></button>
            </section>
          </aside>
        </div>

        {cartOpen && <section className="store-cart-panel panel" id="store-cart" aria-labelledby="store-cart-title">
          <div className="store-cart-heading"><div><p className="eyebrow">{t("store.yourPicks")}</p><h2 id="store-cart-title">{t("store.cart")}</h2></div><button className="icon-btn" type="button" onClick={() => setCartOpen(false)} aria-label={t("store.closeCart")}><Icon name="x" /></button></div>
          {cart.length ? <><div className="store-cart-items">{cart.map((item) => <div key={item.id}><span dir="auto"><Icon name={item.kind === "bundle" ? "package" : item.kind === "theme" ? "palette" : "sparkles"} size={16} />{item.name}</span><LockPrice value={item.price} /><button className="text-link" type="button" onClick={() => removeFromCart(item.id)}>{t("common.remove")}</button></div>)}</div><div className="store-cart-total"><span>{t("store.total")}</span><LockPrice value={cartTotal} /></div></> : <p className="store-cart-empty">{t("store.cartEmpty")}</p>}
        </section>}
      </section>
    </Page>
  );
}

function ThemePackCard({ pack, inCart, onPurchase }) {
  const { t } = useI18n();
  return <article className="store-theme-card">
    <div className={`store-theme-preview ${pack.preview}`} aria-hidden="true">
      {pack.badge && <span className={`store-badge ${pack.badge}`}>{t(BADGE_KEYS[pack.badge])}</span>}
      <span className="store-theme-glyph">{pack.glyph}</span><div className="store-preview-window"><i /><i /><i /><b /><b /></div>
    </div>
    <div className="store-theme-details"><div><h3>{t(pack.nameKey)}</h3><p>{t(pack.detailKey)}</p></div><LockPrice value={pack.price} /></div>
    <button className="btn btn-soft compact store-card-action" type="button" disabled={inCart} onClick={onPurchase}><Icon name="shopping-bag" size={16} />{t(inCart ? "store.inCart" : "store.purchase")}</button>
  </article>;
}

function BundleCard({ bundle, inCart, onPurchase }) {
  const { t } = useI18n();
  return <article className={`store-bundle-card ${bundle.accent}`}>
    {bundle.badge && <span className="store-bundle-badge">{t(BADGE_KEYS[bundle.badge])}</span>}
    <div className="store-bundle-icon"><Icon name={bundle.icon} size={25} /></div><h3>{t(bundle.nameKey)}</h3><p>{t(bundle.detailKey)}</p>
    <ul>{bundle.itemKeys.map((itemKey) => <li key={itemKey}><Icon name="check" size={14} />{t(itemKey)}</li>)}</ul>
    {bundle.price ? <div className="store-bundle-actions"><LockPrice value={bundle.price} /><button className="btn btn-primary compact" type="button" disabled={inCart} onClick={onPurchase}>{t(inCart ? "store.inCart" : "store.purchase")}</button></div> : <button className="btn btn-soft compact" type="button" onClick={onPurchase}><Icon name="wand" size={15} />{t("store.customizeAction")}</button>}
  </article>;
}

function AddOnCard({ id: _id, name, icon, price, inCart, onPurchase }) {
  const { t } = useI18n();
  return <article className="store-addon-card"><span className="store-addon-icon"><Icon name={icon} size={19} /></span><h3 dir="auto">{name}</h3><LockPrice value={price} /><button type="button" className="icon-btn" disabled={inCart} onClick={onPurchase} aria-label={t("store.purchaseNamed", { action: t(inCart ? "store.added" : "store.purchase"), name })}><Icon name={inCart ? "check" : "shopping-bag"} size={16} /></button></article>;
}
