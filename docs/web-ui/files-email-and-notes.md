# Files, email and notes

Your documents and their versions, the emails about each process, and
notes about the search itself.

## Files

Documents and their versions. A document is a resume, cover letter,
portfolio, reference, certificate or transcript, screenshot, job
description, take-home assignment, offer, contract, NDA, background check,
right to work or ID, candidate resource, feedback or other. The list
filters by kind, and by application (those sent with its processes; an
application's **View all files** opens it so, with **Back to application**
above), and a new file's kind is guessed from its name.

- Drop files anywhere on the page, or choose them (the drop zone is under
  the list): a file named like a document becomes its next version, and
  anything else becomes a new document, its kind guessed from the name.
- Drop on a row to add a version to that document.
- A document shows its versions beside a preview: PDFs in the browser's
  viewer, images, and text. Other kinds offer a download.
- Tag versions ("rust-focused"), and see which processes each was sent
  with. A process records which versions went with it, and previews them
  too.

## Email

Each process keeps the emails about it. In its Emails panel:

- drop `.eml` files (Gmail: ⋮ → Download message), or choose them;
- or paste a message (Gmail: ⋮ → Show original → Copy to clipboard;
  pasting the whole page works too).

Each shows who, when, the subject and the start of it, opens to the whole
text, and links to it in Gmail. Cards count them.

Gmail sign-in and sync, matching mail to processes on their own, are built
but switched off for now: `GMAIL` in `src/web/app.js`.

## Notes

General notes, about the search rather than one application (what you want
next, questions to ask): searchable, taggable, edited in place.
