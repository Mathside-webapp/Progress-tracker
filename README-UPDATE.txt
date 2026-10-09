GradeDock v3.24 — SF1 Import and Bulk Actions

INSTALL
1. Back up your current website files.
2. Upload all files INSIDE GradeDock-Website to your existing GitHub website folder.
   Replace matching files. Keep js/action-feedback.js: it is new and required.
3. Refresh the site with Ctrl+Shift+R after GitHub Pages finishes updating.
Your existing js/config.js is preserved byte-for-byte.

No new SQL is required for the schema already included in the latest GradeDock.
If an older database rejects Unspecified gender, run the included
sql/04_ALLOW_UNSPECIFIED_GENDER.sql once. Do not delete tables or existing data.

CHANGES
- SF1 learner-name headers and separate last/first/middle names are read explicitly.
- Male/Female grouping is retained; LRN is optional for numbered SF1 rows.
- No guessing learner names from address, parent or guardian columns.
- Preview every detected name, gender and LRN before confirming import.
- Select all shown classes/exams to archive or delete; restore/delete in Archives.
- Select all students to remove incorrectly imported roster names.
- In-site confirmations with the affected names and deletion consequences.
- Loading labels and disabled controls for asynchronous actions; retry after failure.
- Class deletion removes its roster and results, preserving shared exams.
- Exam deletion removes its answer key/results. Delete permission failures are reported.

VERIFICATION
Automated parser and DOM tests passed with CSV and generated XLSX fixtures,
including full/split names, accented names, optional LRN, duplicate filtering,
import review, bulk archive/restore/delete, repeated clicks, and failure recovery.
The actual SF1 workbook and signed-in live database were not available for testing.
If your SF1 still differs, send that workbook for layout-specific verification.
Existing incorrect names are not automatically rewritten; select and delete those
roster entries, then review the corrected import before saving. Saved scan names
remain unchanged when a roster student is deleted.
