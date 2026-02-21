const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { downloadWhatsAppMedia, sendWhatsAppMessage, sendWhatsAppTemplate } = require('../services/whatsapp');
const { transcribeAudio } = require('../services/whisper');
const { saveTranscription, getSetting } = require('../services/storage');

// Simple sequential queue to avoid overloading APIs
const messageQueue = [];
let processing = false;

/**
 * Verify Meta webhook signature (X-Hub-Signature-256)
 * Returns true if no app secret is configured (development mode) or signature is valid
 */
function verifySignature(req) {
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    if (!appSecret) return true; // Skip in dev

    const signature = req.headers['x-hub-signature-256'];
    if (!signature) return false;

    const expected = 'sha256=' + crypto
        .createHmac('sha256', appSecret)
        .update(JSON.stringify(req.body))
        .digest('hex');

    return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected)
    );
}

/**
 * GET /webhook — Meta webhook verification
 */
router.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
        console.log('✅ Webhook verified successfully');
        return res.status(200).send(challenge);
    }

    console.warn('⚠️ Webhook verification failed');
    res.sendStatus(403);
});

/**
 * POST /webhook — Receives incoming WhatsApp messages
 * Always responds 200 immediately, then queues processing
 */
router.post('/webhook', (req, res) => {
    // Verify signature
    if (!verifySignature(req)) {
        console.error('❌ Invalid webhook signature — possible spoofing attempt');
        return res.sendStatus(403);
    }

    // Respond immediately — Meta retries on timeout
    res.sendStatus(200);

    // Queue for sequential processing
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (message) {
        const senderPhone = message.from;
        const senderName = changes?.value?.contacts?.[0]?.profile?.name || 'Ismeretlen';
        messageQueue.push({ message, senderPhone, senderName });
        processQueue();
    }
});

/**
 * Process message queue sequentially to avoid API rate limits
 */
async function processQueue() {
    if (processing || messageQueue.length === 0) return;
    processing = true;

    while (messageQueue.length > 0) {
        const { message, senderPhone, senderName } = messageQueue.shift();
        const timestamp = Date.now();

        try {
            if (message.type === 'audio') {
                await handleAudioMessage(message, senderPhone, senderName, timestamp);
            } else if (message.type === 'text') {
                await handleTextMessage(message, senderPhone);
            }
        } catch (error) {
            console.error(`❌ [${new Date().toISOString()}] Error processing message from ${senderName} (${senderPhone}):`, error.message);
        }
    }

    processing = false;
}

/**
 * Handle audio/voice messages
 */
async function handleAudioMessage(message, senderPhone, senderName, timestamp) {
    const audioId = message.audio.id;
    const mimeType = message.audio.mime_type || 'audio/ogg';

    console.log(`🎙️ [${new Date().toISOString()}] Voice message from ${senderName} (${senderPhone})`);

    // Step 1: Download audio (retry once on failure)
    let audioBuffer;
    try {
        console.log('  ⬇️ Downloading audio...');
        audioBuffer = await downloadWhatsAppMedia(audioId);
    } catch (downloadErr) {
        console.warn('  ⚠️ First download attempt failed, retrying...', downloadErr.message);
        try {
            await new Promise(r => setTimeout(r, 2000));
            audioBuffer = await downloadWhatsAppMedia(audioId);
        } catch (retryErr) {
            console.error('  ❌ Download failed after retry:', retryErr.message);
            await sendWhatsAppMessage(senderPhone,
                '❌ Nem sikerült letölteni a hangüzenetet, kérlek próbáld újra.'
            ).catch(() => { });
            return;
        }
    }

    // Check file size
    if (audioBuffer.length > 25 * 1024 * 1024) {
        console.warn(`  ⚠️ Audio too large: ${Math.round(audioBuffer.length / 1024 / 1024)}MB`);
        await sendWhatsAppMessage(senderPhone,
            '⚠️ A hangüzenet túl nagy (max 25MB). Kérlek küldj rövidebb üzenetet.'
        ).catch(() => { });
        return;
    }

    // Step 2: Transcribe with Whisper (has its own retry logic)
    console.log('  🔄 Transcribing...');
    const defaultLang = getSetting('default_language');
    const transcription = await transcribeAudio(audioBuffer, mimeType, {
        language: defaultLang !== 'auto' ? defaultLang : undefined
    });
    console.log(`  ✅ Transcribed (${transcription.language}): "${transcription.text.substring(0, 80)}..."`);

    // Step 3: Save to database
    saveTranscription({
        sender: senderPhone,
        senderName: senderName,
        timestamp: Math.floor(timestamp / 1000),
        transcription: transcription.text,
        language: transcription.language,
        duration: transcription.duration || message.audio.duration || null,
        source: 'whatsapp'
    });

    // Step 4: Send reply if auto-reply is enabled
    const autoReply = getSetting('auto_reply');
    if (autoReply === 'true') {
        const replyText = `📝 *Átírás:*\n\n${transcription.text}\n\n_Nyelv: ${transcription.language} | ${Math.round(transcription.duration || 0)}s_`;
        await sendWhatsAppMessage(senderPhone, replyText);
        console.log('  📤 Reply sent to WhatsApp');
    }

    // Step 5: Forward transcription to configured numbers
    const forwardNumbers = process.env.FORWARD_TO_NUMBERS;
    if (forwardNumbers) {
        const numbers = forwardNumbers.split(',').map(n => n.trim()).filter(Boolean);
        const durationStr = `${Math.round(transcription.duration || 0)}s | ${transcription.language}`;

        for (const number of numbers) {
            if (number !== senderPhone) { // Don't double-send to the original sender
                try {
                    // Try template first (works without 24h window)
                    await sendWhatsAppTemplate(number, 'voice_transcription_forward', [
                        `${senderName} (${senderPhone})`,
                        durationStr,
                        transcription.text
                    ]);
                    console.log(`  📨 Forwarded to ${number} (template)`);
                } catch (templateErr) {
                    // Fall back to plain text (only works within 24h window)
                    console.warn(`  ⚠️ Template failed for ${number}, trying plain text:`, templateErr.message);
                    try {
                        const forwardText = `📨 *Új hangüzenet átírás*\n\n👤 *Feladó:* ${senderName} (${senderPhone})\n⏱️ *Hossz:* ${durationStr}\n\n📝 *Szöveg:*\n${transcription.text}`;
                        await sendWhatsAppMessage(number, forwardText);
                        console.log(`  📨 Forwarded to ${number} (plain text)`);
                    } catch (plainErr) {
                        console.error(`  ❌ Forward to ${number} failed completely:`, plainErr.message);
                    }
                }
            }
        }
    }
}

/**
 * Handle text messages
 */
async function handleTextMessage(message, senderPhone) {
    const body = message.text.body.toLowerCase().trim();

    if (body === 'help' || body === 'segítség') {
        await sendWhatsAppMessage(senderPhone,
            '🎙️ *VoiceScribe*\n\n' +
            'Küldj egy hangüzenetet és automatikusan átírom szöveggé!\n\n' +
            'Támogatott nyelvek: 🇭🇺 Magyar, 🇷🇴 Román, 🇬🇧 Angol és 50+ más nyelv.\n\n' +
            '_Powered by OpenAI Whisper_'
        );
    }
}

module.exports = router;
