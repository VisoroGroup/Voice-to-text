/**
 * Mime type to file extension mapping
 */
const MIME_EXT_MAP = {
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/mp4a-latm': 'm4a',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/webm': 'webm',
    'audio/aac': 'aac',
    'audio/flac': 'flac',
    'audio/x-m4a': 'm4a'
};

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB — Whisper limit

/**
 * Sleep utility for retry backoff
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Transcribe audio using OpenAI Whisper API with exponential backoff retry
 * @param {Buffer} audioBuffer - Raw audio bytes
 * @param {string} mimeType - MIME type of the audio
 * @param {Object} options - Optional config
 * @param {number} options.maxRetries - Max retry attempts (default 3)
 * @param {string} options.language - Force language (e.g. 'hu'), or omit for auto-detect
 * @returns {{ text: string, language: string, duration: number, segments: Array }}
 */
async function transcribeAudio(audioBuffer, mimeType, { maxRetries = 3, language } = {}) {
    // Size guard
    if (audioBuffer.length > MAX_FILE_SIZE) {
        throw new Error(`Fișierul audio este prea mare (${Math.round(audioBuffer.length / 1024 / 1024)}MB). Maximum: 25MB.`);
    }

    const baseMime = mimeType.split(';')[0].trim();
    const ext = MIME_EXT_MAP[baseMime] || 'ogg';

    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const formData = new FormData();
            formData.append('file', new Blob([audioBuffer], { type: baseMime }), `audio.${ext}`);
            formData.append('model', 'whisper-1');
            formData.append('response_format', 'verbose_json');
            if (language && language !== 'auto') {
                formData.append('language', language);
            }

            const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
                },
                body: formData
            });

            if (!response.ok) {
                const errorBody = await response.text();
                // Don't retry on 4xx client errors (except 429 rate limit)
                if (response.status < 500 && response.status !== 429) {
                    throw new Error(`Whisper API error ${response.status}: ${errorBody}`);
                }
                throw new Error(`Whisper API ${response.status}: ${errorBody}`);
            }

            const result = await response.json();

            return {
                text: result.text,
                language: result.language || 'unknown',
                duration: result.duration || null,
                segments: result.segments || []
            };
        } catch (error) {
            lastError = error;
            const isRetryable = error.message.includes('429') ||
                error.message.includes('500') ||
                error.message.includes('502') ||
                error.message.includes('503') ||
                error.message.includes('fetch');

            if (attempt < maxRetries && isRetryable) {
                const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
                console.warn(`⚠️ Whisper attempt ${attempt} failed, retrying in ${delay / 1000}s...`, error.message);
                await sleep(delay);
            } else {
                break;
            }
        }
    }

    console.error('❌ Whisper transcription failed after retries:', lastError?.message);
    throw lastError;
}

module.exports = {
    transcribeAudio
};
