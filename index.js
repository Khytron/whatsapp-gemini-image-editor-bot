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

        // If user is trying to generate text-to-image
        if (text.startsWith('.imagine')) {
            const prompt = text.slice(text.indexOf(' ') + 1).trim(); // Getting user prompt

            if (!prompt) {
                await sock.sendMessage(msg.key.remoteJid, { text: '⚠️ Please provide a prompt.'}, { quoted: msg });
                return;
            }

            await sock.sendMessage(msg.key.remoteJid, { text: 'Generating image by Khytron.. '}, { quoted: msg }); 

            try {
                // Initialize the specific model
                const model = genAI.getGenerativeModel({
                    model: "imagen-3.0-generate-001",
                    safetySettings: safetySettings
                });

                // Send the prompt (text only)
                const result = await model.generateContent(prompt);
                const response = await result.response;

                // Extract image data
                const parts = response.candidates[0].content.parts;
                const imagePart = parts.find(part => part.inlineData);

                if (imagePart) {
                    const outputBase64 = imagePart.inlineData.data;
                    const outputBuffer = Buffer.from(outputBase64,  "base64" );

                    await sock.sendMessage(msg.key.remoteJid, {
                        image: outputBuffer,
                        caption: ''
                    }, { quoted: msg });
                } else {
                    // Fallback if the API returns text instead of an image
                    await sock.sendMessage(msg.key.remoteJid, { text: '⚠️ The model returned text instead of an image. Check if your API Key has access to Imagen.' }, { quoted: msg });
                }
            } catch (e) {
                console.error( "Imagine Error: ", e);
                await sock.sendMessage(msg.key.remoteJid, { text: '❌ Error: ' + e.message }, { quoted: msg });
            }
            return; // Stop here after .imagine command is finished
        }
        
        // Triggers
        if (text.startsWith('.botak') || 
            text.startsWith('.niggakan') || 
            text.startsWith('.edit') || 
            text.startsWith('.princess') || 
            text.startsWith('.superman') ||
            text.startsWith('.putihkan') ||
            text.startsWith('.gigachad') ||
            text.startsWith('.penjarakan') ||
            text.startsWith('.homeless') ||
            text.startsWith('.anime') ||
            text.startsWith('.minecraft') ||
            text.startsWith('.pixar') ||
            text.startsWith('.passport') ||
            text.startsWith('.hd') ||
            text.startsWith('.zoomout') ||
            text.startsWith('.cs2') ||
            text.startsWith('.documentary') ||
            text.startsWith('.pixelart') ||
            text.startsWith('.tua') ||
            text.startsWith('.badut') ||
            text.startsWith('.rempit') ||
            text.startsWith('.cyberpunk') ||
            text.startsWith('.mewing') ||
            text.startsWith('.tofigura')
            ) {

            try {
                // 2. Robust Quoted Image Detection
                // We check the quoted message for either a direct image OR a viewOnce image
                const quotedMsg = msgContent.extendedTextMessage?.contextInfo?.quotedMessage;
                
                const isImage = !!msgContent.imageMessage;
                const isQuotedImage = quotedMsg?.imageMessage ||
                                        quotedMsg?.viewOnceMessage?.message?.imageMessage ||
                                        quotedMsg?.viewOnceMessageV2?.message?.imageMessage;

                if (!isImage && !isQuotedImage) {
                    await sock.sendMessage(msg.key.remoteJid, { text: 'Reply to an image or upload one..' }, { quoted: msg });
                    return;
                }

                await sock.sendMessage(msg.key.remoteJid, { text: 'Generating image by Khytron.. ' }, { quoted: msg });

                // 3. Prepare Download
                // If it's a quoted message, we pass the 'quotedMsg' object to the downloader

                const messageToDownload = isImage ? msg : { message: quotedMsg };
                
                const buffer = await downloadMediaMessage(
                    messageToDownload,
                    'buffer',
                    { logger: pino({ level: 'silent' }) }
                );

                // 4. Select Model
                // We use 'gemini-3-pro-image-preview' 
                // because it is state of the art model that supports image editing
                const model = genAI.getGenerativeModel({ 
                    model: "gemini-3-pro-image-preview",
                    safetySettings: safetySettings });

                // 5. THE PROMPTS
                // System prompt
                let prompt = "Referring to the body language and facial structure, ";
                
                if (text.startsWith('.botak')) {
                    // For .botak
                    prompt += "make the person bald";
                   
                } else if (text.startsWith('.niggakan')) {
                    // For .niggakan
                    prompt += "make the person have darker skin tone";
            
                } else if (text.startsWith('.princess')) {
                    // For .princess
                    prompt += "make the person wear a princess dress, dont enhance body features";
                  
                } else if (text.startsWith('.edit')) {
                    // For .edit
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
                   
                } else if (text.startsWith('.penjarakan')) {
                    // For .penjarakan
                    prompt += "put the person in a jail cell wearing an orange prisoner jumpsuit";
                   
                } else if (text.startsWith('.homeless')) {
                    // For .homeless
                    prompt += "make the person look dirty and homeless, wearing rags, begging on the street";
                   
                } else if (text.startsWith('.anime')) {
                    // For .anime
                    prompt += "transform the scene into a high quality anime drawing style";
                   
                } else if (text.startsWith('.minecraft')) {
                    // For .minecraft
                    prompt += "transform the scene into a high quality minecraft, blocky voxel art style";
                   
                } else if (text.startsWith('.pixar')) {
                    // For .pixar
                    prompt += "transform the scene into a high quality cute 3D Pixar drawing style, smooth lighting";
                   
                } else if (text.startsWith('.passport')) {
                    // For .passport
                    prompt += "change the background to plain blue and make the person wear a formal black suit and tie staring straight at the camera, image looks like a legitimate passport photo";
                   
                } else if (text.startsWith('.hd')) {
                    // For .hd
                    prompt += "enhance the image quality, fix the lighting, remove noise, make it high resolution 4K";
                   
                } else if (text.startsWith('.zoomout')) {
                    // For .zoomOut
                    prompt += "as if the camera of the original image was zoomed in, zoom out of the picture, generate the surrounding scenery and make it as accurate as possible";
                   
                } else if (text.startsWith('.cs2')) {
                    // For .cs2
                    prompt += "generate that person in a counter-strike 2 scene as a teammate but as a realistic person, keep everything else as close to the game as possible, use real map from counter-strike 2";
                   
                } else if (text.startsWith('.documentary')) {
                    // For .documentary
                    prompt += "Add a camera effect as if the image was recorded in a documentary, refer to Outlast 2 version of the camera style, but make it integrate nicely into an IRL image";
                    
                } else if (text.startsWith('.pixelart')) {
                    // For .pixelart
                    prompt += "turn the image into high quality low-resolution 8-bit pixel art";
                   
                } else if (text.startsWith('.tua')) {
                    // For .tua
                    prompt += "make the person look 80 years old, with many wrinkles, grey hair, and sagging skin. keep everything else the same";

                } else if (text.startsWith('.badut')) {
                    // For .badut
                    prompt += "make the person look like a circus clown with full face makeup and a red nose";
                    
                } else if (text.startsWith('.rempit')) {
                    // For .rempit
                    prompt += "make the person look like a Malaysian Mat Rempit, wearing a reversed cap, windbreaker, and sitting on a modified motorcycle";
                    
                } else if (text.startsWith('.cyberpunk')) {
                    // For .cyberpunk
                    prompt += "make the person look like a cyborg from Cyberpunk 2077, with neon lights, metal skin parts, and futuristic visor";
                    
                } else if (text.startsWith('.mewing')) {
                    // For .mewing
                    prompt += "give the person an extremely sharp, exaggerated jawline and cheekbones (mewing look), gigachad energy";
                    
                } else if (text.startsWith('.tofigura')) {
                    // For .tofigura
                    prompt += "A realistic product photograph taken on a cluttered wooden office desk. In the foreground, a custom-made toy figure of the person (keep the figure as close to the original person as possible, the body language, facial features and so on..) stands on a clear circular base. Next to it is the retail packaging box for the figure, prominently featuring the original photograph of the person on the front cover. In the background, a large computer monitor displays a 3D wireframe mesh model of the same figure within a 3D modeling software interface. A keyboard, mouse, and various cables are visible on the desk. Natural office lighting.";
                
                }

                // Output the prompt in console (for debugging purposes)
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
                    await sock.sendMessage(msg.key.remoteJid, { text: '⚠️ Gemini Safety Filter blocked this. (Try a different photo)' }, { quoted: msg });
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
    res.status(200).send('Bot is Awake!');
});

// Start the web server. Render automatically sets the PORT environment variable.
app.listen(PORT, () => {
    console.log(`Web Server listening on port ${PORT}`);
});

connectToWhatsApp();