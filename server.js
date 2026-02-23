require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { initDatabase } = require('./services/storage');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (Railway, Render, etc. run behind a reverse proxy)
app.set('trust proxy', 1);

// ── CORS ──────────────────────────────────────────────────────
const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
    : '*';

app.use(cors({ origin: corsOrigins }));

// ── Rate Limiting ─────────────────────────────────────────────

// General API rate limit (100 requests per 15 min per IP)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Prea multe cereri, te rog încearcă mai târziu.' }
});

// Stricter limit for upload/transcribe (10 per 15 min per IP)
const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Prea multe încărcări, te rog încearcă mai târziu.' }
});

// ── Body Parsing ──────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Static Files ──────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ────────────────────────────────────────────────────
// Webhook has no rate limit (Meta needs to reach it freely)
app.use('/', require('./routes/webhook'));

// Upload gets stricter rate limit
app.use('/api/transcribe', uploadLimiter);
app.use('/', require('./routes/transcribe'));

// General API routes get standard rate limit
app.use('/api', apiLimiter);
app.use('/', require('./routes/api'));

// Health check (no rate limit)
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: Math.round(process.uptime()),
        version: require('./package.json').version
    });
});

// ── Start ─────────────────────────────────────────────────────
async function start() {
    try {
        await initDatabase();

        app.listen(PORT, () => {
            console.log('');
            console.log('╔══════════════════════════════════════════╗');
            console.log('║     🎙️  VoiceScribe Server Running       ║');
            console.log('╠══════════════════════════════════════════╣');
            console.log(`║  🌐 Dashboard: http://localhost:${PORT}      ║`);
            console.log(`║  📡 Webhook:   /webhook                  ║`);
            console.log(`║  📤 Upload:    /api/transcribe            ║`);
            console.log('╚══════════════════════════════════════════╝');
            console.log('');

            // Env check warnings
            if (!process.env.OPENAI_API_KEY) console.warn('⚠️  OPENAI_API_KEY not set — transcription will fail');
            if (!process.env.WHATSAPP_ACCESS_TOKEN) console.warn('⚠️  WHATSAPP_ACCESS_TOKEN not set — WhatsApp integration disabled');
            if (!process.env.WHATSAPP_VERIFY_TOKEN) console.warn('⚠️  WHATSAPP_VERIFY_TOKEN not set — webhook verification will reject all');
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

start();
