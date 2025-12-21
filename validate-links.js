#!/usr/bin/env node

const https = require('https');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ampsliudevabkybsbqil.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFtcHNsaXVkZXZhYmt5YnNicWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYzMjE4MTIsImV4cCI6MjA4MTg5NzgxMn0.iZFMR_NheMnFajb_TiW-Gy2dXHgsLpmIgpgJV20RCiM';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function checkUrl(url) {
    return new Promise((resolve) => {
        const req = https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                // Check for "organization":null - means no job board exists
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

async function main() {
    // Get all unchecked companies
    console.log('Fetching unchecked companies...\n');

    const { data: companies, error } = await supabase
        .from('companies')
        .select('id, name, slug, url')
        .eq('link_status', 'unchecked')
        .order('name');

    if (error) {
        console.error('Fetch error:', error);
        process.exit(1);
    }

    if (!companies || companies.length === 0) {
        console.log('No unchecked companies found.');
        console.log('All companies have been validated.');
        process.exit(0);
    }

    console.log(`Found ${companies.length} unchecked companies\n`);

    let activeCount = 0;
    let deadCount = 0;

    // Process in batches of 5 for rate limiting
    for (let i = 0; i < companies.length; i += 5) {
        const batch = companies.slice(i, i + 5);

        const results = await Promise.all(
            batch.map(async (company) => {
                const linkStatus = await checkUrl(company.url);
                return { ...company, linkStatus };
            })
        );

        // Update each company in Supabase
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

        // Rate limit delay
        await new Promise(r => setTimeout(r, 200));
    }

    console.log('\n========================================');
    console.log('ACTIVE:', activeCount);
    console.log('DEAD:', deadCount);
    console.log('========================================\n');
    console.log('Done! Database updated with link statuses.');
}

main();
