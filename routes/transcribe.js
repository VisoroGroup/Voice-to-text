const express = require('express');
const router = express.Router();
const multer = require('multer');
const { transcribeAudio } = require('../services/whisper');
const { saveTranscription } = require('../services/storage');

// Store uploaded files in memory (max 25 MB)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 }
});

/**
 * POST /api/transcribe — Manual audio upload transcription
 * Accepts multipart form data with an 'audio' field
 */
router.post('/api/transcribe', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No audio file provided' });
        }

        const audioBuffer = req.file.buffer;
        const mimeType = req.file.mimetype;

        console.log(`📤 Manual upload: ${req.file.originalname} (${mimeType}, ${Math.round(req.file.size / 1024)}KB)`);

        // Transcribe
        const result = await transcribeAudio(audioBuffer, mimeType);

        // Save to database
        const id = saveTranscription({
            sender: 'manual',
            senderName: req.body.senderName || 'Kézi feltöltés',
            timestamp: Math.floor(Date.now() / 1000),
            transcription: result.text,
            language: result.language,
            duration: result.duration,
            source: 'manual'
        });

        console.log(`✅ Manual transcription saved (id: ${id})`);

        res.json({
            id,
            text: result.text,
            language: result.language,
            duration: result.duration,
            segments: result.segments
        });
    } catch (error) {
        console.error('❌ Manual transcription error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
