const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");

// --- CONFIGURATION ---
const GEMINI_API_KEY = "AIzaSyB5tzQZyuUuOzTRMpz4Ky_fF_oUJb6kCns"; 
// ---------------------

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

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

        const text = msg.message.conversation || msg.message.imageMessage?.caption || msg.message.extendedTextMessage?.text || '';
        
        // Triggers: .botak (Bald) or .hitamkan (Darker)
        if (text.startsWith('.botak') || text.startsWith('.hitamkan') || text.startsWith('.edit')) {
            try {
                const isImage = Object.keys(msg.message)[0] === 'imageMessage';
                const isQuotedImage = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;

                if (!isImage && !isQuotedImage) {
                    await sock.sendMessage(msg.key.remoteJid, { text: 'Reply to an image!' }, { quoted: msg });
                    return;
                }

                await sock.sendMessage(msg.key.remoteJid, { text: '⚡ Asking Gemini ⚡' }, { quoted: msg });

                // // 1. Download
                const messageToDownload = isImage ? msg : { message: msg.message.extendedTextMessage.contextInfo.quotedMessage };
                const buffer = await downloadMediaMessage(messageToDownload, 'buffer', { logger: pino({ level: 'silent' }) });

                // 2. Select Model
                // We use 'gemini-2.5-flash-image' because it is fast and supports image input
                const model = genAI.getGenerativeModel({ 
                    model: "gemini-2.5-flash-image",
                    safetySettings: safetySettings });

                // 3. THE BYPASS PROMPTS
                // We frame this as "Character Concept Art" or "Lighting Study" to avoid Identity Filters
                let prompt = "";
                
                if (text.startsWith('.botak')) {
                    // Bypass Logic: Ask for a "New Character" based on the reference, not an "Edit"
                    prompt = "make the person bald";
                    console.log("Edit Prompt:", prompt);
                } else if (text.startsWith('.hitamkan')) {
                    // For .hitamkan
                    prompt = "make the person have darker skin tone";
                    console.log("Edit Prompt:", prompt);
                } else if (text.startsWith('.edit')) {
                    prompt = text.slice(text.indexOf(' ') + 1).trim();
                    console.log("Edit Prompt:", prompt);
                }
                
                const imagePart = {
                    inlineData: {
                        data: buffer.toString("base64"),
                        mimeType: "image/jpeg",
                    },
                };

                // 4. Generate
                const result = await model.generateContent([prompt, imagePart]);
                const response = await result.response;
                
                try {
                    const outputBase64 = response.candidates[0].content.parts[0].inlineData.data;
                    const outputBuffer = Buffer.from(outputBase64, "base64");

                    await sock.sendMessage(msg.key.remoteJid, { 
                        image: outputBuffer, 
                        caption: '✨ Gemini Result ✨' 
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

connectToWhatsApp();