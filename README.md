# BAMP Sastanak

Private scheduling page for Bosnian American Medical Professionals (BAMP), BAPA and friends.
Participants pick days and set hours for each day; admins see the combined results.

- Sign-up page: the site's main address
- Admin page: add `#admin` to the end of the address and sign in with Google

Hosted on GitHub Pages; data is stored in Firebase (project `bamp-sastanak`).
Security rules live in `firestore.rules` and must be pasted into
Firebase → Firestore → Rules whenever they change.

The site asks search engines not to list it (`robots.txt` and a `noindex` tag).
