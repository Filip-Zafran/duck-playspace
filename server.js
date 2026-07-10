import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import multer from 'multer';
import XLSX from 'xlsx';
import { initializeDatabase, getPool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static('public'));

app.use(session({
  secret: 'duck',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 3600000 }
}));

// Initialize database on startup
try {
  await initializeDatabase();
} catch (error) {
  console.error('Failed to initialize database:', error);
  process.exit(1);
}

// Auth middleware
function requireAuth(req, res, next) {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Keep-alive ping endpoint (prevents Render.com free tier spin-down)
app.get('/ping', (req, res) => {
  res.json({ status: 'alive', timestamp: new Date().toISOString() });
});

// ===== Original Auth Routes =====

app.get('/', (req, res) => {
  if (req.session.authenticated) {
    res.redirect('/home');
  } else {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
  }
});

app.post('/login', (req, res) => {
  const { password } = req.body;

  if (password === 'duck') {
    req.session.authenticated = true;
    res.json({ success: true });
  } else {
    res.json({ success: false, message: 'Incorrect password' });
  }
});

app.get('/home', (req, res) => {
  if (!req.session.authenticated) {
    res.redirect('/');
  } else {
    res.sendFile(path.join(__dirname, 'public', 'home.html'));
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      res.json({ success: false });
    } else {
      res.json({ success: true });
    }
  });
});

// ===== Poll Pages =====

app.get('/poll', (req, res) => {
  const { admin } = req.query;
  if (admin) {
    // Admin dashboard with token
    res.sendFile(path.join(__dirname, 'public', 'poll.html'));
  } else if (req.session.authenticated) {
    // Regular authenticated user accessing admin
    res.sendFile(path.join(__dirname, 'public', 'poll.html'));
  } else {
    res.redirect('/');
  }
});

app.get('/poll-vote', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'poll-vote.html'));
});

app.get('/poll-results', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'poll-results.html'));
});

app.get('/upload-data', (req, res) => {
  if (!req.session.authenticated) {
    res.redirect('/');
  } else {
    res.sendFile(path.join(__dirname, 'public', 'upload-data.html'));
  }
});

app.get('/dashboard', (req, res) => {
  if (!req.session.authenticated) {
    res.redirect('/');
  } else {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
  }
});

// ===== File Upload Config =====
const upload = multer({ storage: multer.memoryStorage() });

// ===== API: Polls =====

app.post('/api/polls', requireAuth, async (req, res) => {
  try {
    const { title, description, duration, expected, location, date1, date2, date3, time1, time2, time3, timer_minutes, about_section, participation_section, important_section, faq_link, faq_title } = req.body;

    // Validate dates
    if (new Date(date1) >= new Date(date2) || new Date(date2) >= new Date(date3)) {
      return res.status(400).json({ error: 'Dates must be in chronological order' });
    }

    const pollId = uuidv4();
    const adminToken = crypto.randomBytes(16).toString('hex');

    let timerEnd = null;
    if (timer_minutes && timer_minutes > 0) {
      timerEnd = new Date(Date.now() + timer_minutes * 60000);
    }

    const pool = getPool();
    await pool.query(
      `INSERT INTO polls (id, admin_token, title, description, duration, expected, location, date1, time1, date2, time2, date3, time3, timer_end, about_section, participation_section, important_section, faq_link, faq_title)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [pollId, adminToken, title, description || 'Join us for an exciting event...', duration, expected || 8, location || null,
       date1, time1 || null, date2, time2 || null, date3, time3 || null, timerEnd, about_section || null, participation_section || null, important_section || null, faq_link || null, faq_title || 'Read the FAQs']
    );

    const origin = `${req.protocol}://${req.get('host')}`;
    res.json({
      id: pollId,
      admin_token: adminToken,
      vote_url: `${origin}/poll-vote?token=${pollId}`,
      admin_url: `${origin}/poll?admin=${adminToken}`,
      results_url: `${origin}/poll-results?token=${pollId}`
    });
  } catch (error) {
    console.error('Error creating poll:', error);
    res.status(500).json({ error: 'Failed to create poll' });
  }
});

app.get('/api/polls', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const pollsResult = await pool.query('SELECT * FROM polls ORDER BY created_at DESC');

    const pollsWithVotes = await Promise.all(pollsResult.rows.map(async (poll) => {
      const votesResult = await pool.query(
        'SELECT choice, COUNT(*) as count FROM votes WHERE poll_id = $1 GROUP BY choice',
        [poll.id]
      );

      const counts = { date1: 0, date2: 0, date3: 0, none: 0 };
      let totalVotes = 0;
      votesResult.rows.forEach(row => {
        counts[row.choice] = parseInt(row.count);
        totalVotes += parseInt(row.count);
      });

      return {
        ...poll,
        votes: totalVotes,
        counts
      };
    }));

    res.json(pollsWithVotes);
  } catch (error) {
    console.error('Error fetching polls:', error);
    res.status(500).json({ error: 'Failed to fetch polls' });
  }
});

app.get('/api/polls/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getPool();

    const pollResult = await pool.query('SELECT * FROM polls WHERE id = $1', [id]);
    if (pollResult.rows.length === 0) {
      return res.status(404).json({ error: 'Poll not found' });
    }

    const votesResult = await pool.query(
      `SELECT voter_name, choice FROM votes WHERE poll_id = $1
       ORDER BY submitted_at DESC LIMIT 20`,
      [id]
    );

    const countsResult = await pool.query(
      'SELECT choice, COUNT(*) as count FROM votes WHERE poll_id = $1 GROUP BY choice',
      [id]
    );

    const counts = { date1: 0, date2: 0, date3: 0, none: 0 };
    countsResult.rows.forEach(row => {
      counts[row.choice] = parseInt(row.count);
    });

    const previews = votesResult.rows.map(vote => ({
      initials: vote.voter_name ? vote.voter_name.substring(0, 2).toUpperCase() : '?',
      choice: vote.choice
    }));

    res.json({ counts, previews });
  } catch (error) {
    console.error('Error fetching poll details:', error);
    res.status(500).json({ error: 'Failed to fetch poll' });
  }
});

app.get('/api/polls/:id/votes', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getPool();

    const pollResult = await pool.query('SELECT * FROM polls WHERE id = $1', [id]);
    if (pollResult.rows.length === 0) {
      return res.status(404).json({ error: 'Poll not found' });
    }

    const votesResult = await pool.query(
      `SELECT voter_name, voter_email, choice, location_choice, submitted_at FROM votes WHERE poll_id = $1
       ORDER BY submitted_at DESC`,
      [id]
    );

    res.json({ votes: votesResult.rows });
  } catch (error) {
    console.error('Error fetching poll votes:', error);
    res.status(500).json({ error: 'Failed to fetch votes' });
  }
});

app.delete('/api/polls/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getPool();

    await pool.query('DELETE FROM polls WHERE id = $1', [id]);
    res.json({ id, message: 'Poll deleted successfully' });
  } catch (error) {
    console.error('Error deleting poll:', error);
    res.status(500).json({ error: 'Failed to delete poll' });
  }
});

// ===== API: Voting =====

app.get('/api/vote/:pollId', async (req, res) => {
  try {
    const { pollId } = req.params;
    const pool = getPool();

    const pollResult = await pool.query('SELECT * FROM polls WHERE id = $1', [pollId]);
    if (pollResult.rows.length === 0) {
      return res.status(404).json({ error: 'Poll not found' });
    }

    const poll = pollResult.rows[0];

    const votesResult = await pool.query(
      `SELECT voter_name, choice FROM votes WHERE poll_id = $1
       ORDER BY submitted_at DESC LIMIT 20`,
      [pollId]
    );

    const countsResult = await pool.query(
      'SELECT choice, COUNT(*) as count FROM votes WHERE poll_id = $1 GROUP BY choice',
      [pollId]
    );

    const counts = { date1: 0, date2: 0, date3: 0, none: 0 };
    countsResult.rows.forEach(row => {
      counts[row.choice] = parseInt(row.count);
    });

    const previews = votesResult.rows.map(vote => ({
      initials: vote.voter_name ? vote.voter_name.substring(0, 2).toUpperCase() : '?',
      choice: vote.choice
    }));

    res.json({
      title: poll.title,
      description: poll.description,
      duration: poll.duration,
      expected: poll.expected,
      date1: poll.date1,
      time1: poll.time1,
      date2: poll.date2,
      time2: poll.time2,
      date3: poll.date3,
      time3: poll.time3,
      timer_end: poll.timer_end,
      location: poll.location,
      about_section: poll.about_section,
      participation_section: poll.participation_section,
      important_section: poll.important_section,
      faq_link: poll.faq_link,
      faq_title: poll.faq_title,
      counts,
      previews
    });
  } catch (error) {
    console.error('Error fetching poll for voting:', error);
    res.status(500).json({ error: 'Failed to fetch poll' });
  }
});

app.post('/api/vote/:pollId', async (req, res) => {
  try {
    const { pollId } = req.params;
    const { voter_name, voter_email, choices, location_choice } = req.body;

    if (!Array.isArray(choices) || choices.length === 0) {
      return res.status(400).json({ error: 'At least one choice is required' });
    }

    const validChoices = ['date1', 'date2', 'date3', 'none'];
    if (!choices.every(choice => validChoices.includes(choice))) {
      return res.status(400).json({ error: 'Invalid choice(s)' });
    }

    const pool = getPool();
    const pollResult = await pool.query('SELECT * FROM polls WHERE id = $1', [pollId]);
    if (pollResult.rows.length === 0) {
      return res.status(404).json({ error: 'Poll not found' });
    }

    const poll = pollResult.rows[0];
    if (poll.timer_end && new Date() > new Date(poll.timer_end)) {
      return res.status(400).json({ error: 'Voting has ended' });
    }

    for (const choice of choices) {
      await pool.query(
        'INSERT INTO votes (poll_id, voter_name, voter_email, choice, location_choice) VALUES ($1, $2, $3, $4, $5)',
        [pollId, voter_name || 'Anonymous', voter_email || null, choice, location_choice || null]
      );
    }

    res.json({ message: 'Vote recorded' });
  } catch (error) {
    console.error('Error recording vote:', error);
    res.status(500).json({ error: 'Failed to record vote' });
  }
});

// ===== API: Upload Data =====
app.post('/api/upload-data', requireAuth, upload.single('file'), async (req, res) => {
  try {
    console.log('1. File received');
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // Parse Excel file with all rows
    console.log(`Parsing file: ${req.file.originalname}`);

    const workbook = XLSX.read(req.file.buffer, {
      type: 'buffer',
      defval: '',
      raw: false
    });

    const sheetName = workbook.SheetNames[0];
    console.log(`Sheet name: ${sheetName}`);

    const worksheet = workbook.Sheets[sheetName];
    console.log(`Worksheet range: ${worksheet['!ref']}`);

    // Ensure we read ALL rows by explicitly setting range
    let range = worksheet['!ref'];
    if (!range) {
      console.error('No range found in worksheet');
      return res.status(400).json({ error: 'Unable to determine worksheet range' });
    }

    // Extract row count from range (e.g., "A1:Z1000" -> 1000)
    const rangeParts = range.split(':');
    const endCell = rangeParts[1];
    const rowMatch = endCell.match(/\d+/);
    const totalRowsInSheet = rowMatch ? parseInt(rowMatch[0]) : 0;
    console.log(`Total rows in sheet: ${totalRowsInSheet}`);

    // Alternative: Read cells directly from worksheet
    function readAllRows(ws) {
      const result = [];
      if (!ws['!ref']) return result;

      const range = XLSX.utils.decode_range(ws['!ref']);
      console.log(`Decoded range: ${JSON.stringify(range)}`);

      // Get headers from first row
      const headers = [];
      for (let C = range.s.c; C <= range.e.c; C++) {
        const cell = ws[XLSX.utils.encode_cell({ r: 0, c: C })];
        headers.push(cell ? String(cell.v) : '');
      }

      // Read all data rows
      for (let R = 1; R <= range.e.r; R++) {
        const row = {};
        let hasData = false;

        for (let C = range.s.c; C <= range.e.c; C++) {
          const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
          // Convert all values to strings to ensure JSON serializable
          const value = cell ? String(cell.v) : '';
          row[headers[C - range.s.c]] = value;
          if (value !== undefined && value !== '' && value !== 'undefined') hasData = true;
        }

        if (hasData) {
          result.push(row);
        }
      }

      return result;
    }

    const data = readAllRows(worksheet);
    console.log('2. Excel parsed:', data.length, 'rows');
    console.log(`Excel file parsed: Found ${data.length} data rows from direct cell reading`);

    if (!data || data.length === 0) {
      return res.status(400).json({ error: `No data found in Excel file. Sheet has ${totalRowsInSheet} rows but no valid data` });
    }

    const pool = getPool();
    const tableName = 'imported_data';
    console.log('3. About to check table');

    // Check if table exists and has correct schema
    const checkTable = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = $1
      );
    `, [tableName]);

    const tableExists = checkTable.rows[0].exists;

    // If table exists, drop it to recreate with correct schema
    if (tableExists) {
      try {
        await pool.query(`DROP TABLE IF EXISTS ${tableName} CASCADE;`);
        console.log('Dropped old table schema');
      } catch (err) {
        console.error(`Error dropping table: ${err.message}`);
      }
    }

    // Create fresh table with JSONB storage
    console.log('4. About to create table');
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${tableName} (
          id SERIAL PRIMARY KEY,
          data JSONB NOT NULL,
          data_hash VARCHAR(64) UNIQUE NOT NULL,
          imported_at TIMESTAMP DEFAULT NOW()
        )
      `);
      console.log('Table created with correct JSONB schema');
    } catch (err) {
      console.error(`Error creating table: ${err.message}`);
      return res.status(500).json({ error: `Failed to create table: ${err.message}` });
    }

    // Insert data with duplicate checking
    let importedRows = 0;
    let skippedRows = 0;
    let errorRows = 0;

    console.log('5. About to insert first row');
    console.log(`Starting to import ${data.length} rows...`);

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      try {
        // Create a hash of the row data to check for duplicates
        const rowString = JSON.stringify(row);
        const dataHash = crypto.createHash('sha256').update(rowString).digest('hex');

        // Check if this data already exists
        const checkResult = await pool.query(
          `SELECT id FROM ${tableName} WHERE data_hash = $1`,
          [dataHash]
        );

        if (checkResult.rows.length === 0) {
          // Insert new row as JSON (all values already converted to strings in readAllRows)
          const jsonStr = JSON.stringify(row);

          await pool.query(
            `INSERT INTO ${tableName} (data, data_hash) VALUES ($1, $2)`,
            [jsonStr, dataHash]
          );
          importedRows++;
          if ((i + 1) % 100 === 0) {
            console.log(`Processed ${i + 1} rows, imported ${importedRows}...`);
          }
        } else {
          skippedRows++;
        }
      } catch (err) {
        console.error(`Error inserting row ${i + 1}: ${err.message}`);
        errorRows++;
      }
    }

    console.log(`Import complete: ${importedRows} imported, ${skippedRows} skipped, ${errorRows} errors out of ${data.length} total`);

    // Get preview of imported rows (max 10)
    const previewResult = await pool.query(`
      SELECT data FROM ${tableName} ORDER BY imported_at DESC LIMIT 10
    `);

    // Convert JSON data back to objects for preview
    const preview = previewResult.rows.map(row => JSON.parse(row.data));
    const columns_response = Object.keys(data[0]);

    res.json({
      importedRows,
      skippedRows,
      totalRows: data.length,
      preview,
      columns: columns_response,
      message: `Successfully imported ${importedRows} rows and skipped ${skippedRows} duplicates`
    });
  } catch (error) {
    console.error('Error uploading data:', error);
    const errorMessage = error && error.message ? error.message : String(error);
    console.error('Error message:', errorMessage);
    console.error('Error type:', typeof error);
    console.error('Error toString:', error.toString());

    try {
      res.status(500).json({ error: `Failed to upload data: ${errorMessage}` });
    } catch (jsonError) {
      console.error('Failed to send JSON response:', jsonError);
      res.status(500).send(`Failed to upload data: ${errorMessage}`);
    }
  }
});

// ===== API: Dashboard =====
app.get('/api/dashboard-data', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const tableName = 'imported_data';

    // Get all data from imported_data table
    const result = await pool.query(`
      SELECT data FROM ${tableName} ORDER BY imported_at DESC
    `);

    // Parse JSON data and add computed fields
    const data = result.rows.map(row => {
      const parsed = JSON.parse(row.data);

      // Compute Sexuality from Gender and Attracted To
      const gender = parsed['Gender'] || '';
      const attractedTo = parsed['Attracted To'] || '';
      let sexuality = '';

      if (gender === 'Man' && attractedTo.includes('Woman')) {
        sexuality = 'Straight';
      } else if (gender === 'Man' && attractedTo.includes('Man')) {
        sexuality = 'Gay';
      } else if (gender === 'Woman' && attractedTo.includes('Man')) {
        sexuality = 'Straight';
      } else if (gender === 'Woman' && attractedTo.includes('Woman')) {
        sexuality = 'Lesbian';
      } else if (attractedTo.includes('Woman') && attractedTo.includes('Man')) {
        sexuality = 'Bi/Pan';
      } else if (attractedTo.includes('Non-binary') || attractedTo.includes('Other')) {
        sexuality = 'Queer';
      } else {
        sexuality = 'Other';
      }

      return {
        ...parsed,
        Sexuality: sexuality
      };
    });

    res.json(data);
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
