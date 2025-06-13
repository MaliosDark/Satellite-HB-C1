const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const { Token, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const fetch = require('node-fetch');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const API_ROOT = "https://genelia.aswss.com";

// Generate image using Genelia API
async function generateImage(prompt) {
    const fd = new FormData();
    fd.append("texto", prompt);
    fd.append("steps", 50);
    fd.append("cfgScale", 7.0);
    fd.append("sampler", "DPM++ 2M");
    fd.append("width", 512);
    fd.append("height", 512);
    fd.append("seed", -1);
    fd.append("negativePrompt", "");
    fd.append("model", "CHEYENNE_v16.safetensors");

    const res = await fetch(`${API_ROOT}/obtener_imagen`, { method: "POST", body: fd });
    if (!res.ok) throw new Error(await res.text());

    const fileName = (await res.text()).split("/").pop();
    return `${API_ROOT}/images/${fileName}`;
}

// Download image from URL and save locally
async function downloadImage(url, mintAddress) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to download image');
    const buffer = await res.arrayBuffer();
    const imagesDir = path.join(__dirname, 'images');
    if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true });
    }
    const filePath = path.join(imagesDir, `${mintAddress}.png`);
    fs.writeFileSync(filePath, Buffer.from(buffer));
    return filePath;
}

// Mint new SPL token and generate metadata
async function mintNewToken(connection, payer, mintAuthority, freezeAuthority, name, symbol) {
    // Create mint
    const token = await Token.createMint(
        connection,
        payer,
        mintAuthority.publicKey,
        freezeAuthority.publicKey,
        9,
        TOKEN_PROGRAM_ID
    );

    const mintAddress = token.publicKey.toBase58();
    // Generate image for token
    const prompt = `${name} token logo`;
    const imageUrl = await generateImage(prompt);
    const localImagePath = await downloadImage(imageUrl, mintAddress);

    // Create metadata JSON
    const metadata = {
        name: name,
        symbol: symbol,
        description: `Token ${name} created by bot.`,
        image: `http://localhost:3030/images/${mintAddress}.png`,
        external_url: "https://pai-os.org",
        twitter: "https://x.com/avatar_terminal",
        telegram: "https://t.com/paios_gaming"
    };

    const metadataDir = path.join(__dirname, 'metadata');
    if (!fs.existsSync(metadataDir)) {
        fs.mkdirSync(metadataDir, { recursive: true });
    }
    const metadataPath = path.join(metadataDir, `${mintAddress}.json`);
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    return {
        mintAddress,
        metadata,
        localImagePath
    };
}

module.exports = { mintNewToken };
