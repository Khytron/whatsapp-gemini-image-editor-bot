const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");

// --- CONFIGURATION ---

// This project uses Render and Uptime Robot 
// to keep a free VM running 24/7
// and the free Gemini API Key with the gemini-3-pro-image-preview model

// Express Port
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
];

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
             const qrcode = require('qrcode-terminal');
             qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('✅ Connected to WhatsApp!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;

        // --- HELPER: UNWRAP MESSAGE LAYERS ---
        // This fixes issues with Disappearing Messages (Ephemeral) and ViewOnce
        const getMessageContent = (m) => {
            if (m.message?.ephemeralMessage) return m.message.ephemeralMessage.message;
            if (m.message?.viewOnceMessage) return m.message.viewOnceMessage.message;
            return m.message;
        }

        const msgContent = getMessageContent(msg);

        // 1. Extract Text (Command) safely
        // We read from 'msgContent' now, so we don't miss the text if it's inside an ephemeral message
        
        const text = msgContent.conversation || 
                    msgContent.imageMessage?.caption ||
                    msgContent.extendedTextMessage?.text || '';
        // Old way: const text = msg.message.conversation || msg.message.imageMessage?.caption || msg.message.extendedTextMessage?.text || '';
        
        // Triggers
        if (text.startsWith('.botak') || 
            text.startsWith('.niggafy') || 
            text.startsWith('.edit') || 
            text.startsWith('.princess') || 
            text.startsWith('.superman') ||
            text.startsWith('.putihkan') ||
            text.startsWith('.gigachad')) {
            try {
                // 2. Robust Quoted Image Detection
                // We check the quoted message for either a direct image OR a viewOnce image
                const quotedMsg = msgContent.extendedTextMessage?.contextInfo?.quotedMessage;
                
                // Old way
                // const isImage = Object.keys(msg.message)[0] === 'imageMessage';
                // const isQuotedImage = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;

                // New way
                const isImage = !!msgContent.imageMessage;
                const isQuotedImage = quotedMsg?.imageMessage ||
                                        quotedMsg?.viewOnceMessage?.message?.imageMessage ||
                                        quotedMsg?.viewOnceMessageV2?.message?.imageMessage;

                if (!isImage && !isQuotedImage) {
                    await sock.sendMessage(msg.key.remoteJid, { text: 'Reply to an image!' }, { quoted: msg });
                    return;
                }

                await sock.sendMessage(msg.key.remoteJid, { text: 'Generating image.. ' }, { quoted: msg });

                // 3. Prepare Download
                // If it's a quoted message, we pass the 'quotedMsg' object to the downloader
                
                // Old way: 
                // const messageToDownload = isImage ? msg : { message: msg.message.extendedTextMessage.contextInfo.quotedMessage };
                // const buffer = await downloadMediaMessage(messageToDownload, 'buffer', { logger: pino({ level: 'silent' }) });
                
                // New way: 
                const messageToDownload = isImage ? msg : { message: quotedMsg };
                
                const buffer = await downloadMediaMessage(
                    messageToDownload,
                    'buffer',
                    { logger: pino({ level: 'silent' }) }
                );

                // 4. Select Model
                // We use 'gemini-3-pro-image-preview' because it is fast and supports image input
                const model = genAI.getGenerativeModel({ 
                    model: "gemini-3-pro-image-preview",
                    safetySettings: safetySettings });

                // 5. THE PROMPTS
                // System prompt
                let prompt = "Referring to the body language and facial structure, ";
                
                if (text.startsWith('.botak')) {
                    // For .botak
                    prompt += "make the person bald";
                   
                } else if (text.startsWith('.niggafy')) {
                    // For .niggakan
                    prompt += "make the person have darker skin tone";
            
                } else if (text.startsWith('.princess')) {
                    // For .princess
                    prompt += "make the person wear a princess dress, dont enhance body features";
                  
                } else if (text.startsWith('.edit')) {
                    prompt += text.slice(text.indexOf(' ') + 1).trim();
                 
                } else if (text.startsWith('.superman')) {
                    // For .superman
                    prompt += "make the person's outfit like superman, dont enhance body features";
                  
                } else if (text.startsWith('.putihkan')) {
                    // For .putihkan
                    prompt += "make the person have white skin tone";
                   
                } else if (text.startsWith('.gigachad')) {
                    // For .gigachad
                    prompt += "make the person have gigachad facial features, keep everything else the same";
                   
                }

                console.log("Edit Prompt:", prompt);
                
                const imagePart = {
                    inlineData: {
                        data: buffer.toString("base64"),
                        mimeType: "image/jpeg",
                    },
                };

                // 6. Generate
                const result = await model.generateContent([prompt, imagePart]);
                const response = await result.response;
                
                try {
                    const outputBase64 = response.candidates[0].content.parts[0].inlineData.data;
                    const outputBuffer = Buffer.from(outputBase64, "base64");

                    await sock.sendMessage(msg.key.remoteJid, { 
                        image: outputBuffer, 
                        caption: '' 
                    }, { quoted: msg });

                } catch (innerErr) {
                    console.error("Gemini Blocked It:", innerErr);
                    await sock.sendMessage(msg.key.remoteJid, { text: '⚠️ Gemini Safety Filter still blocked this. (Try a different photo)' }, { quoted: msg });
                }

            } catch (e) {
                console.error("API Error:", e);
                await sock.sendMessage(msg.key.remoteJid, { text: '❌ Error: ' + e.message }, { quoted: msg });
            }
        }
    });
}


// RENDER SLEEP PREVENTION ENDPOINT
// This endpoint responds to pings from Uptime Robot/Render
app.get('/keep-awake', (req, res) => {
    // You can add logic here to check your WhatsApp connection status
    res.status(200).send('Bot is Awake!');
});

// Start the web server. Render automatically sets the PORT environment variable.
app.listen(PORT, () => {
    console.log(`Web Server listening on port ${PORT}`);
});

connectToWhatsApp();