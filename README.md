# KiaanChat

A small real-time chat so people can message Kiaan directly about a website they want built — no email needed.

- `/` — visitor chat. First-time visitors give their name, then chat; the conversation is remembered on their device.
- `/owner.html` — Kiaan's inbox, locked behind a PIN (set via the `OWNER_PIN` environment variable on Render). Once unlocked on a device it stays unlocked.

Conversations are stored in `data.json` on disk. Render's free tier wipes local disk on every redeploy, so history survives restarts but not a new deploy.
