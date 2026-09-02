/**
 * Whether the storefront ships.
 *
 * It does not. `src/pages/Store.jsx` is twenty lines that render an
 * `EmptyState` and reset the cart and balance to zero -- "the storefront is
 * withheld until commerce launches", in its own words -- and `App.jsx` passes
 * `commerceEnabled={false}` and `storeCommerceEnabled={false}`.
 *
 * So the specs that drive storefront UI wait on elements no component renders:
 * `.store-badge` and `.store-tabs [role='tab']` exist in the stylesheet and
 * nowhere else. Those specs are not wrong, and neither is the application. They
 * are simply ahead of it.
 *
 * They are skipped rather than deleted, because they encode real requirements
 * that will apply the day the storefront lands: badge contrast at AA in every
 * theme, and a category strip that moves focus and selection together. Flip
 * this to true in the same change that ships the storefront, and they run
 * again as written.
 */
export const STOREFRONT_SHIPPED = false;
