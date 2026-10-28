# Explainer video

One 90-second master, recorded from the real product, plus three cutdowns.
Captions first: the master must work muted, on a phone, with no sound.

The job of the video is not to explain agentic development. It is to make a
business owner think: "I have that one thing. I could send it." The system is
the proof, not the pitch.

## Deliverables

| Cut | Length | Where |
| --- | --- | --- |
| Master | 85–90s, 16:9 | Site, YouTube (unlisted), LinkedIn |
| Social | 30s, 4:5 and 1:1 | LinkedIn feed, X |
| Email | 15s, 16:9 | Cold email link, not attachment |
| Loop | 6s, 1:1 | Site secondary spot, social preview |

## Creative direction

- **Workshop, not SaaS ad.** Use the real UI and the site's 3D diorama. No stock
  footage, no actors, no glowing brain, no rocket.
- **Typography carries the claims.** Bone background, cobalt text, orange accent
  — the site's palette. One idea per card.
- **Cuts are quiet.** Cut on sentence ends. No whooshes, no zoom punches, no
  kinetic type.
- **The cursor is the only motion in the UI.** Move it slowly, click once,
  pause. Do not scroll like a demo reel.
- **Sound is optional.** If there is a voiceover, it is Ali's own voice, dry and
  close. If not, the captions carry it. Music: none.

## Script

Timecodes are approximate; hold a beat longer rather than rush.

| Time | Voiceover | On screen |
| --- | --- | --- |
| 0:00–0:05 | You built most of it with AI. | Card: **"You built most of it with AI."** |
| 0:05–0:12 | The last mile is where it stalls — the bug it keeps bringing back, the deploy, the payments, the thing that only breaks for real customers. | Demo site on a phone; a broken form, then a 404, then a price that is out of date. Quick cuts. |
| 0:12–0:20 | Send that part. A one-minute fix is a dollar sixty-seven. No quote, no minimum. | Card: **"A one-minute fix is $1.67."** / **"No quote. No minimum."** |
| 0:20–0:28 | Write what you need. Pick how closely I check it. Set a budget, if you want one. | Portal: new request. Title, description, attention level, budget field. |
| 0:28–0:36 | Nothing starts until I approve it. | Admin: request in **new**. Cursor clicks **Approve**. |
| 0:36–0:46 | An agent does the typing in a sealed copy of your project. It cannot publish, deploy, or touch anything live. | Admin: run card, status running → done. Show the sealed-copy line; do not show executor names. |
| 0:46–0:56 | I read the result before it ships. You see the preview first. | Ticket: diff, changed lines scrolling slowly. Then the preview link opens the demo site with the change visible. |
| 0:56–1:04 | You pay for my minutes, billed by the second, plus the AI at cost. | Ticket: the price line — time, AI, total. Card: **"Measured, not estimated."** |
| 1:04–1:14 | The first five pilot jobs billed between two eighteen and eight twenty-five. | Card: **"$2.18 – $8.25"** / **"First five pilot jobs."** / small: **"Pilot jobs on my own and demo projects."** |
| 1:14–1:20 | Send the smallest thing on your list. | Card: **"Send the smallest thing on your list."** |
| 1:20–1:25 | malipetek dot dev. | Card: **malipetek.dev/portal** |

Voiceover is about 130 words. At a dry, unhurried pace that is roughly 80
seconds of speech, leaving room for the pauses above. If it runs long, cut the
"deploy, payments" list — never the price.

## Shot list

Record at 1440×900 in a clean browser profile, then crop the chrome.

| # | Shot | Route / source | Action | Notes |
| --- | --- | --- | --- | --- |
| 1 | Homepage | `/` | Slow scroll from hero to "How it works" | Let the diorama breathe for 2s |
| 2 | Last mile | demo project | Phone-width view; broken form, stale price, 404 | Use the demo bakery, never a client |
| 3 | Price card | — | Static card | Bone/cobalt/orange, no logo animation |
| 4 | Sign in | `/portal` | Enter demo email, continue | Blur the email field before the code is sent |
| 5 | New request | `/portal/start` | Type a real pilot request; choose Checked; leave budget empty | Type at human speed; do not paste |
| 6 | Approval | `/portal/admin` | Request appears in **new**; click **Approve** | Blur every other row, name, email |
| 7 | Run | admin run card | Status running → done; show elapsed time | Crop executor names; no model names |
| 8 | Diff | ticket page | Scroll the changed lines slowly | Blur file paths if they identify a client |
| 9 | Preview | preview link | Open the demo site; show the change | The change must be visible without narration |
| 10 | Publish | admin | Move the production pointer / click Publish | Show "preview first, then live" |
| 11 | Bill | ticket page | Zoom the price line | Time, AI at cost, total |
| 12 | Proof card | — | Static card | $2.18–$8.25, first five pilot jobs |
| 13 | CTA | — | Static card | malipetek.dev/portal |

## Production

**Recording**

- Fresh browser profile: no bookmarks bar, no extensions, no personal tabs.
- System audio off; notifications off; hide the clock if it is distracting.
- 60fps capture. 1440×900 is enough for 1080p after a modest crop.
- Record three takes of each UI shot; pick the calmest, not the fastest.
- Use a click highlight. Keep the cursor large and slow.

**Data safety**

- Use the demo project and a demo account. Never record a real client's ticket.
- Blur or crop: names, emails, project slugs, ticket titles, keys (`ack_`,
  `cat_`), other prices, executor/model names.
- Watch every frame at full size before export. Blur one thing and miss another
  is the usual failure.

**Edit**

- Cuts on sentence ends. No transitions except a hard cut.
- Captions burned in, large enough to read muted on a phone. Proofread them.
- Optional: an `.srt` for LinkedIn; auto-captions will mangle "malipetek".
- Poster frame: the price card, not a face.

**Voice**

- Ali's voice, recorded close in a quiet room. Dry, no radio voice, no smile
  you can hear.
- If the voice feels forced, ship the captions-only version. It is better than
  a bad read.

**Export**

- Master: H.264 MP4, 1920×1080, 16:9, under 50MB.
- Social: 1080×1350 (4:5) and 1080×1080 (1:1), same edit, reframed.
- Email: 15s, under 10MB, linked — never attached on a first touch.
- Loop: 6s, under 3MB, no audio.

## Cutdowns

**30s (social):** hook (0:00–0:05) → price (0:12–0:20) → one pipeline beat
(0:28–0:46, trimmed) → proof card (1:04–1:14) → CTA.

**15s (email):** "You built most of it with AI." → "A one-minute fix is $1.67.
No quote, no minimum." → "Send the smallest thing on your list.
malipetek.dev/portal."

**6s loop:** the diorama belt moving, with the price card overlaid. No voice.

## Distribution

- Site: a secondary link near the hero — "Watch the 90-second version."
- Portal: on the empty state, before the first request.
- LinkedIn: pinned post, plus the launch post.
- Cold email: link the 15s cut in the second paragraph, or use it in the
  follow-up. Do not attach it.
- YouTube: unlisted master, embedded on the site. Title it plainly.
- ChatGPT plugin listing: use the 30s cut if the listing supports video.
- Replies: when someone asks "how does it work?", send the 90s link, not a
  paragraph.

## Measurement

- Watch-through at 50% and 100% (platform analytics).
- Click to the portal. Until campaign attribution exists, use a distinct link
  path and ask "how did you hear?" in the first reply.
- Requests filed within 7 days of a video post.
- If the 30s outperforms the 90s on LinkedIn, make the 30s the master and keep
  the 90s for the site.

## Production checklist

- [ ] Demo project has a small, visible change ready to build.
- [ ] Demo account can sign in without email access in the shot.
- [ ] Admin data sanitized; every frame checked.
- [ ] Script read aloud once, timed.
- [ ] Three takes per UI shot.
- [ ] Captions proofread, including the URL.
- [ ] Watch muted, on a phone, at arm's length.
- [ ] Master + three cutdowns exported.
- [ ] Poster frame set.
- [ ] Uploaded unlisted; embedded on the site.
- [ ] LinkedIn post scheduled with the 30s cut.
