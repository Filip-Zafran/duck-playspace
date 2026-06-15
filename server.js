import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static('public'));

app.use(session({
  secret: 'duck-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 3600000 }
}));

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

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
