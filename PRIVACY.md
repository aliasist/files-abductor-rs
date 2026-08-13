# Privacy Policy — Aliasist Files Abductor

_Last updated: August 13, 2026_

Aliasist Files Abductor ("the app") is a URL/YouTube downloader published by Aliasist.

## What the app does with your data

- **On desktop (Windows/Linux/macOS):** the app runs `yt-dlp` as a local process on your own
  machine. The URL you paste never leaves your computer except to reach the site you're
  downloading from directly.
- **On Android:** subprocess execution isn't permitted by the OS, so the mobile app instead sends
  the URL you paste to a small backend server we operate (`abductor-dev.aliasist.tech`), which runs
  the download and streams the resulting file back to your device. That URL — and only that URL —
  is transmitted to our server for the duration of the download. We do not log URLs beyond what's
  needed to run the download, do not tie them to any account or identity (the app has no sign-in),
  and do not sell or share this data with third parties.

## What we don't do

- No accounts, no sign-in, no analytics SDKs, no ad tracking.
- No persistent server-side storage of the files you download or the URLs you request — job
  records exist in server memory only for the duration of your download.

## Your responsibility

You are solely responsible for ensuring you have the right to download and use any content you
retrieve with this app. See the in-app disclaimer.

## Contact

Questions about this policy: [dev@aliasist.com](mailto:dev@aliasist.com) ·
[www.aliasist.com](https://www.aliasist.com)
