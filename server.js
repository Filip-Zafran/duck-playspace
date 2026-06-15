import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { initializeDatabase, getPool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

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

// ===== API: Polls =====

app.post('/api/polls', requireAuth, async (req, res) => {
  try {
    const { title, description, duration, expected, date1, date2, date3, time1, time2, time3, timer_minutes } = req.body;

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
      `INSERT INTO polls (id, admin_token, title, description, duration, expected, date1, time1, date2, time2, date3, time3, timer_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [pollId, adminToken, title, description || 'Join us for an exciting event...', duration, expected || 8,
       date1, time1 || null, date2, time2 || null, date3, time3 || null, timerEnd]
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
    const { voter_name, choice } = req.body;

    if (!['date1', 'date2', 'date3', 'none'].includes(choice)) {
      return res.status(400).json({ error: 'Invalid choice' });
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

    await pool.query(
      'INSERT INTO votes (poll_id, voter_name, choice) VALUES ($1, $2, $3)',
      [pollId, voter_name || 'Anonymous', choice]
    );

    res.json({ message: 'Vote recorded' });
  } catch (error) {
    console.error('Error recording vote:', error);
    res.status(500).json({ error: 'Failed to record vote' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
