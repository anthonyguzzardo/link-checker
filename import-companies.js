#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
const https = require('https');
const fs = require('fs');

const SUPABASE_URL = 'https://ampsliudevabkybsbqil.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFtcHNsaXVkZXZhYmt5YnNicWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYzMjE4MTIsImV4cCI6MjA4MTg5NzgxMn0.iZFMR_NheMnFajb_TiW-Gy2dXHgsLpmIgpgJV20RCiM';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function formatSlug(name) {
    return name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function checkUrl(url) {
    return new Promise((resolve) => {
        const req = https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const noPage = data.includes('"organization":null') ||
                               data.includes('"jobBoard":null');
                resolve(noPage ? 'dead' : 'active');
            });
        });

        req.on('error', () => resolve('dead'));
        req.setTimeout(10000, () => {
            req.destroy();
            resolve('dead');
        });
    });
}

async function validateUnchecked() {
    console.log('\n--- Validating unchecked companies ---\n');

    const { data: companies, error } = await supabase
        .from('companies')
        .select('id, name, slug, url')
        .eq('link_status', 'unchecked')
        .order('name');

    if (error) {
        console.error('Fetch error:', error);
        return;
    }

    if (!companies || companies.length === 0) {
        console.log('No unchecked companies to validate.');
        return;
    }

    console.log(`Found ${companies.length} unchecked companies\n`);

    let activeCount = 0;
    let deadCount = 0;

    for (let i = 0; i < companies.length; i += 5) {
        const batch = companies.slice(i, i + 5);

        const results = await Promise.all(
            batch.map(async (company) => {
                const linkStatus = await checkUrl(company.url);
                return { ...company, linkStatus };
            })
        );

        for (const result of results) {
            const { error: updateError } = await supabase
                .from('companies')
                .update({ link_status: result.linkStatus })
                .eq('id', result.id);

            if (updateError) {
                console.error('Update error for', result.name, updateError);
            }

            if (result.linkStatus === 'active') {
                activeCount++;
                console.log('✓', result.name);
            } else {
                deadCount++;
                console.log('✗', result.name);
            }
        }

        console.log(`[${Math.min(i + 5, companies.length)}/${companies.length}]\n`);
        await new Promise(r => setTimeout(r, 200));
    }

    console.log('========================================');
    console.log('ACTIVE:', activeCount);
    console.log('DEAD:', deadCount);
    console.log('========================================\n');
}

async function main() {
    const CSV_DIR = './csv';
    let inputFile = process.argv[2];

    // If no file specified, process all CSVs in the csv folder
    if (!inputFile) {
        const csvFiles = fs.readdirSync(CSV_DIR).filter(f => f.endsWith('.csv'));
        if (csvFiles.length === 0) {
            console.log('No CSV files found in', CSV_DIR);
            console.log('Drop your company list CSVs into the csv/ folder and run again.');
            process.exit(1);
        }
        console.log(`Found ${csvFiles.length} CSV file(s) in ${CSV_DIR}/\n`);

        // Process each CSV file
        for (const file of csvFiles) {
            console.log(`\n=== Processing ${file} ===\n`);
            await processCSV(`${CSV_DIR}/${file}`);
        }

        // Validate all unchecked after processing all files
        await validateUnchecked();
        console.log('Done! Active companies are now visible in the UI.');
        return;
    }

    // If file specified, check csv/ folder first, then current dir
    if (!fs.existsSync(inputFile)) {
        const inCsvDir = `${CSV_DIR}/${inputFile}`;
        if (fs.existsSync(inCsvDir)) {
            inputFile = inCsvDir;
        } else {
            console.log('File not found:', inputFile);
            console.log('Usage: node import-companies.js [file.csv]');
            console.log('Or drop CSVs into csv/ folder and run without arguments.');
            process.exit(1);
        }
    }

    await processCSV(inputFile);
    await validateUnchecked();
    console.log('Done! Active companies are now visible in the UI.');
}

async function processCSV(inputFile) {

    const text = fs.readFileSync(inputFile, 'utf-8');
    const lines = text.split('\n');

    // Parse company names
    const companies = [];
    const seen = new Set();

    for (const line of lines) {
        let name = line.trim();
        if (!name || name.length < 2) continue;

        // Skip header row if present
        if (name.toLowerCase() === 'company' || name.toLowerCase().includes('company name')) continue;

        // Handle quoted values
        if (name.startsWith('"') && name.includes('",')) {
            name = name.match(/^"([^"]+)"/)?.[1] || name;
        }
        name = name.replace(/^["']|["']$/g, '').trim();

        const slug = formatSlug(name);

        // Skip duplicates
        if (seen.has(slug)) continue;
        seen.add(slug);

        companies.push({
            name: name,
            slug: slug,
            url: `https://jobs.ashbyhq.com/${slug}`,
            status: 'unvisited',
            visited: false,
            link_status: 'unchecked'
        });
    }

    console.log(`Parsed ${companies.length} unique companies from ${inputFile}`);

    // Check how many already exist in DB
    const { data: existing, error: fetchError } = await supabase
        .from('companies')
        .select('slug');

    if (fetchError) {
        console.error('Error fetching existing:', fetchError);
        process.exit(1);
    }

    const existingSlugs = new Set(existing?.map(c => c.slug) || []);
    const newCompanies = companies.filter(c => !existingSlugs.has(c.slug));

    console.log(`Found ${existingSlugs.size} existing companies in DB`);
    console.log(`Inserting ${newCompanies.length} new companies...`);

    if (newCompanies.length === 0) {
        console.log('No new companies to import.');
    } else {
        // Insert in batches of 100
        const batchSize = 100;
        let inserted = 0;

        for (let i = 0; i < newCompanies.length; i += batchSize) {
            const batch = newCompanies.slice(i, i + batchSize);
            const { error } = await supabase
                .from('companies')
                .insert(batch);

            if (error) {
                console.error('Insert error:', error);
                console.error('Failed at batch starting index:', i);
            } else {
                inserted += batch.length;
                console.log(`Inserted ${inserted}/${newCompanies.length}`);
            }
        }

        console.log(`\nImported ${inserted} companies.`);
    }
}

main();
