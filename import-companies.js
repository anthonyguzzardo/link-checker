#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
const https = require('https');
const fs = require('fs');

const SUPABASE_URL = 'https://ampsliudevabkybsbqil.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFtcHNsaXVkZXZhYmt5YnNicWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYzMjE4MTIsImV4cCI6MjA4MTg5NzgxMn0.iZFMR_NheMnFajb_TiW-Gy2dXHgsLpmIgpgJV20RCiM';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const RETRIES = 3;
const TIMEOUT_MS = 10000;

// ============================================================================
// Slug Variants
// ============================================================================

function generateSlugVariants(name) {
    const base = name
        .toLowerCase()
        .replace(/\b(inc|llc|ltd|corp|company|co)\b\.?/g, '')
        .replace(/[^a-z0-9.-]/g, '')
        .replace(/^[.-]+|[.-]+$/g, '');

    if (!base) return [];

    const variants = new Set();
    
    // 1. Base as-is (jerry.ai, gamechanger, finnihealth)
    variants.add(base);
    
    // 2. Collapsed - no dots or hyphens (jerryai)
    const collapsed = base.replace(/[.-]/g, '');
    if (collapsed) variants.add(collapsed);
    
    // 3. Split into tokens
    const tokens = base.split(/[.-]+/).filter(Boolean);
    
    // 4. First token (jerry, game, finni)
    if (tokens[0]) variants.add(tokens[0]);
    
    // 5. First two tokens collapsed (jerryai)
    if (tokens.length >= 2) {
        variants.add(tokens[0] + tokens[1]);
    }
    
    // 6. Hyphenated (jerry-ai, game-changer, finni-health)
    if (tokens.length >= 2) {
        variants.add(tokens.join('-'));
    }
    
    // 7. Strip trailing 'ai' (but not .ai TLD, and not if it leaves garbage)
    for (const v of [...variants]) {
        if (v.endsWith('ai') && !v.endsWith('.ai') && v.length > 3) {
            const stripped = v.slice(0, -2).replace(/[.-]+$/, '');
            if (stripped) variants.add(stripped);
        }
    }

    return [...variants];
}

// ============================================================================
// HTTP
// ============================================================================

function httpGet(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        req.setTimeout(TIMEOUT_MS, () => {
            req.destroy();
            reject(new Error('timeout'));
        });
    });
}

async function checkUrl(slug) {
    const url = `https://jobs.ashbyhq.com/${slug}`;
    
    for (let attempt = 1; attempt <= RETRIES; attempt++) {
        try {
            const res = await httpGet(url);
            
            if (res.status !== 200) return false;
            if (res.body.includes('"organization":null')) return false;
            if (res.body.includes('"jobBoard":null')) return false;
            
            return true;
        } catch (err) {
            if (attempt === RETRIES) return false;
            await sleep(1000 * attempt);
        }
    }
    return false;
}

// ============================================================================
// Process ONE company - the whole thing
// ============================================================================

async function processOneCompany(name, existingSlugs) {
    const variants = generateSlugVariants(name);
    
    console.log(`\n[${name}]`);
    console.log(`  Variants: ${variants.join(', ')}`);
    
    // Try each variant
    for (const slug of variants) {
        // Already in DB?
        if (existingSlugs.has(slug)) {
            console.log(`  ${slug} → SKIP (already in DB)`);
            return { status: 'skipped', slug, reason: 'exists' };
        }
        
        // Check URL
        console.log(`  ${slug} → checking...`);
        const works = await checkUrl(slug);
        
        if (works) {
            console.log(`  ${slug} → FOUND ✓`);
            
            // Insert immediately
            const { error } = await supabase.from('companies').insert({
                name: name,
                slug: slug,
                url: `https://jobs.ashbyhq.com/${slug}`,
                status: 'unvisited',
                visited: false,
                link_status: 'active',
            });
            
            if (error) {
                console.log(`  INSERT FAILED: ${error.message}`);
                return { status: 'error', slug, reason: error.message };
            }
            
            console.log(`  INSERTED ✓`);
            existingSlugs.add(slug); // Track it
            return { status: 'active', slug };
        } else {
            console.log(`  ${slug} → nope`);
        }
    }
    
    console.log(`  NO WORKING URL ✗`);
    return { status: 'dead', slug: variants[0] };
}

// ============================================================================
// Main
// ============================================================================

const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseCSV(filePath) {
    const text = fs.readFileSync(filePath, 'utf-8');
    const names = [];

    for (const line of text.split('\n')) {
        let name = line.trim();
        if (!name || name.length < 2) continue;
        if (/^company(\s*name)?$/i.test(name)) continue;

        // Handle quoted values
        const quoted = name.match(/^"([^"]+)"/);
        if (quoted) {
            name = quoted[1];
        } else {
            name = name.split(',')[0];
        }
        
        name = name.replace(/^["']|["']$/g, '').trim();
        if (name && name.length >= 2) names.push(name);
    }

    return names;
}

async function main() {
    const CSV_DIR = './csv';
    
    // Load existing slugs
    console.log('Loading existing companies from DB...');
    const { data: existing, error } = await supabase.from('companies').select('slug');
    if (error) {
        console.error('DB error:', error.message);
        process.exit(1);
    }
    const existingSlugs = new Set(existing?.map(c => c.slug) || []);
    console.log(`Found ${existingSlugs.size} existing companies\n`);

    // Get CSV files
    let files = process.argv.slice(2);
    if (files.length === 0) {
        if (!fs.existsSync(CSV_DIR)) {
            fs.mkdirSync(CSV_DIR);
            console.log(`Created ${CSV_DIR}/ - drop CSVs there and run again.`);
            process.exit(0);
        }
        files = fs.readdirSync(CSV_DIR)
            .filter(f => f.endsWith('.csv'))
            .map(f => `${CSV_DIR}/${f}`);
    }

    if (files.length === 0) {
        console.log('No CSV files found.');
        process.exit(0);
    }

    // Process each file
    const totals = { active: 0, dead: 0, skipped: 0, error: 0 };

    for (const file of files) {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`FILE: ${file}`);
        console.log('='.repeat(50));

        const names = parseCSV(file);
        console.log(`Parsed ${names.length} company names`);

        for (let i = 0; i < names.length; i++) {
            const name = names[i];
            console.log(`\n--- ${i + 1}/${names.length} ---`);
            
            const result = await processOneCompany(name, existingSlugs);
            totals[result.status]++;
            
            // Small delay between companies
            await sleep(100);
        }
    }

    // Summary
    console.log(`\n${'='.repeat(50)}`);
    console.log('DONE');
    console.log('='.repeat(50));
    console.log(`  Active:  ${totals.active}`);
    console.log(`  Dead:    ${totals.dead}`);
    console.log(`  Skipped: ${totals.skipped}`);
    console.log(`  Errors:  ${totals.error}`);
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});