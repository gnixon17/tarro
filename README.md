# NYC Coffee AI Cashier

A minimal, real-time AI voice cashier for a busy coffee shop. Built with Express, Vite, React, SQLite, and Gemini.

## Features
- **Customer Kiosk (`/`)**: Voice and text-based ordering with Gemini. Handles complex menu logic, guardrails, and outputs a structured receipt.
- **Barista KDS (`/barista`)**: Real-time kitchen display system. Move orders from New -> In Progress -> Completed.
- **Owner Dashboard (`/owner`)**: End-of-day metrics and CSV export.

## Tech Stack
- **Frontend**: React, Tailwind CSS, React Router, Framer Motion
- **Backend**: Express.js
- **Database**: SQLite (`better-sqlite3`) - zero config, persists to `coffee_shop.db`
- **AI**: Gemini 3.1 Flash (`@google/genai`)
- **Voice**: Web Speech API (STT) + ElevenLabs (TTS, optional fallback to browser TTS)

## Setup & Run Locally

1. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`

2. Set up environment variables:
   Copy `.env.example` to `.env` and add your keys.
   \`\`\`bash
   GEMINI_API_KEY="your_gemini_key"
   ELEVENLABS_API_KEY="your_elevenlabs_key" # Optional
   \`\`\`

3. Start the dev server:
   \`\`\`bash
   npm run dev
   \`\`\`
   The server will start on `http://localhost:3000`. The SQLite database will be automatically created and seeded with sample data on first run.

## How to Test Quickly
1. Open the **Customer Kiosk**. Click "Switch to Voice" (if your browser supports it) or type: *"Can I get a large iced oat milk latte with half sweet vanilla?"*
2. Watch the AI confirm the order and generate a receipt.
3. Open the **Barista KDS** in another tab. You will see the new order appear. Click it to move it to "In Progress", and again to "Completed".
4. Open the **Owner Dashboard** to see the revenue update and download the `orders.csv`.

## Deployment (Vercel/Render)
To deploy this as a full-stack app:
1. Update the database layer to use Postgres (e.g., Supabase or Vercel Postgres) instead of SQLite, as serverless environments do not support persistent local files.
2. Run `npm run build` to compile the frontend.
3. Start the server with `npm run start`.
