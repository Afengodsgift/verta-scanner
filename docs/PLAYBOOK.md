# VERTA first-revenue playbook (v0.2, repositioned: sell the fix, not the future)

## What changed and why
The first outreach (about 25 emails, Sept 2026) went to executives at large B2B distributors (Grainger, Fastenal, Wesco, Rexel, MSC and similar). Each email described a hypothetical ("if an AI purchasing agent tried to buy from you...") and asked for a chat. No replies, and several addresses bounced. Reasons: big companies have no reason to answer a stranger about a future problem, there was no specific finding about their store, and the ask was a call.
New approach: small and mid-size stores, one real broken thing named in the first line, a fixed-price fix, the free report as the offer.

## Who to sell to
Owners or ecommerce managers of small and mid-size US online stores (WooCommerce, Wix, Squarespace, custom; 30 to 500 products) who sell on Google Shopping or want to. Not enterprise distributors, not hobby shops. Reach a real owner, not support@ or a VP.

## The offer
**Product data fix**: structured product data, price and stock markup, shipping and returns info, then a retest with before and after. Fixed price, agreed before work starts. Suggested start: $300 to $900 per store depending on platform and catalog size. These are hypotheses; price from what the first three say yes to.
Free product data check is the way in. The agent shopping test is an optional extra, not the headline.

## Claims to keep honest
Say "Google Shopping, rich results and AI assistants can read this data". Do not promise rankings, traffic or sales. Say what the free check could not see.

## This week
- Day 1: set `public/config.js` (email, booking link, name), set `VERTA_ACCESS_KEY` on Vercel, redeploy.
- Day 1-2: scan 20 small stores in /app. Keep those with a clear, checkable problem (no price in data, no availability, no shipping or returns info).
- Day 2-5: send 5 emails a day. Use the generated email: it opens with the specific finding. Add one true sentence about their store before it. Offer the free list, not a call.
- When someone replies: send the report link, then quote the fixed-price fix.
- Log replies and objections. After 10 conversations, change the wording, not the product.

## Email rules
First line is the finding, with the evidence from the scan. One link or one ask. No "AI agents" jargon in the subject. Verify the finding yourself before sending. Stop when someone says no.

## Before selling the shopping test
Run the agent (with --llm) on 3 stores you have permission for and check every finding. Never run payment tests without written agreement.
