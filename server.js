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
const PORT = 3000;

// ================== MIDDLEWARE ==================
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public"))); // serve frontend
app.use("/uploads", express.static(path.join(__dirname, "uploads"))); // serve uploads
app.use(
  session({
    secret: "vhp_ctf_secret",
    resave: false,
    saveUninitialized: true,
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
    // Users
    db.run(`CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      score INTEGER DEFAULT 0
    )`);

    // Challenges
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

    // Solved challenges
    db.run(`CREATE TABLE solved (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER,
      challengeId INTEGER,
      UNIQUE(userId, challengeId)
    )`);

    // Admin
    db.run(`CREATE TABLE admin (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT
    )`);

    // Default admin
    db.run(`INSERT INTO admin(username,password) VALUES ('admin','admin123')`);

    console.log("✅ Database initialized with default admin (admin / admin123).");
  }
});

// ================== ADMIN AUTH MIDDLEWARE ==================
function adminAuth(req, res, next) {
  if (req.session.isAdmin) {
    next();
  } else {
    res.status(401).json({ success: false, message: "Admin login required" });
  }
}

// ================== USERS ==================

// Register
app.post("/api/register", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.json({ success: false, message: "Username and password required" });

  db.get("SELECT * FROM users WHERE username=?", [username], (err, row) => {
    if (err) return res.json({ success: false, message: err.message });
    if (row) return res.json({ success: false, message: "Username already exists" });

    db.run(
      "INSERT INTO users(username,password) VALUES(?,?)",
      [username, password],
      function (err) {
        if (err) return res.json({ success: false, message: err.message });
        res.json({ success: true });
      }
    );
  });
});

// Login
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  db.get(
    "SELECT * FROM users WHERE username=? AND password=?",
    [username, password],
    (err, row) => {
      if (err) return res.json({ success: false, message: err.message });
      if (!row) return res.json({ success: false, message: "Invalid credentials" });

      req.session.user = { id: row.id, username: row.username, score: row.score };
      res.json({ success: true, user: req.session.user });
    }
  );
});

// Logout
app.post("/api/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.json({ success: false });
    res.json({ success: true });
  });
});

// Current user
app.get("/api/user", (req, res) => {
  if (req.session.user) res.json(req.session.user);
  else res.json({ error: "Not logged in" });
});

// Leaderboard
app.get("/api/leaderboard", (req, res) => {
  db.all(
    "SELECT username, score FROM users ORDER BY score DESC LIMIT 10",
    [],
    (err, rows) => {
      if (err) return res.json([]);
      res.json(rows);
    }
  );
});

// ================== CHALLENGES ==================

// Get all challenges (admin protected)
app.get("/api/challenges", adminAuth, (req, res) => {
  db.all("SELECT * FROM challenges", [], (err, rows) => {
    if (err) return res.json([]);
    res.json(rows);
  });
});

// Add challenge
app.post("/api/challenges", adminAuth, upload.single("file"), (req, res) => {
  const { title, category, description, flag, points, link } = req.body;
  const file = req.file ? req.file.filename : null;

  db.run(
    `INSERT INTO challenges(title, category, description, flag, points, file, link)
     VALUES(?,?,?,?,?,?,?)`,
    [title, category, description, flag, points, file, link],
    function (err) {
      if (err) return res.json({ success: false, message: err.message });
      res.json({ success: true, id: this.lastID });
    }
  );
});

// Edit challenge
app.put("/api/challenges/:id", adminAuth, upload.single("file"), (req, res) => {
  const id = req.params.id;
  const { title, category, description, flag, points, link } = req.body;
  const file = req.file ? req.file.filename : null;

  db.run(
    `UPDATE challenges SET title=?, category=?, description=?, flag=?, points=?, file=?, link=? WHERE id=?`,
    [title, category, description, flag, points, file, link, id],
    function (err) {
      if (err) return res.json({ success: false, message: err.message });
      res.json({ success: true });
    }
  );
});

// Delete challenge
app.delete("/api/challenges/:id", adminAuth, (req, res) => {
  const id = req.params.id;
  db.run("DELETE FROM challenges WHERE id=?", [id], function (err) {
    if (err) return res.json({ success: false, message: err.message });
    res.json({ success: true });
  });
});

// ================== ADMIN ==================

// Admin login
app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body;
  db.get(
    "SELECT * FROM admin WHERE username=? AND password=?",
    [username, password],
    (err, row) => {
      if (err) return res.json({ success: false, message: err.message });
      if (row) {
        req.session.isAdmin = true; // <-- set session
        res.json({ success: true });
      } else {
        res.json({ success: false, message: "Invalid admin credentials" });
      }
    }
  );
});

// Admin logout
app.get("/api/admin/logout", adminAuth, (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Change admin password
app.post("/api/admin/change-password", adminAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  db.get("SELECT * FROM admin WHERE username='admin'", (err, row) => {
    if (err || !row) return res.json({ success: false, message: "Admin not found" });
    if (row.password === oldPassword)
      return res.json({ success: false, message: "Old password incorrect" });

    db.run("UPDATE admin SET password=? WHERE username='admin'", [newPassword], (err) => {
      if (err) return res.json({ success: false, message: err.message });
      res.json({ success: true, message: "Password changed successfully" });
    });
  });
});

// ================== USERS MANAGEMENT (ADMIN) ==================

// Get all users
app.get("/api/users", adminAuth, (req, res) => {
  db.all("SELECT id, username, score FROM users", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Delete a user
app.delete("/api/users/:id", adminAuth, (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM users WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// ================== FLAG SUBMISSION ==================
app.post('/api/submit', (req, res) => {
  const { challengeId, flag } = req.body;

  if (!req.session.user) return res.json({ success: false, message: "Login required" });

  db.get("SELECT * FROM challenges WHERE id=?", [challengeId], (err, challenge) => {
    if (err || !challenge) return res.json({ success: false, message: "Challenge not found" });

    if (challenge.flag === flag) {
      db.get("SELECT * FROM solved WHERE userId=? AND challengeId=?", [req.session.user.id, challengeId], (err, row) => {
        if (row) return res.json({ success: false, message: "Already solved" });

        db.run("INSERT INTO solved(userId, challengeId) VALUES(?,?)", [req.session.user.id, challengeId], function(err) {
          if(err) return res.json({ success: false, message: err.message });

          const newScore = req.session.user.score + challenge.points;
          db.run("UPDATE users SET score=? WHERE id=?", [newScore, req.session.user.id], (err) => {
            if (err) return res.json({ success: false, message: err.message });

            req.session.user.score = newScore;

            db.all("SELECT * FROM challenges", [], (err, allChallenges) => {
              if(err) return res.json({ success: true, message: "Correct flag!", updatedChallenges: [] });

              db.all("SELECT challengeId FROM solved WHERE userId=?", [req.session.user.id], (err, solvedRows) => {
                const solvedIds = solvedRows.map(r => r.challengeId);
                const updatedChallenges = allChallenges.map(ch => ({
                  ...ch,
                  solved: solvedIds.includes(ch.id)
                }));
                res.json({ success: true, message: "Correct flag!", updatedChallenges });
              });
            });
          });
        });
      });
    } else {
      res.json({ success: false, message: "Wrong flag" });
    }
  });
});

// ================== SOLVED CHALLENGES ==================
app.get('/api/solved/:userId', (req, res) => {
  const { userId } = req.params;
  db.all("SELECT challengeId FROM solved WHERE userId=?", [userId], (err, rows) => {
    if(err) return res.json([]);
    res.json(rows);
  });
});

// ================== SERVE ADMIN PANEL ==================
app.get('/admin.html', adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
// Check admin session
app.get('/api/admin/check-session',(req,res)=>{
  if(req.session.adminLoggedIn) return res.json({success:true});
  res.json({success:false});
});

// Admin login
app.post("/api/admin/login",(req,res)=>{
  const {username,password}=req.body;
  db.get("SELECT * FROM admin WHERE username=? AND password=?",[username,password],(err,row)=>{
      if(err) return res.json({success:false,message:err.message});
      if(row){ req.session.adminLoggedIn=true; return res.json({success:true}); }
      res.json({success:false,message:"Invalid admin credentials"});
  });
});

// Admin logout
app.post('/api/admin/logout',(req,res)=>{
  req.session.adminLoggedIn=false;
  res.json({success:true});
});


// ================== START SERVER ==================
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
