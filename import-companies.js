#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const SUPABASE_URL = 'https://ampsliudevabkybsbqil.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFtcHNsaXVkZXZhYmt5YnNicWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYzMjE4MTIsImV4cCI6MjA4MTg5NzgxMn0.iZFMR_NheMnFajb_TiW-Gy2dXHgsLpmIgpgJV20RCiM';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function formatSlug(name) {
    return name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function main() {
    const inputFile = process.argv[2] || 'companynames.csv';

    if (!fs.existsSync(inputFile)) {
        console.log('File not found:', inputFile);
        console.log('Usage: node import-companies.js <file.csv>');
        process.exit(1);
    }

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
        process.exit(0);
    }

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

    console.log(`\nDone! Imported ${inserted} companies as 'unchecked'.`);
    console.log('Next step: run "node validate-links.js" to check URLs');
}

main();
