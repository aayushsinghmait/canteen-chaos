# Debug log

## CC-02 — "Can't read anything in dark mode"

**Reproduced:** Switched to dark mode (or loaded page with system dark preference). Dish names and prices were nearly invisible because of dark text on dark background.
![Dish](https://drive.google.com/file/d/12dUmfVRpIZACuCe-E15v8tkRBozuqvrQ/view?usp=drive_link)

**Cause:** : The `.dish-body` class in `frontend/style.css:294` had a hardcoded `color: #2b2118` (dark brown) instead of using the CSS variable `var(--ink)` which switches to light color (`#f2e8df`) in dark mode.

**Fix:** :  Changed `color: #2b2118` to `color: var(--ink)` in `.dish-body` rule. This ensures dish names, prices, and meta text use the theme-aware ink color.

**Checked:** : Dark mode now shows readable dish names and prices. Light mode unchanged.
![Dish](https://drive.google.com/file/d/1HLl-7yeWXNaf7ol32J3ERyz1W4WwMifX/view?usp=drive_link)


**Time:** roughly 45 minutes

------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

## CC-04 — "The buttons don't work on my tablet"

**Reproduced:** On tablet-sized screens (761px - 900px), Add to Cart and favourite (star) buttons appeared normal but clicks did nothing.
![Frontpage](https://drive.google.com/file/d/1_fDqCF1Q_9o_xU494oYx0cOHc2FpH7xO/view?usp=drive_link)

**Cause:** : A media query at `frontend/style.css:1032-1047` added `::after` pseudo-elements to `.dish-card` (covering bottom 58px with z-index: 3) and `.img-wrap` (covering top-right 52x52px with z-index: 1). These invisible overlays sat above the buttons, intercepting clicks.

**Fix:** :  Added `pointer-events: none` to both pseudo-elements in the tablet media query. This allows clicks to pass through to the actual buttons underneath.

**Checked:** :  Buttons work on tablet viewport. Visual appearance unchanged (overlays still show for blocked cards).
![frontpage-after-click](https://drive.google.com/file/d/1ai9sNEiIpQmyhY7UZ9HQmxm7x2r0aD_L/view?usp=drive_link)


**Time:** roughly 1 hour

------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

## CC-09 — "The menu shows more dishes than it should"

**Reproduced:** : Menu page loaded all dishes at once instead of paginated batches of 5. "Load more" button appeared but all dishes were already visible.

**Cause:** : `backend/logic/search.js:101` `paginate()` returned `items: list` (full array) instead of `items: items` (paginated slice).

**Fix:**: Changed return value from `items: list` to `items` (shorthand for `items: items`).

**Checked:** : Initial load shows 5 dishes. "Load more" fetches next 5. Infinite scroll works. Total count correct.

**Time:** roughly 30 minutes

------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

## CC-10 — "Sorting by price is backwards"

**Reproduced:** Selected "Price: low to high" - most expensive dishes appeared first. "Price: high to low" showed cheapest first.

**Cause:** `backend/logic/search.js:79-80` SORTERS had reversed comparators: `'price-asc': (a, b) => b.price - a.price` (descending) and `'price-desc': (a, b) => a.price - b.price` (ascending).

**Fix:** Swapped the two comparator functions so `price-asc` sorts low-to-high and `price-desc` sorts high-to-low.

**Checked:** All sort options work correctly. Price low-to-high shows cheapest first. High-to-low shows most expensive first.

**Time:** roghly 25 minutes

------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

## CC-06 — "I ordered more than they had"

**Reproduced:** Dal Tadka Thali shows "Only 3 left" badge. Clicking `+` on the menu card still allows adding up to 10. Cart shows qty=10, and the order goes through — but kitchen only had 3.


**Cause:** `frontend/js/state.js` `setQty()` (line 97) only checked quantity against `MAX_PER_DISH` (10):
```js
if (next > MAX_PER_DISH) return { ok: false, ... reason: `Max 10 of one dish` };
```
There was **no check against `dish.stock`**. The `dish` object (which includes `.stock`) is passed into `setQty`, but its stock was never used as a cap. So a dish with stock=3 let you add up to 10 to the cart, giving a false impression the order was valid.


**Fix:** Added a stock guard in `setQty()` in `frontend/js/state.js` (lines 99-102):
```js
const stock = Number(dish.stock);
if (!Number.isNaN(stock) && next > stock) {
  return { ok: false, qty: cartQty(id), reason: `Only ${stock} ${dish.name} available` };
}
```
This runs before saving to cart. When the user tries to add a 4th unit of a dish with stock=3, they get a toast: **"Only 3 Dal Tadka Thali available"** and the cart stays at 3.


**Checked:** Pressing `+` on Dal Tadka Thali (stock=3) stops at 3 and shows correct warning toast. `MAX_PER_DISH` cap still applies for unlimited-stock items.


**Time:** roughly 45 minutes

------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

## CC-01 — "The search suggestions are behind everything"

**Reproduced:** Typed "fre" in the search box. The suggestion "French Fries | Snacks" appeared but was hidden behind the `.cat-tabs` category bar. Only the topmost sliver was ever visible; clicking items below it did nothing.

**Cause:** A **CSS stacking context** problem — not just a z-index number problem.

When an element has both `position` and `z-index` set, it creates a **stacking context**. Children's z-index values are only meaningful *within* that context. So even though `positionSuggestions()` set `z-index: 200` on `#suggestBox` via JS, that 200 only competed against siblings *inside* `.filters` — not against the `.filters` context itself (z-index: 40) vs `.site-header` (z-index: 50).

The `.cat-tabs` is also a child of `.filters`, but comes later in the DOM and is itself a `position: sticky; z-index: 40` element. Because both suggest-box and cat-tabs are evaluated within the same `.filters` stacking context, DOM order caused cat-tabs to paint over the suggestions.

**Fix:** Moved `#suggestBox` from inside `.search-wrap` to a **direct child of `<body>`** in `frontend/index.html`. At body level it is in the root stacking context, where its `z-index: 200` (set by `positionSuggestions()` in `menu.js`) is compared against top-level elements and beats everything (.filters z-index:40, .cat-tabs z-index:40, .site-header z-index:50).

**Checked:** Typing in the search box now shows the full suggestion list above the category bar, header, and all other sticky elements. Clicking suggestions works across the full dropdown.

**Time:** roughly 1.25 hour

------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

## CC-07 — "Cancelling makes it worse"

**Reproduced:** Ordered Veg Momos x2 (the last 2 in stock). Cancelled from the **My Orders** page (CC-8718 → Cancel). Counter dashboard confirmed the order was cancelled. But the Menu page still showed Veg Momos as **"Sold out"** — stock never appeared to come back.

**Cause:** The backend `releaseStock()` in `validation.js` was correct (`dish.stock + line.qty`) and did restore stock to disk properly. The problem was in **`frontend/js/orders.js`** `cancelOrder()`:

```js
// BEFORE (buggy):
if (state.route === 'menu') loadMenu();
```

This only reloaded the menu if the user was *already on the menu page* when cancelling. When the user cancelled from the **My Orders page** (`state.route === 'orders'`), `loadMenu()` was never called. Later when navigating to the Menu, the menu fetched fresh data — but the API `clearCache()` was not called, and even without cache, the menu re-fetch correctly returned stock=2 from the server. The visible symptom was that the dish still showed "Sold out" while the user remained on My Orders, and only refreshed once they went back to Menu.

The core issue: **`loadMenu()` was gated behind a route check** that excluded the most common cancellation flow (from My Orders).

**Fix:** In `frontend/js/orders.js` `cancelOrder()`:
```js
// AFTER (correct):
api.clearCache();   // drop any stale API cache entries
loadMenu();         // always reload menu so stock shows correctly everywhere
```

Removed the `if (state.route === 'menu')` guard. `loadMenu()` is always safe to call — it runs in the background and updates `state.dishes`, which the menu grid reads. Added `api.clearCache()` beforehand to ensure no stale cache entry for `/menu` is served.

**Checked:** Ordered Veg Momos x2 → cancelled from My Orders page → Menu immediately shows "Only 2 left" badge instead of "Sold out". Counter stock panel correctly shows stock restored.

**Time:** roughly 40 minutes


------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------


