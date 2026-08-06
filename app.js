const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const url = require('url');
const compression = require("compression");
const JavaScriptObfuscator = require('javascript-obfuscator');

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
        const jsFileSaveAbsPath = path.join(os.tmpdir(), 'remove-iyf-ads', cleanedJsFileName);
        console.log('[remove-iyf-ads] Saving file to:', jsFileSaveAbsPath);
        if (fs.existsSync(jsFileSaveAbsPath)) {
            // The js file already exists in the static files folder
            console.log('[remove-iyf-ads] File already exists, serving cached file');
            return res.sendFile(jsFileSaveAbsPath);
        } else {
            // The js file doesn't exist in the static files folder, so we need to generate it
            console.log('[remove-iyf-ads] File not found, fetching original JS from:', originalUrl);
            const jsFileOriginalContent = await getJsFileContent(originalUrl);
            console.log('[remove-iyf-ads] Original JS fetched, size:', jsFileOriginalContent.length, 'chars');

            // Find an expression in the source code like this: e > this.maxSecond ? this.stopPlay()
            let replacedJsFileContent = jsFileOriginalContent.replace(/e\s*>\s*this.maxSecond\s*\?\s*this.stopPlay\(\)/, "e=1000;e>this.maxSecond?this.stopPlay()");
            console.log('[remove-iyf-ads] Expression replaced, size:', replacedJsFileContent.length, 'chars');
            //Obfuscate the code and then save it
            replacedJsFileContent = JavaScriptObfuscator.obfuscate(replacedJsFileContent, {
                    compact: true,
                    controlFlowFlattening: false,
                    deadCodeInjection: false,
                    stringArray: false,
                    splitStrings: false,
                    renameGlobals: false,
                    simplify: true
            }).getObfuscatedCode();
            console.log('[remove-iyf-ads] Code obfuscated, size:', replacedJsFileContent.length, 'chars');

            //Create the folder if it doesn't exist
            if (!fs.existsSync(path.dirname(jsFileSaveAbsPath))) {
                fs.mkdirSync(path.dirname(jsFileSaveAbsPath), { recursive: true });
            }
            // Save the replaced Javascript code into the /static/js folder
            fs.writeFileSync(jsFileSaveAbsPath, replacedJsFileContent);
            console.log('[remove-iyf-ads] File saved successfully');
            return res.sendFile(jsFileSaveAbsPath);
        }
    } else {
        console.log('[remove-iyf-ads] URL did not match expected pattern, redirecting to original URL');
        //This logic shouldn't happen, but if it happens, we redirect to the original URL with a dummy parameter as the current system millisecond 
        // so that the URL will not match with the rule defined in the Chrome extension and hit back our server again.
        const redirectUrl = url.parse(originalUrl, true);
        redirectUrl.query.a_dummy_parameter = String(Date.now())  ;
        return res.redirect(url.format(redirectUrl));
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
app.listen(port, '0.0.0.0', () => {
    console.log(`Server started on port ${port}`);
});