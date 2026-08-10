const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const url = require('url');
const compression = require("compression");
const esbuild = require('esbuild');

const app = express();

// Enable CORS to allow OPTIONS method
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    if (req.method === 'OPTIONS') {
        res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS').status(200).send();
        return;
    }
    next();
});

// Compress all routes
app.use(compression());

// Define routes for GET and POST methods
app.get('/remove-iyf-ads', async (req, res) => {
    try {
        // Handle GET request
        await remove_ify_ads(req, res);
    } catch (error) {
        console.error('[remove-iyf-ads] GET error:', error.message);
        return redirectWithDummyParam(req, res);
    }
});

app.post('/remove-iyf-ads', async (req, res) => {
    try {
        // Handle POST request
        await remove_ify_ads(req, res);
    } catch (error) {
        console.error('[remove-iyf-ads] POST error:', error.message);
        return redirectWithDummyParam(req, res);
    }
});

async function remove_ify_ads(req, res) {
    const originalUrl = (req.query && req.query.original_url) || (req.body && req.body.original_url);
    console.log('[remove-iyf-ads] Request received, original_url:', originalUrl);
    if (!originalUrl) {
        console.log('[remove-iyf-ads] No original_url provided, sending empty response');
        return res.status(200).send(); // Send an empty response
    }

    const matchedGroups = originalUrl.match(/main.*\.js(\?.*)?$/);
    if (matchedGroups) {
        res.set("Cache-Control", "public, max-age=2592000"); //Tell browser to cache the file for 30 days
        const jsFileOriginalSubPath = matchedGroups[0];
        const cleanedJsFileName = jsFileOriginalSubPath.replace(/[^a-zA-Z0-9-.]/g, '_');
        const jsFileSaveAbsPathHighObf = path.join(os.tmpdir(), 'remove-iyf-ads', cleanedJsFileName + '.high-obfuscated');
        const jsFileSaveAbsPathSimpleObf = path.join(os.tmpdir(), 'remove-iyf-ads', cleanedJsFileName + '.simple-obfuscated');        
        console.log('[remove-iyf-ads] Cache paths:', jsFileSaveAbsPathHighObf, '/', jsFileSaveAbsPathSimpleObf);
    
        // Check for remote-obfuscated cache first (best quality)
        if (fs.existsSync(jsFileSaveAbsPathHighObf)) {
            console.log('[remove-iyf-ads] Serving cached high-obfuscated file');
            return res.sendFile(jsFileSaveAbsPathHighObf);
        }
    
        // Check for local-esbuild cache
        if (fs.existsSync(jsFileSaveAbsPathSimpleObf)) {
            console.log('[remove-iyf-ads] Found simple-obfuscated cache, trying remote API for high-obfuscated version...');
            // Try to get high-obfuscated version via remote API
            try {
                const originalJsContent = await getJsFileContent(originalUrl);
                let replacedContent = originalJsContent.replace(/e\s*>\s*this\.maxSecond\s*\?\s*this\.stopPlay\(\)/, "e=1000;e>this.maxSecond?this.stopPlay()");
                const obfuscatedCode = await obfuscateViaRemoteApi(replacedContent, 6000);
                // Save high-obfuscated version
                if (!fs.existsSync(path.dirname(jsFileSaveAbsPathHighObf))) {
                    fs.mkdirSync(path.dirname(jsFileSaveAbsPathHighObf), { recursive: true });
                }
                fs.writeFileSync(jsFileSaveAbsPathHighObf, obfuscatedCode);
                console.log('[remove-iyf-ads] High-obfuscated version cached, serving it now');
                return res.sendFile(jsFileSaveAbsPathHighObf);
            } catch (e) {
                console.log('[remove-iyf-ads] Remote API failed (timeout/error), serving simple-obfuscated cached file');
            }
            // Fallback to local-esbuild cached file
            console.log('[remove-iyf-ads] Serving cached simple-obfuscated file');
            return res.sendFile(jsFileSaveAbsPathSimpleObf);
        }
    
        // No cache exists, need to generate
        console.log('[remove-iyf-ads] No cache found, fetching original JS from:', originalUrl);
        const jsFileOriginalContent = await getJsFileContent(originalUrl);
        console.log('[remove-iyf-ads] Original JS fetched, size:', jsFileOriginalContent.length, 'chars');
    
        // Find an expression in the source code like this: e > this.maxSecond ? this.stopPlay()
        let replacedJsFileContent = jsFileOriginalContent.replace(/e\s*>\s*this\.maxSecond\s*\?\s*this\.stopPlay\(\)/, "e=1000;e>this.maxSecond?this.stopPlay()");
        console.log('[remove-iyf-ads] Expression replaced, size:', replacedJsFileContent.length, 'chars');
        let obfuscationMethod = 'simple-obfuscated'; // Track which method was used
    
        // Try to obfuscate via remote API first, fallback to local esbuild minification
        try {
            console.log('[remove-iyf-ads] Trying remote obfuscate API...');
            replacedJsFileContent = await obfuscateViaRemoteApi(replacedJsFileContent, 10000);
            obfuscationMethod = 'high-obfuscated';
            console.log('[remove-iyf-ads] Code obfuscated via remote API (high-obfuscated), size:', replacedJsFileContent.length, 'chars');
        } catch (remoteErr) {
            // Fallback: use local esbuild minification
            console.log('[remove-iyf-ads] Remote API failed (' + remoteErr.message + '), falling back to simple-obfuscated (esbuild)');
            const minifiedResult = await esbuild.transform(replacedJsFileContent, {
                minifyWhitespace: true,      // Remove whitespace
                minifyIdentifiers: true,     // Shorten variable/function names
                minifySyntax: true,          // Simplify syntax
                legalComments: 'none',       // Remove all legal comments
                keepNames: false,            // Allow renaming functions
                target: 'esnext'             // Use latest JS features for better optimization
            });
            replacedJsFileContent = minifiedResult.code;
            console.log('[remove-iyf-ads] Code minified locally (simple-obfuscated), size:', replacedJsFileContent.length, 'chars');
        }
    
        //Create the folder if it doesn't exist because Render may delete my folder from time to time
        if (!fs.existsSync(path.dirname(jsFileSaveAbsPathHighObf))) {
            fs.mkdirSync(path.dirname(jsFileSaveAbsPathHighObf), { recursive: true });
        }
        // Save with appropriate suffix
        const savePath = obfuscationMethod === 'high-obfuscated' ? jsFileSaveAbsPathHighObf : jsFileSaveAbsPathSimpleObf;
        fs.writeFileSync(savePath, replacedJsFileContent);
        console.log('[remove-iyf-ads] File saved as', obfuscationMethod, 'to', savePath);
        return res.sendFile(savePath);
    } else {
        console.log('[remove-iyf-ads] URL did not match expected pattern, redirecting to original URL');
        //This logic shouldn't happen, but if it happens, we redirect to the original URL with a dummy parameter as the current system millisecond 
        // so that the URL will not match with the rule defined in the Chrome extension and hit back our server again.
        const redirectUrl = url.parse(originalUrl, true);
        redirectUrl.query.a_dummy_parameter = String(Date.now())  ;
        return res.redirect(url.format(redirectUrl));
    }
}

// Helper function to obfuscate JS code via remote API with timeout
// Returns the obfuscated code, or throws on failure/timeout
async function obfuscateViaRemoteApi(jsCode, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const obfResponse = await fetch('https://www.multilanes.com/api/obfuscate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': 'obf-sk-a7f3e9b1c4d8462e'
            },
            body: JSON.stringify({ code: jsCode }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!obfResponse.ok) {
            throw new Error(`Remote obfuscate API returned status ${obfResponse.status}`);
        }
        const obfData = await obfResponse.json();
        if (!obfData.obfuscated) {
            throw new Error('Remote obfuscate API returned no obfuscated code');
        }
        return obfData.obfuscated;
    } catch (err) {
        clearTimeout(timeoutId);
        throw err;
    }
}

// Helper function to redirect to original URL with a dummy parameter
// so that the URL will not match with the rule defined in the Chrome extension and hit back our server again.
function redirectWithDummyParam(req, res) {
    const originalUrl = (req.query && req.query.original_url) || (req.body && req.body.original_url);
    if (originalUrl) {
        const redirectUrl = url.parse(originalUrl, true);
        redirectUrl.query.a_dummy_parameter = String(Date.now());
        return res.redirect(url.format(redirectUrl));
    }
    return res.status(200).send();
}

// Helper function to get the original JS file content
async function getJsFileContent(url) {
    try {
        // Define headers
        const headers = {
            'Accept': '*/*',
            'Host': 'www.ify.tv',
            'Referer': 'https://www.iyf.tv/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
        };

        // Send a GET request with headers
        const response = await fetch(url, { headers });

        // Check if request was successful
        if (!response.ok) {
            throw new Error(`Failed to retrieve file from ${url}. Status code: ${response.status}`);
        }

        // Return the response text
        return await response.text();
    } catch (error) {
        console.error(`Failed to retrieve file from ${url}. Error: ${error.message}`);
        throw error;
    }
}


const port = process.env.PORT || 8089

// Track peak memory usage
let peakMemoryUsage = 0;
setInterval(() => {
    const memUsage = process.memoryUsage();
    const rssMB = (memUsage.rss / 1024 / 1024).toFixed(2);
    const heapMB = (memUsage.heapUsed / 1024 / 1024).toFixed(2);
    if (parseFloat(rssMB) > peakMemoryUsage) {
        peakMemoryUsage = parseFloat(rssMB);
        console.log(`[Memory] New peak: ${peakMemoryUsage} MB (heap: ${heapMB} MB)`);
    }
}, 5000); // Check every 5 seconds

app.listen(port, '0.0.0.0', () => {
    console.log(`Server started on port ${port}`);
    const initialMem = (process.memoryUsage().rss / 1024 / 1024).toFixed(2);
    console.log(`[Memory] Initial RSS: ${initialMem} MB`);
});