# RecoverAI five-minute demo script

## Before the clock

1. Run `npm ci`, `npm run db:generate`, `npx prisma migrate deploy`, and `npm run demo:replay`.
2. Start `npm run dev`; open `http://localhost:3000` at desktop width.
3. Keep Razorpay Test Mode open only if demonstrating the optional live Payment Link path.
4. Never show `.env`, terminal history containing secrets, or real customer data.

## 0:00–0:40 — Problem and promise

“A failed payment is not always lost revenue—but careless recovery can create duplicate charges and erode trust. RecoverAI gives a D2C merchant a bounded recovery operator: detect, decide, act, stop, and prove the outcome.”

Point to **Revenue at risk**, **Recovered revenue**, **Recovery rate**, and **Duplicates prevented**. State clearly that the benchmark is synthetic and deterministic.

## 0:40–1:35 — Detection and diverse decisions

Click **Replay 60-case demo**, then **Confirm replay**. Show that the stable total is ₹1,24,840 at risk and ₹38,280 recovered.

Filter by action/status and open two cases:

- A recoverable bank/network failure that creates a Payment Link.
- A high-risk or contradictory case routed to manual review.

Explain: “The model proposes structured context and copy; deterministic policy authorizes the action.”

## 1:35–2:25 — Guardrails and auditability

In the case sheet, show failure classification, selected action, confidence, and chronological audits. Call out the grace window, maximum attempt, INR/amount validation, contact requirement, and prohibited PIN/OTP/CVV language.

## 2:25–3:15 — Late capture safety

Filter to **closed** and open a late-capture case. Show the `recovery_stopped` audit event.

“The original payment succeeded after a failure event. RecoverAI atomically closes recovery, cancels pending outreach, and counts one duplicate collection prevented.”

## 3:15–4:05 — Verified recovery

Filter to **recovered** and open a case. Show that recovered revenue appears only after a verified `payment_link.paid` outcome with matching amount and currency. If showing Razorpay live, use Test Mode only and keep credentials off-screen.

## 4:05–4:40 — Batch evidence

Return to the top:

- 60 synthetic cases
- 36 attempted/contacted
- 20 recovered
- 16 stopped
- 8 manual reviews
- 8 duplicates prevented
- 30.6632% rupee recovery rate

Say: “These results prove repeatability and system behavior, not future merchant conversion.”

## 4:40–5:00 — Close

“RecoverAI converts a failed-payment stream into measurable recovered revenue while keeping the model away from execution authority. Every action is bounded, every stop is automatic, and every rupee is auditable.”

## Fallback plan

If a network or provider call fails, continue with the local seeded replay. If the hosted preview is used, explain that it is a read-only serverless presentation adapter; the complete transactional workflow runs locally with Prisma migrations and Razorpay Test Mode.
