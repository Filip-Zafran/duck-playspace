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

app.get('/data-filters', (req, res) => {
  if (!req.session.authenticated) {
    res.redirect('/');
  } else {
    res.sendFile(path.join(__dirname, 'public', 'data-filters.html'));
  }
});

app.get('/groups', (req, res) => {
  if (!req.session.authenticated) {
    res.redirect('/');
  } else {
    res.sendFile(path.join(__dirname, 'public', 'groups.html'));
  }
});

app.get('/events', (req, res) => {
  if (!req.session.authenticated) {
    res.redirect('/');
  } else {
    res.sendFile(path.join(__dirname, 'public', 'events.html'));
  }
});

app.get('/dates', (req, res) => {
  // Redirect old /dates route to /events
  res.redirect('/events');
});

app.get('/communication', (req, res) => {
  if (!req.session.authenticated) {
    res.redirect('/');
  } else {
    res.sendFile(path.join(__dirname, 'public', 'communication.html'));
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
          // Insert new row as JSONB (PostgreSQL handles JSON encoding/decoding)
          await pool.query(
            `INSERT INTO ${tableName} (data, data_hash) VALUES ($1, $2)`,
            [JSON.stringify(row), dataHash]
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

    // JSONB columns return as objects, not strings - no need to parse
    const preview = previewResult.rows.map(row => row.data);
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

    // Get all data from imported_data table in import order
    const result = await pool.query(`
      SELECT data FROM ${tableName} ORDER BY imported_at ASC
    `);

    // JSONB columns return as objects, not strings
    const data = result.rows.map(row => {
      const parsed = row.data;

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

// ===== Dashboard API Endpoints =====

// Get all events
app.get('/api/events', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query('SELECT * FROM events ORDER BY date DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Get event participation
app.get('/api/events/:eventId/participation', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { eventId } = req.params;
    const result = await pool.query('SELECT * FROM event_participation WHERE event_id = $1', [eventId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching participation:', error);
    res.status(500).json({ error: 'Failed to fetch participation' });
  }
});

// Update event participation
app.put('/api/events/:eventId/participation/:email', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { eventId, email } = req.params;
    const { invited, responded, status, attended, paid, amount, freeEntry, referral, notes } = req.body;

    const result = await pool.query(`
      INSERT INTO event_participation
      (event_id, email, invited, responded, status, attended, paid, amount, free_entry, referral, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (event_id, email) DO UPDATE SET
        invited = COALESCE($3, invited),
        responded = COALESCE($4, responded),
        status = COALESCE($5, status),
        attended = COALESCE($6, attended),
        paid = COALESCE($7, paid),
        amount = COALESCE($8, amount),
        free_entry = COALESCE($9, free_entry),
        referral = COALESCE($10, referral),
        notes = COALESCE($11, notes),
        updated_at = NOW()
      RETURNING *
    `, [eventId, email, invited, responded, status, attended, paid, amount, freeEntry, referral, notes]);

    // Update participant metadata
    const participantMeta = result.rows[0];
    if (attended) {
      await pool.query(`
        INSERT INTO participant_metadata (email, total_attended, last_event_name)
        VALUES ($1, 1, $2)
        ON CONFLICT (email) DO UPDATE SET
          total_attended = total_attended + 1,
          last_event_name = $2,
          updated_at = NOW()
      `, [email, `Event ${eventId}`]);
    }

    if (paid && amount) {
      await pool.query(`
        UPDATE participant_metadata
        SET total_paid = total_paid + $1, updated_at = NOW()
        WHERE email = $2
      `, [amount, email]);
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating participation:', error);
    res.status(500).json({ error: 'Failed to update participation' });
  }
});

// Get participant metadata
app.get('/api/participants/:email/metadata', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { email } = req.params;
    const result = await pool.query('SELECT * FROM participant_metadata WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      // Return default metadata if not exists
      return res.json({
        email,
        status: 'Active',
        tags: [],
        total_attended: 0,
        total_paid: 0,
        reward_tag: null
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching participant metadata:', error);
    res.status(500).json({ error: 'Failed to fetch metadata' });
  }
});

// Update participant metadata
app.put('/api/participants/:email/metadata', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { email } = req.params;
    const { status, phone, tags, internalNotes } = req.body;

    const result = await pool.query(`
      INSERT INTO participant_metadata (email, status, phone, tags, internal_notes)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (email) DO UPDATE SET
        status = COALESCE($2, status),
        phone = COALESCE($3, phone),
        tags = COALESCE($4, tags),
        internal_notes = COALESCE($5, internal_notes),
        updated_at = NOW()
      RETURNING *
    `, [email, status, phone, JSON.stringify(tags || []), internalNotes]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating participant metadata:', error);
    res.status(500).json({ error: 'Failed to update metadata' });
  }
});

// Calculate and apply rewards
app.post('/api/participants/:email/calculate-reward', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { email } = req.params;

    const result = await pool.query(`
      SELECT total_attended FROM participant_metadata WHERE email = $1
    `, [email]);

    if (result.rows.length === 0) {
      return res.json({ reward: null });
    }

    const attended = result.rows[0].total_attended;
    let reward = null;

    if (attended >= 5) {
      reward = 'FREE EVENT';
    } else if (attended >= 3) {
      reward = '50% OFF';
    }

    if (reward) {
      await pool.query(`
        UPDATE participant_metadata
        SET reward_tag = $1, updated_at = NOW()
        WHERE email = $2
      `, [reward, email]);
    }

    res.json({ reward, attended });
  } catch (error) {
    console.error('Error calculating reward:', error);
    res.status(500).json({ error: 'Failed to calculate reward' });
  }
});

// Sync Dates page data to Dashboard
app.post('/api/sync-from-dates', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { dateName, people, paymentData, availabilityData } = req.body;

    // Create or update event
    await pool.query(`
      INSERT INTO events (name, date)
      VALUES ($1, NOW())
      ON CONFLICT (name) DO UPDATE SET updated_at = NOW()
    `, [dateName]);

    const eventResult = await pool.query('SELECT id FROM events WHERE name = $1', [dateName]);
    const eventId = eventResult.rows[0].id;

    // Update participation for each person
    for (const person of people) {
      const email = person.Email || person.email || '';
      const paid = paymentData?.[email]?.paid || false;
      const amount = paymentData?.[email]?.amount || 0;
      const availability = availabilityData?.[email] || '';

      const attended = availability !== 'D';
      const declined = availability === 'D';

      await pool.query(`
        INSERT INTO event_participation
        (event_id, email, invited, responded, status, attended, paid, amount)
        VALUES ($1, $2, true, $3, $4, $5, $6, $7)
        ON CONFLICT (event_id, email) DO UPDATE SET
          invited = true,
          responded = $3,
          status = $4,
          attended = $5,
          paid = $6,
          amount = $7,
          updated_at = NOW()
      `, [eventId, email, !!availability, declined ? 'declined' : 'accepted', attended, paid, amount]);
    }

    res.json({ success: true, eventId });
  } catch (error) {
    console.error('Error syncing from Dates:', error);
    res.status(500).json({ error: 'Failed to sync data' });
  }
});

// Sync Dashboard data back to Dates page format
app.get('/api/sync-to-dates/:eventName', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { eventName } = req.params;

    const result = await pool.query(`
      SELECT ep.*, e.name, e.date FROM event_participation ep
      JOIN events e ON ep.event_id = e.id
      WHERE e.name = $1
    `, [eventName]);

    const syncData = {
      dateName: eventName,
      people: result.rows.map(row => ({
        Email: row.email,
        'Staying in Berlin': row.attended ? 'Yes' : 'No'
      })),
      paymentData: {},
      availabilityData: {}
    };

    result.rows.forEach(row => {
      syncData.paymentData[row.email] = {
        paid: row.paid,
        amount: row.amount
      };
      syncData.availabilityData[row.email] = row.status === 'declined' ? 'D' : row.status === 'accepted' ? 'A' : 'waiting';
    });

    res.json(syncData);
  } catch (error) {
    console.error('Error syncing to Dates:', error);
    res.status(500).json({ error: 'Failed to sync data' });
  }
});

// Get comprehensive dashboard stats
app.get('/api/dashboard-stats', requireAuth, async (req, res) => {
  try {
    const pool = getPool();

    const participantsResult = await pool.query('SELECT data FROM imported_data');
    const totalParticipants = participantsResult.rows.length;

    const metadataResult = await pool.query('SELECT COUNT(*) as count FROM participant_metadata WHERE status = $1', ['Active']);
    const activeParticipants = parseInt(metadataResult.rows[0].count);

    const eventsResult = await pool.query('SELECT COUNT(*) as count FROM events');
    const totalEvents = parseInt(eventsResult.rows[0].count);

    const revenueResult = await pool.query('SELECT SUM(amount) as total FROM event_participation WHERE paid = true');
    const totalRevenue = revenueResult.rows[0].total || 0;

    const referralsResult = await pool.query('SELECT COUNT(*) as count FROM event_participation WHERE referral = true AND attended = true');
    const referralAttendees = parseInt(referralsResult.rows[0].count);

    res.json({
      totalParticipants,
      activeParticipants,
      totalEvents,
      totalRevenue: parseFloat(totalRevenue),
      referralAttendees
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
