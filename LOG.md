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

