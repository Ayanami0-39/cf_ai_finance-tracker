# 🎙️ Fiscus - AI-Powered Conversational Expense Tracker

> **Stop filling forms. Start talking.**
> Fiscus is an AI-powered expense tracker that understands natural conversation. Just say "I spent $50 on coffee" and the AI automatically categorizes, stores, and tracks it.

[![Built with Cloudflare](https://img.shields.io/badge/Built%20with-Cloudflare-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Powered by Workers AI](https://img.shields.io/badge/Powered%20by-Workers%20AI-F38020)](https://ai.cloudflare.com/)
[![React](https://img.shields.io/badge/React-19.1-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

---

## 🚨 The Problem

Manual expense tracking is **tedious and time-consuming**:

- 😫 Users hate filling out forms
- 📝 Manual categorization is annoying
- 🔍 Finding past expenses is difficult
- 📊 No easy way to ask questions about spending
- ⏰ Takes **5-10 minutes per day**

### Existing Solutions Fall Short

Traditional apps like Mint, YNAB, and Copilot require:

- ❌ Manual data entry
- ❌ Manual categorization
- ❌ Complex UI navigation
- ❌ Bank integration (privacy concerns)

---

## 💡 The Solution: Fiscus

**"What if you could just TALK to your expense tracker?"**

Fiscus is an AI-powered expense tracker that you control entirely through conversation. Just say "I spent $50 on coffee" and the AI automatically categorizes, stores, and tracks it. Ask "How much did I spend on food?" and get instant answers.

**It's like having a personal financial assistant in your pocket.**

### ✨ Key Features

| Feature                       | Description                                             |
| ----------------------------- | ------------------------------------------------------- |
| 🎙️ **Natural Voice Input**    | Speak naturally - no forms, no buttons                  |
| 🤖 **AI Auto-Categorization** | Automatically understands and categorizes expenses      |
| 💬 **Conversational Queries** | Ask questions like "How much did I spend on food?"      |
| 🗑️ **Voice-Powered Deletion** | Delete expenses by voice: "Delete my coffee expense"    |
| ⚡ **Lightning Fast**         | 30 seconds vs 5 minutes                                 |
| 🔒 **Privacy First**          | Your data stays with you - no bank integration required |
| 🌍 **Global Edge Deployment** | Fast response times worldwide via Cloudflare's network  |

---

## 🎯 Key Innovation

### **Conversational Interface + AI Intelligence**

Traditional apps make **YOU** adapt to **THEM**.
Fiscus adapts to **YOU** - you just speak naturally.

**Example Interactions:**

```
You: "I spent $50 on coffee at Starbucks"
Fiscus: ✅ Got it! Added $50 for coffee at Starbucks

You: "How much did I spend on food this week?"
Fiscus: 💰 You spent $287 on food this week across 12 transactions

You: "Delete my last coffee expense"
Fiscus: 🗑️ Deleted $50 coffee expense from Starbucks
```

---

## 🏗️ Architecture & Tech Stack

### Cloudflare Technologies

```
┌─────────────────────────────────────────┐
│  CLOUDFLARE TECHNOLOGIES USED           │
├─────────────────────────────────────────┤
│                                         │
│  1. ☁️  CLOUDFLARE WORKERS              │
│     - Serverless backend API            │
│     - Global edge deployment            │
│     - Handles all API requests          │
│                                         │
│  2. 🤖 WORKERS AI (Llama 3.3 70B)       │
│     - Intent classification             │
│     - Expense categorization            │
│     - Natural language understanding    │
│     - Conversational query responses    │
│     - Expense deletion identification   │
│                                         │
│  3. 💾 DURABLE OBJECTS                  │
│     - Persistent data storage           │
│     - Per-user expense storage          │
│     - Strongly consistent state         │
│     - No external database needed       │
│                                         │
│  4. 🌐 PAGES (Frontend Hosting)         │
│     - React app deployment              │
│     - Global CDN delivery               │
│     - Integrated with Workers           │
│                                         │
└─────────────────────────────────────────┘
```

### Full Tech Stack

**Frontend:**

- ⚛️ React 19.1 + TypeScript 5.8
- 🎙️ Web Speech API (voice input)
- 🔊 ElevenLabs API (voice output)
- 🎨 Tailwind CSS + Framer Motion
- 🧩 Radix UI Components

**Backend:**

- 🔷 Hono Framework (lightweight, fast)
- 🤖 Workers AI - Llama 3.3 70B
- 💾 D1 (all persistent application data)
- Durable Objects retained for coordination and read-only legacy migration
- 🌐 RESTful API design

**AI Capabilities:**

- Intent Classification (ADD/QUERY/DELETE/HELP)
- Natural Language Processing
- Automatic Expense Categorization
- Conversational Query Handling
- Smart Expense Deletion

---

## 🔄 How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                     USER INTERACTION FLOW                    │
└─────────────────────────────────────────────────────────────┘

USER SPEAKS
    ↓
Web Speech API captures voice
    ↓
Sends to /api/voice-command endpoint
    ↓
Cloudflare Worker receives request
    ↓
Workers AI classifies intent (ADD/QUERY/DELETE)
    ↓
┌─────────────────────────────────────────────────────────────┐
│ If ADD_EXPENSE:                                             │
│   → Workers AI extracts amount, merchant, category          │
│   → Saves to Durable Objects                                │
│   → Returns friendly confirmation                           │
├─────────────────────────────────────────────────────────────┤
│ If QUERY:                                                   │
│   → Fetches expenses from Durable Objects                   │
│   → Workers AI generates natural language answer            │
│   → Returns conversational response                         │
├─────────────────────────────────────────────────────────────┤
│ If DELETE:                                                  │
│   → Workers AI identifies which expense                     │
│   → Deletes from Durable Objects                            │
│   → Confirms deletion                                       │
└─────────────────────────────────────────────────────────────┘
    ↓
Response sent to frontend
    ↓
ElevenLabs speaks response
    ↓
UI updates in real-time
```

---

## 🎬 Live Demo

**Try it now:** [https://9c6acdb0.finance-tracker-cr2.pages.dev](https://9c6acdb0.finance-tracker-cr2.pages.dev)

### Quick Test:

1. Click the **microphone button** (grant browser permission)
2. Say: **"I spent $50 on coffee at Starbucks"**
3. AI responds and saves your expense!
4. Ask: **"How much did I spend on food?"**
5. Get instant conversational answers!

**Note:** Voice features require HTTPS (✅ works on live demo)

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ and pnpm
- Cloudflare account (free tier works!)
- ElevenLabs API key (optional, for voice output)

### Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/KshitijD21/finance-tracker.git
   cd finance-tracker
   ```

2. **Install dependencies**

   ```bash
   pnpm install
   ```

3. **Set up environment variables**

   Create a `.env` file in the root directory:

   ```bash
   cp .env.example .env
   ```

   Then update `.env` with your ElevenLabs credentials and API URL:

   ```bash
   VITE_ELEVENLABS_API_KEY=your_api_key_here
   VITE_ELEVENLABS_VOICE_ID=your_voice_id_here
   VITE_ELEVENLABS_MODEL_ID=eleven_flash_v2

   VITE_API_URL=https://your-backend.workers.dev/api
   ```

4. **Run development server**

   ```bash
   pnpm dev
   ```

   The app will be available at `http://localhost:5173`

### D1 storage and safe migration

This implementation stores active expenses, accounts, profiles, families, memberships, and chat messages in D1.
A production cutover is complete only after the rollout and verification below.
The existing Durable Object bindings remain as an account-operation coordinator and read-only
migration bridge. Do **not** remove their bindings, rename the Worker, or add a
`deleted_classes` migration: the original records remain intact for recovery.

`migrations/20261008_d1_app_storage.sql` only adds tables. It does not update or delete
existing expenses. Migration copies existing account hashes verbatim, preserving passwords
and sessions, and commits each registry/scope import together with its completion marker.
Conflicts abort the import rather than overwrite destination accounts or chat messages.
All legacy keys, including inactive/orphaned objects, can be preserved in `app_legacy_snapshots`.
Legacy expense arrays are archived, not restored into active expenses: restoring them
could undo earlier edits or intentional deletions. New chat messages are no longer capped at 100;
already-discarded legacy messages cannot be recovered by this migration.

The backend in `worker/recovered/live-backend.mjs` was recovered from the deployed
Worker version `d0a9ffeb-47cb-4013-9390-2a4e450af330`. Its 72 routes retain subscriptions,
budgets, financial accounts/transfers, roles, device sessions, recycle bin, CSV restore,
audit, reports, notifications, WebSockets and scheduled backups. D1 adapters wrap its
storage operations. The matching deployed React source was unavailable. The deployed HTML, CSS, JavaScript
chunks, manifest and icon have now been recovered in `frontend/recovered/`, with hashes
in `provenance.json`. Keep this baseline intact; deployment preserves existing Cloudflare
assets and serves the reviewed UI refinements through the Worker.

### Deployment

With `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` configured:

```bash
npm run deploy
```

This builds locally, exports the entire existing D1 database and verifies the export
in an in-memory SQLite database. On the first cutover it applies only the new additive
migration, deploys the backend in maintenance mode, archives every existing object in
both namespaces, imports accounts/families/chat, and compares original data before
switching to D1. Original D1 tables must remain byte-for-byte equivalent during copying;
password hashes and roles must match their archived originals. A conflict stops the
cutover without overwriting either original or destination records.

The backend-only upload uses Cloudflare `keep_assets: true` and preserves secrets,
existing bindings, namespace IDs, compatibility settings and the live cron schedule.
It does not upload the locally built React frontend. Subsequent deployments back up
D1 and update only the backend. Do not use a plain `wrangler deploy` for this recovered
checkout; it could publish the older local frontend over the live application.

Backups are written outside the repository under `../scratch/finance-cutover-TIMESTAMP`
with private directory/file permissions. They include the original Worker, settings,
SQL exports before/after migration, inventories and verification results. Keep an
encrypted copy outside the Cloudflare account. The exports include sensitive password
hashes, chat history and financial records; do not commit or publicly share them.

If a first cutover is interrupted during maintenance, resume with the same private
backup directory so the script can use its original migration credential:

```bash
python3 scripts/deploy-backend.py --backup-dir /absolute/path/to/original-backup-directory
```

The temporary migration secret is removed after successful verification. The dedicated
admin endpoint then becomes unavailable. Retain the original namespaces; their business
records remain frozen recovery snapshots. Operational alarm state and WebSockets still
use Durable Objects, while active persistent business data is in D1.

### Frontend refinements and mobile verification

Labels wrap rather than truncate. Summary amounts fit their font size to the
available width while keeping the sign, currency and digits together on one
line. Category lists keep labels and metrics on the same row when they fit,
using smaller type on narrow screens. Statistics uses one accessible
Expenses by category / Income tabbed card. The Income panel reuses the existing
income-source analysis and follows the same period and member filters. The tabs
support arrow keys, Home/End, and both UI languages. A single-category donut
also renders a full ring instead of a degenerate 360-degree SVG arc.

Offline entries remain in the existing `fiscus_offline` IndexedDB queue on the
device until the server confirms success. The UI retries every 20 seconds while
visible and when connectivity, focus, or visibility returns. Retries share one
in-flight flush and reuse the original mutation ID after a lost response. Pending
entries are never evicted to enforce a queue size limit. Entries from another
account or ledger stay queued, with a message asking the user to switch back;
they are never reassigned to the current ledger. Do not clear browser website
data while entries are pending: unsynced entries are not yet in a D1 backup.

`node scripts/build-ui.mjs` verifies the recovered baseline hashes and generates the
versioned frontend served by the Worker. `frontend/refinements/` contains the layout,
viewport bridge and English/Chinese UI dictionary. The original application components,
data contracts and feature chunks stay in place. Generated files are excluded from Git.
The local `src/` checkout remains the older React source; build output from that source
is not uploaded by the safe deployment script.

The refinements account for iPhone safe areas, dynamic visual viewport and keyboard
resizing, prevent input-focus zoom with 16px form text, preserve pinch zoom, and keep
navigation and scrollable dialogs within the available screen. Language changes preserve
React state and unsaved drafts. UI strings are localized separately from user names,
merchant names and chat history, which remain unchanged.

Chat keeps the reading position when a new answer arrives while viewing older
messages. A localized **Jump to latest** button returns to the newest messages;
opening the chat and sending a message still follow the conversation. Loading
older history retains the existing scroll position. Reduced-motion preferences
disable smooth chat scrolling and shorten CSS animations/transitions.

Activity deletion uses an inline confirmation within the original row, preserving
its size on narrow screens. Cancel receives initial keyboard focus, Escape cancels,
and rejected server responses restore the record rather than report success.
Date-only records display their recorded calendar day across time zones without
changing any stored values.

Activity keeps search and filters visible, with CSV import/export, full backup,
restore, batch editing and recycle bin grouped under **More**. Edit stays beside
each record; deletion is available from **Record actions** and still requires
confirmation. Insights puts the Expenses/Income breakdown before secondary
comparisons and groups management panels under **Manage your finances**. Account
and family settings share the account menu. Chat introductions appear only for
empty conversations. Pending sync opens a device-storage explanation and an
explicit retry action, reusing the original queue and mutation IDs.

Startup loads the complete active ledger for the authenticated scope, independently
of chat pagination. Activity still renders records in batches; search accepts dates
such as `2026-08` to reach an older month directly. A startup cap of 100 expenses
previously hid older months even though their records remained in D1.

The full ledger is cached on the device and shown before the startup request
finishes. Successful refreshes replace the snapshot; failed refreshes keep it
available across reloads, including family ledgers. Cache reads do not delete
the saved snapshot or expire it while offline. Snapshots are checked against
the account username and personal scope, and full-ledger writes use version 3.
Explicit account/family refresh actions still invalidate outdated context.

Browser regression tests use the recovered application and synthetic API responses,
with no production connections or database writes:

```bash
npx playwright install --with-deps chromium webkit
npm run test:ui
TEST_WEBKIT=1 npm run test:ui
```

`npm test` also covers authenticated delivery of the versioned UI and the backend's
actual Cloudflare RPC behavior. Installed iPhone web apps may need to be closed and
reopened to load the new HTML; UI asset URLs change with each refinement build.

### Recovery after accidental Worker deletion

D1 is an independent resource. Deleting the Worker does not itself delete the D1 database.
Cloudflare D1 Time Travel can recover recent database changes within the database's
available retention window. An SQL export provides a separate backup, including all
active accounts, families, sessions, financial records, chat and legacy snapshots.
Time Travel is not an indefinite off-account backup.

Restore an export into a **separate** D1 database first and verify its contents. Recreate
the Worker with a D1-capable backend, bind the surviving or verified restored database,
recreate the coordinator classes/bindings as needed, set `APP_STORAGE_MODE=d1`, and restore
application secrets from your secret manager. D1 scope mappings and active tables allow
coordinators to restart without importing stale legacy records. Recover frontend assets
from their own source/artifact backup: a D1 export contains data, not application assets.
Do not import an old SQL dump directly over the live database or redeploy a DO-backed
backend after cutover; that would hide subsequent D1 changes.

Validation: `npm test`, `npm run lint`, and `npm run build`. Storage/API tests use
disposable, in-memory SQLite and mocked Durable Objects. The chat RPC regression also
runs the built backend in Miniflare/workerd with a separate, disposable D1 database.
`npm test` builds first; tests never touch production data.

---

## 📁 Project Structure

```
finance-tracker/
├── src/                          # Frontend React application
│   ├── components/               # React components
│   │   ├── VoiceMode.tsx        # Voice interaction component
│   │   ├── ChatSection.tsx      # Chat interface
│   │   ├── ExpensesSection.tsx  # Expense list view
│   │   └── ui/                  # Reusable UI components
│   ├── hooks/                   # Custom React hooks
│   │   ├── useVoiceConversation.ts  # Voice conversation logic
│   │   ├── useSpeechRecognition.ts  # Web Speech API wrapper
│   │   └── useElevenLabs.ts     # ElevenLabs TTS integration
│   ├── lib/                     # Utility functions
│   │   ├── api.ts               # API client
│   │   └── utils.ts             # Helper functions
│   └── types/                   # TypeScript type definitions
│
├── worker/                       # Cloudflare Worker backend
│   ├── index.ts                 # Main Worker entry point
│   ├── ai/                      # AI processing logic
│   │   ├── classify-intent.ts  # Intent classification
│   │   ├── parse-expense.ts    # Expense parsing
│   │   ├── query-expenses.ts   # Query processing
│   │   ├── delete-expense.ts   # Deletion logic
│   │   └── prompts/            # AI prompts
│   ├── durable-objects/        # Durable Objects
│   │   └── FinanceMemory.ts   # Expense & chat storage
│   └── types/                  # Worker type definitions
│
├── wrangler.jsonc              # Cloudflare Worker configuration
├── vite.config.ts              # Vite configuration
└── package.json                # Dependencies
```

---

## 🤖 AI Features Deep Dive

### 1. Intent Classification

The AI automatically identifies what you want to do:

- **ADD_EXPENSE**: "I spent $50 on coffee"
- **QUERY**: "How much did I spend on food?"
- **DELETE**: "Delete my last coffee expense"
- **HELP**: "What can you do?"

### 2. Expense Parsing

When adding an expense, the AI extracts:

- **Amount**: Dollar value
- **Merchant**: Where you spent it
- **Category**: Auto-categorized (Food, Transport, Entertainment, etc.)

### 3. Natural Language Queries

Ask questions naturally:

- "How much did I spend this week?"
- "What did I spend on food?"
- "Show me my coffee expenses"
- "How much was my Uber ride?"

### 4. Smart Deletion

Delete expenses conversationally:

- "Delete my last coffee expense"
- "Remove all food expenses from yesterday"
- "Delete the $50 Starbucks charge"

---

## 🔌 API Endpoints

### Voice Command (Primary Interface)

```http
POST /api/voice-command
Content-Type: application/json

{
  "userId": "user-123",
  "input": "I spent $50 on coffee"
}
```

### Add Expense (Manual)

```http
POST /api/expense-natural
Content-Type: application/json

{
  "userId": "user-123",
  "input": "Spent $50 on lunch at Chipotle"
}
```

### Get Expenses

```http
GET /api/expenses/:userId
```

### Chat History

```http
GET /api/chat/:userId
POST /api/chat/:userId
DELETE /api/chat/:userId
```

---

## 🎨 UI Components

### Voice Mode

- Real-time audio visualization
- Speaking/listening states
- Animated mic button
- ElevenLabs voice responses

### Chat Section

- Message bubbles (user/assistant)
- Expense cards with metadata
- Scroll to bottom on new messages

### Expenses Section

- Categorized expense cards
- Summary statistics
- Filter and search capabilities

---

## 🔒 Privacy & Security

- ✅ **No bank integration required** - manual entry only
- ✅ **User-specific data isolation** - Durable Objects per user
- ✅ **No third-party data sharing** - all data in Cloudflare
- ✅ **Edge computing** - data processed close to you
- ✅ **Minimal data retention** - only what you add

---

## 🌟 Why Cloudflare?

### Workers AI (Llama 3.3 70B)

- Zero cold starts
- No model management
- Pay-per-request pricing
- Global inference at the edge

### Durable Objects

- Strongly consistent storage
- No database setup
- Automatic scaling
- Built-in state management

### Workers

- Deploy globally in seconds
- Millisecond response times
- No infrastructure management
- Free tier for development

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [Cloudflare Workers](https://workers.cloudflare.com/) - Serverless platform
- [Workers AI](https://ai.cloudflare.com/) - AI inference at the edge
- [ElevenLabs](https://elevenlabs.io/) - Natural voice synthesis
- [Hono](https://hono.dev/) - Lightweight web framework
- [Radix UI](https://www.radix-ui.com/) - Accessible components

---

## 📧 Contact

**Kshitij Dumbre** - [@KshitijD21](https://github.com/KshitijD21)

**Project Links:**

- 🌐 Live Demo: [https://9c6acdb0.finance-tracker-cr2.pages.dev](https://9c6acdb0.finance-tracker-cr2.pages.dev)
- 📦 GitHub: [https://github.com/KshitijD21/finance-tracker](https://github.com/KshitijD21/finance-tracker)
- 📝 Documentation: [PROMPTS.md](./PROMPTS.md)

---

<div align="center">

**Built with ❤️ using Cloudflare Workers AI**

Made by [Kshitij](https://github.com/KshitijD21)

</div>
