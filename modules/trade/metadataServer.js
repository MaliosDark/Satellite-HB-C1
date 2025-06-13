const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3030;

// Serve static images
app.use('/images', express.static(path.join(__dirname, 'images')));

// Serve metadata JSON files
app.get('/metadata/:mintAddress', (req, res) => {
    const mintAddress = req.params.mintAddress;
    const metadataPath = path.join(__dirname, 'metadata', `${mintAddress}.json`);
    if (fs.existsSync(metadataPath)) {
        res.sendFile(metadataPath);
    } else {
        res.status(404).json({ error: 'Metadata not found' });
    }
});

app.listen(PORT, () => {
    console.log(`Metadata server running on port ${PORT}`);
});
