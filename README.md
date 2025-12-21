# LinkChecker

A simple web-based tool for validating and tracking links in bulk.

## Features

- **Bulk Link Validation** - Validate multiple URLs from a CSV file
- **Status Tracking** - Track the status of each link with customizable labels
- **Search & Filter** - Quickly find links by name or filter by status
- **Export** - Export your tracked data to CSV
- **Cloud Sync** - Optional Supabase integration for persistent storage across devices

## Usage

### Web Interface

Open `index.html` in your browser. Import a CSV file containing your links to get started.

For cloud sync, add your Supabase credentials to the configuration section.

### Link Validator Script

```bash
node validate-link.js <input.csv>
```

Validates URLs and outputs results to separate files for valid and invalid links.

## Files

- `index.html` - Main app with Supabase integration
- `link-checker.html` - Standalone version (localStorage only)
- `validate-link.js` - Node.js validation script
