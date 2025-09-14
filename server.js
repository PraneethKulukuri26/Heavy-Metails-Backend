

// Heavy Metals Data API Server
// Provides endpoints:
// GET /api/health -> {status:"ok"}
// GET /api/states -> ["Andaman & Nicobar Islands", ...]
// GET /api/state/:state -> filtered rows for that state
// GET /api/data?state=Name -> same as above (query variant)
// CSV columns: State,District,Location,Longitude,Latitude,Cd,Cr,Cu,Pb,Mn,Ni,Fe,Zn

const express = require('express');
const path = require('path');
const fs = require('fs');
const { parse } = require('csv-parse');

// Add uuid for unique file ids
let uuidv4;
try {
	({ v4: uuidv4 } = require('uuid'));
} catch (e) {
	// uuid not installed yet
}

const DATA_FILE = path.join(__dirname, 'data', 'heavy_metails_data.csv');

// Simple in-memory cache (loaded once at first request)
let cache = {
	rows: null,
	states: null,
	loadedAt: null
};

async function loadCsvIfNeeded() {
	if (cache.rows) return cache.rows;
	const fileExists = fs.existsSync(DATA_FILE);
	if (!fileExists) throw new Error('Data file missing: ' + DATA_FILE);

	const fileContent = await fs.promises.readFile(DATA_FILE, 'utf-8');
	return new Promise((resolve, reject) => {
		parse(fileContent, { columns: true, trim: true }, (err, records) => {
			if (err) return reject(err);
			cache.rows = records;
			// Pre-compute unique states (case-sensitive as in file)
			const stateSet = new Set();
			for (const r of records) {
				if (r.State) stateSet.add(r.State);
			}
			cache.states = Array.from(stateSet).sort((a,b)=> a.localeCompare(b));
			cache.loadedAt = new Date();
			resolve(records);
		});
	});
}

function filterByState(rows, stateQuery) {
	if (!stateQuery) return [];
	const target = stateQuery.toLowerCase();
	return rows.filter(r => (r.State || '').toLowerCase() === target);
}

const cors = require('cors');
const app = express();

// Allow CORS for frontend on localhost:5173
app.use(cors({
	origin: 'http://localhost:5173',
	credentials: true
}));

app.use(express.json()); // for parsing application/json

app.get('/api/health', (_req, res) => {
	res.json({ status: 'ok', loaded: !!cache.rows, rows: cache.rows ? cache.rows.length : 0 });
});

app.get('/api/states', async (_req, res) => {
	try {
		await loadCsvIfNeeded();
		res.json(cache.states);
	} catch (e) {
		res.status(500).json({ error: 'Failed to load data', details: e.message });
	}
});

// Query variant: /api/data?state=Gujarat
app.get('/api/data', async (req, res) => {
	const { state } = req.query;
	if (!state) return res.status(400).json({ error: 'Missing required query parameter: state' });
	try {
		const rows = await loadCsvIfNeeded();
		const matches = filterByState(rows, String(state));
		if (!matches.length) return res.status(404).json({ error: 'State not found', state });
		res.json({ state, count: matches.length, rows: matches });
	} catch (e) {
		res.status(500).json({ error: 'Failed to load data', details: e.message });
	}
});

// Path variant: /api/state/Andaman%20%26%20Nicobar%20Islands
app.get('/api/state/:state', async (req, res) => {
	const stateParam = req.params.state;
	try {
		const rows = await loadCsvIfNeeded();
		const matches = filterByState(rows, stateParam);
		if (!matches.length) return res.status(404).json({ error: 'State not found', state: stateParam });
		res.json({ state: stateParam, count: matches.length, rows: matches });
	} catch (e) {
		res.status(500).json({ error: 'Failed to load data', details: e.message });
	}
});

// Basic root message
app.get('/', (_req, res) => {
	res.send('Heavy Metals Data API. See /api/health, /api/states, /api/data?state=NAME');
});

// POST /api/report
// Payload: { "user_d": ... , "user_id": ... }
// Stores as CSV in data_reports/ with unique id, returns { id, filename, path }
// Also appends the report id to user's reports_submitted in Supabase
const supabase = require('./supabaseClient');
const multer = require('multer');
const upload = multer({ dest: path.join(__dirname, 'data_reports', 'tmp') });

// POST /api/report (multipart/form-data)
// Fields: user_id (string), file (CSV upload), title (string), message (string, optional)
app.post('/api/report', upload.single('file'), async (req, res) => {
	const userId = req.body.user_id;
	const title = req.body.title;
	const message = req.body.message || '';
	if (!userId) {
		return res.status(400).json({ error: "Missing 'user_id' in form data" });
	}
	if (!title) {
		return res.status(400).json({ error: "Missing 'title' in form data" });
	}
	if (!req.file) {
		return res.status(400).json({ error: "Missing CSV file in form data (field name: 'file')" });
	}
	// Generate unique filename
	let id = uuidv4 ? uuidv4() : String(Date.now());
	const filename = `report_${id}.csv`;
	const outPath = path.join(__dirname, 'data_reports', filename);
	const submitted_at = new Date().toISOString();
	const updated_at = submitted_at;
	const status = 'submitted';
	try {
		// Move uploaded file to final location
		await fs.promises.rename(req.file.path, outPath);
		// Insert report record in Supabase (assumes a 'reports' table)
		let supabaseError = null;
		let supabaseData = null;
		// Insert new report row
		const { data: reportData, error: reportErr } = await supabase
			.from('reports')
			.insert([
				{
					id,
					user_id: userId,
					title,
					filename,
					path: `data_reports/${filename}`,
					status,
					message,
					submitted_at,
					updated_at
				}
			])
			.select();
		if (reportErr) {
			supabaseError = reportErr.message;
		} else {
			supabaseData = reportData;
			// Update user's reports_submitted array
			const { data: user, error: fetchErr } = await supabase
				.from('users')
				.select('reports_submitted')
				.eq('id', userId)
				.single();
			if (fetchErr) {
				supabaseError = fetchErr.message;
			} else {
				let reports = Array.isArray(user.reports_submitted) ? user.reports_submitted : [];
				reports.push(id);
				const { error: updateErr, data: updateData } = await supabase
					.from('users')
					.update({ reports_submitted: reports })
					.eq('id', userId);
				if (updateErr) {
					supabaseError = updateErr.message;
				} else {
					supabaseData = { report: reportData, user: updateData };
				}
			}
		}
		res.json({ id, filename, path: `data_reports/${filename}`, status, title, message, submitted_at, updated_at, supabaseError, supabaseData });
	} catch (e) {
		// Clean up temp file if error
		if (req.file && req.file.path && fs.existsSync(req.file.path)) {
			fs.unlinkSync(req.file.path);
		}
		res.status(500).json({ error: 'Failed to save file or update Supabase', details: e.message });
	}
});

// GET /api/user/:user_id/recent-reports
// Returns up to 4 most recent reports for a user (ordered by submitted_at desc)
app.get('/api/user/:user_id/recent-reports', async (req, res) => {
	const userId = req.params.user_id;
	if (!userId) {
		return res.status(400).json({ error: 'Missing user_id in path' });
	}
	try {
		const { data, error } = await supabase
			.from('reports')
			.select('*')
			.eq('user_id', userId)
			.order('submitted_at', { ascending: false })
			.limit(4);
		if (error) {
			return res.status(500).json({ error: 'Failed to fetch user recent reports', details: error.message });
		}
		res.json({ count: data.length, reports: data });
	} catch (e) {
		res.status(500).json({ error: 'Failed to fetch user recent reports', details: e.message });
	}
});
// GET /api/recent-reports
// Returns up to 4 most recent submitted reports (ordered by submitted_at desc)
app.get('/api/recent-reports', async (_req, res) => {
	try {
		const { data, error } = await supabase
			.from('reports')
			.select('*')
			.order('submitted_at', { ascending: false })
			.limit(4);
		if (error) {
			return res.status(500).json({ error: 'Failed to fetch recent reports', details: error.message });
		}
		res.json({ count: data.length, reports: data });
	} catch (e) {
		res.status(500).json({ error: 'Failed to fetch recent reports', details: e.message });
	}
});

// GET /api/reports/approved
// Returns all reports with status 'approved'
app.get('/api/reports/approved', async (_req, res) => {
	try {
		const { data, error } = await supabase
			.from('reports')
			.select('*')
			.eq('status', 'approved')
			.order('submitted_at', { ascending: false });
		if (error) {
			return res.status(500).json({ error: 'Failed to fetch approved reports', details: error.message });
		}

        console.log(`Fetched ${data.length} approved reports`);
		res.json({ reports: data });
	} catch (e) {
		res.status(500).json({ error: 'Failed to fetch approved reports', details: e.message });
	}
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`Heavy Metals Data API listening on port ${PORT}`);
});

module.exports = app;
