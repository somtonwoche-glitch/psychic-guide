const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Email transporter setup (configure in .env)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// Send email helper function
async function sendEmail(to, subject, html) {
  try {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log('📧 Email not configured. Would send to:', to);
      console.log('Subject:', subject);
      return { success: true, message: 'Email logging only (SMTP not configured)' };
    }
    
    await transporter.sendMail({
      from: `"RNPathfinders" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html
    });
    console.log('📧 Email sent to:', to);
    return { success: true };
  } catch (error) {
    console.error('📧 Email error:', error.message);
    return { success: false, error: error.message };
  }
}

async function initializeDatabase() {
  try {
    console.log('📦 Checking/Creating tables...');
    
    await pool.query(`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY, 
      email VARCHAR(255) UNIQUE NOT NULL, 
      password VARCHAR(255) NOT NULL, 
      is_admin BOOLEAN DEFAULT FALSE, 
      primary_subject_id INTEGER, 
      subject_locked_at TIMESTAMP, 
      lock_expires_at TIMESTAMP, 
      aar_count INTEGER DEFAULT 0, 
      session_count INTEGER DEFAULT 0, 
      total_study_minutes INTEGER DEFAULT 0, 
      last_activity TIMESTAMP, 
      onboarding_complete BOOLEAN DEFAULT FALSE, 
      unlock_requested BOOLEAN DEFAULT FALSE,
      unlock_requested_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    
    await pool.query(`CREATE TABLE IF NOT EXISTS access_codes (
      id SERIAL PRIMARY KEY, 
      code VARCHAR(50) UNIQUE NOT NULL, 
      used BOOLEAN DEFAULT FALSE, 
      used_by INTEGER REFERENCES users(id), 
      used_at TIMESTAMP, 
      sent_to_email VARCHAR(255),
      sent_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    
    await pool.query(`CREATE TABLE IF NOT EXISTS password_resets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      token VARCHAR(255) UNIQUE NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      used BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    
    await pool.query(`CREATE TABLE IF NOT EXISTS departments (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, code VARCHAR(20) UNIQUE NOT NULL, icon VARCHAR(10) DEFAULT '📚', is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    
    await pool.query(`CREATE TABLE IF NOT EXISTS subjects (id SERIAL PRIMARY KEY, department_id INTEGER REFERENCES departments(id), name VARCHAR(100) NOT NULL, code VARCHAR(20) NOT NULL, estimated_hours INTEGER DEFAULT 20, is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(department_id, code))`);
    
    await pool.query(`CREATE TABLE IF NOT EXISTS resources (id SERIAL PRIMARY KEY, subject_id INTEGER REFERENCES subjects(id), title VARCHAR(255) NOT NULL, url TEXT NOT NULL, type VARCHAR(50) NOT NULL, duration_minutes INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    
    await pool.query(`CREATE TABLE IF NOT EXISTS study_sessions (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), subject_id INTEGER REFERENCES subjects(id), session_type VARCHAR(50) DEFAULT 'active_recall', planned_duration INTEGER NOT NULL, actual_duration INTEGER, started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, completed_at TIMESTAMP, is_completed BOOLEAN DEFAULT FALSE)`);
    
    await pool.query(`CREATE TABLE IF NOT EXISTS aar_entries (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), subject_id INTEGER REFERENCES subjects(id), what_worked TEXT NOT NULL, what_blocked TEXT NOT NULL, tomorrow_plan TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    
    await pool.query(`CREATE TABLE IF NOT EXISTS user_progress (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), resource_id INTEGER REFERENCES resources(id), completed BOOLEAN DEFAULT FALSE, completed_at TIMESTAMP, UNIQUE(user_id, resource_id))`);

    // Add new columns if they don't exist (for existing databases)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS unlock_requested BOOLEAN DEFAULT FALSE`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS unlock_requested_at TIMESTAMP`);
    await pool.query(`ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS sent_to_email VARCHAR(255)`);
    await pool.query(`ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP`);
    
    console.log('✅ Tables ready');

    // Only insert default data if tables are empty
    const codesCheck = await pool.query('SELECT COUNT(*) as count FROM access_codes');
    if (parseInt(codesCheck.rows[0].count) === 0) {
      console.log('📝 First run - inserting initial data...');
      
      const codes = ['OPERATIVE2024', 'MISSION2024', 'ACADEMIC2024', 'RNPATH2024', 'STUDY2024'];
      for (const c of codes) await pool.query('INSERT INTO access_codes (code) VALUES ($1)', [c]);
      console.log('✅ Access codes inserted');

      const depts = [
        { name: 'Medicine & Nursing', code: 'MED', icon: '🏥' },
        { name: 'Engineering', code: 'ENG', icon: '⚙️' },
        { name: 'Science', code: 'SCI', icon: '🔬' },
        { name: 'Business', code: 'BUS', icon: '📊' },
        { name: 'General Studies', code: 'GEN', icon: '📚' }
      ];
      for (const d of depts) await pool.query('INSERT INTO departments (name, code, icon) VALUES ($1, $2, $3)', [d.name, d.code, d.icon]);
      console.log('✅ Departments inserted');

      // Insert subjects (keeping your existing comprehensive list)
      await insertDefaultSubjects();
    }
  } catch (e) {
    console.error('❌ Database init error:', e.message);
  }
}

async function insertDefaultSubjects() {
  const allSubjects = {
    MED: [
      {c:'MED101',n:'Human Anatomy',h:35},{c:'MED102',n:'Human Physiology',h:35},{c:'MED103',n:'Anatomy & Physiology Combined',h:40},
      {c:'NUR101',n:'Fundamentals of Nursing',h:30},{c:'NUR102',n:'Nursing Ethics & Law',h:20},{c:'NUR201',n:'Medical-Surgical Nursing',h:45},
      {c:'NUR202',n:'Pediatric Nursing',h:30},{c:'NUR203',n:'Obstetric Nursing',h:35},{c:'NUR204',n:'Psychiatric Nursing',h:30},
      {c:'NUR205',n:'Community Health Nursing',h:25},{c:'NUR301',n:'Critical Care Nursing',h:35},{c:'NUR302',n:'Emergency Nursing',h:30},
      {c:'MED201',n:'Pharmacology',h:40},{c:'MED202',n:'Pathophysiology',h:35},{c:'MED203',n:'Microbiology',h:30},
      {c:'MED204',n:'Biochemistry',h:35},{c:'MED205',n:'Medical Immunology',h:25},{c:'MED206',n:'Histology',h:25},
      {c:'MED207',n:'Embryology',h:20},{c:'MED301',n:'Clinical Medicine',h:45},{c:'MED302',n:'Medical Diagnostics',h:30},{c:'MED303',n:'Health Assessment',h:25}
    ],
    ENG: [
      {c:'ENG101',n:'Engineering Mathematics I',h:35},{c:'ENG102',n:'Engineering Mathematics II',h:35},{c:'ENG103',n:'Engineering Mathematics III',h:35},
      {c:'ENG104',n:'Linear Algebra',h:25},{c:'ENG105',n:'Differential Equations',h:30},{c:'ENG201',n:'Thermodynamics',h:35},
      {c:'ENG202',n:'Fluid Mechanics',h:35},{c:'ENG203',n:'Mechanics of Materials',h:35},{c:'ENG204',n:'Engineering Mechanics',h:30},
      {c:'ENG205',n:'Electrical Circuits',h:35},{c:'ENG206',n:'Electronics Basics',h:30},{c:'ENG207',n:'Digital Logic Design',h:30},
      {c:'ENG301',n:'Control Systems',h:35},{c:'ENG302',n:'Signals and Systems',h:35},{c:'ENG303',n:'Engineering Economics',h:20}
    ],
    SCI: [
      {c:'SCI101',n:'Physics I (Mechanics)',h:35},{c:'SCI102',n:'Physics II (E&M)',h:35},{c:'SCI103',n:'Physics III (Waves)',h:30},
      {c:'SCI104',n:'Modern Physics',h:30},{c:'SCI201',n:'General Chemistry I',h:35},{c:'SCI202',n:'General Chemistry II',h:35},
      {c:'SCI203',n:'Organic Chemistry I',h:40},{c:'SCI204',n:'Organic Chemistry II',h:40},{c:'SCI205',n:'Physical Chemistry',h:35},
      {c:'SCI301',n:'General Biology I',h:30},{c:'SCI302',n:'General Biology II',h:30},{c:'SCI303',n:'Cell Biology',h:30},
      {c:'SCI304',n:'Genetics',h:35},{c:'SCI305',n:'Molecular Biology',h:35},{c:'SCI306',n:'Ecology',h:25}
    ],
    BUS: [
      {c:'BUS101',n:'Principles of Accounting I',h:35},{c:'BUS102',n:'Principles of Accounting II',h:35},{c:'BUS103',n:'Financial Accounting',h:35},
      {c:'BUS104',n:'Managerial Accounting',h:30},{c:'BUS201',n:'Microeconomics',h:30},{c:'BUS202',n:'Macroeconomics',h:30},
      {c:'BUS203',n:'Business Statistics',h:35},{c:'BUS204',n:'Business Mathematics',h:30},{c:'BUS301',n:'Financial Management',h:35},
      {c:'BUS302',n:'Marketing Principles',h:25},{c:'BUS303',n:'Business Law',h:30},{c:'BUS304',n:'Management Principles',h:25},
      {c:'BUS305',n:'Operations Management',h:30},{c:'BUS306',n:'Human Resource Management',h:25},{c:'BUS307',n:'Entrepreneurship',h:20}
    ],
    GEN: [
      {c:'GEN101',n:'Use of English I',h:25},{c:'GEN102',n:'Use of English II',h:25},{c:'GEN103',n:'Communication Skills',h:20},
      {c:'GEN104',n:'Technical Writing',h:20},{c:'GEN201',n:'Philosophy & Logic',h:25},{c:'GEN202',n:'Nigerian History',h:20},
      {c:'GEN203',n:'Citizenship Education',h:15},{c:'GEN204',n:'Peace Studies',h:15},{c:'GEN301',n:'Computer Fundamentals',h:25},
      {c:'GEN302',n:'Introduction to Programming',h:35},{c:'GEN303',n:'Web Development Basics',h:30},{c:'GEN304',n:'Data Analysis Basics',h:25}
    ]
  };

  for (const [deptCode, subjects] of Object.entries(allSubjects)) {
    const deptR = await pool.query('SELECT id FROM departments WHERE code=$1', [deptCode]);
    if (deptR.rows.length > 0) {
      const deptId = deptR.rows[0].id;
      for (const s of subjects) {
        try {
          await pool.query('INSERT INTO subjects (department_id,name,code,estimated_hours) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [deptId, s.n, s.c, s.h]);
        } catch (e) {}
      }
    }
  }
  console.log('✅ Subjects inserted');
}

// JWT Middleware
function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  
  jwt.verify(token, process.env.JWT_SECRET || 'rnpathfinders-secret-2024', (err, decoded) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = decoded;
    next();
  });
}

// Generate random code
function generateCode(prefix = 'OP', length = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = prefix;
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// =============================================
// AUTH ROUTES
// =============================================

app.post('/api/auth/register', async (req, res) => {
  try {
    const { accessCode, email, password } = req.body;
    if (!accessCode || !email || !password) return res.status(400).json({ error: 'All fields required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be 8+ characters' });

    const codeR = await pool.query('SELECT id,used FROM access_codes WHERE UPPER(code)=UPPER($1)', [accessCode]);
    if (codeR.rows.length === 0) return res.status(400).json({ error: 'Invalid access code' });
    if (codeR.rows[0].used) return res.status(400).json({ error: 'Access code already used' });

    const existR = await pool.query('SELECT id FROM users WHERE LOWER(email)=LOWER($1)', [email]);
    if (existR.rows.length > 0) return res.status(400).json({ error: 'Email already registered' });

    const hashedPw = await bcrypt.hash(password, 10);
    const userR = await pool.query('INSERT INTO users (email,password) VALUES ($1,$2) RETURNING id,email,is_admin', [email.toLowerCase(), hashedPw]);
    const user = userR.rows[0];

    await pool.query('UPDATE access_codes SET used=TRUE,used_by=$1,used_at=CURRENT_TIMESTAMP WHERE id=$2', [user.id, codeR.rows[0].id]);

    const token = jwt.sign({ userId: user.id, email: user.email, isAdmin: user.is_admin }, process.env.JWT_SECRET || 'rnpathfinders-secret-2024', { expiresIn: '7d' });

    // Send welcome email
    await sendEmail(email, 'Welcome to RNPathfinders! 🎯', `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #00f0ff;">Welcome to RNPathfinders! 🛡️</h1>
        <p>Your account has been successfully created.</p>
        <p>You're now ready to begin your focused study journey. Remember:</p>
        <ul>
          <li>🎯 One subject at a time</li>
          <li>⏱️ Minimum 5-minute sessions</li>
          <li>📝 Complete AARs for reflection</li>
        </ul>
        <p>Good luck, Operative!</p>
        <p style="color: #888;">— The RNPathfinders Team</p>
      </div>
    `);

    res.json({ message: 'Registration successful', token, user: { id: user.id, email: user.email, isAdmin: user.is_admin, onboardingComplete: false } });
  } catch (e) {
    console.error('Register error:', e);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const userR = await pool.query('SELECT * FROM users WHERE LOWER(email)=LOWER($1)', [email]);
    if (userR.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = userR.rows[0];
    const validPw = await bcrypt.compare(password, user.password);
    if (!validPw) return res.status(401).json({ error: 'Invalid credentials' });

    await pool.query('UPDATE users SET last_activity=CURRENT_TIMESTAMP WHERE id=$1', [user.id]);

    const token = jwt.sign({ userId: user.id, email: user.email, isAdmin: user.is_admin }, process.env.JWT_SECRET || 'rnpathfinders-secret-2024', { expiresIn: '7d' });

    res.json({ message: 'Login successful', token, user: { id: user.id, email: user.email, isAdmin: user.is_admin, onboardingComplete: user.onboarding_complete, primarySubjectId: user.primary_subject_id } });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Login failed' });
  }
});

// =============================================
// FORGOT PASSWORD
// =============================================

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const userR = await pool.query('SELECT id,email FROM users WHERE LOWER(email)=LOWER($1)', [email]);
    
    // Always return success to prevent email enumeration
    if (userR.rows.length === 0) {
      return res.json({ message: 'If an account exists with this email, a reset link will be sent.' });
    }

    const user = userR.rows[0];
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3600000); // 1 hour

    await pool.query('INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)', [user.id, resetToken, expiresAt]);

    const resetLink = `${process.env.FRONTEND_URL || 'https://rnpathfinders.ng'}/reset-password.html?token=${resetToken}`;

    await sendEmail(user.email, 'Password Reset - RNPathfinders', `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #00f0ff;">Password Reset Request 🔐</h1>
        <p>You requested a password reset for your RNPathfinders account.</p>
        <p>Click the button below to reset your password:</p>
        <p style="text-align: center; margin: 30px 0;">
          <a href="${resetLink}" style="background: linear-gradient(135deg, #00f0ff, #8338ec); color: #000; padding: 15px 30px; text-decoration: none; border-radius: 4px; font-weight: bold;">Reset Password</a>
        </p>
        <p style="color: #888; font-size: 12px;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
        <p style="color: #888; font-size: 12px;">Reset link: ${resetLink}</p>
      </div>
    `);

    res.json({ message: 'If an account exists with this email, a reset link will be sent.' });
  } catch (e) {
    console.error('Forgot password error:', e);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password required' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be 8+ characters' });

    const resetR = await pool.query('SELECT * FROM password_resets WHERE token=$1 AND used=FALSE AND expires_at > CURRENT_TIMESTAMP', [token]);
    if (resetR.rows.length === 0) return res.status(400).json({ error: 'Invalid or expired reset token' });

    const resetRecord = resetR.rows[0];
    const hashedPw = await bcrypt.hash(newPassword, 10);

    await pool.query('UPDATE users SET password=$1 WHERE id=$2', [hashedPw, resetRecord.user_id]);
    await pool.query('UPDATE password_resets SET used=TRUE WHERE id=$1', [resetRecord.id]);

    // Get user email for notification
    const userR = await pool.query('SELECT email FROM users WHERE id=$1', [resetRecord.user_id]);
    if (userR.rows.length > 0) {
      await sendEmail(userR.rows[0].email, 'Password Changed - RNPathfinders', `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #00ff88;">Password Changed Successfully ✅</h1>
          <p>Your RNPathfinders password has been changed.</p>
          <p>If you didn't make this change, please contact support immediately.</p>
        </div>
      `);
    }

    res.json({ message: 'Password reset successful. You can now login with your new password.' });
  } catch (e) {
    console.error('Reset password error:', e);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// =============================================
// USER UNLOCK REQUEST
// =============================================

app.post('/api/unlock-request', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Check if user has a locked subject
    const userR = await pool.query('SELECT * FROM users WHERE id=$1', [userId]);
    if (userR.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    
    const user = userR.rows[0];
    if (!user.primary_subject_id) return res.status(400).json({ error: 'No subject to unlock' });

    // Check unlock progress
    const daysPassed = user.subject_locked_at ? Math.floor((Date.now() - new Date(user.subject_locked_at)) / (1000 * 60 * 60 * 24)) : 0;
    const sessions = user.session_count || 0;
    const aars = user.aar_count || 0;

    // Check if requirements met
    const requirementsMet = daysPassed >= 7 && sessions >= 5 && aars >= 3;

    if (requirementsMet) {
      // Auto-unlock if requirements met
      await pool.query('UPDATE users SET primary_subject_id=NULL, subject_locked_at=NULL, lock_expires_at=NULL, onboarding_complete=FALSE, unlock_requested=FALSE WHERE id=$1', [userId]);
      return res.json({ message: 'Congratulations! You have met all requirements. Your subject has been unlocked!', unlocked: true });
    }

    // Request unlock from admin
    await pool.query('UPDATE users SET unlock_requested=TRUE, unlock_requested_at=CURRENT_TIMESTAMP WHERE id=$1', [userId]);

    // Notify admins
    const adminsR = await pool.query('SELECT email FROM users WHERE is_admin=TRUE');
    for (const admin of adminsR.rows) {
      await sendEmail(admin.email, 'Unlock Request - RNPathfinders', `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #ffbe0b;">Unlock Request 🔓</h1>
          <p>User <strong>${user.email}</strong> has requested to unlock their subject.</p>
          <p>Progress:</p>
          <ul>
            <li>Days: ${daysPassed}/7</li>
            <li>Sessions: ${sessions}/5</li>
            <li>AARs: ${aars}/3</li>
          </ul>
          <p>Login to the admin panel to approve or deny this request.</p>
        </div>
      `);
    }

    res.json({ 
      message: 'Unlock request submitted. An admin will review your request.',
      progress: { days: daysPassed, sessions, aars },
      requirementsMet: false
    });
  } catch (e) {
    console.error('Unlock request error:', e);
    res.status(500).json({ error: 'Failed to submit unlock request' });
  }
});

// =============================================
// ADMIN: SEND ACCESS CODE VIA EMAIL
// =============================================

app.post('/api/admin/codes/send', verifyToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin required' });

    const { email, count = 1, prefix = 'OP' } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const codes = [];
    for (let i = 0; i < count; i++) {
      let code;
      let attempts = 0;
      do {
        code = generateCode(prefix, 6);
        const exists = await pool.query('SELECT id FROM access_codes WHERE code=$1', [code]);
        if (exists.rows.length === 0) break;
        attempts++;
      } while (attempts < 10);

      await pool.query('INSERT INTO access_codes (code, sent_to_email, sent_at) VALUES ($1, $2, CURRENT_TIMESTAMP)', [code, email]);
      codes.push(code);
    }

    // Send email with codes
    const codesHtml = codes.map(c => `<li style="font-family: monospace; font-size: 18px; margin: 10px 0;">${c}</li>`).join('');
    
    await sendEmail(email, 'Your RNPathfinders Access Code(s) 🎯', `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #00f0ff;">Your Access Code${codes.length > 1 ? 's' : ''} 🛡️</h1>
        <p>You've been invited to join RNPathfinders!</p>
        <p>Use ${codes.length > 1 ? 'one of these codes' : 'this code'} to register:</p>
        <ul style="list-style: none; padding: 20px; background: #1a1a2e; border-radius: 8px;">
          ${codesHtml}
        </ul>
        <p>Visit <a href="${process.env.FRONTEND_URL || 'https://rnpathfinders.ng'}" style="color: #00f0ff;">RNPathfinders</a> to get started.</p>
        <p style="color: #888;">Each code can only be used once.</p>
      </div>
    `);

    res.json({ 
      message: `${codes.length} code(s) sent to ${email}`,
      codes,
      email
    });
  } catch (e) {
    console.error('Send codes error:', e);
    res.status(500).json({ error: 'Failed to send codes' });
  }
});

// =============================================
// ADMIN: GET UNLOCK REQUESTS
// =============================================

app.get('/api/admin/unlock-requests', verifyToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin required' });

    const r = await pool.query(`
      SELECT u.id, u.email, u.session_count, u.aar_count, u.subject_locked_at, u.unlock_requested_at,
             s.name as subject_name, s.code as subject_code
      FROM users u
      LEFT JOIN subjects s ON u.primary_subject_id = s.id
      WHERE u.unlock_requested = TRUE
      ORDER BY u.unlock_requested_at DESC
    `);

    const requests = r.rows.map(row => {
      const daysPassed = row.subject_locked_at ? Math.floor((Date.now() - new Date(row.subject_locked_at)) / (1000 * 60 * 60 * 24)) : 0;
      return {
        ...row,
        days_passed: daysPassed,
        requirements_met: daysPassed >= 7 && row.session_count >= 5 && row.aar_count >= 3
      };
    });

    res.json({ requests });
  } catch (e) {
    console.error('Get unlock requests error:', e);
    res.status(500).json({ error: 'Failed to get requests' });
  }
});

// =============================================
// ADMIN: APPROVE/DENY UNLOCK
// =============================================

app.post('/api/admin/users/:id/approve-unlock', verifyToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin required' });

    const userId = req.params.id;
    const userR = await pool.query('SELECT email FROM users WHERE id=$1', [userId]);
    if (userR.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    await pool.query('UPDATE users SET primary_subject_id=NULL, subject_locked_at=NULL, lock_expires_at=NULL, onboarding_complete=FALSE, unlock_requested=FALSE, aar_count=0, session_count=0 WHERE id=$1', [userId]);

    await sendEmail(userR.rows[0].email, 'Subject Unlocked! 🎉 - RNPathfinders', `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #00ff88;">Subject Unlocked! 🔓</h1>
        <p>Great news! Your unlock request has been approved.</p>
        <p>You can now choose a new subject to focus on.</p>
        <p>Login to RNPathfinders to continue your journey!</p>
      </div>
    `);

    res.json({ message: 'User unlocked and notified via email' });
  } catch (e) {
    console.error('Approve unlock error:', e);
    res.status(500).json({ error: 'Failed to approve unlock' });
  }
});

app.post('/api/admin/users/:id/deny-unlock', verifyToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin required' });

    const userId = req.params.id;
    const { reason } = req.body;

    const userR = await pool.query('SELECT email FROM users WHERE id=$1', [userId]);
    if (userR.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    await pool.query('UPDATE users SET unlock_requested=FALSE WHERE id=$1', [userId]);

    await sendEmail(userR.rows[0].email, 'Unlock Request Update - RNPathfinders', `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #ffbe0b;">Unlock Request Update</h1>
        <p>Your unlock request was not approved at this time.</p>
        ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
        <p>Please continue working on meeting the requirements:</p>
        <ul>
          <li>7 days with the subject</li>
          <li>5 completed sessions</li>
          <li>3 after-action reviews</li>
        </ul>
        <p>Keep going, Operative! 💪</p>
      </div>
    `);

    res.json({ message: 'Request denied and user notified' });
  } catch (e) {
    console.error('Deny unlock error:', e);
    res.status(500).json({ error: 'Failed to deny unlock' });
  }
});

// =============================================
// EXISTING ROUTES (keeping all your routes)
// =============================================

app.get('/api/auth/me', verifyToken, async (req, res) => {
  try {
    const userR = await pool.query(`SELECT u.*,s.name as primary_subject_name,s.code as primary_subject_code,d.name as department_name,d.icon as department_icon FROM users u LEFT JOIN subjects s ON u.primary_subject_id=s.id LEFT JOIN departments d ON s.department_id=d.id WHERE u.id=$1`, [req.user.userId]);
    if (userR.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const u = userR.rows[0];
    res.json({ user: { id: u.id, email: u.email, isAdmin: u.is_admin, onboardingComplete: u.onboarding_complete, primarySubjectId: u.primary_subject_id, primarySubjectName: u.primary_subject_name, primarySubjectCode: u.primary_subject_code, departmentName: u.department_name, departmentIcon: u.department_icon, unlockRequested: u.unlock_requested } });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/departments', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM departments WHERE is_active=TRUE ORDER BY name');
    res.json({ departments: r.rows });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/departments/:id/subjects', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM subjects WHERE department_id=$1 AND is_active=TRUE ORDER BY code', [req.params.id]);
    res.json({ subjects: r.rows });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/subjects', async (req, res) => {
  try {
    const r = await pool.query('SELECT s.*,d.name as department_name FROM subjects s JOIN departments d ON s.department_id=d.id WHERE s.is_active=TRUE ORDER BY s.code');
    res.json({ subjects: r.rows });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/declare-subject', verifyToken, async (req, res) => {
  try {
    const { subjectId } = req.body;
    if (!subjectId) return res.status(400).json({ error: 'Subject required' });
    const userR = await pool.query('SELECT primary_subject_id FROM users WHERE id=$1', [req.user.userId]);
    if (userR.rows[0].primary_subject_id) return res.status(400).json({ error: 'Subject already locked' });
    const lockExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.query('UPDATE users SET primary_subject_id=$1,subject_locked_at=CURRENT_TIMESTAMP,lock_expires_at=$2,onboarding_complete=TRUE WHERE id=$3', [subjectId, lockExpires, req.user.userId]);
    res.json({ message: 'Subject locked for 7 days!' });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/resources', verifyToken, async (req, res) => {
  try {
    const userR = await pool.query('SELECT primary_subject_id FROM users WHERE id=$1', [req.user.userId]);
    const subjectId = userR.rows[0]?.primary_subject_id;
    if (!subjectId) return res.json({ resources: [] });
    const r = await pool.query('SELECT * FROM resources WHERE subject_id=$1 AND is_active=TRUE ORDER BY sort_order,title', [subjectId]);
    res.json({ resources: r.rows });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/progress', verifyToken, async (req, res) => {
  try {
    const userR = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.userId]);
    const u = userR.rows[0];
    const daysPassed = u.subject_locked_at ? Math.floor((Date.now() - new Date(u.subject_locked_at)) / (1000 * 60 * 60 * 24)) : 0;
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const streakR = await pool.query('SELECT DISTINCT DATE(completed_at) as d FROM study_sessions WHERE user_id=$1 AND is_completed=TRUE ORDER BY d DESC', [req.user.userId]);
    let streak = 0;
    if (streakR.rows.length > 0) {
      let checkDate = new Date(); checkDate.setHours(0, 0, 0, 0);
      for (const row of streakR.rows) {
        const sessionDate = new Date(row.d); sessionDate.setHours(0, 0, 0, 0);
        if (sessionDate.getTime() === checkDate.getTime()) { streak++; checkDate.setDate(checkDate.getDate() - 1); }
        else if (sessionDate.getTime() === checkDate.getTime() - 86400000) { streak++; checkDate = sessionDate; checkDate.setDate(checkDate.getDate() - 1); }
        else break;
      }
    }
    res.json({ progress: { totalSessions: u.session_count || 0, totalAARs: u.aar_count || 0, totalStudyMinutes: u.total_study_minutes || 0, currentStreak: streak, lockProgress: { days: daysPassed, sessions: u.session_count || 0, aars: u.aar_count || 0 } } });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/sessions/start', verifyToken, async (req, res) => {
  try {
    const { plannedDuration, sessionType } = req.body;
    if (!plannedDuration) return res.status(400).json({ error: 'Duration required' });
    const userR = await pool.query('SELECT primary_subject_id FROM users WHERE id=$1', [req.user.userId]);
    const subjectId = userR.rows[0]?.primary_subject_id;
    if (!subjectId) return res.status(400).json({ error: 'No subject selected' });
    const activeR = await pool.query('SELECT id FROM study_sessions WHERE user_id=$1 AND is_completed=FALSE', [req.user.userId]);
    if (activeR.rows.length > 0) return res.status(400).json({ error: 'Session already active' });
    const r = await pool.query('INSERT INTO study_sessions (user_id,subject_id,planned_duration,session_type) VALUES ($1,$2,$3,$4) RETURNING *', [req.user.userId, subjectId, plannedDuration, sessionType || 'active_recall']);
    res.json({ message: 'Session started', session: r.rows[0] });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/sessions/active', verifyToken, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM study_sessions WHERE user_id=$1 AND is_completed=FALSE ORDER BY started_at DESC LIMIT 1', [req.user.userId]);
    res.json({ activeSession: r.rows[0] || null });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/sessions/:id/complete', verifyToken, async (req, res) => {
  try {
    const sessionR = await pool.query('SELECT * FROM study_sessions WHERE id=$1 AND user_id=$2', [req.params.id, req.user.userId]);
    if (sessionR.rows.length === 0) return res.status(404).json({ error: 'Session not found' });
    const session = sessionR.rows[0];
    const actualMinutes = Math.floor((Date.now() - new Date(session.started_at)) / 60000);
    if (actualMinutes < 5) return res.status(400).json({ error: 'Minimum 5 minutes required' });
    await pool.query('UPDATE study_sessions SET is_completed=TRUE,completed_at=CURRENT_TIMESTAMP,actual_duration=$1 WHERE id=$2', [actualMinutes, req.params.id]);
    await pool.query('UPDATE users SET session_count=session_count+1,total_study_minutes=total_study_minutes+$1,last_activity=CURRENT_TIMESTAMP WHERE id=$2', [actualMinutes, req.user.userId]);
    res.json({ message: 'Session completed!', duration: actualMinutes });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/aar/submit', verifyToken, async (req, res) => {
  try {
    const { whatWorked, whatBlocked, tomorrowPlan } = req.body;
    if (!whatWorked || !whatBlocked || !tomorrowPlan) return res.status(400).json({ error: 'All fields required' });
    const wordCount = (whatWorked + ' ' + whatBlocked + ' ' + tomorrowPlan).split(/\s+/).filter(w => w).length;
    if (wordCount < 20) return res.status(400).json({ error: 'Minimum 20 words required' });
    const userR = await pool.query('SELECT primary_subject_id FROM users WHERE id=$1', [req.user.userId]);
    const subjectId = userR.rows[0]?.primary_subject_id;
    await pool.query('INSERT INTO aar_entries (user_id,subject_id,what_worked,what_blocked,tomorrow_plan) VALUES ($1,$2,$3,$4,$5)', [req.user.userId, subjectId, whatWorked, whatBlocked, tomorrowPlan]);
    await pool.query('UPDATE users SET aar_count=aar_count+1 WHERE id=$1', [req.user.userId]);
    res.json({ message: 'AAR submitted!' });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// Admin routes
app.post('/api/admin/codes', verifyToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin required' });
    const { count = 5, prefix = 'OP' } = req.body;
    const codes = [];
    for (let i = 0; i < count; i++) {
      let code;
      let attempts = 0;
      do {
        code = generateCode(prefix, 6);
        const exists = await pool.query('SELECT id FROM access_codes WHERE code=$1', [code]);
        if (exists.rows.length === 0) break;
        attempts++;
      } while (attempts < 10);
      await pool.query('INSERT INTO access_codes (code) VALUES ($1)', [code]);
      codes.push(code);
    }
    res.json({ message: `${count} codes generated`, codes });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/admin/codes', verifyToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin required' });
    const r = await pool.query('SELECT ac.*,u.email as used_by_email FROM access_codes ac LEFT JOIN users u ON ac.used_by=u.id ORDER BY ac.created_at DESC');
    res.json({ codes: r.rows });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/admin/users', verifyToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin required' });
    const r = await pool.query('SELECT u.id,u.email,u.is_admin,u.session_count,u.aar_count,u.total_study_minutes,u.onboarding_complete,u.unlock_requested,u.created_at,s.name as primary_subject FROM users u LEFT JOIN subjects s ON u.primary_subject_id=s.id ORDER BY u.created_at DESC');
    res.json({ users: r.rows });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/admin/resources', verifyToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin required' });
    const { subjectId, title, url, type } = req.body;
    if (!subjectId || !title || !url || !type) return res.status(400).json({ error: 'All fields required' });
    const r = await pool.query('INSERT INTO resources (subject_id,title,url,type) VALUES ($1,$2,$3,$4) RETURNING *', [subjectId, title, url, type]);
    res.json({ message: 'Resource added', resource: r.rows[0] });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/admin/resources', verifyToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin required' });
    const r = await pool.query('SELECT r.*,s.name as subject_name,s.code as subject_code FROM resources r JOIN subjects s ON r.subject_id=s.id ORDER BY s.code,r.sort_order');
    res.json({ resources: r.rows });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.delete('/api/admin/resources/:id', verifyToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin required' });
    await pool.query('DELETE FROM resources WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/admin/users/:id/unlock', verifyToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin required' });
    const userId = req.params.id;
    await pool.query('UPDATE users SET primary_subject_id=NULL,subject_locked_at=NULL,lock_expires_at=NULL,onboarding_complete=FALSE,aar_count=0,session_count=0,unlock_requested=FALSE WHERE id=$1', [userId]);
    res.json({ message: 'User unlocked successfully.' });
  } catch (e) { res.status(500).json({ error: 'Failed to unlock user' }); }
});

app.delete('/api/admin/users/:id', verifyToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin required' });
    const userId = req.params.id;
    if (parseInt(userId) === req.user.userId) return res.status(400).json({ error: 'Cannot delete yourself' });
    await pool.query('DELETE FROM user_progress WHERE user_id=$1', [userId]);
    await pool.query('DELETE FROM aar_entries WHERE user_id=$1', [userId]);
    await pool.query('DELETE FROM study_sessions WHERE user_id=$1', [userId]);
    await pool.query('DELETE FROM password_resets WHERE user_id=$1', [userId]);
    await pool.query('UPDATE access_codes SET used=FALSE,used_by=NULL,used_at=NULL WHERE used_by=$1', [userId]);
    await pool.query('DELETE FROM users WHERE id=$1', [userId]);
    res.json({ message: 'User deleted' });
  } catch (e) { res.status(500).json({ error: 'Failed to delete user' }); }
});

const PORT = process.env.PORT || 5000;
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ RNPathfinders API v3.0 running on port ${PORT}`);
    console.log(`📧 Email: ${process.env.SMTP_USER ? 'Configured' : 'Not configured (logging only)'}`);
    console.log(`🔐 Features: Password Reset, Email Codes, User Unlock Requests`);
  });
});
