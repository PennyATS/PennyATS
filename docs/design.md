# PennyATS design rules

## Light theme

The application canvas uses `--bg` (`#f6f7fa`). Content surfaces use `--surface` (`#ffffff`), a `--border` (`#e2e3eb`) outline, and a 12px corner radius. Text uses `--text` (`#222330`), supporting text uses `--muted` (`#6d7080`), and actions use `--accent` (`#6253b5`). Keep the interface readable and keyboard accessible.

## Tables and reports

Never place a data table directly on the gray application canvas. Put it inside a distinct white card or give the table its own white, bordered, rounded surface. In reports, the section title, explanation, CSV action, empty state, and table belong in the same card.

Use row dividers within the surface. Keep dense tables horizontally scrollable on narrow screens rather than squeezing columns until values are unreadable. Apply this rule to new tables throughout the authenticated app, including jobs, candidates, settings, and reports.

## Surfaces for everything else

Nothing that holds content or takes an action sits directly on the gray canvas. Page sections, forms, lists, and timelines go in a `.card`; every button variant has its own background (`.btn` uses `--accent`, `.btn-secondary` uses `--surface` with a border). Headings and the canvas itself are the only things that sit on `--bg`.

Shared classes in `apps/web/src/app/globals.css`, so pages don't hand-roll these:

- `.card` with `.card-header`, `.card-title`, and `.card-note` for a section and its explanation.
- `.card-rows` for rows inside a card, separated by hairlines.
- `.inset` for a bordered area inside a card (for example a danger zone). Don't nest a `.card` inside a `.card`.
- `.btn-icon` for square, single-symbol buttons such as move arrows. Give them an `aria-label`.
- Disabled buttons explain why nearby (a short note or `title`), rather than only looking faded.
