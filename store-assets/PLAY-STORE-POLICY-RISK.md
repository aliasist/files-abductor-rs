# ⚠️ Play Store Policy Risk — Aliasist Files Abductor

**Read this before paying the $25 Play Console registration fee for this app.**

## The core problem

Google Play's Developer Program Policy explicitly targets apps that facilitate
downloading video/audio from streaming platforms. Relevant clauses:

- **Intellectual Property policy** — apps that enable infringement of
  copyrighted content (which YouTube downloads generally are, since YouTube's
  own Terms of Service prohibit downloading videos except where YouTube
  itself provides a download button) are grounds for rejection or removal.
- YouTube itself actively reports "youtube downloader" apps to Google for
  ToS violations, and Google has historically responded by pulling them —
  this is a well-documented, ongoing pattern, not a hypothetical risk.

## What this means in practice

- **Very high likelihood of rejection at initial review**, or
- **Approval followed by later removal** once it gets enough visibility for
  YouTube/Google to notice and act on it (this has happened repeatedly to
  similar apps over the years — search "youtube downloader app removed from
  play store" for numerous examples).
- Google has also been known to **suspend the entire developer account**,
  not just the one app, for repeat or serious policy violations — which
  would also take Globalize down with it if both are under the same account.

## Options, roughly ordered by risk

1. **Don't submit this app to Play Store at all.** Keep distributing it the
   way you already do — GitHub releases, direct APK download, sideloading.
   This is almost certainly the safest option and requires no policy
   gamble. Nothing about today's work is wasted either way — the AAB and
   signing setup remain useful if you change your mind later, or if you
   want a signed APK for direct distribution (still worth having, since
   Android now warns harder on unsigned/debug APKs).

2. **Strip YouTube support, ship "direct URL only."** Positions it as a
   generic file grabber instead of a YouTube-specific tool. Lower risk but
   not zero — Google's automated scanners look at behavior/user reviews
   too, and users will likely still use it for YouTube URLs and leave
   reviews saying so, which brings the same attention back.

3. **Submit as-is and see what happens.** Fastest path to find out, but
   burns the $25 fee with a real chance of rejection, and repeated
   rejections/policy strikes can affect your developer account's standing
   for *future* apps too (including Globalize, if under the same account).

## Recommendation

Given you already have working GitHub-release distribution for this app
and it functions fine sideloaded, **option 1 (skip Play Store for this one)
carries the least risk to your developer account** — which you'll want
clean for Globalize and anything else you publish later. The signed AAB
built today isn't wasted regardless: it's the same signing setup you'd
need for any future submission decision, and a signed release APK is
still useful for direct distribution outside Play Store.

This is your call — the technical work is done and ready to submit if you
decide to proceed regardless of the risk. Nothing here blocks you, it's
just information you should have before spending the fee on this specific
app.
