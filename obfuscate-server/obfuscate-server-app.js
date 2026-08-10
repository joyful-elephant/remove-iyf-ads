const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const JavaScriptObfuscator = require('javascript-obfuscator');

const app = express();

// Cache directory for storing obfuscated results
const CACHE_DIR = path.join(__dirname, 'cache');
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function getCachePath(jsCode) {
    const hash = crypto.createHash('sha256').update(jsCode).digest('hex');
    return path.join(CACHE_DIR, hash + '.js');
}

// Serve static files (test.html)
app.use(express.static(path.join(__dirname)));

// Allow large payloads (up to 50MB)
app.use(express.json({ limit: '50mb' }));
app.use(express.text({ limit: '50mb', type: ['text/plain', 'application/javascript', 'text/javascript'] }));

// API Key authentication
const API_KEY = process.env.API_KEY || 'obf-sk-a7f3e9b1c4d8462e';

// CORS - allow all origins
app.use((req, res, next) => {
    const origin = req.headers.origin;
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, x-api-key');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', '86400'); // Cache preflight for 24 hours
    if (req.method === 'OPTIONS') {
        return res.status(204).send();
    }
    next();
});

// API key middleware for /api/obfuscate
function requireApiKey(req, res, next) {
    const key = req.headers['x-api-key'];
    if (!key || key !== API_KEY) {
        return res.status(401).json({ error: 'Invalid or missing API key. Provide x-api-key header.' });
    }
    next();
}

// Multer for file upload (store in memory)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

/**
 * POST /api/obfuscate
 *
 * Accepts JS code in three ways:
 *   1. JSON body:  { "code": "...js source..." }
 *   2. Raw text body (Content-Type: text/plain or application/javascript)
 *   3. Multipart file upload (field name: "file")
 *
 * Returns JSON: { "obfuscated": "...obfuscated code..." }
 */
app.post('/api/obfuscate', requireApiKey, upload.single('file'), (req, res) => {
    try {
        let jsCode = null;

        if (req.file) {
            // Case 3: file uploaded via multipart
            jsCode = req.file.buffer.toString('utf-8');
        } else if (typeof req.body === 'string') {
            // Case 2: raw text body
            jsCode = req.body;
        } else if (req.body && typeof req.body.code === 'string') {
            // Case 1: JSON with "code" field
            jsCode = req.body.code;
        }

        if (!jsCode || jsCode.trim().length === 0) {
            return res.status(400).json({ error: 'No JavaScript code provided. Send as JSON {"code":"..."}, raw text, or multipart file upload.' });
        }

        console.log(`[obfuscate] Received ${jsCode.length} chars of JS code`);

        // Check cache first
        const cachePath = getCachePath(jsCode);
        if (fs.existsSync(cachePath)) {
            const cached = fs.readFileSync(cachePath, 'utf-8');
            console.log(`[obfuscate] Cache hit, returning cached result (${cached.length} chars)`);
            return res.json({ obfuscated: cached, cached: true });
        }
        console.log('[obfuscate] Cache miss, obfuscating...');

        const obfuscatedResult = JavaScriptObfuscator.obfuscate(jsCode, {
            compact: true,
            controlFlowFlattening: true,
            controlFlowFlatteningThreshold: 0.75,
            deadCodeInjection: true,
            deadCodeInjectionThreshold: 0.4,
            debugProtection: false,
            disableConsoleOutput: false,
            identifierNamesGenerator: 'hexadecimal',
            log: false,
            numbersToExpressions: true,
            renameGlobals: true,
            selfDefending: false,
            simplify: true,
            splitStrings: true,
            splitStringsChunkLength: 5,
            stringArray: true,
            stringArrayCallsTransform: true,
            stringArrayCallsTransformThreshold: 0.75,
            stringArrayEncoding: ['base64'],
            stringArrayIndexShift: true,
            stringArrayRotate: true,
            stringArrayShuffle: true,
            stringArrayWrappersCount: 2,
            stringArrayWrappersChainedCalls: true,
            stringArrayWrappersParametersMaxCount: 4,
            stringArrayWrappersType: 'variable',
            stringArrayThreshold: 0.75,
            target: 'node',
            unicodeEscapeSequence: false,
            transformObjectKeys: true,
            reservedStrings: []
        });

        const obfuscatedCode = obfuscatedResult.getObfuscatedCode();
        console.log(`[obfuscate] Obfuscation complete, output ${obfuscatedCode.length} chars`);

        // Save to cache
        fs.writeFileSync(cachePath, obfuscatedCode, 'utf-8');
        console.log(`[obfuscate] Result cached to ${path.basename(cachePath)}`);

        res.json({ obfuscated: obfuscatedCode });
    } catch (error) {
        console.error('[obfuscate] Error:', error.message);
        res.status(500).json({ error: 'Obfuscation failed: ' + error.message });
    }
});

const port = process.env.PORT || 8089;

app.listen(port, '0.0.0.0', () => {
    console.log(`Obfuscate server started on port ${port}`);
});
