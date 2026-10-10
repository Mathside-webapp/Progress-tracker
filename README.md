# Mathside

<p align="center">
  <img src="./assets/mathside-maintenance.png" alt="Mathside Under Maintenance" width="760">
</p>

<p align="center"><strong>Mathside — Gamified Mathematics Learning & Student Progress</strong></p>

Mathside is a classroom website for managing mathematics activities, performance tasks, submissions, student progress, class records, notifications, and teacher feedback.

## Under Maintenance / Website Unavailable

The illustration above is the official **Mathside Under Maintenance** image.

The same image is used by the website's fallback page:

- Illustration: `assets/mathside-maintenance.png`
- Unavailable/offline page: `offline.html`
- Offline handling: `service-worker.js`

When Mathside cannot load the normal website, the fallback page displays this illustration together with the temporary-unavailable message and retry controls.

> **Important:** Keep `README.md`, `offline.html`, `service-worker.js`, and the entire `assets` folder in their existing locations. Moving or renaming `assets/mathside-maintenance.png` will prevent the illustration from loading.

## Configuration

Mathside uses the existing Supabase configuration stored in `js/config.js`. Do not replace it with placeholder values when updating the website.

## Deployment

Upload the project files while preserving the folder structure. For GitHub Pages, `index.html` must remain at the project root and `assets/mathside-maintenance.png` must remain inside the `assets` folder.

## V24.14 Reference Redesign
- Rebuilt the teacher workspace around the supplied desktop/mobile Mathside references.
- New light cream/white layout, tighter spacing, smaller supporting text, softer borders/shadows, and mobile-first card layouts.
- Added teacher Calendar panel.
- Activities no longer show instructions in the activity list; instructions remain available in Preview/Edit.
- Added 10 selectable class logos and 10 selectable class backgrounds.
- Added class visual customization after class creation through the class card menu.
- Includes the generated illustration boards under `assets/v16/` plus optimized site-ready crops.
- Supabase needs the two new `mathside_sections` columns in `Mathside-V24.14-Class-Visuals.sql`. The connected Mathside project has already been updated.
