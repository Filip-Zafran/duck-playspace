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
import { parseEventUpload } from './event-import.js';

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

app.get('/feedback', (req, res) => {
  if (!req.session.authenticated) {
    res.redirect('/');
  } else {
    res.sendFile(path.join(__dirname, 'public', 'feedback.html'));
  }
});

app.get('/feedback-response', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'feedback-response.html'));
});

app.get('/feedback-results', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'feedback-results.html'));
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

app.get('/quiz', (req, res) => {
  if (!req.session.authenticated) {
    res.redirect('/');
  } else {
    res.sendFile(path.join(__dirname, 'public', 'quiz.html'));
  }
});

app.get('/quiz-public/:quizId', (req, res) => {
  // Public quiz page - no authentication required
  res.sendFile(path.join(__dirname, 'public', 'quiz-public.html'));
});

app.get('/quiz-editor/:quizId', (req, res) => {
  if (!req.session.authenticated) {
    res.redirect('/');
  } else {
    res.sendFile(path.join(__dirname, 'public', 'quiz-editor.html'));
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
      // Count distinct voters for each choice (1 person = 1 vote, even if they voted for multiple options)
      const votesResult = await pool.query(
        'SELECT choice, COUNT(DISTINCT voter_name) as count FROM votes WHERE poll_id = $1 GROUP BY choice',
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

    // Count distinct voters for each choice (1 person = 1 vote, even if they voted for multiple options)
    const countsResult = await pool.query(
      'SELECT choice, COUNT(DISTINCT voter_name) as count FROM votes WHERE poll_id = $1 GROUP BY choice',
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

    const poll = pollResult.rows[0];
    res.json({
      ...poll,
      counts,
      previews
    });
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

// Manually close a poll without deleting its votes or results
app.patch('/api/polls/:id/close', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getPool();
    const result = await pool.query(
      'UPDATE polls SET is_closed = TRUE WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Poll not found' });
    }

    res.json({ id, message: 'Poll closed successfully' });
  } catch (error) {
    console.error('Error closing poll:', error);
    res.status(500).json({ error: 'Failed to close poll' });
  }
});

// Extend poll deadline
app.patch('/api/polls/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { extend_hours } = req.body;

    if (!extend_hours || extend_hours < 1) {
      return res.status(400).json({ error: 'Invalid extend_hours value' });
    }

    const pool = getPool();

    // Get current poll
    const pollResult = await pool.query('SELECT timer_end FROM polls WHERE id = $1', [id]);
    if (pollResult.rows.length === 0) {
      return res.status(404).json({ error: 'Poll not found' });
    }

    const currentTimerEnd = pollResult.rows[0].timer_end;

    // Calculate new deadline by adding hours to current timer_end
    const newTimerEnd = new Date(new Date(currentTimerEnd).getTime() + extend_hours * 60 * 60 * 1000);

    // Update the poll
    await pool.query(
      'UPDATE polls SET timer_end = $1 WHERE id = $2',
      [newTimerEnd, id]
    );

    res.json({
      id,
      message: `Deadline extended by ${extend_hours} hour${extend_hours !== 1 ? 's' : ''}`,
      new_deadline: newTimerEnd
    });
  } catch (error) {
    console.error('Error extending poll deadline:', error);
    res.status(500).json({ error: 'Failed to extend deadline' });
  }
});

// ===== API: Feedback =====

app.post('/api/feedback', requireAuth, async (req, res) => {
  try {
    const { title, description, event_name, submission_message, is_anonymous, questions, timer_minutes } = req.body;
    if (!title || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: 'A title and at least one question are required' });
    }

    const allowedTypes = ['text', 'rating', 'yes_no', 'single_select', 'multiple_select', 'checkbox'];
    const cleanQuestions = questions.map((question, index) => ({
      id: `q${index + 1}`,
      text: String(question.text || '').trim(),
      type: allowedTypes.includes(question.type) ? question.type : 'text',
      required: Boolean(question.required),
      options: ['single_select', 'multiple_select'].includes(question.type)
        ? (Array.isArray(question.options) ? question.options : [])
            .map(option => String(option).trim())
            .filter(Boolean)
        : []
    }));

    if (cleanQuestions.some(question => !question.text)) {
      return res.status(400).json({ error: 'Every question must have text' });
    }
    if (cleanQuestions.some(question => ['single_select', 'multiple_select'].includes(question.type) && question.options.length < 2)) {
      return res.status(400).json({ error: 'Choice questions need at least two options' });
    }

    const feedbackId = uuidv4();
    const resultsShareToken = crypto.randomBytes(24).toString('hex');
    const timerMinutes = Number(timer_minutes);
    const timerEnd = Number.isFinite(timerMinutes) && timerMinutes > 0
      ? new Date(Date.now() + timerMinutes * 60000)
      : null;
    const pool = getPool();

    await pool.query(
      `INSERT INTO feedback_forms
       (id, title, description, event_name, submission_message, results_share_token, is_anonymous, questions, timer_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
      [feedbackId, title.trim(), description?.trim() || null, event_name?.trim() || null,
        submission_message?.trim() || null, resultsShareToken, true,
        JSON.stringify(cleanQuestions), timerEnd]
    );

    const origin = `${req.protocol}://${req.get('host')}`;
    res.json({
      id: feedbackId,
      response_url: `${origin}/feedback-response?token=${feedbackId}`,
      results_url: `${origin}/feedback-results?token=${resultsShareToken}`
    });
  } catch (error) {
    console.error('Error creating feedback form:', error);
    res.status(500).json({ error: 'Failed to create feedback form' });
  }
});

app.get('/api/feedback', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(`
      SELECT f.*, COUNT(r.id)::int AS response_count
      FROM feedback_forms f
      LEFT JOIN feedback_responses r ON r.feedback_id = f.id
      GROUP BY f.id
      ORDER BY f.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching feedback forms:', error);
    res.status(500).json({ error: 'Failed to fetch feedback forms' });
  }
});

app.get('/api/feedback/:id/results', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const formResult = await pool.query('SELECT * FROM feedback_forms WHERE id = $1', [req.params.id]);
    if (formResult.rows.length === 0) {
      return res.status(404).json({ error: 'Feedback form not found' });
    }
    const responsesResult = await pool.query(
      `SELECT id, respondent_name, respondent_email, answers, submitted_at
       FROM feedback_responses WHERE feedback_id = $1 ORDER BY submitted_at DESC`,
      [req.params.id]
    );
    res.json({ form: formResult.rows[0], responses: responsesResult.rows });
  } catch (error) {
    console.error('Error fetching feedback results:', error);
    res.status(500).json({ error: 'Failed to fetch feedback results' });
  }
});

app.get('/api/public-feedback-results/:token', async (req, res) => {
  try {
    const pool = getPool();
    const formResult = await pool.query(
      `SELECT * FROM feedback_forms WHERE results_share_token = $1`,
      [req.params.token]
    );
    if (!formResult.rows.length) return res.status(404).json({ error: 'Results link not found' });
    const form = formResult.rows[0];
    const responsesResult = await pool.query(
      `SELECT id, answers, submitted_at FROM feedback_responses
       WHERE feedback_id = $1 ORDER BY submitted_at DESC`,
      [form.id]
    );
    delete form.results_share_token;
    res.json({ form, responses: responsesResult.rows });
  } catch (error) {
    console.error('Error fetching shared feedback results:', error);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

app.get('/api/feedback/:id/export.xlsx', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const formResult = await pool.query('SELECT * FROM feedback_forms WHERE id = $1', [req.params.id]);
    if (!formResult.rows.length) return res.status(404).json({ error: 'Feedback form not found' });
    const form = formResult.rows[0];
    const result = await pool.query(
      'SELECT id, answers, submitted_at FROM feedback_responses WHERE feedback_id = $1 ORDER BY submitted_at',
      [req.params.id]
    );
    const rows = result.rows.map((response, index) => {
      const row = { 'Response #': index + 1, Submitted: response.submitted_at };
      for (const question of form.questions || []) {
        const value = response.answers?.[question.id];
        row[question.text] = Array.isArray(value) ? value.join('; ') : (value ?? '');
      }
      return row;
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Responses');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', `attachment; filename="duck-feedback-${req.params.id}.xlsx"`);
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buffer);
  } catch (error) {
    console.error('Error exporting feedback:', error);
    res.status(500).json({ error: 'Failed to export feedback' });
  }
});

app.patch('/api/feedback/:id/close', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      'UPDATE feedback_forms SET is_closed = TRUE WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Feedback form not found' });
    }
    res.json({ message: 'Feedback form closed' });
  } catch (error) {
    console.error('Error closing feedback form:', error);
    res.status(500).json({ error: 'Failed to close feedback form' });
  }
});

app.delete('/api/feedback/:id', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query('DELETE FROM feedback_forms WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Feedback form not found' });
    }
    res.json({ message: 'Feedback form deleted' });
  } catch (error) {
    console.error('Error deleting feedback form:', error);
    res.status(500).json({ error: 'Failed to delete feedback form' });
  }
});

app.get('/api/public-feedback/:id', async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, title, description, event_name, submission_message, is_anonymous, questions, timer_end, is_closed
       FROM feedback_forms WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Feedback form not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching public feedback form:', error);
    res.status(500).json({ error: 'Failed to fetch feedback form' });
  }
});

app.post('/api/public-feedback/:id/responses', async (req, res) => {
  try {
    const pool = getPool();
    const formResult = await pool.query('SELECT * FROM feedback_forms WHERE id = $1', [req.params.id]);
    if (formResult.rows.length === 0) {
      return res.status(404).json({ error: 'Feedback form not found' });
    }

    const form = formResult.rows[0];
    if (form.is_closed || (form.timer_end && new Date() > new Date(form.timer_end))) {
      return res.status(400).json({ error: 'This feedback form is closed' });
    }

    const { respondent_name, respondent_email, answers } = req.body;
    if (!form.is_anonymous && (!respondent_name?.trim() || !respondent_email?.trim())) {
      return res.status(400).json({ error: 'Name and email are required' });
    }
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      return res.status(400).json({ error: 'Answers are required' });
    }

    const questions = form.questions || [];
    const cleanAnswers = {};
    for (const question of questions) {
      const answer = answers[question.id];
      if (question.type === 'multiple_select') {
        if (answer !== undefined && !Array.isArray(answer)) {
          return res.status(400).json({ error: `Invalid answer for "${question.text}"` });
        }
        const selected = answer || [];
        if (selected.some(option => !question.options.includes(option))) {
          return res.status(400).json({ error: `Invalid option selected for "${question.text}"` });
        }
        const otherOption = question.options.find(option => option.toLowerCase() === 'other');
        if (otherOption && selected.includes(otherOption)) {
          const otherText = String(answers[`${question.id}_other`] || '').trim();
          if (!otherText) {
            return res.status(400).json({ error: `Please specify the "Other" answer for "${question.text}"` });
          }
          cleanAnswers[question.id] = selected.map(option =>
            option === otherOption ? `Other: ${otherText}` : option
          );
        } else {
          cleanAnswers[question.id] = selected;
        }
      } else if (question.type === 'single_select') {
        const selected = answer === undefined ? '' : String(answer);
        if (selected && !question.options.includes(selected)) {
          return res.status(400).json({ error: `Invalid option selected for "${question.text}"` });
        }
        cleanAnswers[question.id] = selected;
      } else if (question.type === 'checkbox') {
        cleanAnswers[question.id] = answer === true;
      } else {
        cleanAnswers[question.id] = answer === undefined ? '' : String(answer);
      }
    }

    const missingRequired = questions.some(question => {
      if (!question.required) return false;
      const answer = cleanAnswers[question.id];
      if (question.type === 'multiple_select') return !Array.isArray(answer) || answer.length === 0;
      if (question.type === 'checkbox') return answer !== true;
      return answer === undefined || String(answer).trim() === '';
    });
    if (missingRequired) {
      return res.status(400).json({ error: 'Please answer all required questions' });
    }

    await pool.query(
      `INSERT INTO feedback_responses (feedback_id, respondent_name, respondent_email, answers)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [
        req.params.id,
        form.is_anonymous ? null : respondent_name.trim(),
        form.is_anonymous ? null : respondent_email.trim(),
        JSON.stringify(cleanAnswers)
      ]
    );
    res.json({ message: form.submission_message || 'Thank you for your feedback!' });
  } catch (error) {
    console.error('Error saving feedback response:', error);
    res.status(500).json({ error: 'Failed to save feedback' });
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

    // Count distinct voters for each choice (1 person = 1 vote, even if they voted for multiple options)
    const countsResult = await pool.query(
      'SELECT choice, COUNT(DISTINCT voter_name) as count FROM votes WHERE poll_id = $1 GROUP BY choice',
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
      is_closed: poll.is_closed,
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
    if (poll.is_closed) {
      return res.status(400).json({ error: 'Voting has ended' });
    }

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
    const client = await pool.connect();
    let importedRows = 0;
    let updatedRows = 0;
    let skippedRows = 0;

    try {
      await client.query('BEGIN');
      // Serialize imports so concurrent uploads cannot create duplicate participant rows.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('imported_data_upload'))");
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${tableName} (
          id SERIAL PRIMARY KEY,
          data JSONB NOT NULL,
          data_hash VARCHAR(64) UNIQUE NOT NULL,
          imported_at TIMESTAMP DEFAULT NOW()
        )
      `);

      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const email = String(row.Email || row.email || '').trim();
        let existingParticipant = null;

        if (email) {
          const existing = await client.query(`
            SELECT id, data, data_hash FROM ${tableName}
            WHERE LOWER(COALESCE(data->>'Email', data->>'email')) = LOWER($1)
            ORDER BY id LIMIT 2 FOR UPDATE
          `, [email]);
          if (existing.rows.length > 1) {
            throw new Error(`Multiple existing participant rows use ${email}. Resolve the duplicate before importing.`);
          }
          existingParticipant = existing.rows[0] || null;
          if (existingParticipant) {
            const canonicalEmail = existingParticipant.data.Email || existingParticipant.data.email;
            if (Object.hasOwn(row, 'Email')) row.Email = canonicalEmail;
            if (Object.hasOwn(row, 'email')) row.email = canonicalEmail;
          }
        }

        const rowString = JSON.stringify(row);
        const dataHash = crypto.createHash('sha256').update(rowString).digest('hex');
        if (existingParticipant) {
          if (existingParticipant.data_hash === dataHash) {
            skippedRows++;
            continue;
          }
          await client.query(
            `UPDATE ${tableName} SET data = $1, data_hash = $2, imported_at = NOW() WHERE id = $3`,
            [rowString, dataHash, existingParticipant.id]
          );
          updatedRows++;
          continue;
        }

        const inserted = await client.query(
          `INSERT INTO ${tableName} (data, data_hash) VALUES ($1, $2) ON CONFLICT (data_hash) DO NOTHING RETURNING id`,
          [rowString, dataHash]
        );
        if (inserted.rowCount) importedRows++;
        else skippedRows++;

        if ((i + 1) % 100 === 0) {
          console.log(`Processed ${i + 1} rows, added ${importedRows}, updated ${updatedRows}...`);
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    console.log(`Import complete: ${importedRows} added, ${updatedRows} updated, ${skippedRows} unchanged out of ${data.length} total`);

    // Get preview of imported rows (max 10)
    const previewResult = await pool.query(`
      SELECT data FROM ${tableName} ORDER BY imported_at DESC LIMIT 10
    `);

    // JSONB columns return as objects, not strings - no need to parse
    const preview = previewResult.rows.map(row => row.data);
    const columns_response = Object.keys(data[0]);

    res.json({
      importedRows,
      updatedRows,
      skippedRows,
      totalRows: data.length,
      preview,
      columns: columns_response,
      message: `Added ${importedRows} participants, updated ${updatedRows}, and skipped ${skippedRows} unchanged rows`
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

// Edit one participant's uploaded record. If their email changes, carry linked stats along too.
app.put('/api/participants/:email', requireAuth, async (req, res) => {
  const originalEmail = decodeURIComponent(req.params.email);
  const updatedData = req.body?.data;
  if (!updatedData || typeof updatedData !== 'object' || Array.isArray(updatedData)) {
    return res.status(400).json({ error: 'Participant data must be an object.' });
  }
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const existingResult = await client.query(`
      SELECT id, data FROM imported_data
      WHERE LOWER(COALESCE(data->>'Email', data->>'email')) = LOWER($1)
      ORDER BY id LIMIT 2 FOR UPDATE
    `, [originalEmail]);
    if (!existingResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Participant was not found.' });
    }
    if (existingResult.rows.length > 1) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This email identifies multiple uploaded rows. Resolve the duplicate before editing.' });
    }
    const existing = existingResult.rows[0];
    const data = { ...existing.data, ...updatedData };
    const emailKey = Object.hasOwn(data, 'Email') ? 'Email' : (Object.hasOwn(data, 'email') ? 'email' : 'Email');
    const newEmail = String(data[emailKey] || '').trim();
    if (!newEmail) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Email cannot be blank.' });
    }
    if (newEmail.toLowerCase() !== originalEmail.toLowerCase()) {
      const collision = await client.query(`
        SELECT id FROM imported_data
        WHERE LOWER(COALESCE(data->>'Email', data->>'email')) = LOWER($1) AND id <> $2
        LIMIT 1
      `, [newEmail, existing.id]);
      if (collision.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Another participant already uses that email.' });
      }
      // Any uniqueness conflict in linked records aborts the whole edit.
      await client.query('UPDATE event_participation SET email = $1 WHERE LOWER(email) = LOWER($2)', [newEmail, originalEmail]);
      await client.query('UPDATE date_stats SET participant_email = $1 WHERE LOWER(participant_email) = LOWER($2)', [newEmail, originalEmail]);
      await client.query('UPDATE participant_metadata SET email = $1 WHERE LOWER(email) = LOWER($2)', [newEmail, originalEmail]);
    }
    const dataHash = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
    await client.query('UPDATE imported_data SET data = $1, data_hash = $2 WHERE id = $3', [JSON.stringify(data), dataHash, existing.id]);
    await client.query('COMMIT');
    res.json({ success: true, data });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating participant data:', error);
    if (error.code === '23505') return res.status(409).json({ error: 'The change conflicts with another participant record.' });
    res.status(500).json({ error: 'Failed to update participant data.' });
  } finally {
    client.release();
  }
});

app.get('/api/participants/report-flags', requireAuth, async (req, res) => {
  try {
    const result = await getPool().query('SELECT email, reported FROM participant_metadata WHERE reported = TRUE');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching reported flags:', error);
    res.status(500).json({ error: 'Failed to fetch report flags.' });
  }
});

app.put('/api/participants/:email/reported', requireAuth, async (req, res) => {
  const email = decodeURIComponent(req.params.email);
  const { reported } = req.body || {};
  if (typeof reported !== 'boolean') return res.status(400).json({ error: 'Reported must be true or false.' });
  try {
    const result = await getPool().query(`
      INSERT INTO participant_metadata (email, reported) VALUES ($1, $2)
      ON CONFLICT (email) DO UPDATE SET reported = EXCLUDED.reported, updated_at = NOW()
      RETURNING email, reported
    `, [email, reported]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating reported flag:', error);
    res.status(500).json({ error: 'Failed to update report flag.' });
  }
});

// ===== Dashboard API Endpoints =====

// Read date outcomes recorded per participant and event.
app.get('/api/date-stats', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(`
      SELECT ds.*, e.name AS event_name, e.date AS event_date
      FROM date_stats ds
      JOIN events e ON e.id = ds.event_id
      ORDER BY e.date DESC NULLS LAST, e.name, ds.participant_email
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching date stats:', error);
    res.status(500).json({ error: 'Failed to fetch date stats' });
  }
});

// Import event participation and date outcomes without clearing existing records.
app.post('/api/date-stats/import', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a CSV or Excel file to import.' });
  const extension = path.extname(req.file.originalname).toLowerCase();
  if (!['.csv', '.xls', '.xlsx'].includes(extension)) {
    return res.status(400).json({ error: 'Choose a CSV (.csv) or Excel (.xls, .xlsx) file.' });
  }

  const normalizeHeader = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const parseBoolean = (value, label, rowNumber) => {
    if (value === '' || value === null || value === undefined) return null;
    const normalized = String(value).trim().toLowerCase();
    if (['yes', 'y', 'true', '1', 'attended', 'invited', 'paid'].includes(normalized)) return true;
    if (['no', 'n', 'false', '0', 'notattended', 'unpaid'].includes(normalized)) return false;
    throw new Error(`Row ${rowNumber}: ${label} must be Yes or No.`);
  };
  const parseCount = (value, label, rowNumber, allowDecimal = false) => {
    if (value === '' || value === null || value === undefined) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || (!allowDecimal && !Number.isInteger(number))) {
      throw new Error(`Row ${rowNumber}: ${label} must be a non-negative ${allowDecimal ? 'number' : 'whole number'}.`);
    }
    return number;
  };
  const parseNameList = (entry, label, rowNumber) => {
    if (!entry.found) return null;
    const raw = String(entry.value ?? '').trim();
    if (!raw) return [];
    const names = raw.split(/[|;\n]+/).map(name => name.trim()).filter(Boolean);
    if (!names.length) throw new Error(`Row ${rowNumber}: ${label} contains no readable names.`);
    return [...new Set(names)];
  };
  const parseEventDate = (value, rowNumber) => {
    if (value === null || value === undefined || value === '') return null;
    const raw = String(value).trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) throw new Error(`Row ${rowNumber}: Event Date must use YYYY-MM-DD format.`);
    const [, year, month, day] = match;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)) {
      throw new Error(`Row ${rowNumber}: Event Date is not a valid calendar date.`);
    }
    return raw;
  };

  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer', raw: false });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return res.status(400).json({ error: 'The file has no worksheet.' });
    const sourceRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '', raw: false });
    if (!sourceRows.length) return res.status(400).json({ error: 'The first worksheet has no data rows.' });

    const rows = sourceRows.map((source, index) => {
      const rowNumber = index + 2;
      const values = new Map(Object.entries(source).map(([key, value]) => [normalizeHeader(key), value]));
      const readEntry = (...aliases) => {
        for (const alias of aliases) {
          const key = normalizeHeader(alias);
          if (values.has(key)) {
            const value = values.get(key);
            return {
              found: true,
              value: value === '' || value === null || value === undefined ? null : String(value).trim()
            };
          }
        }
        return { found: false, value: null };
      };
      const read = (...aliases) => readEntry(...aliases).value;
      const eventId = parseCount(read('Event ID', 'event_id'), 'Event ID', rowNumber);
      const eventName = read('Event Name', 'Event');
      const eventDate = parseEventDate(read('Event Date', 'Date'), rowNumber);
      const email = read('Participant Email', 'Email');
      const participantName = read('Participant Name', 'Name');
      if ((!eventId && !eventName) || !email) {
        throw new Error(`Row ${rowNumber}: Event ID or Event Name, and Participant Email are required.`);
      }
      if (eventId === 0) throw new Error(`Row ${rowNumber}: Event ID must be greater than zero.`);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error(`Row ${rowNumber}: Participant Email is not a valid email address.`);
      }

      const participation = {
        invited: parseBoolean(read('Invited'), 'Invited', rowNumber),
        responded: parseBoolean(read('Responded'), 'Responded', rowNumber),
        status: read('Participation Status', 'Status'),
        attended: parseBoolean(read('Attended Event', 'Event Attended', 'Attended'), 'Attended Event', rowNumber),
        paid: parseBoolean(read('Paid'), 'Paid', rowNumber),
        amount: parseCount(read('Amount', 'Amount Paid'), 'Amount', rowNumber, true),
        freeEntry: parseBoolean(read('Free Entry'), 'Free Entry', rowNumber),
        referral: parseBoolean(read('Referral'), 'Referral', rowNumber),
        notes: read('Participation Notes')
      };
      const dateStats = {
        attended: parseBoolean(read('Went On Date', 'Had Date', 'Date Attended'), 'Went On Date', rowNumber),
        likesGiven: parseCount(read('Likes Given'), 'Likes Given', rowNumber),
        likesReceived: parseCount(read('Likes Received'), 'Likes Received', rowNumber),
        romanticLikesGiven: parseCount(read('Romantic Likes Given', 'Likes Given Romantic'), 'Romantic Likes Given', rowNumber),
        socialLikesGiven: parseCount(read('Social Likes Given', 'Likes Given Social'), 'Social Likes Given', rowNumber),
        romanticLikesReceived: parseCount(read('Romantic Likes Received', 'Likes Received Romantic'), 'Romantic Likes Received', rowNumber),
        socialLikesReceived: parseCount(read('Social Likes Received', 'Likes Received Social'), 'Social Likes Received', rowNumber),
        romanticMatches: parseCount(read('Romantic Matches'), 'Romantic Matches', rowNumber),
        socialMatches: parseCount(read('Social Matches'), 'Social Matches', rowNumber),
        totalMatches: parseCount(read('Total Matches'), 'Total Matches', rowNumber),
        romanticMatchesNames: parseNameList(readEntry('Romantic Matches Names'), 'Romantic Matches Names', rowNumber),
        socialMatchesNames: parseNameList(readEntry('Social Matches Names'), 'Social Matches Names', rowNumber),
        notes: read('Date Notes')
      };
      const hasParticipation = Object.values(participation).some(value => value !== null);
      const hasDateStats = Object.values(dateStats).some(value => value !== null);
      if (!hasParticipation && !hasDateStats) throw new Error(`Row ${rowNumber}: No event participation or date stats were provided.`);
      return { rowNumber, eventId, eventName, eventDate, email, participantName, participation, dateStats, hasParticipation, hasDateStats };
    });

    const seenParticipants = new Set();
    for (const row of rows) {
      const eventKey = row.eventId ? `id:${row.eventId}` : `name:${row.eventName.toLowerCase()}`;
      const key = `${eventKey}|${row.email.toLowerCase()}`;
      if (seenParticipants.has(key)) {
        throw new Error(`Row ${row.rowNumber}: This event and participant email appear more than once in the file.`);
      }
      seenParticipants.add(key);
    }

    const client = await getPool().connect();
    let participationSaved = 0;
    let dateStatsSaved = 0;
    let participantsCreated = 0;
    let participantsUpdated = 0;
    const rollupEmails = new Set();
    try {
      await client.query('BEGIN');
      const resolvedParticipants = new Set();
      for (const row of rows) {
        const eventResult = row.eventId
          ? await client.query(
              row.eventName
                ? 'SELECT id, name, date::text AS event_date, is_failed FROM events WHERE id = $1 AND LOWER(name) = LOWER($2) LIMIT 1'
                : 'SELECT id, name, date::text AS event_date, is_failed FROM events WHERE id = $1 LIMIT 1',
              row.eventName ? [row.eventId, row.eventName] : [row.eventId]
            )
          : await client.query('SELECT id, name, date::text AS event_date, is_failed FROM events WHERE LOWER(name) = LOWER($1) LIMIT 1', [row.eventName]);
        if (!eventResult.rows.length) {
          const eventLabel = row.eventId ? `ID ${row.eventId}${row.eventName ? ` (“${row.eventName}”)` : ''}` : `“${row.eventName}”`;
          throw new Error(`Row ${row.rowNumber}: Event ${eventLabel} was not found. Check the event ID/name and add the event in Events first.`);
        }
        const event = eventResult.rows[0];
        if (row.eventDate && event.event_date && row.eventDate !== event.event_date) {
          throw new Error(`Row ${row.rowNumber}: Event Date does not match the saved date for “${event.name}” (ID ${event.id}).`);
        }
        if (row.eventDate && !event.event_date) {
          await client.query('UPDATE events SET date = $1 WHERE id = $2', [row.eventDate, event.id]);
        }
        const resolvedKey = `${event.id}|${row.email.toLowerCase()}`;
        if (resolvedParticipants.has(resolvedKey)) {
          throw new Error(`Row ${row.rowNumber}: This event and participant email appear more than once in the file.`);
        }
        resolvedParticipants.add(resolvedKey);
        if (eventResult.rows[0].is_failed && row.hasDateStats) throw new Error(`Row ${row.rowNumber}: Date stats cannot be recorded for a failed event.`);
        if (eventResult.rows[0].is_failed && (row.participation.paid === true || Number(row.participation.amount || 0) > 0)) {
          throw new Error(`Row ${row.rowNumber}: Failed events cannot record payments or revenue.`);
        }
        const participantResult = await client.query(`
          SELECT id, data, COALESCE(data->>'Email', data->>'email') AS email
          FROM imported_data
          WHERE LOWER(COALESCE(data->>'Email', data->>'email')) = LOWER($1)
          ORDER BY id LIMIT 2 FOR UPDATE
        `, [row.email]);
        if (participantResult.rows.length > 1) {
          throw new Error(`Row ${row.rowNumber}: Multiple participant records use this email. Resolve the duplicate before importing.`);
        }
        let participantEmail;
        if (!participantResult.rows.length) {
          if (!row.participantName) {
            throw new Error(`Row ${row.rowNumber}: Participant Name is required to add a participant that is not already in the database.`);
          }
          const profile = { Name: row.participantName, Email: row.email };
          const profileString = JSON.stringify(profile);
          const profileHash = crypto.createHash('sha256').update(profileString).digest('hex');
          await client.query(
            'INSERT INTO imported_data (data, data_hash) VALUES ($1, $2) ON CONFLICT (data_hash) DO NOTHING',
            [profileString, profileHash]
          );
          participantEmail = row.email;
          participantsCreated++;
        } else {
          const existingParticipant = participantResult.rows[0];
          participantEmail = existingParticipant.email;
          if (row.participantName) {
            const profile = existingParticipant.data || {};
            const nameKey = Object.hasOwn(profile, 'Name') ? 'Name' : Object.hasOwn(profile, 'name') ? 'name' : 'Name';
            if (profile[nameKey] !== row.participantName) {
              profile[nameKey] = row.participantName;
              const profileString = JSON.stringify(profile);
              const profileHash = crypto.createHash('sha256').update(profileString).digest('hex');
              await client.query('UPDATE imported_data SET data = $1, data_hash = $2 WHERE id = $3', [profileString, profileHash, existingParticipant.id]);
              participantsUpdated++;
            }
          }
        }
        const eventId = eventResult.rows[0].id;

        if (row.hasParticipation) {
          const p = row.participation;
          const pFlags = [p.invited, p.responded, p.status, p.attended, p.paid, p.amount, p.freeEntry, p.referral, p.notes].map(value => value !== null);
          await client.query(`
            INSERT INTO event_participation
              (event_id, email, invited, responded, status, attended, paid, amount, free_entry, referral, notes)
            VALUES ($1, $2, COALESCE($3, FALSE), COALESCE($4, FALSE), COALESCE($5, 'waiting'), COALESCE($6, FALSE), COALESCE($7, FALSE), COALESCE($8, 0), COALESCE($9, FALSE), COALESCE($10, FALSE), $11)
            ON CONFLICT (event_id, email) DO UPDATE SET
              invited = CASE WHEN $12 THEN EXCLUDED.invited ELSE event_participation.invited END,
              responded = CASE WHEN $13 THEN EXCLUDED.responded ELSE event_participation.responded END,
              status = CASE WHEN $14 THEN EXCLUDED.status ELSE event_participation.status END,
              attended = CASE WHEN $15 THEN EXCLUDED.attended ELSE event_participation.attended END,
              paid = CASE WHEN $16 THEN EXCLUDED.paid ELSE event_participation.paid END,
              amount = CASE WHEN $17 THEN EXCLUDED.amount ELSE event_participation.amount END,
              free_entry = CASE WHEN $18 THEN EXCLUDED.free_entry ELSE event_participation.free_entry END,
              referral = CASE WHEN $19 THEN EXCLUDED.referral ELSE event_participation.referral END,
              notes = CASE WHEN $20 THEN EXCLUDED.notes ELSE event_participation.notes END,
              updated_at = NOW()
          `, [eventId, participantEmail, p.invited, p.responded, p.status, p.attended, p.paid, p.amount, p.freeEntry, p.referral, p.notes, ...pFlags]);
          participationSaved++;
          rollupEmails.add(participantEmail);
        }

        if (row.hasDateStats) {
          const d = row.dateStats;
          const dFlags = [d.attended, d.likesGiven, d.likesReceived, d.romanticLikesGiven, d.socialLikesGiven,
            d.romanticLikesReceived, d.socialLikesReceived, d.romanticMatches, d.socialMatches, d.notes,
            d.romanticMatchesNames, d.socialMatchesNames, d.totalMatches].map(value => value !== null);
          await client.query(`
            INSERT INTO date_stats
            (event_id, participant_email, attended, likes_given, likes_received, romantic_likes_given, social_likes_given,
             romantic_likes_received, social_likes_received, romantic_matches, social_matches, notes,
             romantic_matches_names, social_matches_names, total_matches)
          VALUES ($1, $2, $3, COALESCE($4, COALESCE($6, 0) + COALESCE($7, 0)),
              COALESCE($5, COALESCE($8, 0) + COALESCE($9, 0)), COALESCE($6, 0), COALESCE($7, 0),
              COALESCE($8, 0), COALESCE($9, 0), COALESCE($10, 0), COALESCE($11, 0), $12,
              COALESCE($13::jsonb, '[]'::jsonb), COALESCE($14::jsonb, '[]'::jsonb), $15)
            ON CONFLICT (event_id, participant_email) DO UPDATE SET
              attended = CASE WHEN $16 THEN EXCLUDED.attended ELSE date_stats.attended END,
              likes_given = CASE WHEN $17 THEN EXCLUDED.likes_given
                WHEN ($19 OR $20) THEN (CASE WHEN $19 THEN EXCLUDED.romantic_likes_given ELSE date_stats.romantic_likes_given END
                  + CASE WHEN $20 THEN EXCLUDED.social_likes_given ELSE date_stats.social_likes_given END)
                ELSE date_stats.likes_given END,
              likes_received = CASE WHEN $18 THEN EXCLUDED.likes_received
                WHEN ($21 OR $22) THEN (CASE WHEN $21 THEN EXCLUDED.romantic_likes_received ELSE date_stats.romantic_likes_received END
                  + CASE WHEN $22 THEN EXCLUDED.social_likes_received ELSE date_stats.social_likes_received END)
                ELSE date_stats.likes_received END,
              romantic_likes_given = CASE WHEN $19 THEN EXCLUDED.romantic_likes_given ELSE date_stats.romantic_likes_given END,
              social_likes_given = CASE WHEN $20 THEN EXCLUDED.social_likes_given ELSE date_stats.social_likes_given END,
              romantic_likes_received = CASE WHEN $21 THEN EXCLUDED.romantic_likes_received ELSE date_stats.romantic_likes_received END,
              social_likes_received = CASE WHEN $22 THEN EXCLUDED.social_likes_received ELSE date_stats.social_likes_received END,
              romantic_matches = CASE WHEN $23 THEN EXCLUDED.romantic_matches ELSE date_stats.romantic_matches END,
              social_matches = CASE WHEN $24 THEN EXCLUDED.social_matches ELSE date_stats.social_matches END,
              notes = CASE WHEN $25 THEN EXCLUDED.notes ELSE date_stats.notes END,
              romantic_matches_names = CASE WHEN $26 THEN EXCLUDED.romantic_matches_names ELSE date_stats.romantic_matches_names END,
              social_matches_names = CASE WHEN $27 THEN EXCLUDED.social_matches_names ELSE date_stats.social_matches_names END,
              total_matches = CASE WHEN $28 THEN EXCLUDED.total_matches ELSE date_stats.total_matches END,
              updated_at = NOW()
          `, [eventId, participantEmail, d.attended, d.likesGiven, d.likesReceived, d.romanticLikesGiven, d.socialLikesGiven,
            d.romanticLikesReceived, d.socialLikesReceived, d.romanticMatches, d.socialMatches, d.notes,
            d.romanticMatchesNames === null ? null : JSON.stringify(d.romanticMatchesNames),
            d.socialMatchesNames === null ? null : JSON.stringify(d.socialMatchesNames), d.totalMatches, ...dFlags]);
          dateStatsSaved++;
        }
      }
      await refreshParticipantRollups(client, [...rollupEmails]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    res.json({ rowsProcessed: rows.length, participationSaved, dateStatsSaved, participantsCreated, participantsUpdated,
      message: 'Import saved. Existing event and participant records were updated only for fields present in the file; other saved records were kept.' });
  } catch (error) {
    console.error('Error importing event stats:', error);
    res.status(400).json({ error: error.message || 'Failed to import event stats.' });
  }
});

// Save or update one participant's outcomes for an event.
app.post('/api/date-stats', requireAuth, async (req, res) => {
  try {
    const { eventId, participantEmail, attended = true, romanticLikesGiven = 0, socialLikesGiven = 0,
      romanticLikesReceived = 0, socialLikesReceived = 0, romanticMatches = 0, socialMatches = 0, notes = '' } = req.body;
    const counts = [romanticLikesGiven, socialLikesGiven, romanticLikesReceived, socialLikesReceived, romanticMatches, socialMatches];
    const numericEventId = Number(eventId);
    if (!Number.isInteger(numericEventId) || numericEventId <= 0 ||
        typeof participantEmail !== 'string' || !participantEmail.trim() ||
        (attended !== null && typeof attended !== 'boolean') ||
        counts.some(value => !Number.isInteger(Number(value)) || Number(value) < 0) ||
        typeof notes !== 'string' || notes.length > 1000) {
      return res.status(400).json({ error: 'Choose an event and participant, and enter non-negative whole-number counts.' });
    }

    const pool = getPool();
    const eventResult = await pool.query('SELECT is_failed FROM events WHERE id = $1', [numericEventId]);
    if (!eventResult.rows.length) return res.status(404).json({ error: 'Event not found.' });
    if (eventResult.rows[0].is_failed) return res.status(400).json({ error: 'Date stats cannot be recorded for a failed event.' });
    const participantResult = await pool.query(`
      SELECT COALESCE(data->>'Email', data->>'email') AS email
      FROM imported_data
      WHERE LOWER(COALESCE(data->>'Email', data->>'email')) = LOWER($1)
      ORDER BY id LIMIT 1
    `, [participantEmail.trim()]);
    if (!participantResult.rows.length) return res.status(400).json({ error: 'Participant was not found in participant data.' });
    const canonicalEmail = participantResult.rows[0].email;
    const result = await pool.query(`
      INSERT INTO date_stats
        (event_id, participant_email, attended, likes_given, likes_received, romantic_likes_given, social_likes_given,
         romantic_likes_received, social_likes_received, romantic_matches, social_matches, notes)
      VALUES ($1, $2, $3, $4 + $5, $6 + $7, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (event_id, participant_email) DO UPDATE SET
        attended = COALESCE(EXCLUDED.attended, date_stats.attended),
        likes_given = EXCLUDED.likes_given,
        likes_received = EXCLUDED.likes_received,
        romantic_likes_given = EXCLUDED.romantic_likes_given,
        social_likes_given = EXCLUDED.social_likes_given,
        romantic_likes_received = EXCLUDED.romantic_likes_received,
        social_likes_received = EXCLUDED.social_likes_received,
        romantic_matches = EXCLUDED.romantic_matches,
        social_matches = EXCLUDED.social_matches,
        notes = EXCLUDED.notes,
        updated_at = NOW()
      RETURNING *
    `, [numericEventId, canonicalEmail, attended, ...counts.map(Number), notes.trim()]);
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Error saving date stats:', error);
    if (error.code === '23503') return res.status(400).json({ error: 'The selected event no longer exists.' });
    res.status(500).json({ error: 'Failed to save date stats' });
  }
});

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

// Record a planned event that was cancelled/failed and its RSVP yes/no responses.
app.post('/api/events/failed', requireAuth, async (req, res) => {
  const { name, date, eventType, attendingEmails, notAttendingEmails } = req.body || {};
  const parseEmails = value => String(value || '').split(/[\n,;]+/).map(email => email.trim().toLowerCase()).filter(Boolean);
  const attending = parseEmails(attendingEmails);
  const notAttending = parseEmails(notAttendingEmails);
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 255 ||
      typeof eventType !== 'string' || !eventType.trim() || eventType.trim().length > 100 ||
      (date !== null && date !== undefined && date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) ||
      attending.length + notAttending.length === 0 || attending.length + notAttending.length > 1000 ||
      [...attending, ...notAttending].some(email => !emailPattern.test(email))) {
    return res.status(400).json({ error: 'Enter an event name, event type, and at least one valid participant email.' });
  }
  if (new Set(attending).size !== attending.length || new Set(notAttending).size !== notAttending.length ||
      attending.some(email => notAttending.includes(email))) {
    return res.status(400).json({ error: 'Each participant must appear once and can only have one RSVP response.' });
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const duplicateEvent = await client.query('SELECT id FROM events WHERE LOWER(name) = LOWER($1) LIMIT 1', [name.trim()]);
    if (duplicateEvent.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'An event with this name already exists.' });
    }

    const emails = [...attending, ...notAttending];
    const participants = await client.query(`
      SELECT DISTINCT ON (LOWER(COALESCE(data->>'Email', data->>'email')))
        COALESCE(data->>'Email', data->>'email') AS email
      FROM imported_data
      WHERE LOWER(COALESCE(data->>'Email', data->>'email')) = ANY($1::text[])
      ORDER BY LOWER(COALESCE(data->>'Email', data->>'email')), id
    `, [emails]);
    const participantByEmail = new Map(participants.rows.map(row => [row.email.toLowerCase(), row.email]));
    const unknownEmails = emails.filter(email => !participantByEmail.has(email));
    if (unknownEmails.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `These emails are not in participant data: ${unknownEmails.slice(0, 5).join(', ')}${unknownEmails.length > 5 ? ', …' : ''}` });
    }

    const created = await client.query(`
      INSERT INTO events (name, date, participation_fee, event_type, is_failed)
      VALUES ($1, $2, 0, $3, TRUE) RETURNING id
    `, [name.trim(), date || null, eventType.trim()]);
    const eventId = created.rows[0].id;
    for (const [emailsForResponse, status] of [[attending, 'attending'], [notAttending, 'not_attending']]) {
      for (const inputEmail of emailsForResponse) {
        await client.query(`
          INSERT INTO event_participation
            (event_id, email, invited, responded, status, attended, paid, amount, free_entry)
          VALUES ($1, $2, TRUE, TRUE, $3, FALSE, FALSE, 0, FALSE)
        `, [eventId, participantByEmail.get(inputEmail)]);
      }
    }
    await client.query('COMMIT');
    res.status(201).json({ eventId, eventName: name.trim(), attendingCount: attending.length, notAttendingCount: notAttending.length });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating failed event:', error);
    res.status(500).json({ error: 'Failed to save failed event.' });
  } finally {
    client.release();
  }
});

async function refreshParticipantRollups(client, emails) {
  for (const email of [...new Set(emails.map(value => String(value).trim()).filter(Boolean))]) {
    const totals = await client.query(`
      SELECT COUNT(*) FILTER (WHERE attended)::INTEGER AS total_attended,
             COALESCE(SUM(amount) FILTER (WHERE paid), 0) AS total_paid
      FROM event_participation ep
      JOIN events e ON e.id = ep.event_id
      WHERE LOWER(ep.email) = LOWER($1) AND e.is_failed = FALSE
    `, [email]);
    await client.query(`
      INSERT INTO participant_metadata (email, total_attended, total_paid, reward_tag)
      VALUES ($1, $2, $3, CASE WHEN $2 >= 5 THEN 'FREE EVENT' WHEN $2 >= 3 THEN '50% OFF' ELSE NULL END)
      ON CONFLICT (email) DO UPDATE SET
        total_attended = EXCLUDED.total_attended,
        total_paid = EXCLUDED.total_paid,
        reward_tag = EXCLUDED.reward_tag,
        updated_at = NOW()
    `, [email, totals.rows[0].total_attended, totals.rows[0].total_paid]);
  }
}

// Preview or import one event admin PDF, Excel workbook, or CSV without deleting unrelated records.
app.post('/api/events/import', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose an event PDF, Excel, or CSV file.' });
  try {
    const eventData = await parseEventUpload(req.file);
    const expectedRevenue = eventData.people.filter(person => person.paid && !person.freeEntry).reduce((sum, person) => sum + Number(person.amount || 0), 0);
    if (req.body.preview === 'true') {
      const existing = await getPool().query('SELECT id FROM events WHERE LOWER(name) = LOWER($1) LIMIT 1', [eventData.eventName]);
      return res.json({ eventName: eventData.eventName, date: eventData.date, fee: eventData.fee, participantCount: eventData.people.length, expectedRevenue, existing: existing.rows.length > 0 });
    }
    if (req.body.commit !== 'true') return res.status(400).json({ error: 'Review the file first, then confirm before saving.' });

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      let eventResult = await client.query('SELECT id, is_failed FROM events WHERE LOWER(name) = LOWER($1) ORDER BY id LIMIT 1 FOR UPDATE', [eventData.eventName]);
      let eventId;
      const rollupEmails = new Set(eventData.people.map(person => person.email.trim()));
      if (eventResult.rows.length) {
        eventId = eventResult.rows[0].id;
        if (eventResult.rows[0].is_failed) throw new Error(`Event “${eventData.eventName}” is marked failed. Use the failed-event RSVP form to update it.`);
        await client.query('UPDATE events SET date = COALESCE($1, date), participation_fee = $2, updated_at = NOW() WHERE id = $3', [eventData.date, eventData.fee, eventId]);
        const updatedPayments = await client.query('UPDATE event_participation SET amount = $1, updated_at = NOW() WHERE event_id = $2 AND paid = TRUE AND free_entry = FALSE RETURNING email', [eventData.fee, eventId]);
        updatedPayments.rows.forEach(row => rollupEmails.add(row.email));
      } else {
        const created = await client.query('INSERT INTO events (name, date, participation_fee) VALUES ($1, $2, $3) RETURNING id', [eventData.eventName, eventData.date, eventData.fee]);
        eventId = created.rows[0].id;
      }

      for (const person of eventData.people) {
        const registered = await client.query(`
          SELECT COALESCE(data->>'Email', data->>'email') AS email FROM imported_data
          WHERE LOWER(COALESCE(data->>'Email', data->>'email')) = LOWER($1)
          ORDER BY id LIMIT 1
        `, [person.email]);
        let participantEmail = registered.rows[0]?.email || person.email.trim();
        if (!registered.rows.length) {
          const minimalProfile = { Name: person.name, Email: participantEmail };
          const profileHash = crypto.createHash('sha256').update(JSON.stringify(minimalProfile)).digest('hex');
          await client.query('INSERT INTO imported_data (data, data_hash) VALUES ($1, $2) ON CONFLICT (data_hash) DO NOTHING', [JSON.stringify(minimalProfile), profileHash]);
        }
        rollupEmails.add(participantEmail);
        await client.query(`
          INSERT INTO event_participation
            (event_id, email, invited, responded, status, attended, paid, amount, free_entry)
          VALUES ($1, $2, TRUE, TRUE, 'accepted', $3, $4, $5, $6)
          ON CONFLICT (event_id, email) DO UPDATE SET
            invited = TRUE, responded = TRUE, status = 'accepted',
            attended = EXCLUDED.attended, paid = EXCLUDED.paid, amount = EXCLUDED.amount,
            free_entry = EXCLUDED.free_entry, updated_at = NOW()
        `, [eventId, participantEmail, person.attended, person.paid, person.amount, person.freeEntry]);

        await client.query(`
          INSERT INTO date_stats
            (event_id, participant_email, attended, likes_given, likes_received, romantic_likes_given, social_likes_given,
             romantic_likes_received, social_likes_received, romantic_matches, social_matches, notes)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'Imported from event data upload')
          ON CONFLICT (event_id, participant_email) DO UPDATE SET
            attended = COALESCE(EXCLUDED.attended, date_stats.attended), likes_given = EXCLUDED.likes_given, likes_received = EXCLUDED.likes_received,
            romantic_likes_given = EXCLUDED.romantic_likes_given, social_likes_given = EXCLUDED.social_likes_given,
            romantic_likes_received = EXCLUDED.romantic_likes_received, social_likes_received = EXCLUDED.social_likes_received,
            romantic_matches = EXCLUDED.romantic_matches, social_matches = EXCLUDED.social_matches,
            notes = EXCLUDED.notes, updated_at = NOW()
        `, [eventId, participantEmail, person.dateAttended, person.romanticLikesGiven + person.socialLikesGiven,
          person.romanticLikesReceived + person.socialLikesReceived, person.romanticLikesGiven, person.socialLikesGiven,
          person.romanticLikesReceived, person.socialLikesReceived, person.romanticMatches, person.socialMatches]);
      }
      await refreshParticipantRollups(client, [...rollupEmails]);
      await client.query('COMMIT');
      res.json({ eventId, eventName: eventData.eventName, participantCount: eventData.people.length, expectedRevenue });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  } catch (error) {
    console.error('Error importing event data:', error);
    res.status(400).json({ error: error.message || 'Could not import event data.' });
  }
});

app.put('/api/events/:eventId/fee', requireAuth, async (req, res) => {
  const fee = Number(req.body?.fee);
  if (!Number.isFinite(fee) || fee < 0 || Math.round(fee * 100) !== fee * 100) return res.status(400).json({ error: 'Fee must be a non-negative amount with up to two decimal places.' });
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const eventResult = await client.query('UPDATE events SET participation_fee = $1, updated_at = NOW() WHERE id = $2 AND is_failed = FALSE RETURNING id, name, date, participation_fee', [fee, req.params.eventId]);
    if (!eventResult.rows.length) {
      const exists = await client.query('SELECT is_failed FROM events WHERE id = $1', [req.params.eventId]);
      await client.query('ROLLBACK');
      return exists.rows.length ? res.status(400).json({ error: 'Failed events cannot have a participation fee.' }) : res.status(404).json({ error: 'Event not found.' });
    }
    const updated = await client.query('UPDATE event_participation SET amount = $1, updated_at = NOW() WHERE event_id = $2 AND paid = TRUE AND free_entry = FALSE RETURNING email', [fee, req.params.eventId]);
    await refreshParticipantRollups(client, updated.rows.map(row => row.email));
    await client.query('COMMIT');
    res.json({ event: eventResult.rows[0], participantsUpdated: updated.rowCount });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating event fee:', error);
    res.status(500).json({ error: 'Failed to update event fee.' });
  } finally { client.release(); }
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
  const client = await getPool().connect();
  try {
    const { eventId, email } = req.params;
    const { invited, responded, status, attended, paid, amount, freeEntry, referral, notes } = req.body;
    await client.query('BEGIN');
    const eventRecord = await client.query('SELECT id, is_failed FROM events WHERE id = $1 FOR UPDATE', [eventId]);
    if (!eventRecord.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Event not found.' });
    }
    const failedEvent = eventRecord.rows[0].is_failed;
    if (failedEvent && (paid === true || Number(amount || 0) > 0)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Failed events cannot record payments or revenue.' });
    }
    const registered = await client.query(`
      SELECT COALESCE(data->>'Email', data->>'email') AS email
      FROM imported_data
      WHERE LOWER(COALESCE(data->>'Email', data->>'email')) = LOWER($1)
      ORDER BY id LIMIT 1
    `, [email]);
    if (!registered.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Participant was not found in participant data.' });
    }
    const canonicalEmail = registered.rows[0].email;

    const result = await client.query(`
      INSERT INTO event_participation
      (event_id, email, invited, responded, status, attended, paid, amount, free_entry, referral, notes, invitation_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CASE WHEN $3 IS TRUE THEN NOW() ELSE NULL END)
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
        invitation_date = CASE
          WHEN $3 IS TRUE AND event_participation.invited IS DISTINCT FROM TRUE THEN NOW()
          ELSE event_participation.invitation_date
        END,
        updated_at = NOW()
      RETURNING *
    `, [eventId, canonicalEmail, invited, responded, status, failedEvent ? false : attended, failedEvent ? false : paid, failedEvent ? 0 : amount, failedEvent ? false : freeEntry, referral, notes]);

    const lastEvent = await client.query(`
      SELECT e.name
      FROM event_participation ep
      JOIN events e ON e.id = ep.event_id
      WHERE LOWER(ep.email) = LOWER($1) AND ep.attended = TRUE
      ORDER BY CASE WHEN e.date ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN e.date::date END DESC NULLS LAST,
               ep.updated_at DESC
      LIMIT 1
    `, [canonicalEmail]);
    await client.query(`
      INSERT INTO participant_metadata (email, last_event_name)
      VALUES ($1, $2)
      ON CONFLICT (email) DO UPDATE SET last_event_name = EXCLUDED.last_event_name, updated_at = NOW()
    `, [canonicalEmail, lastEvent.rows[0]?.name || null]);
    await refreshParticipantRollups(client, [canonicalEmail]);
    await client.query('COMMIT');

    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating participation:', error);
    res.status(500).json({ error: 'Failed to update participation' });
  } finally {
    client.release();
  }
});

// Get participant metadata
app.get('/api/participants/metadata', requireAuth, async (req, res) => {
  try {
    const result = await getPool().query('SELECT * FROM participant_metadata ORDER BY email');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching participant metadata:', error);
    res.status(500).json({ error: 'Failed to fetch participant metadata.' });
  }
});

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

app.get('/api/participants/activity', requireAuth, async (req, res) => {
  try {
    const result = await getPool().query(`
      WITH participants AS (
        SELECT DISTINCT LOWER(COALESCE(data->>'Email', data->>'email')) AS email_key
        FROM imported_data
        WHERE COALESCE(data->>'Email', data->>'email') IS NOT NULL
      ), invite_activity AS (
        SELECT LOWER(email) AS email_key, MAX(invitation_date) AS last_invited_at
        FROM event_participation
        WHERE invited = TRUE AND invitation_date IS NOT NULL
        GROUP BY LOWER(email)
      ), attendance_ranked AS (
        SELECT LOWER(ep.email) AS email_key, e.date AS last_attended_at,
          ROW_NUMBER() OVER (
            PARTITION BY LOWER(ep.email)
            ORDER BY CASE WHEN e.date::text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN LEFT(e.date::text, 10) END DESC NULLS LAST,
              ep.updated_at DESC
          ) AS position
        FROM event_participation ep
        JOIN events e ON e.id = ep.event_id
        WHERE ep.attended = TRUE AND e.is_failed = FALSE
      )
      SELECT participants.email_key AS email, invite_activity.last_invited_at, attendance_ranked.last_attended_at
      FROM participants
      LEFT JOIN invite_activity ON invite_activity.email_key = participants.email_key
      LEFT JOIN attendance_ranked ON attendance_ranked.email_key = participants.email_key AND attendance_ranked.position = 1
      ORDER BY participants.email_key
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching participant activity dates:', error);
    res.status(500).json({ error: 'Failed to fetch participant activity dates.' });
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

    await pool.query(`
      UPDATE participant_metadata
      SET reward_tag = $1, updated_at = NOW()
      WHERE email = $2
    `, [reward, email]);

    res.json({ reward, attended });
  } catch (error) {
    console.error('Error calculating reward:', error);
    res.status(500).json({ error: 'Failed to calculate reward' });
  }
});

// Sync Dates page data to Dashboard
app.post('/api/sync-from-dates', requireAuth, async (req, res) => {
  const client = await getPool().connect();
  try {
    const { dateName, people, paymentData, availabilityData } = req.body;
    if (typeof dateName !== 'string' || !dateName.trim() || !Array.isArray(people)) {
      return res.status(400).json({ error: 'An event name and participant list are required.' });
    }
    await client.query('BEGIN');
    const existingEvent = await client.query('SELECT id, is_failed FROM events WHERE LOWER(name) = LOWER($1) LIMIT 1 FOR UPDATE', [dateName.trim()]);
    if (existingEvent.rows[0]?.is_failed) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Failed events cannot receive attendance or payment data.' });
    }

    let eventId;
    if (existingEvent.rows.length) {
      eventId = existingEvent.rows[0].id;
      await client.query('UPDATE events SET updated_at = NOW() WHERE id = $1', [eventId]);
    } else {
      const created = await client.query('INSERT INTO events (name, date) VALUES ($1, NOW()) RETURNING id', [dateName.trim()]);
      eventId = created.rows[0].id;
    }
    const rollupEmails = new Set();

    // Update participation for each person
    for (const person of people) {
      const inputEmail = String(person.Email || person.email || '').trim();
      if (!inputEmail) throw new Error('Every participant needs an email address.');
      const registered = await client.query(`
        SELECT COALESCE(data->>'Email', data->>'email') AS email
        FROM imported_data
        WHERE LOWER(COALESCE(data->>'Email', data->>'email')) = LOWER($1)
        ORDER BY id LIMIT 1
      `, [inputEmail]);
      if (!registered.rows.length) throw new Error(`Participant ${inputEmail} was not found in participant data.`);
      const email = registered.rows[0].email;
      const responseData = paymentData?.[inputEmail] || paymentData?.[email] || {};
      const paid = Boolean(responseData.paid);
      const amount = Number(responseData.amount || 0);
      const availability = availabilityData?.[inputEmail] || availabilityData?.[email] || '';

      const attended = availability !== 'D';
      const declined = availability === 'D';

      await client.query(`
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
      rollupEmails.add(email);
    }

    await refreshParticipantRollups(client, [...rollupEmails]);
    await client.query('COMMIT');
    res.json({ success: true, eventId });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error syncing from Dates:', error);
    res.status(500).json({ error: 'Failed to sync data' });
  } finally {
    client.release();
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

    const metadataResult = await pool.query("SELECT COUNT(*) as count FROM participant_metadata WHERE LOWER(COALESCE(status, '')) = 'active'");
    const activeParticipants = parseInt(metadataResult.rows[0].count);

    const eventsResult = await pool.query('SELECT COUNT(*) as count FROM events');
    const totalEvents = parseInt(eventsResult.rows[0].count);

    const revenueResult = await pool.query('SELECT SUM(ep.amount) as total FROM event_participation ep JOIN events e ON e.id = ep.event_id WHERE ep.paid = true AND e.is_failed = false');
    const totalRevenue = revenueResult.rows[0].total || 0;

    const referralsResult = await pool.query('SELECT COUNT(*) as count FROM event_participation WHERE referral = true AND attended = true');
    const referralAttendees = parseInt(referralsResult.rows[0].count);
    const participationResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE invited = true)::int AS invited,
        COUNT(*) FILTER (WHERE responded = true)::int AS responded,
        COUNT(*) FILTER (WHERE attended = true)::int AS attended
      FROM event_participation
    `);

    res.json({
      totalParticipants,
      activeParticipants,
      totalEvents,
      totalRevenue: parseFloat(totalRevenue),
      referralAttendees,
      invited: participationResult.rows[0].invited,
      responded: participationResult.rows[0].responded,
      attended: participationResult.rows[0].attended
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ===== API: Quiz =====

app.post('/api/quizzes', async (req, res) => {
  // Optional authentication for admin creation
  if (!req.body.title) {
    return res.status(400).json({ error: 'Title is required' });
  }
  // Note: In production, you may want to add requireAuth here
  try {
    const { title, description, required_score_percent, reward_location, reward_address, meeting_time, questions } = req.body;
    const pool = getPool();
    const quizId = uuidv4();

    // Insert quiz
    await pool.query(
      `INSERT INTO quizzes (id, title, description, required_score_percent, reward_location, reward_address, meeting_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [quizId, title, description || null, required_score_percent || 100, reward_location || null, reward_address || null, meeting_time || null]
    );

    // Insert questions and options
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const result = await pool.query(
        `INSERT INTO quiz_questions (quiz_id, question_text, correct_answer, explanation, display_order)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [quizId, q.question_text, q.correct_answer, q.explanation || null, i]
      );

      const questionId = result.rows[0].id;

      // Insert options
      for (const [letter, text] of Object.entries(q.options)) {
        await pool.query(
          `INSERT INTO quiz_options (question_id, option_letter, option_text)
           VALUES ($1, $2, $3)`,
          [questionId, letter, text]
        );
      }
    }

    res.json({ id: quizId, message: 'Quiz created successfully' });
  } catch (error) {
    console.error('Error creating quiz:', error);
    res.status(500).json({ error: 'Failed to create quiz' });
  }
});

app.get('/api/quizzes/:quizId', async (req, res) => {
  try {
    const { quizId } = req.params;
    const pool = getPool();

    const quizResult = await pool.query('SELECT * FROM quizzes WHERE id = $1', [quizId]);
    if (quizResult.rows.length === 0) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    const quiz = quizResult.rows[0];

    const questionsResult = await pool.query(
      `SELECT * FROM quiz_questions WHERE quiz_id = $1 ORDER BY display_order ASC`,
      [quizId]
    );

    const questions = await Promise.all(questionsResult.rows.map(async (q) => {
      const optionsResult = await pool.query(
        `SELECT * FROM quiz_options WHERE question_id = $1 ORDER BY option_letter ASC`,
        [q.id]
      );

      const options = {};
      optionsResult.rows.forEach(opt => {
        options[opt.option_letter] = opt.option_text;
      });

      return {
        id: q.id,
        question_text: q.question_text,
        options,
        correct_answer: q.correct_answer,
        explanation: q.explanation
      };
    }));

    res.json({
      ...quiz,
      questions
    });
  } catch (error) {
    console.error('Error fetching quiz:', error);
    res.status(500).json({ error: 'Failed to fetch quiz' });
  }
});

app.post('/api/quiz-answer/:quizId', async (req, res) => {
  try {
    const { quizId } = req.params;
    const { voter_token, question_id, selected_answer } = req.body;

    if (!voter_token || !question_id || !selected_answer) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const pool = getPool();

    // Get correct answer
    const questionResult = await pool.query(
      'SELECT correct_answer FROM quiz_questions WHERE id = $1',
      [question_id]
    );

    if (questionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }

    const correct_answer = questionResult.rows[0].correct_answer;
    const is_correct = selected_answer.toUpperCase() === correct_answer;

    // Upsert answer
    await pool.query(
      `INSERT INTO quiz_submissions (quiz_id, voter_token, question_id, selected_answer, is_correct)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (quiz_id, voter_token, question_id) DO UPDATE SET
         selected_answer = $4,
         is_correct = $5,
         submitted_at = NOW()`,
      [quizId, voter_token, question_id, selected_answer.toUpperCase(), is_correct]
    );

    res.json({ is_correct, correct_answer });
  } catch (error) {
    console.error('Error recording answer:', error);
    res.status(500).json({ error: 'Failed to record answer' });
  }
});

app.get('/api/quiz-progress/:quizId', async (req, res) => {
  try {
    const { quizId } = req.params;
    const { voter_token } = req.query;

    if (!voter_token) {
      return res.status(400).json({ error: 'voter_token required' });
    }

    const pool = getPool();

    // Get total questions
    const totalResult = await pool.query(
      'SELECT COUNT(*) as count FROM quiz_questions WHERE quiz_id = $1',
      [quizId]
    );
    const totalQuestions = parseInt(totalResult.rows[0].count);

    // Get submitted answers
    const submittedResult = await pool.query(
      `SELECT COUNT(*) as count, SUM(CASE WHEN is_correct THEN 1 ELSE 0 END) as correct
       FROM quiz_submissions WHERE quiz_id = $1 AND voter_token = $2`,
      [quizId, voter_token]
    );

    const submitted = parseInt(submittedResult.rows[0].count);
    const correct = parseInt(submittedResult.rows[0].correct || 0);
    const percent = totalQuestions > 0 ? Math.round((correct / totalQuestions) * 100) : 0;

    res.json({
      total_questions: totalQuestions,
      submitted_answers: submitted,
      correct_answers: correct,
      percent_correct: percent,
      completed: submitted === totalQuestions
    });
  } catch (error) {
    console.error('Error fetching quiz progress:', error);
    res.status(500).json({ error: 'Failed to fetch progress' });
  }
});

app.get('/api/quiz-completion/:quizId', async (req, res) => {
  try {
    const { quizId } = req.params;
    const { voter_token } = req.query;

    if (!voter_token) {
      return res.status(400).json({ error: 'voter_token required' });
    }

    const pool = getPool();

    // Get quiz info
    const quizResult = await pool.query('SELECT * FROM quizzes WHERE id = $1', [quizId]);
    if (quizResult.rows.length === 0) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    const quiz = quizResult.rows[0];

    // Get total questions
    const totalResult = await pool.query(
      'SELECT COUNT(*) as count FROM quiz_questions WHERE quiz_id = $1',
      [quizId]
    );
    const totalQuestions = parseInt(totalResult.rows[0].count);

    // Get submitted answers
    const submittedResult = await pool.query(
      `SELECT COUNT(*) as count, SUM(CASE WHEN is_correct THEN 1 ELSE 0 END) as correct
       FROM quiz_submissions WHERE quiz_id = $1 AND voter_token = $2`,
      [quizId, voter_token]
    );

    const submitted = parseInt(submittedResult.rows[0].count);
    const correct = parseInt(submittedResult.rows[0].correct || 0);
    const percent = totalQuestions > 0 ? Math.round((correct / totalQuestions) * 100) : 0;

    const isCompleted = submitted === totalQuestions && percent >= (quiz.required_score_percent || 100);

    res.json({
      completed: isCompleted,
      percent_correct: percent,
      total_questions: totalQuestions,
      correct_answers: correct,
      reward_location: isCompleted ? quiz.reward_location : null,
      reward_address: isCompleted ? quiz.reward_address : null,
      meeting_time: isCompleted ? quiz.meeting_time : null
    });
  } catch (error) {
    console.error('Error checking quiz completion:', error);
    res.status(500).json({ error: 'Failed to check completion' });
  }
});

// Update quiz question
app.put('/api/quiz-questions/:questionId', requireAuth, async (req, res) => {
  try {
    const { questionId } = req.params;
    const { question_text, correct_answer, explanation } = req.body;
    const pool = getPool();

    const result = await pool.query(
      `UPDATE quiz_questions
       SET question_text = $1, correct_answer = $2, explanation = $3
       WHERE id = $4 RETURNING *`,
      [question_text, correct_answer, explanation, questionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating question:', error);
    res.status(500).json({ error: 'Failed to update question' });
  }
});

// Update quiz option
app.put('/api/quiz-options/:optionId', requireAuth, async (req, res) => {
  try {
    const { optionId } = req.params;
    const { option_text } = req.body;
    const pool = getPool();

    const result = await pool.query(
      `UPDATE quiz_options
       SET option_text = $1
       WHERE id = $2 RETURNING *`,
      [option_text, optionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Option not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating option:', error);
    res.status(500).json({ error: 'Failed to update option' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
