const express = require('express');
const mysql = require('mysql2/promise');
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

// Database connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'RNPathfinders API is running',
    domain: 'rnpathfinders.ng'
  });
});

// Test database connection
app.get('/api/test-db', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    res.json({ status: 'ok', message: 'Database connected successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Database connection failed', details: error.message });
  }
});

// Register endpoint
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, accessCode } = req.body;

    // Validate input
    if (!email || !password || !accessCode) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate password length
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Check if access code is valid
    const [codes] = await pool.execute(
      'SELECT * FROM access_codes WHERE code = ? AND used = FALSE',
      [accessCode]
    );

    if (codes.length === 0) {
      return res.status(400).json({ error: 'Invalid or already used access code' });
    }

    // Check if email already exists
    const [existingUsers] = await pool.execute(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Check if this is the first user (make them admin)
    const [userCount] = await pool.execute('SELECT COUNT(*) as count FROM users');
    const isAdmin = userCount[0].count === 0;

    // Create user
    const [result] = await pool.execute(
      'INSERT INTO users (email, password, is_admin, created_at) VALUES (?, ?, ?, NOW())',
      [email, hashedPassword, isAdmin]
    );

    const userId = result.insertId;

    // Mark access code as used
    await pool.execute(
      'UPDATE access_codes SET used = TRUE, used_by = ?, used_at = NOW() WHERE code = ?',
      [userId, accessCode]
    );

    // Generate JWT token
    const token = jwt.sign(
      { userId, email, isAdmin },
      process.env.JWT_SECRET || 'your-secret-key-change-this',
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Registration successful',
      token,
      user: { id: userId, email, isAdmin }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed', details: error.message });
  }
});

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const [users] = await pool.execute(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = users[0];

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email, isAdmin: user.is_admin },
      process.env.JWT_SECRET || 'your-secret-key-change-this',
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: { id: user.id, email: user.email, isAdmin: user.is_admin }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed', details: error.message });
  }
});

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-this');
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Get current user info
app.get('/api/auth/me', verifyToken, async (req, res) => {
  try {
    const [users] = await pool.execute(
      'SELECT id, email, is_admin, created_at FROM users WHERE id = ?',
      [req.user.userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: users[0] });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user info' });
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
    for (let i = 0; i < count; i++) {
      const randomCode = `${prefix}-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
      await pool.execute(
        'INSERT INTO access_codes (code, created_at) VALUES (?, NOW())',
        [randomCode]
      );
      codes.push(randomCode);
    }

    res.json({ message: `${count} codes generated`, codes });
  } catch (error) {
    console.error('Code generation error:', error);
    res.status(500).json({ error: 'Failed to generate codes' });
  }
});

// Admin: Get all users
app.get('/api/admin/users', verifyToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const [users] = await pool.execute(
      'SELECT id, email, is_admin, created_at FROM users ORDER BY created_at DESC'
    );

    res.json({ users });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// Admin: Get all access codes
app.get('/api/admin/codes', verifyToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const [codes] = await pool.execute(
      'SELECT ac.*, u.email as used_by_email FROM access_codes ac LEFT JOIN users u ON ac.used_by = u.id ORDER BY ac.created_at DESC'
    );

    res.json({ codes });
  } catch (error) {
    console.error('Get codes error:', error);
    res.status(500).json({ error: 'Failed to get codes' });
  }
});

// Get all resources
app.get('/api/resources', verifyToken, async (req, res) => {
  try {
    const [resources] = await pool.execute(
      'SELECT * FROM resources ORDER BY created_at DESC'
    );

    res.json({ resources });
  } catch (error) {
    console.error('Get resources error:', error);
    res.status(500).json({ error: 'Failed to get resources' });
  }
});

// Admin: Add resource
app.post('/api/admin/resources', verifyToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { title, url, category, type } = req.body;

    if (!title || !url || !category || !type) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    await pool.execute(
      'INSERT INTO resources (title, url, category, type, created_at) VALUES (?, ?, ?, ?, NOW())',
      [title, url, category, type]
    );

    res.json({ message: 'Resource added successfully' });
  } catch (error) {
    console.error('Add resource error:', error);
    res.status(500).json({ error: 'Failed to add resource' });
  }
});

// Admin: Delete resource
app.delete('/api/admin/resources/:id', verifyToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    await pool.execute('DELETE FROM resources WHERE id = ?', [req.params.id]);

    res.json({ message: 'Resource deleted successfully' });
  } catch (error) {
    console.error('Delete resource error:', error);
    res.status(500).json({ error: 'Failed to delete resource' });
  }
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ RNPathfinders API running on port ${PORT}`);
  console.log(`🌐 Frontend URL: ${process.env.FRONTEND_URL}`);
});
