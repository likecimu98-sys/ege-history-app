# Telegram bot VPS adapter

The live bot remains in `/root/bot` and keeps its SQLite database. Its
PostgreSQL integration consists of:

- `server/api/bot-client.js` — authenticated localhost client;
- `server/api/bot-firestore-compat.js` — the small compatibility surface used
  by the existing bot;
- `server/bot/bot-vps.patch` — exact changes to the live `bot.js` entry point.

The patch was prepared against SHA-256
`b3c9d8a63ec48361f07676b72fccc32a7264f247b428e5d999f5db1130073e20`
and produces
`854479249453762cb419e7add80fc58cba6a238872607a735ec2491811658071`.
Refuse to apply it if the live source hash differs; reconcile the bot update
manually instead.

The staged, syntax-checked files live at `/root/bot/vps-stage`. Production
cutover copies them only after saving `/root/bot/bot.js`, `engage.js` and `.env`
to a timestamped rollback directory. The bot environment receives only:

```text
HISTORY_API_URL=http://127.0.0.1:8792
INTERNAL_API_TOKEN=<generated server secret>
```

The internal API is not routed by Nginx and the Node API itself listens on
localhost. Notification jobs are claimed durably in PostgreSQL, retried after a
failure and deduplicated per recipient in the bot SQLite database.
