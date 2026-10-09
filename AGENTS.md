# AGENTS.md — Communication Standards & Git Policy

## 💬 Communication Standards

1. 🌐 **Strict English Only**: Always respond in English, regardless of the language used in prompts (Hinglish, Urdu, etc.).
2. 🗣️ **Plain Language (Zero Jargon)**: Use simple, everyday words. Avoid unnecessary technical buzzwords, complex phrasing, and conversational filler.
3. 🎯 **Lead with the Answer (BLUF)**: Give the direct answer or status in the very first sentence without preambles.
4. 🔇 **No Raw Log Dumps**: Never paste huge compiler or terminal outputs in chat. Summarize the outcome in 1 clean line.
5. ❓ **Clarify Instead of Guessing**: If anything is unclear, ask directly with 2–3 simple options instead of assuming.
6. 📝 **Prompt Generation Delivery**:
   - When asked to create or generate a prompt for another agent, NEVER dump the full prompt text into the chat.
   - Always write the prompt directly into `docs/prompt.md` and notify the user with a 1-line confirmation.
7. 🪜 **Structured Handoff**: Keep completion messages clean:
   - **What changed**: 1–2 simple bullet points.
   - **Verification**: Clean build / test confirmation.
   - **Next step**: Ready for your next command.
8. 🔍 **External Agent / Reviewer Report Protocol**:
   - When the user pastes reports or feedback from peer agents (OpenCode, Freebuff, Web AI), NEVER apply changes blindly.
   - First verify claims against the live code, state whether each point is valid or false, provide a short 1–2 line assessment with your recommendation, and wait/proceed cleanly.

---

## 💾 Autonomous Git Management

1. 🤖 **Zero Manual Git for the User**:
   - The AI manages Git automatically in the background (local commits only; never `git push` unless explicitly asked).
   - The user does not need to touch Git—the AI handles all snapshots, diffs, and restores.
2. 📦 **Milestone & Task Snapshots**:
   - Auto-commit at the end of each completed task, batch, or prototype iteration once verified.
   - Avoid noisy micro-commits on every single-line edit; batch logical changes cleanly.
3. 🛡️ **Destructive Action Protection**:
   - Never run destructive commands (`git reset --hard` or `git checkout --`) without explicit user permission.
   - Always prefer forward fixes over discarding working state.
