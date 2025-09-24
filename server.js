// ================== IMPORTS ==================
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const cors = require("cors");

// ================== APP ==================
const app = express();
const PORT = process.env.PORT || 3000;

// ================== MIDDLEWARE ==================
app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    secret: "vhp_ctf_secret",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false, sameSite: "lax" },
  })
);

// ================== FILE UPLOAD ==================
const upload = multer({ dest: path.join(__dirname, "uploads") });

// ================== DATABASE ==================
const dbFile = path.join(__dirname, "ctf.db");
const dbExists = fs.existsSync(dbFile);
const db = new sqlite3.Database(dbFile);

db.serialize(() => {
  if (!dbExists) {
    db.run(`CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      score INTEGER DEFAULT 0
    )`);
    db.run(`CREATE TABLE challenges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      category TEXT,
      description TEXT,
      flag TEXT,
      points INTEGER,
      file TEXT,
      link TEXT
    )`);
    db.run(`CREATE TABLE solved (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER,
      challengeId INTEGER,
      UNIQUE(userId, challengeId)
    )`);
    db.run(`CREATE TABLE admin (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT
    )`);
    db.run(`INSERT INTO admin(username,password) VALUES ('admin','admin123')`);
    console.log("✅ Database initialized with default admin (admin/admin123).");
  }
});

// ================== ADMIN AUTH ==================
function adminAuth(req, res, next) {
  if (req.session.isAdmin) next();
  else res.status(401).json({ success: false, message: "Admin login required" });
}

// ================== USER ROUTES ==================

// Register user
app.post("/api/register", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ success: false, message: "All fields required" });

  db.run("INSERT INTO users(username,password) VALUES(?,?)", [username, password], function (err) {
    if (err) return res.json({ success: false, message: "Username already taken" });
    req.session.user = { id: this.lastID, username, score: 0 };
    res.json({ success: true, user: req.session.user });
  });
});

// Login user
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  db.get("SELECT * FROM users WHERE username=? AND password=?", [username, password], (err, row) => {
    if (err || !row) return res.json({ success: false, message: "Invalid credentials" });
    req.session.user = { id: row.id, username: row.username, score: row.score };
    res.json({ success: true, user: req.session.user });
  });
});

// Logout user
app.post("/api/logout", (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Get user session
app.get("/api/user", (req, res) => {
  if (req.session.user) return res.json({ success: true, user: req.session.user });
  res.json({ success: false, message: "Not logged in" });
});

// ================== ADMIN ROUTES ==================

// Admin login
app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body;
  db.get("SELECT * FROM admin WHERE username=? AND password=?", [username, password], (err, row) => {
    if (err) return res.json({ success: false, message: err.message });
    if (row) {
      req.session.isAdmin = true;
      req.session.adminUsername = username;
      return res.json({ success: true });
    }
    res.json({ success: false, message: "Invalid credentials" });
  });
});

// Check admin session
app.get("/api/admin/check-session", (req, res) => {
  if (req.session.isAdmin) return res.json({ success: true, username: req.session.adminUsername });
  res.json({ success: false });
});

// Admin logout
app.post("/api/admin/logout", (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Change admin password
app.post("/api/admin/change-password", adminAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  db.get("SELECT * FROM admin WHERE username='admin'", (err, row) => {
    if (err || !row) return res.json({ success: false, message: "Admin not found" });
    if (row.password !== oldPassword) return res.json({ success: false, message: "Old password incorrect" });
    db.run("UPDATE admin SET password=? WHERE username='admin'", [newPassword], (err) => {
      if (err) return res.json({ success: false, message: err.message });
      res.json({ success: true, message: "Password changed successfully" });
    });
  });
});

// ================== USERS MANAGEMENT ==================

// Get all users
app.get("/api/users", adminAuth, (req, res) => {
  db.all("SELECT id, username, score FROM users", [], (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    res.json(rows);
  });
});

// Delete a user
app.delete("/api/users/:id", adminAuth, (req, res) => {
  const id = req.params.id;
  db.run("DELETE FROM users WHERE id=?", [id], function(err){
    if(err) return res.status(500).json({ success: false, message: err.message });
    res.json({ success: true });
  });
});

// ================== CHALLENGES ==================

// ================== PUBLIC ROUTE (FOR LOGGED-IN USERS) ==================
app.get("/api/challenges", (req, res) => {
  if (!req.session.user) return res.status(401).json({ success: false, message: "Login required" });
  const userId = req.session.user.id;

  db.all("SELECT * FROM challenges", [], (err, challenges) => {
    if (err) return res.status(500).json({ success: false, message: err.message });

    db.all("SELECT challengeId FROM solved WHERE userId=?", [userId], (err, solved) => {
      if (err) return res.status(500).json({ success: false, message: err.message });

      const solvedIds = solved.map(s => s.challengeId);
      const result = challenges.map(ch => ({
        ...ch,
        solved: solvedIds.includes(ch.id)
      }));

      res.json(result);
    });
  });
});

// ================== ADMIN CHALLENGE MANAGEMENT ==================
app.get("/api/admin/challenges", adminAuth, (req, res) => {
  db.all("SELECT * FROM challenges", [], (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    res.json(rows);
  });
});

app.post("/api/challenges", adminAuth, upload.single("file"), (req, res) => {
  const { title, category, description, flag, points, link } = req.body;
  const file = req.file ? req.file.filename : null;
  db.run("INSERT INTO challenges(title, category, description, flag, points, file, link) VALUES(?,?,?,?,?,?,?)",
    [title, category, description, flag, points, file, link],
    function (err) {
      if (err) return res.json({ success: false, message: err.message });
      res.json({ success: true, id: this.lastID });
    });
});

app.put("/api/challenges/:id", adminAuth, (req, res) => {
  const id = req.params.id;
  const { title, category, description, flag, points, link } = req.body;
  db.run("UPDATE challenges SET title=?, category=?, description=?, flag=?, points=?, link=? WHERE id=?",
    [title, category, description, flag, points, link, id],
    function (err) {
      if (err) return res.json({ success: false, message: err.message });
      res.json({ success: true });
    });
});

app.delete("/api/challenges/:id", adminAuth, (req, res) => {
  const id = req.params.id;
  db.run("DELETE FROM challenges WHERE id=?", [id], function (err) {
    if (err) return res.json({ success: false, message: err.message });
    res.json({ success: true });
  });
});

// ================== FLAG SUBMISSION ==================
app.post("/api/submit", (req, res) => {
  const { challengeId, flag } = req.body;
  if (!req.session.user) return res.json({ success: false, message: "Login required" });

  db.get("SELECT * FROM challenges WHERE id=?", [challengeId], (err, challenge) => {
    if (!challenge) return res.json({ success: false, message: "Challenge not found" });

    if (challenge.flag === flag) {
      db.get("SELECT * FROM solved WHERE userId=? AND challengeId=?", [req.session.user.id, challengeId], (err, row) => {
        if (row) return res.json({ success: false, message: "Already solved" });

        db.run("INSERT INTO solved(userId, challengeId) VALUES(?,?)", [req.session.user.id, challengeId], function (err) {
          if (err) return res.json({ success: false, message: err.message });
          db.run("UPDATE users SET score=score+? WHERE id=?", [challenge.points, req.session.user.id]);
          req.session.user.score += challenge.points;
          res.json({ success: true, message: "Correct flag!" });
        });
      });
    } else {
      res.json({ success: false, message: "Wrong flag" });
    }
  });
});

// ================== LEADERBOARD ==================
app.get("/api/leaderboard", (req, res) => {
  db.all("SELECT username, score FROM users ORDER BY score DESC LIMIT 10", [], (err, rows) => {
    if (err) return res.json([]);
    res.json(rows);
  });
});

// ================== START SERVER ==================
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
