import { useEffect, useMemo, useState } from "react";
import { assets } from "../lib/constants.js";
import { Icon } from "../lib/icons.jsx";
import { assetPath } from "../lib/utils.js";
import { Page } from "../components/ui/index.jsx";

const categories = [
  ["all", "All", "sparkles"],
  ["themes", "Theme Packs", "palette"],
  ["bundles", "Bundles", "package"],
  ["addons", "Add-ons", "wand"],
  ["skins", "AI Skins", "shirt"],
  ["limited", "Limited", "gift"],
  ["accessories", "Accessories", "headphones"]
];

const themePacks = [
  { id: "sunshine", name: "Sunshine Pack", description: "Yellow UI Theme", price: 750, preview: "sunshine", badge: "NEW", glyph: "☀" },
  { id: "forest", name: "Forest Pack", description: "Green Theme", price: 750, preview: "forest", badge: "POPULAR", glyph: "🌲" },
  { id: "halloween", name: "Halloween Pack", description: "Orange & Dark Theme", price: 900, preview: "halloween", badge: "LIMITED", glyph: "🎃" },
  { id: "summer", name: "Summer Pack", description: "Blue Theme", price: 750, preview: "summer", badge: "NEW", glyph: "🏖" },
  { id: "sakura", name: "Sakura Pack", description: "Pink Theme", price: 800, preview: "sakura", glyph: "🌸" },
  { id: "galaxy", name: "Galaxy Pack", description: "Purple Space Theme", price: 950, preview: "galaxy", badge: "POPULAR", glyph: "🌌" },
  { id: "winter", name: "Winter Pack", description: "Snow Theme", price: 850, preview: "winter", glyph: "🎄" }
];

const bundles = [
  { id: "student-starter", name: "Student Starter Pack", detail: "Theme + Profile Frame + Chat Badge + Avatar", price: 1350, icon: "gift", accent: "starter", items: ["Theme", "Profile Frame", "Chat Badge", "Avatar"] },
  { id: "ultimate-study", name: "Ultimate Study Pack", detail: "Every Theme + Every Add-on + Exclusive Rewards", price: 2490, icon: "package", accent: "ultimate", badge: "BEST VALUE", items: ["Every Theme", "Every Add-on", "Exclusive Rewards"] },
  { id: "custom", name: "Custom Pack", detail: "Build your perfect study setup.", price: 0, icon: "wand", accent: "custom", items: ["Choose your own items"] }
];

const addOns = [
  ["profile-frames", "Profile Frames", "user"],
  ["animated-backgrounds", "Animated Backgrounds", "sparkles"],
  ["cursor-effects", "Cursor Effects", "cursor"],
  ["study-wallpapers", "Study Wallpapers", "image"],
  ["achievement-effects", "Achievement Effects", "award"],
  ["level-up", "Level-up Animation", "activity"],
  ["focus-timers", "Focus Timer Styles", "clock"],
  ["notebook-covers", "Notebook Covers", "book-open"],
  ["bookmarks", "Bookmarks", "bookmark"],
  ["chat-stickers", "Chat Stickers", "sticker"],
  ["name-colors", "Name Colors", "palette"],
  ["sound-packs", "Sound Packs", "volume"]
];

const companionUnlocks = [
  ["New outfits", "shirt"],
  ["New glasses", "eye"],
  ["Headphones", "headphones"],
  ["Graduation cap", "award"],
  ["Seasonal skins", "sparkles"],
  ["Idle animations", "activity"],
  ["Voice packs", "volume"],
  ["Chat emotes", "sticker"],
  ["Study animations", "book-open"]
];

const tipMessages = [
  "A fresh theme can refresh your focus.",
  "Save your best study setup for exam season.",
  "A small cosmetic reward can make consistency feel visible."
];

function formatLock(value) {
  return Number(value).toLocaleString();
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

function LockPrice({ value }) {
  return <span className="store-lock-price"><Icon name="coins" size={17} /><strong>{formatLock(value)}</strong><small>LOCK</small></span>;
}

export default function Store({ onLockBalanceChange, onCartCountChange }) {
  const [activeCategory, setActiveCategory] = useState("all");
  const [cart, setCart] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [dailyClaimed, setDailyClaimed] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    const rotate = window.setInterval(() => setTipIndex((current) => (current + 1) % tipMessages.length), 6800);
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
  const visibleThemePacks = activeCategory === "limited" ? themePacks.filter((pack) => pack.badge === "LIMITED") : themePacks;

  function addToCart(item) {
    if (isInCart(item.id)) return;
    setCart((current) => [...current, item]);
    setNotice(`${item.name} was added to your cart.`);
  }

  function removeFromCart(itemId) {
    setCart((current) => current.filter((item) => item.id !== itemId));
  }

  function claimDailyReward() {
    if (dailyClaimed) return;
    setDailyClaimed(true);
    onLockBalanceChange?.((current) => current + 25);
    setNotice("25 LOCK claimed. Come back tomorrow for another reward.");
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
            <p className="eyebrow">LOCK Store</p>
            <h2>Make your study space yours.</h2>
            <p id="store-subtitle">Themes, bundles, and small rewards for every focused session.</p>
          </div>
          <button className="store-cart-summary" type="button" onClick={() => setCartOpen(true)} aria-expanded={cartOpen} aria-controls="store-cart">
            <Icon name="shopping-bag" size={18} />
            <span>{cart.length ? `${cart.length} item${cart.length === 1 ? "" : "s"}` : "Your cart is empty"}</span>
            {cart.length > 0 && <LockPrice value={cartTotal} />}
          </button>
        </header>

        <section className="store-hero" aria-labelledby="store-hero-title">
          <img src={assetPath("/assets/store-hero-treasure.png")} alt="Two Lock In cat companions opening a glowing treasure chest" />
          <div className="store-hero-copy">
            <p className="eyebrow">Featured bundle</p>
            <h1 id="store-hero-title">Unlock the best experience.</h1>
            <p>Premium themes, bundles and exclusive cosmetics.</p>
            <div className="store-hero-actions">
              <LockPrice value={2490} />
              <button className="btn btn-primary" type="button" onClick={showFullPack}>View Full Pack <Icon name="chevron-right" size={17} /></button>
            </div>
          </div>
        </section>

        <div className="store-body">
          <main className="store-catalogue">
            <div className="store-tabs" role="tablist" aria-label="Store categories">
              {categories.map(([id, label, icon]) => (
                <button key={id} type="button" role="tab" aria-selected={activeCategory === id} className={activeCategory === id ? "active" : ""} onClick={() => setActiveCategory(id)}>
                  <Icon name={icon} size={16} /><span>{label}</span>
                </button>
              ))}
            </div>

            {notice && <p className="store-notice" role="status"><Icon name="check" size={16} />{notice}<button type="button" onClick={() => setNotice("")} aria-label="Dismiss store update"><Icon name="x" size={15} /></button></p>}

            {showThemes && <section className="store-section" aria-labelledby="theme-packs-heading">
              <div className="store-section-heading">
                <div><p className="eyebrow">Customize</p><h2 id="theme-packs-heading">{activeCategory === "limited" ? "Limited theme packs" : "Theme Packs"}</h2><p>Transform your workspace. Boost your mood.</p></div>
                <span>{visibleThemePacks.length} available</span>
              </div>
              <div className="store-theme-grid">
                {visibleThemePacks.map((pack) => <ThemePackCard key={pack.id} pack={pack} inCart={isInCart(pack.id)} onPurchase={() => addToCart({ ...pack, type: "Theme pack" })} />)}
              </div>
            </section>}

            {showBundles && <section className="store-section" id="store-bundles" aria-labelledby="bundles-heading">
              <div className="store-section-heading">
                <div><p className="eyebrow">More together</p><h2 id="bundles-heading">Bundles</h2><p>Everything you need, all in one pack.</p></div>
              </div>
              <div className="store-bundles-grid">
                {bundles.map((bundle) => <BundleCard key={bundle.id} bundle={bundle} inCart={isInCart(bundle.id)} onPurchase={() => addToCart({ ...bundle, type: "Bundle" })} />)}
              </div>
            </section>}

            {showAddOns && <section className="store-section" aria-labelledby="addons-heading">
              <div className="store-section-heading">
                <div><p className="eyebrow">Small details</p><h2 id="addons-heading">{activeCategory === "accessories" ? "Accessories" : "Add-ons"}</h2><p>Personal touches for every study session.</p></div>
              </div>
              <div className="store-addons-grid">
                {addOns.map(([id, name, icon], index) => <AddOnCard key={id} id={id} name={name} icon={icon} price={150 + (index % 4) * 50} inCart={isInCart(id)} onPurchase={() => addToCart({ id, name, price: 150 + (index % 4) * 50, type: "Add-on" })} />)}
              </div>
            </section>}

            {showCompanion && <section className="store-companion" aria-labelledby="companion-heading">
              <div className="store-companion-copy"><p className="eyebrow">AI companion</p><h2 id="companion-heading">Starmo &amp; Starsea</h2><p>Give your study companions new ways to show up for every focus block.</p><button className="btn btn-soft compact" type="button" onClick={() => setNotice("Companion skins are ready to explore in the Store.")}>Explore companion skins <Icon name="chevron-right" size={16} /></button></div>
              <img src={assetPath(assets.mascot)} alt="Lock In study companion" />
              <ul className="store-unlocks">
                {companionUnlocks.map(([label, icon]) => <li key={label}><Icon name={icon} size={15} />{label}</li>)}
              </ul>
            </section>}
          </main>

          <aside className="store-sidebar" aria-label="Store extras">
            <section className="store-side-card store-daily-card">
              <div className="store-side-icon"><Icon name="gift" size={20} /></div>
              <div><p className="eyebrow">Daily reward</p><h2>{dailyClaimed ? "Reward claimed" : "Come back every day"}</h2></div>
              <time dateTime={`PT${timeUntilTomorrow(now)}`} aria-label={`Next daily reward in ${timeUntilTomorrow(now)}`}>{dailyClaimed ? "Available tomorrow" : timeUntilTomorrow(now)}</time>
              <p>{dailyClaimed ? "Your daily LOCK is ready again at midnight." : "Log in daily and earn LOCK."}</p>
              <button className="btn btn-primary" type="button" disabled={dailyClaimed} onClick={claimDailyReward}>{dailyClaimed ? "Claimed" : "Claim 25 LOCK"}</button>
            </section>

            <section className="store-side-card store-topup-card" aria-labelledby="topup-heading">
              <div className="store-side-title"><div><p className="eyebrow">LOCK Shop</p><h2 id="topup-heading">Top up LOCK</h2></div><Icon name="coins" size={19} /></div>
              <div className="store-topup-list">
                {[[500, "$1.99"], [1250, "$3.99", "POPULAR"], [2750, "$7.99"], [6000, "$14.99"]].map(([amount, price, badge]) => <button key={amount} className="store-topup-option" type="button" onClick={() => setNotice(`${formatLock(amount)} LOCK is ready to add when checkout is available.`)}><LockPrice value={amount} /><span>{price}</span>{badge && <em>{badge}</em>}</button>)}
              </div>
              <button className="btn btn-soft compact store-full-width" type="button" onClick={() => setNotice("More LOCK options will appear here.")}>View all</button>
            </section>

            <section className="store-side-card store-tip-card">
              <div className="store-side-title"><div><p className="eyebrow">Pro Tip</p><h2>Keep it fresh</h2></div><Icon name="sparkles" size={19} /></div>
              <p key={tipIndex} className="store-tip-copy">“{tipMessages[tipIndex]}”</p>
              <button className="text-link" type="button" onClick={() => setTipIndex((current) => (current + 1) % tipMessages.length)}>Next tip <Icon name="chevron-right" size={15} /></button>
            </section>
          </aside>
        </div>

        {cartOpen && <section className="store-cart-panel panel" id="store-cart" aria-labelledby="store-cart-title">
          <div className="store-cart-heading"><div><p className="eyebrow">Your picks</p><h2 id="store-cart-title">Cart</h2></div><button className="icon-btn" type="button" onClick={() => setCartOpen(false)} aria-label="Close cart"><Icon name="x" /></button></div>
          {cart.length ? <><div className="store-cart-items">{cart.map((item) => <div key={item.id}><span><Icon name={item.type === "Bundle" ? "package" : item.type === "Theme pack" ? "palette" : "sparkles"} size={16} />{item.name}</span><LockPrice value={item.price} /><button className="text-link" type="button" onClick={() => removeFromCart(item.id)}>Remove</button></div>)}</div><div className="store-cart-total"><span>Total</span><LockPrice value={cartTotal} /></div></> : <p className="store-cart-empty">Choose a theme, bundle, or add-on to begin your collection.</p>}
        </section>}
      </section>
    </Page>
  );
}

function ThemePackCard({ pack, inCart, onPurchase }) {
  return <article className="store-theme-card">
    <div className={`store-theme-preview ${pack.preview}`} aria-hidden="true">
      {pack.badge && <span className={`store-badge ${pack.badge.toLowerCase()}`}>{pack.badge}</span>}
      <span className="store-theme-glyph">{pack.glyph}</span><div className="store-preview-window"><i /><i /><i /><b /><b /></div>
    </div>
    <div className="store-theme-details"><div><h3>{pack.name}</h3><p>{pack.description}</p></div><LockPrice value={pack.price} /></div>
    <button className="btn btn-soft compact store-card-action" type="button" disabled={inCart} onClick={onPurchase}><Icon name="shopping-bag" size={16} />{inCart ? "In cart" : "Purchase"}</button>
  </article>;
}

function BundleCard({ bundle, inCart, onPurchase }) {
  return <article className={`store-bundle-card ${bundle.accent}`}>
    {bundle.badge && <span className="store-bundle-badge">{bundle.badge}</span>}
    <div className="store-bundle-icon"><Icon name={bundle.icon} size={25} /></div><h3>{bundle.name}</h3><p>{bundle.detail}</p>
    <ul>{bundle.items.map((item) => <li key={item}><Icon name="check" size={14} />{item}</li>)}</ul>
    {bundle.price ? <div className="store-bundle-actions"><LockPrice value={bundle.price} /><button className="btn btn-primary compact" type="button" disabled={inCart} onClick={onPurchase}>{inCart ? "In cart" : "Purchase"}</button></div> : <button className="btn btn-soft compact" type="button" onClick={onPurchase}><Icon name="wand" size={15} />Customize</button>}
  </article>;
}

function AddOnCard({ name, icon, price, inCart, onPurchase }) {
  return <article className="store-addon-card"><span className="store-addon-icon"><Icon name={icon} size={19} /></span><h3>{name}</h3><LockPrice value={price} /><button type="button" className="icon-btn" disabled={inCart} onClick={onPurchase} aria-label={`${inCart ? "Added" : "Purchase"} ${name}`}><Icon name={inCart ? "check" : "shopping-bag"} size={16} /></button></article>;
}
