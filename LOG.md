# Debug log

## CC-02 — "Can't read anything in dark mode"

**Reproduced:** Switched to dark mode (or loaded page with system dark preference). Dish names and prices were nearly invisible because of dark text on dark background.
![Dish](https://drive.google.com/file/d/12dUmfVRpIZACuCe-E15v8tkRBozuqvrQ/view?usp=drive_link)

**Cause:** : The `.dish-body` class in `frontend/style.css:294` had a hardcoded `color: #2b2118` (dark brown) instead of using the CSS variable `var(--ink)` which switches to light color (`#f2e8df`) in dark mode.

**Fix:** :  Changed `color: #2b2118` to `color: var(--ink)` in `.dish-body` rule. This ensures dish names, prices, and meta text use the theme-aware ink color.

**Checked:** : Dark mode now shows readable dish names and prices. Light mode unchanged.
![Dish](https://drive.google.com/file/d/1HLl-7yeWXNaf7ol32J3ERyz1W4WwMifX/view?usp=drive_link)


**Time:** roughly 45 minutes
