const express = require('express');
const router = express.Router();
const {
    getTranscriptions, getTranscription, updateTranscription,
    deleteTranscription, deleteAllTranscriptions,
    getStats, getAllSettings, setSetting, exportAll,
    transcriptionEmitter
} = require('../services/storage');

// ═══════════════════════════════════════════════
// SSE — Server-Sent Events for real-time updates
// ═══════════════════════════════════════════════
const sseClients = new Set();

router.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Send initial connected event
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

    sseClients.add(res);

    req.on('close', () => {
        sseClients.delete(res);
    });
});

// Broadcast new transcriptions to all SSE clients
transcriptionEmitter.on('new', (data) => {
    const payload = JSON.stringify({ type: 'new_transcription', data });
    for (const client of sseClients) {
        client.write(`data: ${payload}\n\n`);
    }
});

// ═══════════════════════════════════════════════
// TRANSCRIPTIONS CRUD
// ═══════════════════════════════════════════════

/**
 * GET /api/transcriptions — Paginated list
 */
router.get('/api/transcriptions', (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const source = req.query.source || undefined;
        const search = req.query.search || undefined;

        const result = getTranscriptions({ page, limit, source, search });
        res.json(result);
    } catch (error) {
        console.error('Error fetching transcriptions:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/transcriptions/:id — Single transcription
 */
router.get('/api/transcriptions/:id', (req, res) => {
    try {
        const item = getTranscription(parseInt(req.params.id));
        if (!item) return res.status(404).json({ error: 'Transcription not found' });
        res.json(item);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * PATCH /api/transcriptions/:id — Update transcription text (inline edit)
 */
router.patch('/api/transcriptions/:id', (req, res) => {
    try {
        const { transcription } = req.body;
        if (typeof transcription !== 'string') {
            return res.status(400).json({ error: 'transcription field is required' });
        }
        const updated = updateTranscription(parseInt(req.params.id), transcription);
        if (!updated) return res.status(404).json({ error: 'Transcription not found' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /api/transcriptions/:id — Delete one
 */
router.delete('/api/transcriptions/:id', (req, res) => {
    try {
        const deleted = deleteTranscription(parseInt(req.params.id));
        if (!deleted) return res.status(404).json({ error: 'Transcription not found' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /api/transcriptions — Delete all
 */
router.delete('/api/transcriptions', (req, res) => {
    try {
        deleteAllTranscriptions();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/transcriptions/:id/export — Export as .txt or .srt
 */
router.get('/api/transcriptions/:id/export', (req, res) => {
    try {
        const item = getTranscription(parseInt(req.params.id));
        if (!item) return res.status(404).json({ error: 'Transcription not found' });

        const format = req.query.format || 'txt';

        if (format === 'srt') {
            const duration = item.duration || 0;
            const endH = Math.floor(duration / 3600);
            const endM = Math.floor((duration % 3600) / 60);
            const endS = Math.floor(duration % 60);
            const endMs = Math.round((duration % 1) * 1000);
            const srt = `1\n00:00:00,000 --> ${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:${String(endS).padStart(2, '0')},${String(endMs).padStart(3, '0')}\n${item.transcription}\n`;

            res.setHeader('Content-Type', 'text/srt; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="transcription_${item.id}.srt"`);
            return res.send(srt);
        }

        const header = `VoiceScribe Transcription\n========================\nID: ${item.id}\nSender: ${item.sender_name} (${item.sender})\nLanguage: ${item.language || 'N/A'}\nDuration: ${item.duration ? Math.round(item.duration) + 's' : 'N/A'}\nSource: ${item.source}\nDate: ${item.created_at}\n========================\n\n`;

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="transcription_${item.id}.txt"`);
        res.send(header + item.transcription);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ═══════════════════════════════════════════════
// EXPORT ALL
// ═══════════════════════════════════════════════

/**
 * GET /api/export?format=json|csv
 */
router.get('/api/export', (req, res) => {
    try {
        const format = req.query.format || 'json';
        const data = exportAll();

        if (format === 'csv') {
            const headers = ['id', 'sender', 'sender_name', 'timestamp', 'transcription', 'language', 'duration', 'source', 'created_at'];
            const csvRows = [headers.join(';')];
            data.forEach(row => {
                csvRows.push(headers.map(h => {
                    const val = row[h] ?? '';
                    return `"${String(val).replace(/"/g, '""')}"`;
                }).join(';'));
            });

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename="voicescribe_export.csv"');
            return res.send('\uFEFF' + csvRows.join('\n'));
        }

        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="voicescribe_export.json"');
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ═══════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════

router.get('/api/stats', (req, res) => {
    try {
        const stats = getStats();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ═══════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════

router.get('/api/settings', (req, res) => {
    try {
        const settings = getAllSettings();
        // Add computed info
        settings.webhook_url = (process.env.BASE_URL || 'https://your-domain.com') + '/webhook';
        settings.whatsapp_connected = !!(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
        res.json(settings);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.patch('/api/settings', (req, res) => {
    try {
        const allowed = ['auto_reply', 'default_language'];
        for (const [key, value] of Object.entries(req.body)) {
            if (allowed.includes(key)) {
                setSetting(key, value);
            }
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
