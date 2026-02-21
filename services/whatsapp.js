const WHATSAPP_API_URL = 'https://graph.facebook.com/v18.0';

/**
 * Download media (voice message) from WhatsApp
 * Two-step process: get media URL, then download binary
 */
async function downloadWhatsAppMedia(mediaId) {
    // Step 1: Get the media URL
    const mediaResponse = await fetch(
        `${WHATSAPP_API_URL}/${mediaId}`,
        {
            headers: {
                Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`
            }
        }
    );

    if (!mediaResponse.ok) {
        throw new Error(`Failed to get media URL: ${mediaResponse.status} ${mediaResponse.statusText}`);
    }

    const mediaData = await mediaResponse.json();

    // Step 2: Download the actual file
    const fileResponse = await fetch(mediaData.url, {
        headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`
        }
    });

    if (!fileResponse.ok) {
        throw new Error(`Failed to download media: ${fileResponse.status} ${fileResponse.statusText}`);
    }

    return Buffer.from(await fileResponse.arrayBuffer());
}

/**
 * Send a text message via WhatsApp Cloud API
 */
async function sendWhatsAppMessage(to, text) {
    const response = await fetch(
        `${WHATSAPP_API_URL}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: to,
                type: 'text',
                text: { body: text }
            })
        }
    );

    if (!response.ok) {
        const error = await response.text();
        console.error('WhatsApp send error:', error);
        throw new Error(`Failed to send WhatsApp message: ${response.status}`);
    }

    return response.json();
}

/**
 * Send a template message via WhatsApp Cloud API
 * Templates can be sent anytime (no 24h window restriction)
 */
async function sendWhatsAppTemplate(to, templateName, params, language = 'en') {
    const response = await fetch(
        `${WHATSAPP_API_URL}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: to,
                type: 'template',
                template: {
                    name: templateName,
                    language: { code: language },
                    components: [
                        {
                            type: 'body',
                            parameters: params.map(p => ({ type: 'text', text: p }))
                        }
                    ]
                }
            })
        }
    );

    if (!response.ok) {
        const error = await response.text();
        console.error('WhatsApp template send error:', error);
        throw new Error(`Failed to send template message: ${response.status}`);
    }

    return response.json();
}

module.exports = {
    downloadWhatsAppMedia,
    sendWhatsAppMessage,
    sendWhatsAppTemplate
};
