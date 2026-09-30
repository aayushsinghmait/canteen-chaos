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

