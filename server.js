const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(express.json());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'https://rnpathfinders.ng',
  credentials: true
}));

// FIXED: Enhanced database pool with better connection handling
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 10000, // Return error after 10 seconds if connection not established
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000
});

// FIXED: Handle pool errors
pool.on('error', (err) => {
  console.error('❌ Unexpected database pool error:', err);
});

// FIXED: Test database connection on startup
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database connection failed:', err);
  } else {
    console.log('✅ Database connected successfully');
  }
});

// Email configuration check
const emailConfigured = process.env.BREVO_API_KEY && process.env.SENDER_EMAIL;
if (emailConfigured) {
  console.log('📧 Email: Configured');
  console.log('📧 BREVO_API_KEY length:', process.env.BREVO_API_KEY?.length || 0);
  console.log('📧 SENDER_EMAIL:', process.env.SENDER_EMAIL);
} else {
  console.log('📧 Email: Not configured (logging only)');
}

// FIXED: Initialize database with retry logic
async function initializeDatabase() {
  let retries = 3;
  while (retries > 0) {
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

      await pool.query(`CREATE TABLE IF NOT EXISTS departments (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        code VARCHAR(20) UNIQUE NOT NULL,
        icon VARCHAR(10) DEFAULT '📚',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`);

      await pool.query(`CREATE TABLE IF NOT EXISTS subjects (
        id SERIAL PRIMARY KEY,
        department_id INTEGER REFERENCES departments(id),
        name VARCHAR(100) NOT NULL,
        code VARCHAR(20) NOT NULL,
        estimated_hours INTEGER DEFAULT 20,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(department_id, code)
      )`);

      await pool.query(`CREATE TABLE IF NOT EXISTS resources (
        id SERIAL PRIMARY KEY,
        subject_id INTEGER REFERENCES subjects(id),
        title VARCHAR(255) NOT NULL,
        url TEXT NOT NULL,
        type VARCHAR(50) NOT NULL,
        duration_minutes INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`);

      await pool.query(`CREATE TABLE IF NOT EXISTS study_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        subject_id INTEGER REFERENCES subjects(id),
        session_type VARCHAR(50) DEFAULT 'active_recall',
        planned_duration INTEGER NOT NULL,
        actual_duration INTEGER,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        is_completed BOOLEAN DEFAULT FALSE
      )`);

      await pool.query(`CREATE TABLE IF NOT EXISTS aar_entries (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        subject_id INTEGER REFERENCES subjects(id),
        what_worked TEXT NOT NULL,
        what_blocked TEXT NOT NULL,
        tomorrow_plan TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`);

      await pool.query(`CREATE TABLE IF NOT EXISTS user_progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        resource_id INTEGER REFERENCES resources(id),
        completed BOOLEAN DEFAULT FALSE,
        completed_at TIMESTAMP,
        UNIQUE(user_id, resource_id)
      )`);

      await pool.query(`CREATE TABLE IF NOT EXISTS password_resets (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        token VARCHAR(255) UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`);

      console.log('✅ Tables ready');

      // Check if initial data exists
      const codesCheck = await pool.query('SELECT COUNT(*) as count FROM access_codes');
      if (parseInt(codesCheck.rows[0].count) === 0) {
        console.log('📝 First run - inserting initial data...');
        
        // Insert default codes
        const codes = ['OPERATIVE2024', 'MISSION2024', 'ACADEMIC2024', 'RNPATH2024', 'STUDY2024'];
        for (const code of codes) {
          await pool.query('INSERT INTO access_codes (code) VALUES ($1) ON CONFLICT DO NOTHING', [code]);
        }
        console.log('✅ Access codes inserted');

        // Insert departments
        const departments = [
          { name: 'Medicine & Nursing', code: 'MED', icon: '🏥' },
          { name: 'Engineering', code: 'ENG', icon: '⚙️' },
          { name: 'Science', code: 'SCI', icon: '🔬' },
          { name: 'Business', code: 'BUS', icon: '📊' },
          { name: 'General Studies', code: 'GEN', icon: '📚' }
        ];

        for (const dept of departments) {
          await pool.query(
            'INSERT INTO departments (name, code, icon) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [dept.name, dept.code, dept.icon]
          );
        }
        console.log('✅ Departments inserted');

        // Get department IDs for subjects
        const deptIds = await pool.query('SELECT id, code FROM departments');
        const deptMap = {};
        deptIds.rows.forEach(d => deptMap[d.code] = d.id);

        // Insert all 130 subjects
        const subjectsByDept = {
          MED: [
            {code:'MED101',name:'Human Anatomy',hours:35},
            {code:'MED102',name:'Human Physiology',hours:35},
            {code:'MED201',name:'Pharmacology',hours:35},
            {code:'MED202',name:'Pathophysiology',hours:30},
            {code:'MED203',name:'Microbiology',hours:30},
            {code:'MED204',name:'Biochemistry',hours:30},
            {code:'MED205',name:'Immunology',hours:25},
            {code:'MED206',name:'Histology',hours:25},
            {code:'MED207',name:'Embryology',hours:20},
            {code:'NUR101',name:'Fundamentals of Nursing',hours:25},
            {code:'NUR201',name:'Medical-Surgical Nursing',hours:40},
            {code:'NUR202',name:'Pediatric Nursing',hours:25},
            {code:'NUR203',name:'Obstetric Nursing',hours:25},
            {code:'NUR204',name:'Psychiatric Nursing',hours:25},
            {code:'NUR205',name:'Community Health Nursing',hours:25},
            {code:'NUR301',name:'Critical Care Nursing',hours:30},
            {code:'NUR302',name:'Emergency Nursing',hours:25},
            {code:'NUR303',name:'Geriatric Nursing',hours:20},
            {code:'NUR304',name:'Nursing Research',hours:20},
            {code:'NUR305',name:'Nursing Leadership',hours:20},
            {code:'NUR306',name:'Nursing Ethics',hours:15},
            {code:'NUR307',name:'Health Assessment',hours:20}
          ],
          ENG: [
            {code:'ENG101',name:'Engineering Mathematics I',hours:40},
            {code:'ENG102',name:'Engineering Mathematics II',hours:40},
            {code:'ENG103',name:'Engineering Mathematics III',hours:40},
            {code:'ENG104',name:'Calculus I',hours:35},
            {code:'ENG105',name:'Calculus II',hours:35},
            {code:'ENG106',name:'Linear Algebra',hours:30},
            {code:'ENG107',name:'Differential Equations',hours:30},
            {code:'ENG201',name:'Engineering Mechanics',hours:35},
            {code:'ENG202',name:'Thermodynamics',hours:30},
            {code:'ENG203',name:'Fluid Mechanics',hours:30},
            {code:'ENG204',name:'Strength of Materials',hours:30},
            {code:'ENG205',name:'Engineering Drawing',hours:25},
            {code:'ENG301',name:'Circuit Theory',hours:35},
            {code:'ENG302',name:'Electronics I',hours:35},
            {code:'ENG303',name:'Electronics II',hours:35},
            {code:'ENG304',name:'Digital Electronics',hours:30},
            {code:'ENG305',name:'Signals and Systems',hours:30},
            {code:'ENG306',name:'Control Systems',hours:30},
            {code:'ENG307',name:'Power Systems',hours:30},
            {code:'ENG308',name:'Electrical Machines',hours:30},
            {code:'ENG401',name:'Introduction to Programming',hours:40},
            {code:'ENG402',name:'Data Structures',hours:40},
            {code:'ENG403',name:'Algorithms',hours:35},
            {code:'ENG404',name:'Database Systems',hours:30},
            {code:'ENG405',name:'Computer Networks',hours:30},
            {code:'ENG406',name:'Operating Systems',hours:30},
            {code:'ENG501',name:'Structural Analysis',hours:35},
            {code:'ENG502',name:'Geotechnical Engineering',hours:30},
            {code:'ENG503',name:'Transportation Engineering',hours:25},
            {code:'ENG504',name:'Machine Design',hours:30},
            {code:'ENG505',name:'Manufacturing Processes',hours:30}
          ],
          SCI: [
            {code:'SCI101',name:'Physics I (Mechanics)',hours:40},
            {code:'SCI102',name:'Physics II (Electricity & Magnetism)',hours:40},
            {code:'SCI103',name:'Physics III (Waves & Optics)',hours:35},
            {code:'SCI104',name:'Modern Physics',hours:30},
            {code:'SCI105',name:'Quantum Mechanics',hours:35},
            {code:'SCI106',name:'Thermodynamics & Statistical Mechanics',hours:30},
            {code:'SCI201',name:'General Chemistry I',hours:40},
            {code:'SCI202',name:'General Chemistry II',hours:40},
            {code:'SCI203',name:'Organic Chemistry I',hours:40},
            {code:'SCI204',name:'Organic Chemistry II',hours:40},
            {code:'SCI205',name:'Physical Chemistry',hours:35},
            {code:'SCI206',name:'Analytical Chemistry',hours:30},
            {code:'SCI207',name:'Inorganic Chemistry',hours:30},
            {code:'SCI301',name:'General Biology',hours:35},
            {code:'SCI302',name:'Cell Biology',hours:35},
            {code:'SCI303',name:'Genetics',hours:35},
            {code:'SCI304',name:'Molecular Biology',hours:35},
            {code:'SCI305',name:'Ecology',hours:30},
            {code:'SCI306',name:'Evolution',hours:25},
            {code:'SCI401',name:'Calculus I',hours:40},
            {code:'SCI402',name:'Calculus II',hours:40},
            {code:'SCI403',name:'Linear Algebra',hours:30},
            {code:'SCI404',name:'Probability & Statistics',hours:35},
            {code:'SCI405',name:'Discrete Mathematics',hours:30},
            {code:'SCI501',name:'Introduction to Computer Science',hours:40},
            {code:'SCI502',name:'Programming Fundamentals',hours:40},
            {code:'SCI503',name:'Data Structures',hours:35},
            {code:'SCI504',name:'Algorithms',hours:35}
          ],
          BUS: [
            {code:'BUS101',name:'Principles of Accounting I',hours:35},
            {code:'BUS102',name:'Principles of Accounting II',hours:35},
            {code:'BUS103',name:'Cost Accounting',hours:30},
            {code:'BUS104',name:'Management Accounting',hours:30},
            {code:'BUS105',name:'Auditing',hours:30},
            {code:'BUS106',name:'Taxation',hours:25},
            {code:'BUS107',name:'Financial Statement Analysis',hours:25},
            {code:'BUS201',name:'Corporate Finance',hours:35},
            {code:'BUS202',name:'Investment Analysis',hours:30},
            {code:'BUS203',name:'Financial Markets',hours:30},
            {code:'BUS204',name:'International Finance',hours:25},
            {code:'BUS301',name:'Microeconomics',hours:35},
            {code:'BUS302',name:'Macroeconomics',hours:35},
            {code:'BUS303',name:'Econometrics',hours:30},
            {code:'BUS401',name:'Business Statistics I',hours:35},
            {code:'BUS402',name:'Business Statistics II',hours:35},
            {code:'BUS403',name:'Quantitative Methods',hours:30},
            {code:'BUS501',name:'Principles of Management',hours:30},
            {code:'BUS502',name:'Organizational Behavior',hours:30},
            {code:'BUS503',name:'Human Resource Management',hours:30},
            {code:'BUS504',name:'Operations Management',hours:30},
            {code:'BUS505',name:'Strategic Management',hours:30},
            {code:'BUS506',name:'Project Management',hours:25},
            {code:'BUS601',name:'Marketing Principles',hours:30},
            {code:'BUS602',name:'Consumer Behavior',hours:25},
            {code:'BUS603',name:'Marketing Research',hours:25},
            {code:'BUS701',name:'Business Law',hours:25},
            {code:'BUS702',name:'Entrepreneurship',hours:25},
            {code:'BUS703',name:'Business Ethics',hours:20}
          ],
          GEN: [
            {code:'GEN101',name:'Use of English I',hours:25},
            {code:'GEN102',name:'Use of English II',hours:25},
            {code:'GEN103',name:'Communication Skills',hours:20},
            {code:'GEN104',name:'Technical Writing',hours:20},
            {code:'GEN201',name:'Nigerian History',hours:20},
            {code:'GEN202',name:'Nigerian Government',hours:20},
            {code:'GEN203',name:'African Studies',hours:20},
            {code:'GEN301',name:'Philosophy & Logic',hours:25},
            {code:'GEN302',name:'Critical Thinking',hours:20},
            {code:'GEN401',name:'Introduction to Psychology',hours:25},
            {code:'GEN402',name:'Introduction to Sociology',hours:25},
            {code:'GEN501',name:'Computer Applications',hours:25},
            {code:'GEN502',name:'Digital Literacy',hours:20},
            {code:'GEN503',name:'Introduction to ICT',hours:20},
            {code:'GEN601',name:'Research Methods',hours:30},
            {code:'GEN602',name:'Academic Writing',hours:25},
            {code:'GEN603',name:'Study Skills',hours:20},
            {code:'GEN701',name:'Entrepreneurship Development',hours:25},
            {code:'GEN702',name:'Business Communication',hours:20},
            {code:'GEN703',name:'Leadership Skills',hours:20},
            {code:'GEN704',name:'Environmental Science',hours:20}
          ]
        };

        console.log('📚 Inserting 130 subjects...');
        for (const [deptCode, subjects] of Object.entries(subjectsByDept)) {
          const deptId = deptMap[deptCode];
          for (const subj of subjects) {
            await pool.query(
              'INSERT INTO subjects (department_id, code, name, estimated_hours) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
              [deptId, subj.code, subj.name, subj.hours]
            );
          }
        }
        console.log('✅ All data inserted successfully');
      } else {
        console.log('📊 Database already has data - skipping seed');
      }

      console.log('✅ Database initialization complete');
      return; // Success, exit retry loop
      
    } catch (error) {
      retries--;
      console.error(`❌ Database init error (${retries} retries left):`, error.message);
      if (retries === 0) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
    }
  }
}

// Auth middleware
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-this');
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = result.rows[0];
    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
};

// FIXED: Improved registration with transaction and proper error handling
app.post('/api/auth/register', async (req, res) => {
  const client = await pool.connect(); // Get dedicated client from pool
  
  try {
    const { accessCode, email, password } = req.body;

    // Validation
    if (!accessCode || !email || !password) {
      return res.status(400).json({ error: 'All fields required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    await client.query('BEGIN'); // Start transaction

    // Check access code with row lock to prevent race conditions
    const codeResult = await client.query(
      'SELECT * FROM access_codes WHERE code = $1 FOR UPDATE',
      [accessCode]
    );

    if (codeResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid access code' });
    }

    if (codeResult.rows[0].used) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Access code already used' });
    }

    // Check if email exists
    const emailCheck = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (emailCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Check if this will be first user (admin)
    const userCount = await client.query('SELECT COUNT(*) as count FROM users');
    const isFirstUser = parseInt(userCount.rows[0].count) === 0;

    // Create user
    const userResult = await client.query(
      'INSERT INTO users (email, password, is_admin) VALUES ($1, $2, $3) RETURNING *',
      [email, hashedPassword, isFirstUser]
    );

    const newUser = userResult.rows[0];

    // Mark code as used
    await client.query(
      'UPDATE access_codes SET used = true, used_by = $1, used_at = CURRENT_TIMESTAMP WHERE code = $2',
      [newUser.id, accessCode]
    );

    await client.query('COMMIT'); // Commit transaction

    // Generate token
    const token = jwt.sign(
      { userId: newUser.id },
      process.env.JWT_SECRET || 'your-secret-key-change-this',
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: {
        id: newUser.id,
        email: newUser.email,
        isAdmin: newUser.is_admin,
        onboardingComplete: newUser.onboarding_complete
      }
    });

  } catch (error) {
    await client.query('ROLLBACK'); // Rollback on error
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  } finally {
    client.release(); // CRITICAL: Always release client back to pool
  }
});

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last activity
    await pool.query('UPDATE users SET last_activity = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET || 'your-secret-key-change-this',
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        isAdmin: user.is_admin,
        onboardingComplete: user.onboarding_complete,
        primarySubjectId: user.primary_subject_id
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});


// Get current user
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.*,
        s.name as primary_subject_name,
        s.code as primary_subject_code,
        d.name as department_name,
        d.icon as department_icon
      FROM users u
      LEFT JOIN subjects s ON u.primary_subject_id = s.id
      LEFT JOIN departments d ON s.department_id = d.id
      WHERE u.id = $1
    `, [req.user.id]);

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

// Forgot password
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    
    if (userResult.rows.length === 0) {
      return res.status(200).json({ message: 'If email exists, reset link sent' });
    }

    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3600000); // 1 hour

    await pool.query(
      'INSERT INTO password_resets (email, token, expires_at) VALUES ($1, $2, $3)',
      [email, token, expiresAt]
    );

    const resetLink = `${process.env.FRONTEND_URL}/reset-password.html?token=${token}`;

    if (emailConfigured) {
      try {
        await sendEmail({
          to: email,
          subject: 'Reset Your RNPathfinders Password',
          html: `
            <h2>Password Reset Request</h2>
            <p>Click the link below to reset your password:</p>
            <a href="${resetLink}">${resetLink}</a>
            <p>This link expires in 1 hour.</p>
            <p>If you didn't request this, ignore this email.</p>
          `
        });
      } catch (emailError) {
        console.error('Email send failed:', emailError);
      }
    } else {
      console.log('📧 Would send reset link to:', email);
      console.log('Reset link:', resetLink);
    }

    res.json({ message: 'If email exists, reset link sent' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// Reset password
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const resetResult = await pool.query(
      'SELECT * FROM password_resets WHERE token = $1 AND used = false AND expires_at > NOW()',
      [token]
    );

    if (resetResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    const reset = resetResult.rows[0];
    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query('UPDATE users SET password = $1 WHERE email = $2', [hashedPassword, reset.email]);
    await pool.query('UPDATE password_resets SET used = true WHERE id = $1', [reset.id]);

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Get departments
app.get('/api/departments', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM departments WHERE is_active = true ORDER BY name');
    res.json({ departments: result.rows });
  } catch (error) {
    console.error('Error fetching departments:', error);
    res.status(500).json({ error: 'Failed to fetch departments' });
  }
});

// Get subjects by department
app.get('/api/departments/:id/subjects', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM subjects WHERE department_id = $1 AND is_active = true ORDER BY code',
      [req.params.id]
    );
    res.json({ subjects: result.rows });
  } catch (error) {
    console.error('Error fetching subjects:', error);
    res.status(500).json({ error: 'Failed to fetch subjects' });
  }
});

// Get all subjects
app.get('/api/subjects', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, d.name as department_name 
      FROM subjects s
      JOIN departments d ON s.department_id = d.id
      WHERE s.is_active = true
      ORDER BY d.name, s.code
    `);
    res.json({ subjects: result.rows });
  } catch (error) {
    console.error('Error fetching subjects:', error);
    res.status(500).json({ error: 'Failed to fetch subjects' });
  }
});

// Declare subject
app.post('/api/declare-subject', authMiddleware, async (req, res) => {
  try {
    const { subjectId } = req.body;

    if (!subjectId) {
      return res.status(400).json({ error: 'Subject ID required' });
    }

    const lockExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await pool.query(
      `UPDATE users SET 
        primary_subject_id = $1,
        subject_locked_at = CURRENT_TIMESTAMP,
        lock_expires_at = $2,
        onboarding_complete = true
      WHERE id = $3`,
      [subjectId, lockExpires, req.user.id]
    );

    res.json({ message: 'Subject locked successfully' });
  } catch (error) {
    console.error('Declare subject error:', error);
    res.status(500).json({ error: 'Failed to declare subject' });
  }
});

// Get user progress
app.get('/api/progress', authMiddleware, async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        COUNT(DISTINCT DATE(started_at)) as total_days,
        COUNT(CASE WHEN is_completed = true THEN 1 END) as total_sessions,
        COALESCE(SUM(actual_duration), 0) as total_study_minutes
      FROM study_sessions
      WHERE user_id = $1
    `, [req.user.id]);

    const aars = await pool.query(
      'SELECT COUNT(*) as count FROM aar_entries WHERE user_id = $1',
      [req.user.id]
    );

    const lockProgress = {
      days: Math.min(
        Math.floor((Date.now() - new Date(req.user.subject_locked_at).getTime()) / (24 * 60 * 60 * 1000)),
        7
      ),
      sessions: req.user.session_count || 0,
      aars: req.user.aar_count || 0
    };

    res.json({
      progress: {
        totalDays: parseInt(stats.rows[0].total_days) || 0,
        totalSessions: parseInt(stats.rows[0].total_sessions) || 0,
        totalStudyMinutes: parseInt(stats.rows[0].total_study_minutes) || 0,
        totalAARs: parseInt(aars.rows[0].count) || 0,
        currentStreak: 0,
        lockProgress
      }
    });
  } catch (error) {
    console.error('Progress error:', error);
    res.status(500).json({ error: 'Failed to fetch progress' });
  }
});

// Get resources
app.get('/api/resources', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.* FROM resources r
       WHERE r.subject_id = $1 AND r.is_active = true
       ORDER BY r.sort_order, r.id`,
      [req.user.primary_subject_id]
    );
    res.json({ resources: result.rows });
  } catch (error) {
    console.error('Resources error:', error);
    res.status(500).json({ error: 'Failed to fetch resources' });
  }
});

// Start session
app.post('/api/sessions/start', authMiddleware, async (req, res) => {
  try {
    const { plannedDuration, sessionType } = req.body;

    const activeCheck = await pool.query(
      'SELECT * FROM study_sessions WHERE user_id = $1 AND is_completed = false',
      [req.user.id]
    );

    if (activeCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Active session already exists' });
    }

    const result = await pool.query(
      `INSERT INTO study_sessions (user_id, subject_id, planned_duration, session_type)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.id, req.user.primary_subject_id, plannedDuration, sessionType || 'review']
    );

    res.json({ session: result.rows[0] });
  } catch (error) {
    console.error('Start session error:', error);
    res.status(500).json({ error: 'Failed to start session' });
  }
});

// Get active session
app.get('/api/sessions/active', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM study_sessions WHERE user_id = $1 AND is_completed = false ORDER BY started_at DESC LIMIT 1',
      [req.user.id]
    );
    
    res.json({ activeSession: result.rows[0] || null });
  } catch (error) {
    console.error('Active session error:', error);
    res.status(500).json({ error: 'Failed to fetch active session' });
  }
});

// Complete session
app.post('/api/sessions/:id/complete', authMiddleware, async (req, res) => {
  try {
    const sessionId = req.params.id;
    
    const session = await pool.query(
      'SELECT * FROM study_sessions WHERE id = $1 AND user_id = $2',
      [sessionId, req.user.id]
    );

    if (session.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const startTime = new Date(session.rows[0].started_at);
    const actualDuration = Math.floor((Date.now() - startTime.getTime()) / 60000);

    await pool.query(
      `UPDATE study_sessions SET 
        is_completed = true,
        completed_at = CURRENT_TIMESTAMP,
        actual_duration = $1
       WHERE id = $2`,
      [actualDuration, sessionId]
    );

    await pool.query(
      'UPDATE users SET session_count = session_count + 1, total_study_minutes = total_study_minutes + $1 WHERE id = $2',
      [actualDuration, req.user.id]
    );

    res.json({ message: 'Session completed' });
  } catch (error) {
    console.error('Complete session error:', error);
    res.status(500).json({ error: 'Failed to complete session' });
  }
});

// Submit AAR
app.post('/api/aar/submit', authMiddleware, async (req, res) => {
  try {
    const { whatWorked, whatBlocked, tomorrowPlan } = req.body;

    if (!whatWorked || !whatBlocked || !tomorrowPlan) {
      return res.status(400).json({ error: 'All fields required' });
    }

    await pool.query(
      `INSERT INTO aar_entries (user_id, subject_id, what_worked, what_blocked, tomorrow_plan)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, req.user.primary_subject_id, whatWorked, whatBlocked, tomorrowPlan]
    );

    await pool.query('UPDATE users SET aar_count = aar_count + 1 WHERE id = $1', [req.user.id]);

    res.json({ message: 'AAR submitted successfully' });
  } catch (error) {
    console.error('AAR submit error:', error);
    res.status(500).json({ error: 'Failed to submit AAR' });
  }
});

// Unlock request
app.post('/api/unlock-request', authMiddleware, async (req, res) => {
  try {
    await pool.query(
      'UPDATE users SET unlock_requested = true, unlock_requested_at = CURRENT_TIMESTAMP WHERE id = $1',
      [req.user.id]
    );

    res.json({ message: 'Unlock request submitted' });
  } catch (error) {
    console.error('Unlock request error:', error);
    res.status(500).json({ error: 'Failed to submit unlock request' });
  }
});

// Email sending function
async function sendEmail({ to, subject, html }) {
  if (!emailConfigured) {
    console.log('📧 Email not configured. Would send to:', to);
    console.log('Subject:', subject);
    return;
  }

  try {
    console.log('📧 Attempting to send email...');
    console.log('📧 BREVO_API_KEY exists:', !!process.env.BREVO_API_KEY);
    console.log('📧 RN exists:', !!process.env.RN);

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': process.env.BREVO_API_KEY || process.env.RN,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: {
          email: process.env.SENDER_EMAIL,
          name: 'RNPathfinders'
        },
        to: [{ email: to }],
        subject: subject,
        htmlContent: html
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(JSON.stringify(errorData));
    }

    console.log('📧 Email sent to:', to);
  } catch (error) {
    console.error('📧 Email error:', error.message);
    throw error;
  }
}

// Admin endpoints
app.get('/api/admin/codes', authMiddleware, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin only' });
  }

  try {
    const result = await pool.query(`
      SELECT ac.*, u.email as used_by_email
      FROM access_codes ac
      LEFT JOIN users u ON ac.used_by = u.id
      ORDER BY ac.created_at DESC
    `);
    res.json({ codes: result.rows });
  } catch (error) {
    console.error('Admin codes error:', error);
    res.status(500).json({ error: 'Failed to fetch codes' });
  }
});

app.post('/api/admin/codes', authMiddleware, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin only' });
  }

  try {
    const { count = 1, prefix = 'CODE' } = req.body;
    const codes = [];

    for (let i = 0; i < count; i++) {
      const code = `${prefix}${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
      await pool.query('INSERT INTO access_codes (code) VALUES ($1)', [code]);
      codes.push(code);
    }

    res.json({ codes });
  } catch (error) {
    console.error('Generate codes error:', error);
    res.status(500).json({ error: 'Failed to generate codes' });
  }
});

app.post('/api/admin/codes/send', authMiddleware, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin only' });
  }

  try {
    const { email, prefix = 'CODE' } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    const code = `${prefix}${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
    
    await pool.query(
      'INSERT INTO access_codes (code, sent_to_email, sent_at) VALUES ($1, $2, CURRENT_TIMESTAMP)',
      [code, email]
    );

    if (emailConfigured) {
      await sendEmail({
        to: email,
        subject: 'Your RNPathfinders Access Code(s) 🎯',
        html: `
          <h2>Welcome to RNPathfinders!</h2>
          <p>Your access code is:</p>
          <h1 style="background:#f0f0f0;padding:20px;text-align:center;font-family:monospace;">${code}</h1>
          <p>Use this code to register at: <a href="${process.env.FRONTEND_URL}">${process.env.FRONTEND_URL}</a></p>
          <p>This code is for single use only.</p>
        `
      });
    }

    res.json({ message: 'Code sent successfully', code });
  } catch (error) {
    console.error('Send code error:', error);
    res.status(500).json({ error: 'Failed to send code' });
  }
});

app.get('/api/admin/users', authMiddleware, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin only' });
  }

  try {
    const result = await pool.query(`
      SELECT u.id, u.email, u.is_admin, u.session_count, u.aar_count,
             s.code || ' - ' || s.name as primary_subject,
             u.unlock_requested
      FROM users u
      LEFT JOIN subjects s ON u.primary_subject_id = s.id
      ORDER BY u.created_at DESC
    `);
    res.json({ users: result.rows });
  } catch (error) {
    console.error('Admin users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.post('/api/admin/users/:id/unlock', authMiddleware, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin only' });
  }

  try {
    await pool.query(
      `UPDATE users SET 
        primary_subject_id = NULL,
        subject_locked_at = NULL,
        lock_expires_at = NULL,
        onboarding_complete = FALSE,
        unlock_requested = FALSE
       WHERE id = $1`,
      [req.params.id]
    );

    res.json({ message: 'User unlocked successfully' });
  } catch (error) {
    console.error('Unlock user error:', error);
    res.status(500).json({ error: 'Failed to unlock user' });
  }
});

app.delete('/api/admin/users/:id', authMiddleware, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin only' });
  }

  try {
    if (req.params.id === req.user.id.toString()) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }

    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

app.get('/api/admin/unlock-requests', authMiddleware, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin only' });
  }

  try {
    const result = await pool.query(`
      SELECT u.id, u.email, u.session_count, u.aar_count, u.unlock_requested_at,
             s.code || ' - ' || s.name as primary_subject,
             EXTRACT(DAY FROM (NOW() - u.subject_locked_at)) as days_locked
      FROM users u
      LEFT JOIN subjects s ON u.primary_subject_id = s.id
      WHERE u.unlock_requested = true
      ORDER BY u.unlock_requested_at ASC
    `);
    res.json({ requests: result.rows });
  } catch (error) {
    console.error('Unlock requests error:', error);
    res.status(500).json({ error: 'Failed to fetch unlock requests' });
  }
});

app.post('/api/admin/users/:id/approve-unlock', authMiddleware, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin only' });
  }

  try {
    await pool.query(
      `UPDATE users SET 
        primary_subject_id = NULL,
        subject_locked_at = NULL,
        lock_expires_at = NULL,
        onboarding_complete = FALSE,
        unlock_requested = FALSE
       WHERE id = $1`,
      [req.params.id]
    );

    res.json({ message: 'Unlock request approved' });
  } catch (error) {
    console.error('Approve unlock error:', error);
    res.status(500).json({ error: 'Failed to approve unlock' });
  }
});

app.post('/api/admin/users/:id/deny-unlock', authMiddleware, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin only' });
  }

  try {
    await pool.query(
      'UPDATE users SET unlock_requested = FALSE WHERE id = $1',
      [req.params.id]
    );

    res.json({ message: 'Unlock request denied' });
  } catch (error) {
    console.error('Deny unlock error:', error);
    res.status(500).json({ error: 'Failed to deny unlock' });
  }
});

app.get('/api/admin/resources', authMiddleware, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin only' });
  }

  try {
    const result = await pool.query(`
      SELECT r.*, s.code as subject_code, s.name as subject_name
      FROM resources r
      JOIN subjects s ON r.subject_id = s.id
      ORDER BY r.created_at DESC
    `);
    res.json({ resources: result.rows });
  } catch (error) {
    console.error('Admin resources error:', error);
    res.status(500).json({ error: 'Failed to fetch resources' });
  }
});

app.post('/api/admin/resources', authMiddleware, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin only' });
  }

  try {
    const { subjectId, title, url, type } = req.body;

    await pool.query(
      'INSERT INTO resources (subject_id, title, url, type) VALUES ($1, $2, $3, $4)',
      [subjectId, title, url, type]
    );

    res.json({ message: 'Resource added successfully' });
  } catch (error) {
    console.error('Add resource error:', error);
    res.status(500).json({ error: 'Failed to add resource' });
  }
});

app.delete('/api/admin/resources/:id', authMiddleware, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin only' });
  }

  try {
    await pool.query('DELETE FROM resources WHERE id = $1', [req.params.id]);
    res.json({ message: 'Resource deleted successfully' });
  } catch (error) {
    console.error('Delete resource error:', error);
    res.status(500).json({ error: 'Failed to delete resource' });
  }
});

app.post('/api/admin/subjects', authMiddleware, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin only' });
  }

  try {
    const { departmentId, code, name } = req.body;

    await pool.query(
      'INSERT INTO subjects (department_id, code, name) VALUES ($1, $2, $3)',
      [departmentId, code, name]
    );

    res.json({ message: 'Subject added successfully' });
  } catch (error) {
    console.error('Add subject error:', error);
    res.status(500).json({ error: 'Failed to add subject' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'RNPathfinders API is running',
    version: '3.0.1',
    domain: 'rnpathfinders.ng'
  });
});

// Test database
app.get('/api/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({
      status: 'ok',
      message: 'Database connected successfully',
      time: result.rows[0].now
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Database connection failed',
      error: error.message
    });
  }
});

// Initialize database and start server
const PORT = process.env.PORT || 5000;

initializeDatabase()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ RNPathfinders API v3.0.1 running on port ${PORT}`);
      console.log(`📧 Email: ${emailConfigured ? 'Configured' : 'Not configured (logging only)'}`);
      console.log(`🔐 Features: Password Reset, Email Codes, User Unlock Requests`);
    });
  })
  .catch(error => {
    console.error('❌ Failed to initialize database:', error);
    process.exit(1);
  });
