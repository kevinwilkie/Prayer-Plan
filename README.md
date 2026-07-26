# Personal Prayer Plan

A simple, phone-friendly web app for praying through the **ACTS** model —
**A**doration, **C**onfession, **T**hanksgiving, **S**upplication — plus an
**Attributes of God** reference.

Instead of a fixed week, the app keeps a **bank** of items for each section and
**draws a fresh plan each day**, shuffling and working through every bank
**without repeating** an item until the whole bank has been used, then
reshuffling. Today's draw is locked in (reopening shows the same plan), and you
can swipe or use the ‹ › arrows to **re-read previous days**.

The app is **phone-first** with a serif, "quiet sanctuary" look (EB Garamond +
Newsreader). A **bottom tab bar** moves between five screens — **Today**,
**Cards**, **Banks**, **Answered**, and **More**. The Today screen opens with a
**season-colored header**: the accent follows the church calendar automatically
(Advent/Lent violet, Christmas/Easter gold, Pentecost red, Ordinary Time green),
computed from the date (Western/Roman calendar), and it shows the date with
‹ › day arrows and a live "N of 4 prayed" progress meter.

On Today, a **List / Cards** toggle lets you read the day as the full list —
where you can **check off** each section and jot **notes** — or flip through
today's plan as a focused **deck of prayer cards**. Both are saved privately in
your browser.

The **More** screen holds the appearance control and reference material:

- **Theme** — three palettes: **Sanctuary** (warm off-white, default),
  **Candlelight** (soft parchment), and **Night** (dark). Pick one from the
  swatch tiles; your choice is remembered and applied before paint (no flash).
- **Attributes of God** — a tappable reference for Adoration.
- **Back up / move devices** — export or import your whole plan as JSON.
- **About** and a **Reset this device** action.

There is no build step. The only dependency is the optional Firebase JS SDK
(loaded from a CDN) used for accounts.

## Accounts & sync (optional)

Configured in `config.js` (Firebase web config — safe to expose; data is
protected by Firestore security rules). In **Settings → Account** (or the
welcome screen) you sign in with email + password. When signed in, your whole plan (banks,
people, cards, answered prayers, notes, settings) syncs to your account and
follows you across devices; signing in on a new device pulls your saved plan.
Without signing in, everything still works locally on the device.

## Install it (offline app)

The app is a PWA: open the site, then **Add to Home Screen** (iOS Safari: Share →
Add to Home Screen; Android Chrome: ⋮ → Add to Home screen / Install). It then
launches full-screen with its own icon and works **offline** — a service worker
(`sw.js`) caches the app shell and assets, and the content/notes/cards already
live in your browser. `manifest.webmanifest` defines the name and icons.

## View it

- **Locally:** open `index.html` in any web browser.
- **On the web (GitHub Pages):** see *Publishing* below.

## Prayer Cards

The **Prayer Cards** tab is inspired by Paul Miller's *A Praying Life*. The whole
**ACTS** plan becomes a deck of index cards you **flip through one at a time**
(arrows or swipe), grouped **Adoration → Confession → Thanksgiving →
Supplication**. Each card shows a category label, a title, and Scripture.

- **Adoration / Confession / Thanksgiving cards** (one per item in those banks)
  show the definition/theme, the Scripture to **pray this**, and a dated
  **Reflections** log. An *Edit in … bank* button jumps to that bank to change
  the content. New items you add in a bank tab automatically appear in the deck.
- **Supplication cards** (one per person/area) add a Scripture to **pray over**
  them, their **requests** (kept in sync with the Supplication bank), and a
  dated **Answered prayers** log to record how God answers.

Add a new Supplication person/topic at the bottom of the deck; cards you create
can be removed, and seeded content is protected. A **Show** dropdown filters the
deck to **All / Adoration / Confession / Thanksgiving / Supplication**.

## Answered Prayers

The **Answered Prayers** tab gathers every entry you log on a Supplication prayer
card into one **timeline**, newest first, each tagged with the person and the
date it was added — a growing record of God's faithfulness. (Adoration /
Confession / Thanksgiving cards keep their own *Reflections* and aren't mixed in
here.)

## Editing in the app (no code)

Open any bank tab — **Adoration, Confession, Thanksgiving, Supplication** — to
manage its contents. You can **add**, **edit**, or **delete** any item (including
the originals), and under Supplication you can rename or remove people and edit
their requests. Prayer Cards can also be deleted from the deck. Everything is
saved on your device; the bank's **Back up / export** box copies your whole plan
as JSON (to move devices, keep a backup, or send to Claude to bake in).

Under the hood the content is seeded from `data.js` on first run, then becomes
your editable copy in the browser (`localStorage`).

## Adding content in the app (no code)

Each bank has its own **tab** at the top — **Adoration, Confession, Thanksgiving,
Supplication**. Open a tab to see everything in that bank and **add your own**
items (or, for Supplication, add people and requests). Additions save in your
browser and join the rotation on the next day's draw.

Because those additions live in your browser only, each bank tab has an
**Export** button: tap it to copy your additions and send them to Claude to bake
them permanently into `data.js` (so they're shared across devices and survive a
cache clear).

## Editing the content in code

**The starting content lives in [`data.js`](data.js).** You do not need to touch
the HTML, CSS, or `app.js`. The bigger each bank, the more variety before
anything repeats. After editing, just reload the page.

Inside `data.js`:

- `PRAYER_PLAN.dailyCounts` — how many items to draw per day from each bank,
  e.g. `{ adoration: 1, confession: 2, thanksgiving: 1 }`.
- `PRAYER_PLAN.banks.adoration` / `.confession` — a list of
  `{ term, definition, scripture }` items.
- `PRAYER_PLAN.banks.thanksgiving` — a list of `{ title, scriptures: [ {ref,text} ] }`.
- `PRAYER_PLAN.supplication.subjects` — the people/areas you pray for, each
  `{ name, requests: [ "...", "..." ] }`. Every subject appears daily with one
  request drawn from its list in rotation.
- `PRAYER_PLAN.attributes` — the alphabetical Attributes of God reference,
  each `{ name, definition }`.

A scripture is always `{ ref: "Book 1:1", text: "the verse..." }`.

Tips:
- Keep text wrapped in `"double quotes"` and keep the trailing commas.
- If a verse contains a `"`, write it as `\"` so it doesn't end the line early.
  (Curly quotes `“ ”` are fine as-is.)

> **Note on saved data:** your check-offs and notes live in this browser only
> (via `localStorage`). They aren't synced across devices and will clear if you
> wipe site data. Editing `data.js` never touches them.

## Publishing (GitHub Pages)

1. Push this code to GitHub (it currently lives on the
   `claude/weekly-prayer-plan-fr9sah` branch).
2. In the repository, go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select the branch (`claude/weekly-prayer-plan-fr9sah`, or `main` if you merge
   first) and the `/ (root)` folder, then **Save**.
5. After a minute, your plan will be live at the URL GitHub shows on that page.
   Add it to your phone's home screen for one-tap access.

## Files

| File | What it is |
|------|------------|
| `data.js` | **Your content** — the banks. Edit this. |
| `index.html` | Page shell. |
| `app.js` | Rotation engine, day history, check-off & notes, view navigation. |
| `styles.css` | Styling (mobile-first, dark mode, print-friendly). |
| `.nojekyll` | Tells GitHub Pages to serve files as-is. |
