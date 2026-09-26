═══════════════════════════════════════════════════════════════════════════════
               NEUROTREND AI v1.1 - Trading Bot Indodax
═══════════════════════════════════════════════════════════════════════════════

📦 REPOSITORY: https://neuro.grok.me (private)
📅 Last Update: 26 September 2026
💰 Modal: Rp 198.335 (bisa diubah di Settings)

🔧 STATUS: LIVE (real money aktif) - PAPER mode masih aktif

🛠️ Fitur Utama:
   • AI Signal + Heuristic (90% equity mode)
   • Grid Trading + Momentum + Dip Leg
   • Manual Trade + Jual Semua
   • Circuit Breaker 5% + 2% Lock Profit
   • Time Out 1/2/3 Jam (pilih sendiri)
   • Scan 15 detik atau 30 detik
   • Wallet sync real-time
   • Chart + Log live

⚠️ PENTING:
   • API key HARUS TRADE ONLY (bukan WITHDRAW)
   • Gunakan .env dengan LIVE_TRADING=true
   • Modal kecil (di bawah Rp 500.000) aman untuk testing
   • Setelah untung 5% global = JUAL SEMUA otomatis

📁 STRUKTUR FOLDER:
   /neurotrend
   ├── .env.example
   ├── .readme.txt          ← file ini
   ├── package.json
   ├── tsconfig.json
   ├── src/
   │   ├── lib/neurotrend/
   │   │   ├── store.ts
   │   │   ├── indodax-private.ts
   │   │   ├── portfolio.ts
   │   │   ├── smart.ts           (strategi agresif)
   │   │   └── scanner.ts
   │   └── App.tsx
   └── public/

🚀 CARA PAKAI:
   1. Copy .env.example ke .env dan isi
   2. npm install
   3. npm run dev
   4. Centang "90% equity" jika mau trade besar sekali
   5. Klik "Mulai · Auto · Scan"

💬 BUTUH BANTUAN?
   - Buka Issue di GitHub (private)
   - Atau ketik langsung ke Grok di sini

═══════════════════════════════════════════════════════════════════════════════
