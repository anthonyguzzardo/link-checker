#!/usr/bin/env node

const https = require('https');
const fs = require('fs');

const inputFile = process.argv[2];

if (!inputFile) {
    console.log('Usage: node validate-ashby.js <file.csv>');
    process.exit(1);
}

if (!fs.existsSync(inputFile)) {
    console.log('ERROR: File not found:', inputFile);
    process.exit(1);
}

const text = fs.readFileSync(inputFile, 'utf-8');
console.log('Read', text.length, 'bytes');

const names = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

console.log('Found', names.length, 'companies\n');

if (names.length === 0) {
    console.log('No companies found!');
    process.exit(1);
}

console.log('First 3:', names.slice(0, 3).join(', '), '\n');

function formatCompanyName(name) {
    return name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function checkUrl(name) {
    return new Promise((resolve) => {
        const formatted = formatCompanyName(name);
        const url = `https://jobs.ashbyhq.com/${formatted}`;
        
        const req = https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                // Check for "organization":null in __appData - this means no job board exists
                const noPage = data.includes('"organization":null') || 
                               data.includes('"jobBoard":null');
                resolve({ name, url, valid: !noPage });
            });
        });
        
        req.on('error', (err) => {
            resolve({ name, url, valid: null, error: err.message });
        });
        
        req.setTimeout(10000, () => {
            req.destroy();
            resolve({ name, url, valid: null, error: 'timeout' });
        });
    });
}

async function main() {
    const valid = [];
    const invalid = [];

    for (let i = 0; i < names.length; i += 5) {
        const batch = names.slice(i, i + 5);
        const results = await Promise.all(batch.map(checkUrl));
        
        for (const r of results) {
            if (r.valid === true) {
                valid.push(r);
                console.log('✓', r.name);
            } else if (r.valid === false) {
                invalid.push(r);
                console.log('✗', r.name);
            } else {
                console.log('?', r.name, r.error);
            }
        }
        
        console.log(`[${Math.min(i + 5, names.length)}/${names.length}]\n`);
        await new Promise(r => setTimeout(r, 200));
    }

    console.log('\n========================================');
    console.log('VALID:', valid.length);
    console.log('NO PAGE:', invalid.length);
    console.log('========================================\n');

    fs.writeFileSync('ashby-valid.csv', 'Company,URL\n' + valid.map(r => `"${r.name}","${r.url}"`).join('\n'));
    fs.writeFileSync('ashby-no-page.txt', invalid.map(r => r.name).join('\n'));
    
    console.log('Saved: ashby-valid.csv');
    console.log('Saved: ashby-no-page.txt');
}

main();