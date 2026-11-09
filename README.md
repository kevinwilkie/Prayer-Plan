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
Newsreader). A **bottom tab bar** moves between four screens: **Today**,
**Library**, **Journal**, and **More**. You can start on a **welcome screen**
that signs you in, or choose **Continue without an account** and keep
everything on the device.

**Today** opens with a **season-colored header**. The accent follows the church
calendar automatically (Advent/Lent violet, Christmas/Easter gold, Pentecost
red, Ordinary Time green), and the header shows a countdown to the next season,
the date with ‹ › day arrows, and an Adore / Confess / Thank / Ask progress bar.
Below it is one row per ACTS section: tap the ring to mark it prayed, or tap the
row (or the **Continue** bar) to start a **guided session** that walks through
each item one card at a time, with a note for the day, and ends on an *Amen*
screen.

**Library** holds everything you pray through, one list per bank (Adore,
Confess, Thanks, People). Each bank shows how far through its current rotation
you are, and each item shows whether it's up today, up next, when you last
prayed it, or that it's new. **+ Add** opens a sheet to add an item; tap any
item to open its **prayer card** (Scripture to pray, requests for people, and a
dated Answered or Reflections log), where you can also edit or delete it.

**Journal** collects every **answered prayer** you've logged (grouped by month)
and every day's **notes**.

**More** holds your account, the **theme** (Sanctuary, Candlelight or Night),
the **daily draw** (how many Adoration, Confession and Thanksgiving items to
draw each day, 1 to 5), the Attributes of God reference, Back up & restore,
About, and Reset this device.

There is no build step. The only dependency is the optional Firebase JS SDK
(loaded from a CDN) used for accounts.

## Accounts & sync (optional)

Configured in `config.js` (Firebase web config — safe to expose; data is
protected by Firestore security rules). On the **More** screen (or the
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

## Editing in the app (no code)

Everything is edited in **Library**: add items with **+ Add**, and open any item
to edit or delete it. For people, add and remove requests right on their card.
Everything saves on your device (and to your account when signed in).
**More → Back up & restore** copies your whole plan as JSON, to move devices,
keep a backup, or send to Claude to bake in.

Under the hood the content is seeded from `data.js` on first run, then becomes
your editable copy in the browser (`localStorage`).

## Editing the content in code

**The starting content lives in [`data.js`](data.js).** You do not need to touch
the HTML, CSS, or `app.js`. The bigger each bank, the more variety before
anything repeats. After editing, just reload the page.

Inside `data.js`:

- `PRAYER_PLAN.dailyCounts` — the default number of items to draw per day from
  each bank, e.g. `{ adoration: 1, confession: 2, thanksgiving: 1 }`. Each person
  can change theirs in **More → Daily draw**.
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

> **Note on saved data:** your check-offs and notes live in this browser
> (via `localStorage`) and sync to your account when you're signed in.
> Editing `data.js` never touches them.

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
| `app.js` | Rotation engine, day history, Today / Library / Journal / More screens. |
| `sync.js` | Accounts, cloud sync and the welcome screen (Firebase). |
| `styles.css` | Styling: three palettes plus the liturgical-season accent. |
| `.nojekyll` | Tells GitHub Pages to serve files as-is. |
