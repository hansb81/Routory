# Conventions detail (aliases / CSS) — full original text

> CLAUDE.md에서 요약되며 빠질 수 있는 세부사항의 원문. comments.html 언급(원본 52번 줄)은 지시에 따라 제외.

## Alias scheme (원문)

Every screen/part has an alias key (e.g. `MAIN`, `MYTRIP-BOTTOMTABS`, `FLIGHT`, `INVITE-MODAL`).


- Where an alias appears: `// @별칭 KEY · name` on line 1 of every `js/*.js`; `<!-- @별칭 KEY · name -->` plus `data-alias="KEY · name"` in `index.html` and in the templates JS builds (router `PAGE_ALIASES`, `mainPage`, `myTripPage`, `tripShell`, `tripMembers`, `ui`); `[KEY]` in `css/style.css` (TOC and section/sub-section comments).
- **Alias view** (dev aid): open with `?alias=1` or press Alt+Shift+A. `js/aliasView.js` (lazy-loaded by `app.js#initAliasView`, CSS section 14) draws dashed boxes and clickable tags over every visible `[data-alias]`.
- Keep new screens and modals consistent with this scheme.


## Code style conventions (원문)

- The multi-step modals (trip setup, flight, lodging) share the `.wizard*` CSS classes (`.wizard-header/-heading/-body/-footer`, `.wizard-back`, `.wizard-close`, `.wizard-step-label`). Selectable lists share `.pick-list/.pick-item/.pick-info/.pick-name/.pick-sub/.pick-btn`, and search boxes use `.search-input`. Reuse these rather than adding new layouts. Element ids (e.g. `trip-back`, `city-list`) are separate from class names and stay module-specific.
- `[hidden]` is forced to `display: none !important` in CSS, so toggle visibility with the `hidden` attribute.
- `css/style.css` is one file split into numbered sections (the table of contents is at the top). Put new rules in the matching section instead of appending to the end. All colors, spacing, radii, shadows and z-indexes come from the `:root` tokens; do not hard-code hex colors or z-index numbers (use `--z-modal`, `--z-alert`, ...).
- **Category colors/icons**: the `--color-all/flight/lodging/meal/sightseeing/shopping/etc` tokens are kept in `:root`, and `[data-category="..."]` maps them to `--cat-color`. Give an element `data-category` and use `var(--cat-color)`. Icons and labels for the same keys live in `myTripData.CATEGORY_META`. (Schedule items themselves have no category.)
- The my-trip mint header uses `--mint`, `--mint-dark` (date pill) and `--mint-deep` (mint text on white).
- Responsive: the base styles are the 360px phone layout, with tweaks in the `max-width: 400px` block and wider layouts from 600/720/1024px (`--content-max` grows to 640/720/860). `word-break: keep-all` on `body` keeps Korean words together.
