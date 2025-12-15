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

// PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Initialize database tables
async function initializeDatabase() {
  try {
    // Create users table with subject lock fields
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        is_admin BOOLEAN DEFAULT FALSE,
        primary_subject_id INTEGER,
        secondary_subject_id INTEGER,
        subject_locked_at TIMESTAMP,
        lock_expires_at TIMESTAMP,
        aar_count INTEGER DEFAULT 0,
        session_count INTEGER DEFAULT 0,
        total_study_minutes INTEGER DEFAULT 0,
        swaps_used INTEGER DEFAULT 0,
        last_activity TIMESTAMP,
        onboarding_complete BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create access_codes table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS access_codes (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        used_by INTEGER REFERENCES users(id),
        used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create departments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS departments (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        code VARCHAR(20) UNIQUE NOT NULL,
        description TEXT,
        icon VARCHAR(10) DEFAULT '📚',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create subjects table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subjects (
        id SERIAL PRIMARY KEY,
        department_id INTEGER REFERENCES departments(id),
        name VARCHAR(100) NOT NULL,
        code VARCHAR(20) NOT NULL,
        description TEXT,
        difficulty_level VARCHAR(20) DEFAULT 'intermediate',
        estimated_hours INTEGER DEFAULT 20,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(department_id, code)
      )
    `);

    // Create resources table (modified)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS resources (
        id SERIAL PRIMARY KEY,
        subject_id INTEGER REFERENCES subjects(id),
        title VARCHAR(255) NOT NULL,
        description TEXT,
        url TEXT NOT NULL,
        type VARCHAR(50) NOT NULL,
        duration_minutes INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        is_required BOOLEAN DEFAULT TRUE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create study_sessions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS study_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        subject_id INTEGER REFERENCES subjects(id),
        resource_id INTEGER REFERENCES resources(id),
        session_type VARCHAR(50) DEFAULT 'active_recall',
        planned_duration INTEGER NOT NULL,
        actual_duration INTEGER,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        is_completed BOOLEAN DEFAULT FALSE,
        notes TEXT
      )
    `);

    // Create aar_entries table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS aar_entries (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        subject_id INTEGER REFERENCES subjects(id),
        session_id INTEGER REFERENCES study_sessions(id),
        what_worked TEXT NOT NULL,
        what_blocked TEXT NOT NULL,
        tomorrow_plan TEXT NOT NULL,
        energy_level INTEGER DEFAULT 5,
        focus_rating INTEGER DEFAULT 5,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create user_progress table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        resource_id INTEGER REFERENCES resources(id),
        completed BOOLEAN DEFAULT FALSE,
        completed_at TIMESTAMP,
        time_spent_minutes INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, resource_id)
      )
    `);

    // Create unlock_history table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS unlock_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        subject_id INTEGER REFERENCES subjects(id),
        unlock_tier INTEGER NOT NULL,
        unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert default access codes
    const defaultCodes = ['OPERATIVE2024', 'MISSION2024', 'ACADEMIC2024', 'RNPATH2024', 'STUDY2024'];
    for (const code of defaultCodes) {
      await pool.query(
        'INSERT INTO access_codes (code) VALUES ($1) ON CONFLICT (code) DO NOTHING',
        [code]
      );
    }

    // Insert default departments
    const departments = [
      { name: 'Medicine & Nursing', code: 'MED', icon: '🏥', description: 'Medical and Healthcare Studies' },
      { name: 'Engineering', code: 'ENG', icon: '⚙️', description: 'Engineering and Technology' },
      { name: 'Science', code: 'SCI', icon: '🔬', description: 'Natural and Physical Sciences' },
      { name: 'Business', code: 'BUS', icon: '📊', description: 'Business and Management' },
      { name: 'General Studies', code: 'GEN', icon: '📚', description: 'General Courses for All Students' }
    ];

    for (const dept of departments) {
      await pool.query(
        `INSERT INTO departments (name, code, icon, description) 
         VALUES ($1, $2, $3, $4) ON CONFLICT (code) DO NOTHING`,
        [dept.name, dept.code, dept.icon, dept.description]
      );
    }

    // ==================== MEDICINE & NURSING SUBJECTS ====================
    const medicalSubjects = [
      // Anatomy & Physiology
      { code: 'MED101', name: 'Human Anatomy', hours: 35 },
      { code: 'MED102', name: 'Human Physiology', hours: 35 },
      { code: 'MED103', name: 'Anatomy & Physiology Combined', hours: 40 },
      // Nursing Core
      { code: 'NUR101', name: 'Fundamentals of Nursing', hours: 30 },
      { code: 'NUR102', name: 'Nursing Ethics & Law', hours: 20 },
      { code: 'NUR201', name: 'Medical-Surgical Nursing', hours: 45 },
      { code: 'NUR202', name: 'Pediatric Nursing', hours: 30 },
      { code: 'NUR203', name: 'Obstetric & Gynecological Nursing', hours: 35 },
      { code: 'NUR204', name: 'Psychiatric & Mental Health Nursing', hours: 30 },
      { code: 'NUR205', name: 'Community Health Nursing', hours: 25 },
      { code: 'NUR301', name: 'Critical Care Nursing', hours: 35 },
      { code: 'NUR302', name: 'Emergency Nursing', hours: 30 },
      // Medical Sciences
      { code: 'MED201', name: 'Pharmacology', hours: 40 },
      { code: 'MED202', name: 'Pathophysiology', hours: 35 },
      { code: 'MED203', name: 'Microbiology', hours: 30 },
      { code: 'MED204', name: 'Biochemistry', hours: 35 },
      { code: 'MED205', name: 'Medical Immunology', hours: 25 },
      { code: 'MED206', name: 'Histology', hours: 25 },
      { code: 'MED207', name: 'Embryology', hours: 20 },
      { code: 'MED301', name: 'Clinical Medicine', hours: 45 },
      { code: 'MED302', name: 'Medical Diagnostics', hours: 30 },
      { code: 'MED303', name: 'Health Assessment', hours: 25 }
    ];

    const medDept = await pool.query('SELECT id FROM departments WHERE code = $1', ['MED']);
    if (medDept.rows.length > 0) {
      const deptId = medDept.rows[0].id;
      for (const subj of medicalSubjects) {
        await pool.query(
          `INSERT INTO subjects (department_id, code, name, estimated_hours) 
           VALUES ($1, $2, $3, $4) ON CONFLICT (department_id, code) DO NOTHING`,
          [deptId, subj.code, subj.name, subj.hours]
        );
      }
    }

    // ==================== ENGINEERING SUBJECTS ====================
    const engineeringSubjects = [
      // Mathematics
      { code: 'ENG101', name: 'Engineering Mathematics I', hours: 35 },
      { code: 'ENG102', name: 'Engineering Mathematics II', hours: 35 },
      { code: 'ENG103', name: 'Engineering Mathematics III', hours: 35 },
      { code: 'ENG104', name: 'Linear Algebra', hours: 25 },
      { code: 'ENG105', name: 'Calculus', hours: 30 },
      { code: 'ENG106', name: 'Differential Equations', hours: 30 },
      { code: 'ENG107', name: 'Numerical Methods', hours: 25 },
      { code: 'ENG108', name: 'Statistics & Probability', hours: 25 },
      // Core Engineering
      { code: 'ENG201', name: 'Engineering Mechanics', hours: 35 },
      { code: 'ENG202', name: 'Thermodynamics', hours: 35 },
      { code: 'ENG203', name: 'Fluid Mechanics', hours: 35 },
      { code: 'ENG204', name: 'Strength of Materials', hours: 30 },
      { code: 'ENG205', name: 'Engineering Drawing', hours: 25 },
      { code: 'ENG206', name: 'Material Science', hours: 30 },
      // Electrical & Electronics
      { code: 'ENG301', name: 'Circuit Theory', hours: 30 },
      { code: 'ENG302', name: 'Electrical Machines', hours: 35 },
      { code: 'ENG303', name: 'Power Systems', hours: 35 },
      { code: 'ENG304', name: 'Electronics', hours: 30 },
      { code: 'ENG305', name: 'Digital Logic Design', hours: 25 },
      { code: 'ENG306', name: 'Control Systems', hours: 30 },
      { code: 'ENG307', name: 'Signals & Systems', hours: 30 },
      // Computer & IT
      { code: 'ENG401', name: 'Programming Fundamentals', hours: 30 },
      { code: 'ENG402', name: 'Data Structures & Algorithms', hours: 35 },
      { code: 'ENG403', name: 'Computer Architecture', hours: 25 },
      { code: 'ENG404', name: 'Operating Systems', hours: 30 },
      { code: 'ENG405', name: 'Database Systems', hours: 25 },
      { code: 'ENG406', name: 'Computer Networks', hours: 30 },
      // Civil & Mechanical
      { code: 'ENG501', name: 'Structural Analysis', hours: 35 },
      { code: 'ENG502', name: 'Surveying', hours: 25 },
      { code: 'ENG503', name: 'Concrete Technology', hours: 25 },
      { code: 'ENG504', name: 'Machine Design', hours: 35 },
      { code: 'ENG505', name: 'Manufacturing Processes', hours: 30 }
    ];

    const engDept = await pool.query('SELECT id FROM departments WHERE code = $1', ['ENG']);
    if (engDept.rows.length > 0) {
      const deptId = engDept.rows[0].id;
      for (const subj of engineeringSubjects) {
        await pool.query(
          `INSERT INTO subjects (department_id, code, name, estimated_hours) 
           VALUES ($1, $2, $3, $4) ON CONFLICT (department_id, code) DO NOTHING`,
          [deptId, subj.code, subj.name, subj.hours]
        );
      }
    }

    // ==================== SCIENCE SUBJECTS ====================
    const scienceSubjects = [
      // Physics
      { code: 'SCI101', name: 'General Physics I (Mechanics)', hours: 30 },
      { code: 'SCI102', name: 'General Physics II (Electricity & Magnetism)', hours: 30 },
      { code: 'SCI103', name: 'General Physics III (Waves & Optics)', hours: 25 },
      { code: 'SCI104', name: 'Modern Physics', hours: 30 },
      { code: 'SCI105', name: 'Quantum Mechanics', hours: 35 },
      { code: 'SCI106', name: 'Nuclear Physics', hours: 30 },
      // Chemistry
      { code: 'SCI201', name: 'General Chemistry I', hours: 30 },
      { code: 'SCI202', name: 'General Chemistry II', hours: 30 },
      { code: 'SCI203', name: 'Organic Chemistry I', hours: 35 },
      { code: 'SCI204', name: 'Organic Chemistry II', hours: 35 },
      { code: 'SCI205', name: 'Inorganic Chemistry', hours: 30 },
      { code: 'SCI206', name: 'Physical Chemistry', hours: 35 },
      { code: 'SCI207', name: 'Analytical Chemistry', hours: 25 },
      // Biology
      { code: 'SCI301', name: 'General Biology I', hours: 30 },
      { code: 'SCI302', name: 'General Biology II', hours: 30 },
      { code: 'SCI303', name: 'Cell Biology', hours: 25 },
      { code: 'SCI304', name: 'Genetics', hours: 30 },
      { code: 'SCI305', name: 'Molecular Biology', hours: 30 },
      { code: 'SCI306', name: 'Ecology', hours: 25 },
      { code: 'SCI307', name: 'Zoology', hours: 30 },
      { code: 'SCI308', name: 'Botany', hours: 25 },
      // Mathematics
      { code: 'SCI401', name: 'Calculus I', hours: 30 },
      { code: 'SCI402', name: 'Calculus II', hours: 30 },
      { code: 'SCI403', name: 'Linear Algebra', hours: 25 },
      { code: 'SCI404', name: 'Mathematical Statistics', hours: 30 },
      { code: 'SCI405', name: 'Discrete Mathematics', hours: 25 },
      // Computer Science
      { code: 'SCI501', name: 'Introduction to Computer Science', hours: 25 },
      { code: 'SCI502', name: 'Python Programming', hours: 30 },
      { code: 'SCI503', name: 'Data Science Fundamentals', hours: 30 }
    ];

    const sciDept = await pool.query('SELECT id FROM departments WHERE code = $1', ['SCI']);
    if (sciDept.rows.length > 0) {
      const deptId = sciDept.rows[0].id;
      for (const subj of scienceSubjects) {
        await pool.query(
          `INSERT INTO subjects (department_id, code, name, estimated_hours) 
           VALUES ($1, $2, $3, $4) ON CONFLICT (department_id, code) DO NOTHING`,
          [deptId, subj.code, subj.name, subj.hours]
        );
      }
    }

    // ==================== BUSINESS SUBJECTS ====================
    const businessSubjects = [
      // Accounting
      { code: 'BUS101', name: 'Principles of Accounting I', hours: 30 },
      { code: 'BUS102', name: 'Principles of Accounting II', hours: 30 },
      { code: 'BUS103', name: 'Cost Accounting', hours: 30 },
      { code: 'BUS104', name: 'Management Accounting', hours: 25 },
      { code: 'BUS105', name: 'Auditing', hours: 30 },
      { code: 'BUS106', name: 'Taxation', hours: 30 },
      { code: 'BUS107', name: 'Financial Accounting', hours: 35 },
      // Finance
      { code: 'BUS201', name: 'Corporate Finance', hours: 30 },
      { code: 'BUS202', name: 'Financial Management', hours: 30 },
      { code: 'BUS203', name: 'Investment Analysis', hours: 25 },
      { code: 'BUS204', name: 'Money & Banking', hours: 25 },
      { code: 'BUS205', name: 'International Finance', hours: 25 },
      // Economics
      { code: 'BUS301', name: 'Microeconomics', hours: 30 },
      { code: 'BUS302', name: 'Macroeconomics', hours: 30 },
      { code: 'BUS303', name: 'Development Economics', hours: 25 },
      { code: 'BUS304', name: 'Monetary Economics', hours: 25 },
      { code: 'BUS305', name: 'International Economics', hours: 25 },
      // Management
      { code: 'BUS401', name: 'Principles of Management', hours: 25 },
      { code: 'BUS402', name: 'Organizational Behavior', hours: 25 },
      { code: 'BUS403', name: 'Human Resource Management', hours: 25 },
      { code: 'BUS404', name: 'Operations Management', hours: 30 },
      { code: 'BUS405', name: 'Strategic Management', hours: 30 },
      { code: 'BUS406', name: 'Project Management', hours: 25 },
      // Marketing & Others
      { code: 'BUS501', name: 'Marketing Principles', hours: 25 },
      { code: 'BUS502', name: 'Consumer Behavior', hours: 20 },
      { code: 'BUS503', name: 'Business Law', hours: 30 },
      { code: 'BUS504', name: 'Business Statistics', hours: 30 },
      { code: 'BUS505', name: 'Entrepreneurship', hours: 25 },
      { code: 'BUS506', name: 'Business Communication', hours: 20 }
    ];

    const busDept = await pool.query('SELECT id FROM departments WHERE code = $1', ['BUS']);
    if (busDept.rows.length > 0) {
      const deptId = busDept.rows[0].id;
      for (const subj of businessSubjects) {
        await pool.query(
          `INSERT INTO subjects (department_id, code, name, estimated_hours) 
           VALUES ($1, $2, $3, $4) ON CONFLICT (department_id, code) DO NOTHING`,
          [deptId, subj.code, subj.name, subj.hours]
        );
      }
    }

    // ==================== GENERAL STUDIES SUBJECTS ====================
    const generalSubjects = [
      // Use of English
      { code: 'GEN101', name: 'Use of English I', hours: 25 },
      { code: 'GEN102', name: 'Use of English II', hours: 25 },
      { code: 'GEN103', name: 'Communication Skills', hours: 20 },
      { code: 'GEN104', name: 'Essay Writing & Comprehension', hours: 20 },
      // General Studies
      { code: 'GEN201', name: 'Nigerian History & Culture', hours: 20 },
      { code: 'GEN202', name: 'Citizenship Education', hours: 15 },
      { code: 'GEN203', name: 'Philosophy & Logic', hours: 25 },
      { code: 'GEN204', name: 'Introduction to Sociology', hours: 20 },
      { code: 'GEN205', name: 'Introduction to Psychology', hours: 25 },
      { code: 'GEN206', name: 'Peace & Conflict Studies', hours: 15 },
      { code: 'GEN207', name: 'Environmental Studies', hours: 20 },
      // Computer & Digital Literacy
      { code: 'GEN301', name: 'Introduction to Computers', hours: 20 },
      { code: 'GEN302', name: 'Computer Applications', hours: 25 },
      { code: 'GEN303', name: 'Digital Literacy', hours: 15 },
      // Research & Study Skills
      { code: 'GEN401', name: 'Research Methods', hours: 25 },
      { code: 'GEN402', name: 'Study Skills & Time Management', hours: 15 },
      { code: 'GEN403', name: 'Critical Thinking', hours: 20 },
      { code: 'GEN404', name: 'Library & Information Studies', hours: 15 },
      // Entrepreneurship & Leadership
      { code: 'GEN501', name: 'Entrepreneurship Development', hours: 25 },
      { code: 'GEN502', name: 'Leadership & Ethics', hours: 20 },
      { code: 'GEN503', name: 'Personal Development', hours: 15 }
    ];

    const genDept = await pool.query('SELECT id FROM departments WHERE code = $1', ['GEN']);
    if (genDept.rows.length > 0) {
      const deptId = genDept.rows[0].id;
      for (const subj of generalSubjects) {
        await pool.query(
          `INSERT INTO subjects (department_id, code, name, estimated_hours) 
           VALUES ($1, $2, $3, $4) ON CONFLICT (department_id, code) DO NOTHING`,
          [deptId, subj.code, subj.name, subj.hours]
        );
      }
    }

    console.log('✅ Database tables initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization error:', error.message);
  }
}

// ==================== MIDDLEWARE ====================

// Verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Check subject lock
const checkSubjectLock = async (req, res, next) => {
  try {
    const userResult = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [req.user.userId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    req.userFull = userResult.rows[0];
    next();
  } catch (error) {
    return res.status(500).json({ error: 'Server error' });
  }
};

// ==================== HEALTH ENDPOINTS ====================

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'RNPathfinders API is running',
    version: '2.0.0',
    domain: 'rnpathfinders.ng'
  });
});

app.get('/api/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ status: 'ok', message: 'Database connected successfully', time: result.rows[0].now });
  } catch (error) {
    res.status(500).json({ error: 'Database connection failed', details: error.message });
  }
});

// ==================== AUTH ENDPOINTS ====================

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, accessCode } = req.body;

    if (!email || !password || !accessCode) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const codeResult = await pool.query(
      'SELECT * FROM access_codes WHERE code = $1 AND used = FALSE',
      [accessCode]
    );

    if (codeResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or already used access code' });
    }

    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const userCount = await pool.query('SELECT COUNT(*) as count FROM users');
    const isAdmin = parseInt(userCount.rows[0].count) === 0;

    const newUser = await pool.query(
      `INSERT INTO users (email, password, is_admin, created_at) 
       VALUES ($1, $2, $3, NOW()) RETURNING id, email, is_admin, onboarding_complete`,
      [email, hashedPassword, isAdmin]
    );

    const userId = newUser.rows[0].id;

    await pool.query(
      'UPDATE access_codes SET used = TRUE, used_by = $1, used_at = NOW() WHERE code = $2',
      [userId, accessCode]
    );

    const token = jwt.sign(
      { userId, email, isAdmin },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Registration successful',
      token,
      user: { 
        id: userId, 
        email, 
        isAdmin,
        onboardingComplete: false
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed', details: error.message });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const userResult = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = userResult.rows[0];

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last activity
    await pool.query(
      'UPDATE users SET last_activity = NOW() WHERE id = $1',
      [user.id]
    );

    const token = jwt.sign(
      { userId: user.id, email: user.email, isAdmin: user.is_admin },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
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
    res.status(500).json({ error: 'Login failed', details: error.message });
  }
});

// Get current user
app.get('/api/auth/me', verifyToken, async (req, res) => {
  try {
    const userResult = await pool.query(
      `SELECT u.*, s.name as primary_subject_name, s.code as primary_subject_code,
              d.name as department_name, d.icon as department_icon
       FROM users u
       LEFT JOIN subjects s ON u.primary_subject_id = s.id
       LEFT JOIN departments d ON s.department_id = d.id
       WHERE u.id = $1`,
      [req.user.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    
    // Calculate lock status
    let lockStatus = null;
    if (user.primary_subject_id) {
      const now = new Date();
      const lockExpires = user.lock_expires_at ? new Date(user.lock_expires_at) : null;
      const daysRemaining = lockExpires ? Math.ceil((lockExpires - now) / (1000 * 60 * 60 * 24)) : 0;
      
      const canUnlock = lockExpires && now >= lockExpires && user.aar_count >= 3 && user.session_count >= 5;
      
      lockStatus = {
        isLocked: !canUnlock,
        daysRemaining: Math.max(0, daysRemaining),
        aarsNeeded: Math.max(0, 3 - user.aar_count),
        sessionsNeeded: Math.max(0, 5 - user.session_count)
      };
    }

    res.json({ 
      user: {
        id: user.id,
        email: user.email,
        isAdmin: user.is_admin,
        onboardingComplete: user.onboarding_complete,
        primarySubjectId: user.primary_subject_id,
        primarySubjectName: user.primary_subject_name,
        primarySubjectCode: user.primary_subject_code,
        departmentName: user.department_name,
        departmentIcon: user.department_icon,
        aarCount: user.aar_count,
        sessionCount: user.session_count,
        totalStudyMinutes: user.total_study_minutes,
        lockStatus,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// ==================== DEPARTMENT & SUBJECT ENDPOINTS ====================

// Get all departments
app.get('/api/departments', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM departments WHERE is_active = TRUE ORDER BY name'
    );
    res.json({ departments: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get departments' });
  }
});

// Get subjects by department
app.get('/api/departments/:deptId/subjects', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM subjects WHERE department_id = $1 AND is_active = TRUE ORDER BY code',
      [req.params.deptId]
    );
    res.json({ subjects: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get subjects' });
  }
});

// Get all subjects (for admin)
app.get('/api/subjects', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, d.name as department_name, d.icon as department_icon
       FROM subjects s
       JOIN departments d ON s.department_id = d.id
       WHERE s.is_active = TRUE
       ORDER BY d.name, s.code`
    );
    res.json({ subjects: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get subjects' });
  }
});

// ==================== PRIMARY SUBJECT DECLARATION ====================

// Declare primary subject (locks user for 7 days)
app.post('/api/declare-subject', verifyToken, async (req, res) => {
  try {
    const { subjectId } = req.body;
    
    if (!subjectId) {
      return res.status(400).json({ error: 'Subject ID is required' });
    }

    // Check if user already has a primary subject
    const userResult = await pool.query(
      'SELECT primary_subject_id, onboarding_complete FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (userResult.rows[0].primary_subject_id && userResult.rows[0].onboarding_complete) {
      return res.status(400).json({ error: 'You already have a primary subject declared' });
    }

    // Verify subject exists
    const subjectResult = await pool.query(
      'SELECT * FROM subjects WHERE id = $1 AND is_active = TRUE',
      [subjectId]
    );

    if (subjectResult.rows.length === 0) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    const subject = subjectResult.rows[0];

    // Lock user to this subject for 7 days
    const lockExpires = new Date();
    lockExpires.setDate(lockExpires.getDate() + 7);

    await pool.query(
      `UPDATE users SET 
        primary_subject_id = $1,
        subject_locked_at = NOW(),
        lock_expires_at = $2,
        onboarding_complete = TRUE,
        last_activity = NOW()
       WHERE id = $3`,
      [subjectId, lockExpires, req.user.userId]
    );

    // Log unlock history
    await pool.query(
      'INSERT INTO unlock_history (user_id, subject_id, unlock_tier) VALUES ($1, $2, 1)',
      [req.user.userId, subjectId]
    );

    res.json({
      message: 'Primary subject declared successfully',
      subject: {
        id: subject.id,
        name: subject.name,
        code: subject.code
      },
      lockExpiresAt: lockExpires,
      unlockRequirements: {
        days: 7,
        aars: 3,
        sessions: 5
      }
    });

  } catch (error) {
    console.error('Declare subject error:', error);
    res.status(500).json({ error: 'Failed to declare subject' });
  }
});

// ==================== RESOURCES ENDPOINTS ====================

// Get resources for user's primary subject only
app.get('/api/resources', verifyToken, checkSubjectLock, async (req, res) => {
  try {
    const user = req.userFull;
    
    if (!user.primary_subject_id) {
      return res.status(400).json({ error: 'No primary subject declared' });
    }

    const result = await pool.query(
      `SELECT r.*, 
              COALESCE(up.completed, FALSE) as completed,
              COALESCE(up.time_spent_minutes, 0) as time_spent
       FROM resources r
       LEFT JOIN user_progress up ON r.id = up.resource_id AND up.user_id = $1
       WHERE r.subject_id = $2 AND r.is_active = TRUE
       ORDER BY r.sort_order, r.id`,
      [req.user.userId, user.primary_subject_id]
    );

    res.json({ resources: result.rows });
  } catch (error) {
    console.error('Get resources error:', error);
    res.status(500).json({ error: 'Failed to get resources' });
  }
});

// Get single resource
app.get('/api/resources/:id', verifyToken, checkSubjectLock, async (req, res) => {
  try {
    const user = req.userFull;
    
    const result = await pool.query(
      `SELECT r.*, s.name as subject_name, s.code as subject_code,
              COALESCE(up.completed, FALSE) as completed,
              COALESCE(up.time_spent_minutes, 0) as time_spent
       FROM resources r
       JOIN subjects s ON r.subject_id = s.id
       LEFT JOIN user_progress up ON r.id = up.resource_id AND up.user_id = $1
       WHERE r.id = $2 AND r.subject_id = $3`,
      [req.user.userId, req.params.id, user.primary_subject_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Resource not found or not accessible' });
    }

    res.json({ resource: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get resource' });
  }
});

// ==================== STUDY SESSION ENDPOINTS ====================

// Start a study session
app.post('/api/sessions/start', verifyToken, checkSubjectLock, async (req, res) => {
  try {
    const { resourceId, plannedDuration, sessionType } = req.body;
    const user = req.userFull;

    if (!user.primary_subject_id) {
      return res.status(400).json({ error: 'No primary subject declared' });
    }

    // Check for existing active session
    const activeSession = await pool.query(
      'SELECT * FROM study_sessions WHERE user_id = $1 AND is_completed = FALSE',
      [req.user.userId]
    );

    if (activeSession.rows.length > 0) {
      return res.status(400).json({ 
        error: 'You have an active session. Complete it first.',
        activeSession: activeSession.rows[0]
      });
    }

    // Create new session
    const result = await pool.query(
      `INSERT INTO study_sessions 
       (user_id, subject_id, resource_id, session_type, planned_duration, started_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [req.user.userId, user.primary_subject_id, resourceId || null, sessionType || 'active_recall', plannedDuration || 25]
    );

    // Update last activity
    await pool.query('UPDATE users SET last_activity = NOW() WHERE id = $1', [req.user.userId]);

    res.json({
      message: 'Session started',
      session: result.rows[0]
    });

  } catch (error) {
    console.error('Start session error:', error);
    res.status(500).json({ error: 'Failed to start session' });
  }
});

// Complete a study session
app.post('/api/sessions/:id/complete', verifyToken, async (req, res) => {
  try {
    const { notes } = req.body;
    const sessionId = req.params.id;

    // Get session
    const sessionResult = await pool.query(
      'SELECT * FROM study_sessions WHERE id = $1 AND user_id = $2',
      [sessionId, req.user.userId]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionResult.rows[0];

    if (session.is_completed) {
      return res.status(400).json({ error: 'Session already completed' });
    }

    // Calculate actual duration
    const startTime = new Date(session.started_at);
    const endTime = new Date();
    const actualDuration = Math.round((endTime - startTime) / (1000 * 60)); // in minutes

    // Minimum 5 minutes to count as valid session
    if (actualDuration < 5) {
      return res.status(400).json({ error: 'Session must be at least 5 minutes to count' });
    }

    // Update session
    await pool.query(
      `UPDATE study_sessions SET 
        is_completed = TRUE, 
        completed_at = NOW(), 
        actual_duration = $1,
        notes = $2
       WHERE id = $3`,
      [actualDuration, notes || null, sessionId]
    );

    // Update user stats
    await pool.query(
      `UPDATE users SET 
        session_count = session_count + 1,
        total_study_minutes = total_study_minutes + $1,
        last_activity = NOW()
       WHERE id = $2`,
      [actualDuration, req.user.userId]
    );

    // Update resource progress if resource was specified
    if (session.resource_id) {
      await pool.query(
        `INSERT INTO user_progress (user_id, resource_id, time_spent_minutes, completed)
         VALUES ($1, $2, $3, FALSE)
         ON CONFLICT (user_id, resource_id) 
         DO UPDATE SET time_spent_minutes = user_progress.time_spent_minutes + $3`,
        [req.user.userId, session.resource_id, actualDuration]
      );
    }

    res.json({
      message: 'Session completed',
      actualDuration,
      requiresAAR: true
    });

  } catch (error) {
    console.error('Complete session error:', error);
    res.status(500).json({ error: 'Failed to complete session' });
  }
});

// Get active session
app.get('/api/sessions/active', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ss.*, r.title as resource_title, s.name as subject_name
       FROM study_sessions ss
       LEFT JOIN resources r ON ss.resource_id = r.id
       LEFT JOIN subjects s ON ss.subject_id = s.id
       WHERE ss.user_id = $1 AND ss.is_completed = FALSE
       ORDER BY ss.started_at DESC
       LIMIT 1`,
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.json({ activeSession: null });
    }

    res.json({ activeSession: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get active session' });
  }
});

// Get session history
app.get('/api/sessions/history', verifyToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    
    const result = await pool.query(
      `SELECT ss.*, r.title as resource_title, s.name as subject_name
       FROM study_sessions ss
       LEFT JOIN resources r ON ss.resource_id = r.id
       LEFT JOIN subjects s ON ss.subject_id = s.id
       WHERE ss.user_id = $1 AND ss.is_completed = TRUE
       ORDER BY ss.completed_at DESC
       LIMIT $2`,
      [req.user.userId, limit]
    );

    res.json({ sessions: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get session history' });
  }
});

// ==================== AAR ENDPOINTS ====================

// Submit AAR
app.post('/api/aar/submit', verifyToken, checkSubjectLock, async (req, res) => {
  try {
    const { sessionId, whatWorked, whatBlocked, tomorrowPlan, energyLevel, focusRating } = req.body;
    const user = req.userFull;

    // Validate inputs
    if (!whatWorked || !whatBlocked || !tomorrowPlan) {
      return res.status(400).json({ error: 'All AAR fields are required' });
    }

    // Minimum word count
    const wordCount = (whatWorked + whatBlocked + tomorrowPlan).split(/\s+/).length;
    if (wordCount < 20) {
      return res.status(400).json({ error: 'AAR must be at least 20 words total. Reflect properly.' });
    }

    // Create AAR entry
    const result = await pool.query(
      `INSERT INTO aar_entries 
       (user_id, subject_id, session_id, what_worked, what_blocked, tomorrow_plan, energy_level, focus_rating)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [req.user.userId, user.primary_subject_id, sessionId || null, whatWorked, whatBlocked, tomorrowPlan, energyLevel || 5, focusRating || 5]
    );

    // Update user AAR count
    await pool.query(
      'UPDATE users SET aar_count = aar_count + 1, last_activity = NOW() WHERE id = $1',
      [req.user.userId]
    );

    res.json({
      message: 'AAR submitted successfully',
      aar: result.rows[0]
    });

  } catch (error) {
    console.error('Submit AAR error:', error);
    res.status(500).json({ error: 'Failed to submit AAR' });
  }
});

// Get AAR history
app.get('/api/aar/history', verifyToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    
    const result = await pool.query(
      `SELECT a.*, s.name as subject_name
       FROM aar_entries a
       LEFT JOIN subjects s ON a.subject_id = s.id
       WHERE a.user_id = $1
       ORDER BY a.created_at DESC
       LIMIT $2`,
      [req.user.userId, limit]
    );

    res.json({ aars: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get AAR history' });
  }
});

// ==================== PROGRESS ENDPOINTS ====================

// Get user progress/stats
app.get('/api/progress', verifyToken, checkSubjectLock, async (req, res) => {
  try {
    const user = req.userFull;

    // Get resource completion stats
    let resourceStats = { total: 0, completed: 0 };
    if (user.primary_subject_id) {
      const resourceResult = await pool.query(
        `SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN up.completed = TRUE THEN 1 END) as completed
         FROM resources r
         LEFT JOIN user_progress up ON r.id = up.resource_id AND up.user_id = $1
         WHERE r.subject_id = $2 AND r.is_active = TRUE`,
        [req.user.userId, user.primary_subject_id]
      );
      resourceStats = resourceResult.rows[0];
    }

    // Get session stats for current week
    const weeklyStats = await pool.query(
      `SELECT 
        COUNT(*) as sessions_this_week,
        COALESCE(SUM(actual_duration), 0) as minutes_this_week
       FROM study_sessions
       WHERE user_id = $1 
         AND is_completed = TRUE 
         AND completed_at >= NOW() - INTERVAL '7 days'`,
      [req.user.userId]
    );

    // Get streak (consecutive days with sessions)
    const streakResult = await pool.query(
      `SELECT DATE(completed_at) as session_date
       FROM study_sessions
       WHERE user_id = $1 AND is_completed = TRUE
       GROUP BY DATE(completed_at)
       ORDER BY session_date DESC`,
      [req.user.userId]
    );

    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (let i = 0; i < streakResult.rows.length; i++) {
      const sessionDate = new Date(streakResult.rows[i].session_date);
      sessionDate.setHours(0, 0, 0, 0);
      
      const expectedDate = new Date(today);
      expectedDate.setDate(expectedDate.getDate() - i);
      
      if (sessionDate.getTime() === expectedDate.getTime()) {
        streak++;
      } else {
        break;
      }
    }

    // Calculate unlock progress
    const lockProgress = {
      days: user.subject_locked_at ? Math.floor((new Date() - new Date(user.subject_locked_at)) / (1000 * 60 * 60 * 24)) : 0,
      daysRequired: 7,
      aars: user.aar_count,
      aarsRequired: 3,
      sessions: user.session_count,
      sessionsRequired: 5
    };

    res.json({
      progress: {
        totalSessions: user.session_count,
        totalAARs: user.aar_count,
        totalStudyMinutes: user.total_study_minutes,
        totalStudyHours: Math.round(user.total_study_minutes / 60 * 10) / 10,
        resourcesCompleted: parseInt(resourceStats.completed),
        resourcesTotal: parseInt(resourceStats.total),
        sessionsThisWeek: parseInt(weeklyStats.rows[0].sessions_this_week),
        minutesThisWeek: parseInt(weeklyStats.rows[0].minutes_this_week),
        currentStreak: streak,
        lockProgress
      }
    });

  } catch (error) {
    console.error('Get progress error:', error);
    res.status(500).json({ error: 'Failed to get progress' });
  }
});

// Mark resource as completed
app.post('/api/resources/:id/complete', verifyToken, checkSubjectLock, async (req, res) => {
  try {
    const resourceId = req.params.id;
    const user = req.userFull;

    // Verify resource belongs to user's subject
    const resourceResult = await pool.query(
      'SELECT * FROM resources WHERE id = $1 AND subject_id = $2',
      [resourceId, user.primary_subject_id]
    );

    if (resourceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Resource not found' });
    }

    // Mark as completed
    await pool.query(
      `INSERT INTO user_progress (user_id, resource_id, completed, completed_at)
       VALUES ($1, $2, TRUE, NOW())
       ON CONFLICT (user_id, resource_id) 
       DO UPDATE SET completed = TRUE, completed_at = NOW()`,
      [req.user.userId, resourceId]
    );

    res.json({ message: 'Resource marked as completed' });

  } catch (error) {
    res.status(500).json({ error: 'Failed to complete resource' });
  }
});

// ==================== ADMIN ENDPOINTS ====================

// Admin: Add department
app.post('/api/admin/departments', verifyToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { name, code, description, icon } = req.body;

    if (!name || !code) {
      return res.status(400).json({ error: 'Name and code are required' });
    }

    const result = await pool.query(
      'INSERT INTO departments (name, code, description, icon) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, code.toUpperCase(), description || null, icon || '📚']
    );

    res.json({ message: 'Department added', department: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add department' });
  }
});

// Admin: Add subject
app.post('/api/admin/subjects', verifyToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { departmentId, name, code, description, estimatedHours } = req.body;

    if (!departmentId || !name || !code) {
      return res.status(400).json({ error: 'Department ID, name, and code are required' });
    }

    const result = await pool.query(
      `INSERT INTO subjects (department_id, name, code, description, estimated_hours) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [departmentId, name, code.toUpperCase(), description || null, estimatedHours || 20]
    );

    res.json({ message: 'Subject added', subject: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add subject' });
  }
});

// Admin: Add resource
app.post('/api/admin/resources', verifyToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { subjectId, title, description, url, type, durationMinutes, sortOrder, isRequired } = req.body;

    if (!subjectId || !title || !url || !type) {
      return res.status(400).json({ error: 'Subject ID, title, URL, and type are required' });
    }

    const result = await pool.query(
      `INSERT INTO resources (subject_id, title, description, url, type, duration_minutes, sort_order, is_required) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [subjectId, title, description || null, url, type, durationMinutes || 0, sortOrder || 0, isRequired !== false]
    );

    res.json({ message: 'Resource added', resource: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add resource' });
  }
});

// Admin: Generate access codes
app.post('/api/admin/codes', verifyToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { count = 1, prefix = 'OP' } = req.body;

    const codes = [];
    for (let i = 0; i < Math.min(count, 50); i++) {
      const randomCode = `${prefix}-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
      await pool.query('INSERT INTO access_codes (code) VALUES ($1)', [randomCode]);
      codes.push(randomCode);
    }

    res.json({ message: `${codes.length} codes generated`, codes });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate codes' });
  }
});

// Admin: Get all codes
app.get('/api/admin/codes', verifyToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const result = await pool.query(
      `SELECT ac.*, u.email as used_by_email 
       FROM access_codes ac 
       LEFT JOIN users u ON ac.used_by = u.id 
       ORDER BY ac.created_at DESC`
    );

    res.json({ codes: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get codes' });
  }
});

// Admin: Get all users
app.get('/api/admin/users', verifyToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const result = await pool.query(
      `SELECT u.id, u.email, u.is_admin, u.session_count, u.aar_count, 
              u.total_study_minutes, u.onboarding_complete, u.created_at, u.last_activity,
              s.name as primary_subject
       FROM users u
       LEFT JOIN subjects s ON u.primary_subject_id = s.id
       ORDER BY u.created_at DESC`
    );

    res.json({ users: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// Admin: Get all resources
app.get('/api/admin/resources', verifyToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const result = await pool.query(
      `SELECT r.*, s.name as subject_name, s.code as subject_code, d.name as department_name
       FROM resources r
       JOIN subjects s ON r.subject_id = s.id
       JOIN departments d ON s.department_id = d.id
       ORDER BY d.name, s.code, r.sort_order`
    );

    res.json({ resources: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get resources' });
  }
});

// Admin: Delete resource
app.delete('/api/admin/resources/:id', verifyToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    await pool.query('DELETE FROM resources WHERE id = $1', [req.params.id]);
    res.json({ message: 'Resource deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete resource' });
  }
});

// Admin: Get dashboard stats
app.get('/api/admin/stats', verifyToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const stats = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM users WHERE last_activity >= NOW() - INTERVAL '7 days') as active_users,
        (SELECT COUNT(*) FROM study_sessions WHERE is_completed = TRUE) as total_sessions,
        (SELECT COALESCE(SUM(actual_duration), 0) FROM study_sessions WHERE is_completed = TRUE) as total_minutes,
        (SELECT COUNT(*) FROM aar_entries) as total_aars,
        (SELECT COUNT(*) FROM resources WHERE is_active = TRUE) as total_resources,
        (SELECT COUNT(*) FROM access_codes WHERE used = FALSE) as available_codes
    `);

    res.json({ stats: stats.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// ==================== START SERVER ====================

const PORT = process.env.PORT || 5000;

initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ RNPathfinders API v2.0 running on port ${PORT}`);
    console.log(`🌐 Frontend URL: ${process.env.FRONTEND_URL}`);
    console.log(`🗄️ Database: Neon PostgreSQL`);
  });
});
