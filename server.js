const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.FRONTEND_URL || 'https://rnpathfinders.ng', credentials: true }));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function initializeDatabase() {
  try {
    // DROP ALL TABLES FIRST to ensure clean schema
    console.log('🗑️ Dropping old tables...');
    await pool.query('DROP TABLE IF EXISTS user_progress CASCADE');
    await pool.query('DROP TABLE IF EXISTS unlock_history CASCADE');
    await pool.query('DROP TABLE IF EXISTS aar_entries CASCADE');
    await pool.query('DROP TABLE IF EXISTS study_sessions CASCADE');
    await pool.query('DROP TABLE IF EXISTS resources CASCADE');
    await pool.query('DROP TABLE IF EXISTS subjects CASCADE');
    await pool.query('DROP TABLE IF EXISTS departments CASCADE');
    await pool.query('DROP TABLE IF EXISTS access_codes CASCADE');
    await pool.query('DROP TABLE IF EXISTS users CASCADE');
    console.log('✅ Old tables dropped');

    // CREATE FRESH TABLES
    console.log('📦 Creating new tables...');
    await pool.query(`CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL, is_admin BOOLEAN DEFAULT FALSE, primary_subject_id INTEGER, subject_locked_at TIMESTAMP, lock_expires_at TIMESTAMP, aar_count INTEGER DEFAULT 0, session_count INTEGER DEFAULT 0, total_study_minutes INTEGER DEFAULT 0, last_activity TIMESTAMP, onboarding_complete BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await pool.query(`CREATE TABLE access_codes (id SERIAL PRIMARY KEY, code VARCHAR(50) UNIQUE NOT NULL, used BOOLEAN DEFAULT FALSE, used_by INTEGER REFERENCES users(id), used_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await pool.query(`CREATE TABLE departments (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, code VARCHAR(20) UNIQUE NOT NULL, icon VARCHAR(10) DEFAULT '📚', is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await pool.query(`CREATE TABLE subjects (id SERIAL PRIMARY KEY, department_id INTEGER REFERENCES departments(id), name VARCHAR(100) NOT NULL, code VARCHAR(20) NOT NULL, estimated_hours INTEGER DEFAULT 20, is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(department_id, code))`);
    await pool.query(`CREATE TABLE resources (id SERIAL PRIMARY KEY, subject_id INTEGER REFERENCES subjects(id), title VARCHAR(255) NOT NULL, url TEXT NOT NULL, type VARCHAR(50) NOT NULL, duration_minutes INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await pool.query(`CREATE TABLE study_sessions (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), subject_id INTEGER REFERENCES subjects(id), session_type VARCHAR(50) DEFAULT 'active_recall', planned_duration INTEGER NOT NULL, actual_duration INTEGER, started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, completed_at TIMESTAMP, is_completed BOOLEAN DEFAULT FALSE)`);
    await pool.query(`CREATE TABLE aar_entries (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), subject_id INTEGER REFERENCES subjects(id), what_worked TEXT NOT NULL, what_blocked TEXT NOT NULL, tomorrow_plan TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await pool.query(`CREATE TABLE user_progress (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), resource_id INTEGER REFERENCES resources(id), completed BOOLEAN DEFAULT FALSE, completed_at TIMESTAMP, UNIQUE(user_id, resource_id))`);
    console.log('✅ Tables created');

    // INSERT ACCESS CODES
    const codes = ['OPERATIVE2024', 'MISSION2024', 'ACADEMIC2024', 'RNPATH2024', 'STUDY2024'];
    for (const c of codes) await pool.query('INSERT INTO access_codes (code) VALUES ($1)', [c]);
    console.log('✅ Access codes inserted');

    // INSERT DEPARTMENTS
    const depts = [
      { name: 'Medicine & Nursing', code: 'MED', icon: '🏥' },
      { name: 'Engineering', code: 'ENG', icon: '⚙️' },
      { name: 'Science', code: 'SCI', icon: '🔬' },
      { name: 'Business', code: 'BUS', icon: '📊' },
      { name: 'General Studies', code: 'GEN', icon: '📚' }
    ];
    for (const d of depts) await pool.query('INSERT INTO departments (name, code, icon) VALUES ($1, $2, $3)', [d.name, d.code, d.icon]);
    console.log('✅ Departments inserted');

    // ALL SUBJECTS WITH VIDEOS
    const allSubjects = {
      MED: [
        {c:'MED101',n:'Human Anatomy',h:35,v:[{t:'Anatomy Full Course',u:'https://www.youtube.com/watch?v=gEUu-A2wfSE'},{t:'Anatomy Crash Course',u:'https://www.youtube.com/watch?v=uBGl2BujkPQ'},{t:'Body Systems',u:'https://www.youtube.com/watch?v=Ae4MadKPJC0'}]},
        {c:'MED102',n:'Human Physiology',h:35,v:[{t:'Physiology Full Course',u:'https://www.youtube.com/watch?v=fNgKi3e1x7c'},{t:'Body Functions',u:'https://www.youtube.com/watch?v=X9ZZ6tcxArI'},{t:'Physiology Made Easy',u:'https://www.youtube.com/watch?v=dQJ4GWRZ85o'}]},
        {c:'MED103',n:'Anatomy & Physiology Combined',h:40,v:[{t:'A&P Complete',u:'https://www.youtube.com/watch?v=S-0xIBAuQrg'},{t:'A&P Study Guide',u:'https://www.youtube.com/watch?v=0bZC5_37YhE'},{t:'A&P Series',u:'https://www.youtube.com/watch?v=uBGl2BujkPQ'}]},
        {c:'NUR101',n:'Fundamentals of Nursing',h:30,v:[{t:'Nursing Fundamentals',u:'https://www.youtube.com/watch?v=D3PEEm_3U98'},{t:'Basic Nursing Skills',u:'https://www.youtube.com/watch?v=5kLqdBvlI5s'},{t:'Nursing NCLEX',u:'https://www.youtube.com/watch?v=o-9bkgGSYvI'}]},
        {c:'NUR102',n:'Nursing Ethics & Law',h:20,v:[{t:'Nursing Ethics',u:'https://www.youtube.com/watch?v=0o3bpMqKTLU'},{t:'Legal Issues',u:'https://www.youtube.com/watch?v=YCFHw-7FjfE'},{t:'Patient Rights',u:'https://www.youtube.com/watch?v=MZD-xKwfaKo'}]},
        {c:'NUR201',n:'Medical-Surgical Nursing',h:45,v:[{t:'Med-Surg Complete',u:'https://www.youtube.com/watch?v=s9R3Pd2Jz18'},{t:'Med-Surg NCLEX',u:'https://www.youtube.com/watch?v=I9RJgP-AzDk'},{t:'Adult Health',u:'https://www.youtube.com/watch?v=TLBQPqqxVWQ'}]},
        {c:'NUR202',n:'Pediatric Nursing',h:30,v:[{t:'Pediatric Nursing',u:'https://www.youtube.com/watch?v=Q5xvRv0mAvs'},{t:'Child Health',u:'https://www.youtube.com/watch?v=LdQoHxqMwko'},{t:'Pediatric Assessment',u:'https://www.youtube.com/watch?v=pV9e3J9NJBY'}]},
        {c:'NUR203',n:'Obstetric Nursing',h:35,v:[{t:'OB Nursing',u:'https://www.youtube.com/watch?v=VUy8KjA7GvE'},{t:'Maternity NCLEX',u:'https://www.youtube.com/watch?v=EQf5Rl2uto4'},{t:'Labor Delivery',u:'https://www.youtube.com/watch?v=XxIvBqaWTlE'}]},
        {c:'NUR204',n:'Psychiatric Nursing',h:30,v:[{t:'Psychiatric Nursing',u:'https://www.youtube.com/watch?v=3KrWIQ2V-bM'},{t:'Mental Health',u:'https://www.youtube.com/watch?v=pwG3T5KwXHM'},{t:'Psych Concepts',u:'https://www.youtube.com/watch?v=oGUGGPc4CvE'}]},
        {c:'NUR205',n:'Community Health Nursing',h:25,v:[{t:'Community Health',u:'https://www.youtube.com/watch?v=FuQKvPJMp0M'},{t:'Public Health',u:'https://www.youtube.com/watch?v=p-KJWMPJjvE'},{t:'Community NCLEX',u:'https://www.youtube.com/watch?v=PkXGhJV_GFs'}]},
        {c:'NUR301',n:'Critical Care Nursing',h:35,v:[{t:'ICU Nursing',u:'https://www.youtube.com/watch?v=kCHH0L8J9xI'},{t:'Critical Care',u:'https://www.youtube.com/watch?v=2V4l8NkCYRU'},{t:'Ventilator Basics',u:'https://www.youtube.com/watch?v=8pQGwHfm8VM'}]},
        {c:'NUR302',n:'Emergency Nursing',h:30,v:[{t:'Emergency Nursing',u:'https://www.youtube.com/watch?v=KsXTjPGiA8U'},{t:'ER Skills',u:'https://www.youtube.com/watch?v=s2-H1kMh88g'},{t:'Trauma Nursing',u:'https://www.youtube.com/watch?v=HCqx8O4ZfWI'}]},
        {c:'MED201',n:'Pharmacology',h:40,v:[{t:'Pharmacology Complete',u:'https://www.youtube.com/watch?v=hyU4v9Lp6Bc'},{t:'Drug Classes',u:'https://www.youtube.com/watch?v=ysisvR-K7Bw'},{t:'Pharmacology Easy',u:'https://www.youtube.com/watch?v=X5XmflLdSjQ'}]},
        {c:'MED202',n:'Pathophysiology',h:35,v:[{t:'Pathophysiology Full',u:'https://www.youtube.com/watch?v=c0XnGKx7fQI'},{t:'Disease Mechanisms',u:'https://www.youtube.com/watch?v=OsCYR_wPKos'},{t:'Patho Guide',u:'https://www.youtube.com/watch?v=1hORflfmF3A'}]},
        {c:'MED203',n:'Microbiology',h:30,v:[{t:'Microbiology Complete',u:'https://www.youtube.com/watch?v=6-paPmUnyao'},{t:'Bacteria Viruses',u:'https://www.youtube.com/watch?v=jfFNwoJC1Jw'},{t:'Medical Micro',u:'https://www.youtube.com/watch?v=GHBm3VBoEbE'}]},
        {c:'MED204',n:'Biochemistry',h:35,v:[{t:'Biochemistry Full',u:'https://www.youtube.com/watch?v=TQ8TXZqLgqE'},{t:'Biochem Basics',u:'https://www.youtube.com/watch?v=uQT37RlVYdo'},{t:'Metabolism',u:'https://www.youtube.com/watch?v=ZQQp-7cLgbE'}]},
        {c:'MED205',n:'Medical Immunology',h:25,v:[{t:'Immunology Overview',u:'https://www.youtube.com/watch?v=fSEFXl2-_Y4'},{t:'Immune System',u:'https://www.youtube.com/watch?v=lXfEK8G8CUI'},{t:'Immunology Simple',u:'https://www.youtube.com/watch?v=GIJK3dwCWCw'}]},
        {c:'MED206',n:'Histology',h:25,v:[{t:'Histology Complete',u:'https://www.youtube.com/watch?v=mM6uvNxOOfo'},{t:'Tissue Types',u:'https://www.youtube.com/watch?v=u7_ZO_xLWF8'},{t:'Histology Slides',u:'https://www.youtube.com/watch?v=9TIqlHHoWYo'}]},
        {c:'MED207',n:'Embryology',h:20,v:[{t:'Embryology Full',u:'https://www.youtube.com/watch?v=biP5vSBgcwM'},{t:'Human Development',u:'https://www.youtube.com/watch?v=3mJUPU_R98E'},{t:'Embryology Easy',u:'https://www.youtube.com/watch?v=0r77JJzqkvE'}]},
        {c:'MED301',n:'Clinical Medicine',h:45,v:[{t:'Clinical Medicine',u:'https://www.youtube.com/watch?v=w2Iq_kPX-Cc'},{t:'Clinical Exam',u:'https://www.youtube.com/watch?v=cU7rEDp3-CY'},{t:'Patient Assessment',u:'https://www.youtube.com/watch?v=LCJgPWnAEgw'}]},
        {c:'MED302',n:'Medical Diagnostics',h:30,v:[{t:'Diagnostic Testing',u:'https://www.youtube.com/watch?v=XKSCAWHgBgo'},{t:'Lab Values',u:'https://www.youtube.com/watch?v=PpDMKhQ0pQc'},{t:'Medical Imaging',u:'https://www.youtube.com/watch?v=HqPo26VnJXI'}]},
        {c:'MED303',n:'Health Assessment',h:25,v:[{t:'Health Assessment',u:'https://www.youtube.com/watch?v=jf_kQ16_u_M'},{t:'Physical Exam',u:'https://www.youtube.com/watch?v=1aYoQxtmYwE'},{t:'Head to Toe',u:'https://www.youtube.com/watch?v=_Tq_Yo6xV7M'}]}
      ],
      ENG: [
        {c:'ENG101',n:'Engineering Mathematics I',h:35,v:[{t:'Engineering Math 1',u:'https://www.youtube.com/watch?v=WUvTyaaNkzM'},{t:'Calculus Engineers',u:'https://www.youtube.com/watch?v=fYyARMqiaag'},{t:'Math Basics',u:'https://www.youtube.com/watch?v=HfACrKJ_Y2w'}]},
        {c:'ENG102',n:'Engineering Mathematics II',h:35,v:[{t:'Engineering Math 2',u:'https://www.youtube.com/watch?v=7gigNsz4Oe8'},{t:'Advanced Calculus',u:'https://www.youtube.com/watch?v=_1UKz0Ei6YU'},{t:'Diff Equations',u:'https://www.youtube.com/watch?v=p_di4Zn4wz4'}]},
        {c:'ENG103',n:'Engineering Mathematics III',h:35,v:[{t:'Engineering Math 3',u:'https://www.youtube.com/watch?v=dRw0wLqLXQE'},{t:'Laplace Transforms',u:'https://www.youtube.com/watch?v=KqokoYr_h1A'},{t:'Fourier Series',u:'https://www.youtube.com/watch?v=r6sGWTCMz2k'}]},
        {c:'ENG104',n:'Linear Algebra',h:25,v:[{t:'Linear Algebra MIT',u:'https://www.youtube.com/watch?v=ZK3O402wf1c'},{t:'3Blue1Brown',u:'https://www.youtube.com/watch?v=fNk_zzaMoSs'},{t:'Matrix Ops',u:'https://www.youtube.com/watch?v=rowWM-MijXU'}]},
        {c:'ENG105',n:'Calculus',h:30,v:[{t:'Calculus Complete',u:'https://www.youtube.com/watch?v=WsQQvHm4lSw'},{t:'Prof Leonard',u:'https://www.youtube.com/watch?v=fYyARMqiaag'},{t:'Calculus Easy',u:'https://www.youtube.com/watch?v=H9eCT6f_Ftw'}]},
        {c:'ENG106',n:'Differential Equations',h:30,v:[{t:'Diff Eq Full',u:'https://www.youtube.com/watch?v=p_di4Zn4wz4'},{t:'ODE Guide',u:'https://www.youtube.com/watch?v=HKvP2ESjJbA'},{t:'Diff Eq Easy',u:'https://www.youtube.com/watch?v=6o7b9yyhH7k'}]},
        {c:'ENG107',n:'Numerical Methods',h:25,v:[{t:'Numerical Methods',u:'https://www.youtube.com/watch?v=tEXPXcuTGdA'},{t:'Numerical Analysis',u:'https://www.youtube.com/watch?v=LqGMjdBp1dc'},{t:'Computational',u:'https://www.youtube.com/watch?v=TMy2CK7ALYk'}]},
        {c:'ENG108',n:'Statistics & Probability',h:25,v:[{t:'Statistics Full',u:'https://www.youtube.com/watch?v=xxpc-HPKN28'},{t:'Probability',u:'https://www.youtube.com/watch?v=KbB0FjPg0mw'},{t:'Stats Easy',u:'https://www.youtube.com/watch?v=zouPoc49xbk'}]},
        {c:'ENG201',n:'Engineering Mechanics',h:35,v:[{t:'Statics Complete',u:'https://www.youtube.com/watch?v=atoYbN3Rl1w'},{t:'Dynamics Full',u:'https://www.youtube.com/watch?v=GVVBJl_6HBg'},{t:'Mechanics Overview',u:'https://www.youtube.com/watch?v=2kS_GXwFbgI'}]},
        {c:'ENG202',n:'Thermodynamics',h:35,v:[{t:'Thermodynamics Full',u:'https://www.youtube.com/watch?v=8N1BxHgsoOw'},{t:'Thermo NPTEL',u:'https://www.youtube.com/watch?v=TKDy0F_m-_w'},{t:'Thermo Laws',u:'https://www.youtube.com/watch?v=NyOYW07-L5g'}]},
        {c:'ENG203',n:'Fluid Mechanics',h:35,v:[{t:'Fluid Mechanics',u:'https://www.youtube.com/watch?v=PZcX9Mk4dw0'},{t:'Fluid Dynamics',u:'https://www.youtube.com/watch?v=RrBmkJsgN-c'},{t:'Hydraulics',u:'https://www.youtube.com/watch?v=dQmaNGvW5-8'}]},
        {c:'ENG204',n:'Strength of Materials',h:30,v:[{t:'Strength Materials',u:'https://www.youtube.com/watch?v=RJlPH6cCgHc'},{t:'Mechanics Materials',u:'https://www.youtube.com/watch?v=aaGP4FXNW-A'},{t:'Stress Strain',u:'https://www.youtube.com/watch?v=aQf6Q8t1FQE'}]},
        {c:'ENG205',n:'Engineering Drawing',h:25,v:[{t:'Engineering Drawing',u:'https://www.youtube.com/watch?v=JN3AsQU7Sgs'},{t:'Technical Drawing',u:'https://www.youtube.com/watch?v=Uzqp7MJQFEY'},{t:'AutoCAD',u:'https://www.youtube.com/watch?v=yzPf6Fm05-I'}]},
        {c:'ENG206',n:'Material Science',h:30,v:[{t:'Material Science',u:'https://www.youtube.com/watch?v=3WYhTG3pIlE'},{t:'Materials Eng',u:'https://www.youtube.com/watch?v=QOUXnV1CW4M'},{t:'Properties',u:'https://www.youtube.com/watch?v=N-9T3f9p5ys'}]},
        {c:'ENG301',n:'Circuit Theory',h:30,v:[{t:'Circuit Analysis',u:'https://www.youtube.com/watch?v=7mdc-hhX-QY'},{t:'Basic Circuits',u:'https://www.youtube.com/watch?v=mc979OhitAg'},{t:'Circuit Theorems',u:'https://www.youtube.com/watch?v=_4-Pld3DLWU'}]},
        {c:'ENG302',n:'Electrical Machines',h:35,v:[{t:'Electrical Machines',u:'https://www.youtube.com/watch?v=2aRdJt3-80I'},{t:'Motors Generators',u:'https://www.youtube.com/watch?v=LAtPHANEfQo'},{t:'Transformers',u:'https://www.youtube.com/watch?v=GMePE7NZcxw'}]},
        {c:'ENG303',n:'Power Systems',h:35,v:[{t:'Power Systems',u:'https://www.youtube.com/watch?v=E2DxUHH8jN8'},{t:'Power Generation',u:'https://www.youtube.com/watch?v=20Vb6hlLQSg'},{t:'Transmission',u:'https://www.youtube.com/watch?v=AhdIKENQVOM'}]},
        {c:'ENG304',n:'Electronics',h:30,v:[{t:'Electronics Full',u:'https://www.youtube.com/watch?v=8gvJzrjwjds'},{t:'Analog Electronics',u:'https://www.youtube.com/watch?v=Srhp7K_pQCs'},{t:'Transistors',u:'https://www.youtube.com/watch?v=7ukDKVHnac4'}]},
        {c:'ENG305',n:'Digital Logic Design',h:25,v:[{t:'Digital Logic',u:'https://www.youtube.com/watch?v=M0mx8S05v60'},{t:'Logic Gates',u:'https://www.youtube.com/watch?v=JQBRzsPhw2w'},{t:'Boolean Algebra',u:'https://www.youtube.com/watch?v=gj8QmRQtVao'}]},
        {c:'ENG306',n:'Control Systems',h:30,v:[{t:'Control Systems',u:'https://www.youtube.com/watch?v=oBc_BHxw78s'},{t:'Control Theory',u:'https://www.youtube.com/watch?v=Pi7l8mMjYVE'},{t:'PID Controllers',u:'https://www.youtube.com/watch?v=wkfEZmsQqiA'}]},
        {c:'ENG307',n:'Signals & Systems',h:30,v:[{t:'Signals Systems',u:'https://www.youtube.com/watch?v=s8rsR_TStaA'},{t:'Signal Processing',u:'https://www.youtube.com/watch?v=hewTwm5P0Gg'},{t:'Fourier Transform',u:'https://www.youtube.com/watch?v=spUNpyF58BY'}]},
        {c:'ENG401',n:'Programming Fundamentals',h:30,v:[{t:'CS50 Programming',u:'https://www.youtube.com/watch?v=8mAITcNt710'},{t:'C Programming',u:'https://www.youtube.com/watch?v=KJgsSFOSQv0'},{t:'Programming Logic',u:'https://www.youtube.com/watch?v=zOjov-2OZ0E'}]},
        {c:'ENG402',n:'Data Structures & Algorithms',h:35,v:[{t:'DSA Full',u:'https://www.youtube.com/watch?v=8hly31xKli0'},{t:'Data Structures',u:'https://www.youtube.com/watch?v=RBSGKlAvoiM'},{t:'Algorithms',u:'https://www.youtube.com/watch?v=0IAPZzGSbME'}]},
        {c:'ENG403',n:'Computer Architecture',h:25,v:[{t:'Computer Arch',u:'https://www.youtube.com/watch?v=o_WXTRS2qTY'},{t:'CPU Memory',u:'https://www.youtube.com/watch?v=zLP_X4wyHbY'},{t:'How Computers Work',u:'https://www.youtube.com/watch?v=QZwneRb-zqA'}]},
        {c:'ENG404',n:'Operating Systems',h:30,v:[{t:'OS Full Course',u:'https://www.youtube.com/watch?v=vBURTt97EkA'},{t:'OS Concepts',u:'https://www.youtube.com/watch?v=2i2N_Qo_FyM'},{t:'Process Mgmt',u:'https://www.youtube.com/watch?v=OrM7nZcxXZU'}]},
        {c:'ENG405',n:'Database Systems',h:25,v:[{t:'Database Course',u:'https://www.youtube.com/watch?v=ztHopE5Wnpc'},{t:'SQL Full',u:'https://www.youtube.com/watch?v=HXV3zeQKqGY'},{t:'DB Design',u:'https://www.youtube.com/watch?v=UrYLYV7WSHM'}]},
        {c:'ENG406',n:'Computer Networks',h:30,v:[{t:'Networks Full',u:'https://www.youtube.com/watch?v=qiQR5rTSshw'},{t:'Networking',u:'https://www.youtube.com/watch?v=3QhU9jd03a0'},{t:'TCP/IP OSI',u:'https://www.youtube.com/watch?v=CRdL1PcherM'}]},
        {c:'ENG501',n:'Structural Analysis',h:35,v:[{t:'Structural Analysis',u:'https://www.youtube.com/watch?v=t7_9COLm3rQ'},{t:'Beam Analysis',u:'https://www.youtube.com/watch?v=9_pmeN8xEzw'},{t:'Truss Analysis',u:'https://www.youtube.com/watch?v=GsWtYTKQCK8'}]},
        {c:'ENG502',n:'Surveying',h:25,v:[{t:'Surveying Full',u:'https://www.youtube.com/watch?v=YjfeMkCj_-g'},{t:'Land Surveying',u:'https://www.youtube.com/watch?v=q-Y0bnx6Ndw'},{t:'Total Station',u:'https://www.youtube.com/watch?v=0t5V8-L5f6k'}]},
        {c:'ENG503',n:'Concrete Technology',h:25,v:[{t:'Concrete Tech',u:'https://www.youtube.com/watch?v=LZDyXPnYiPE'},{t:'Concrete Mix',u:'https://www.youtube.com/watch?v=sBf0zrVHsQw'},{t:'Cement Aggregates',u:'https://www.youtube.com/watch?v=d0T-kslWQSE'}]},
        {c:'ENG504',n:'Machine Design',h:35,v:[{t:'Machine Design',u:'https://www.youtube.com/watch?v=dT7TfpDJXHs'},{t:'Mechanical Design',u:'https://www.youtube.com/watch?v=U1TQlQYP-NQ'},{t:'Shaft Bearing',u:'https://www.youtube.com/watch?v=rqQxXKJ3R8Y'}]},
        {c:'ENG505',n:'Manufacturing Processes',h:30,v:[{t:'Manufacturing',u:'https://www.youtube.com/watch?v=d_dBnlCVCjM'},{t:'Machining',u:'https://www.youtube.com/watch?v=RH6BYzXJOLk'},{t:'Welding Casting',u:'https://www.youtube.com/watch?v=6E0fVi2ydcw'}]}
      ],
      SCI: [
        {c:'SCI101',n:'General Physics I',h:30,v:[{t:'Physics 1 Mechanics',u:'https://www.youtube.com/watch?v=b1t41Q3xRM8'},{t:'Classical Mechanics',u:'https://www.youtube.com/watch?v=wWnfJ0-xXRE'},{t:'Mechanics Simple',u:'https://www.youtube.com/watch?v=ZM8ECpBuQYE'}]},
        {c:'SCI102',n:'General Physics II',h:30,v:[{t:'E&M Full',u:'https://www.youtube.com/watch?v=x1-SibwIPM4'},{t:'E&M MIT',u:'https://www.youtube.com/watch?v=rtlJoXxlSFE'},{t:'Electromagnetism',u:'https://www.youtube.com/watch?v=Elqf_b2lJtg'}]},
        {c:'SCI103',n:'General Physics III',h:25,v:[{t:'Waves Optics',u:'https://www.youtube.com/watch?v=TfYCnOvNnFU'},{t:'Wave Physics',u:'https://www.youtube.com/watch?v=ds_3P8ytcxI'},{t:'Optics Light',u:'https://www.youtube.com/watch?v=KTzGBJPuJwM'}]},
        {c:'SCI104',n:'Modern Physics',h:30,v:[{t:'Modern Physics',u:'https://www.youtube.com/watch?v=EhXz8rFgPBg'},{t:'Relativity Quantum',u:'https://www.youtube.com/watch?v=AInCqm5nCzw'},{t:'Atomic Physics',u:'https://www.youtube.com/watch?v=7kb1VT0J3DE'}]},
        {c:'SCI105',n:'Quantum Mechanics',h:35,v:[{t:'Quantum Full',u:'https://www.youtube.com/watch?v=LYgLOOKdBYE'},{t:'Quantum Beginners',u:'https://www.youtube.com/watch?v=p7bzE1E5PMY'},{t:'Wave Functions',u:'https://www.youtube.com/watch?v=KKr91v7yLcM'}]},
        {c:'SCI106',n:'Nuclear Physics',h:30,v:[{t:'Nuclear Physics',u:'https://www.youtube.com/watch?v=S51cTY3HfQo'},{t:'Radioactivity',u:'https://www.youtube.com/watch?v=rIvt_b8WLsA'},{t:'Nuclear Reactions',u:'https://www.youtube.com/watch?v=IkfmgqPqU8w'}]},
        {c:'SCI201',n:'General Chemistry I',h:30,v:[{t:'Gen Chem 1',u:'https://www.youtube.com/watch?v=5yw1YH7YA7c'},{t:'Chem Fundamentals',u:'https://www.youtube.com/watch?v=bka20Q9TN6M'},{t:'Periodic Table',u:'https://www.youtube.com/watch?v=0RRVV4Diomg'}]},
        {c:'SCI202',n:'General Chemistry II',h:30,v:[{t:'Gen Chem 2',u:'https://www.youtube.com/watch?v=lSmJN1_uVpI'},{t:'Equilibrium',u:'https://www.youtube.com/watch?v=g5wNg_dKsYY'},{t:'Thermochemistry',u:'https://www.youtube.com/watch?v=z6S6LTyx2pg'}]},
        {c:'SCI203',n:'Organic Chemistry I',h:35,v:[{t:'Organic Chem 1',u:'https://www.youtube.com/watch?v=WCjGh85_wsA'},{t:'Organic Basics',u:'https://www.youtube.com/watch?v=BL52cBrlOqM'},{t:'Functional Groups',u:'https://www.youtube.com/watch?v=Pb2kfPBMNbo'}]},
        {c:'SCI204',n:'Organic Chemistry II',h:35,v:[{t:'Organic Chem 2',u:'https://www.youtube.com/watch?v=r4MzJbAqkWk'},{t:'Mechanisms',u:'https://www.youtube.com/watch?v=HUjQ_XQAHD0'},{t:'Synthesis',u:'https://www.youtube.com/watch?v=HM8P_yZqm3g'}]},
        {c:'SCI205',n:'Inorganic Chemistry',h:30,v:[{t:'Inorganic Chem',u:'https://www.youtube.com/watch?v=m55kgyApYrY'},{t:'Coordination',u:'https://www.youtube.com/watch?v=O1p1SRGjS44'},{t:'Transition Metals',u:'https://www.youtube.com/watch?v=N4d2J7i4rMA'}]},
        {c:'SCI206',n:'Physical Chemistry',h:35,v:[{t:'Physical Chem',u:'https://www.youtube.com/watch?v=BxUS1K7xu30'},{t:'Thermo Chemistry',u:'https://www.youtube.com/watch?v=s0A3dQ6Mlvo'},{t:'Chemical Kinetics',u:'https://www.youtube.com/watch?v=wYqQCojggyM'}]},
        {c:'SCI207',n:'Analytical Chemistry',h:25,v:[{t:'Analytical Chem',u:'https://www.youtube.com/watch?v=EUvn0EV6fIw'},{t:'Titrations',u:'https://www.youtube.com/watch?v=aGPhfwCE5jY'},{t:'Spectroscopy',u:'https://www.youtube.com/watch?v=7vEy2JNLmik'}]},
        {c:'SCI301',n:'General Biology I',h:30,v:[{t:'Biology Full',u:'https://www.youtube.com/watch?v=QnQe0xW_JY4'},{t:'Cell Biology',u:'https://www.youtube.com/watch?v=URUJD5NEXC8'},{t:'Life Processes',u:'https://www.youtube.com/watch?v=8IlzKri08kk'}]},
        {c:'SCI302',n:'General Biology II',h:30,v:[{t:'Biology 2',u:'https://www.youtube.com/watch?v=GcB07lq5BjE'},{t:'Evolution Ecology',u:'https://www.youtube.com/watch?v=GhHOjC4oxh8'},{t:'Classification',u:'https://www.youtube.com/watch?v=9L4JLCvPZC8'}]},
        {c:'SCI303',n:'Cell Biology',h:25,v:[{t:'Cell Biology Full',u:'https://www.youtube.com/watch?v=cj8dDTHGJBY'},{t:'Cell Structure',u:'https://www.youtube.com/watch?v=URUJD5NEXC8'},{t:'Cell Division',u:'https://www.youtube.com/watch?v=L0k-enzoeOM'}]},
        {c:'SCI304',n:'Genetics',h:30,v:[{t:'Genetics Full',u:'https://www.youtube.com/watch?v=8m6hHRlKwxY'},{t:'DNA Heredity',u:'https://www.youtube.com/watch?v=zwibgNGe4aY'},{t:'Mendelian',u:'https://www.youtube.com/watch?v=Mehz7tCxjSE'}]},
        {c:'SCI305',n:'Molecular Biology',h:30,v:[{t:'Molecular Bio',u:'https://www.youtube.com/watch?v=gb-MKXLe5ao'},{t:'DNA Replication',u:'https://www.youtube.com/watch?v=gG7uCskUOrA'},{t:'Protein Synthesis',u:'https://www.youtube.com/watch?v=oefAI2x2CQM'}]},
        {c:'SCI306',n:'Ecology',h:25,v:[{t:'Ecology Full',u:'https://www.youtube.com/watch?v=sjE-Pkjp3u4'},{t:'Ecosystems',u:'https://www.youtube.com/watch?v=GlWNuzrqe7U'},{t:'Population',u:'https://www.youtube.com/watch?v=RBOsqmBQBQk'}]},
        {c:'SCI307',n:'Zoology',h:30,v:[{t:'Zoology Complete',u:'https://www.youtube.com/watch?v=sYlz_RHCY-8'},{t:'Animal Kingdom',u:'https://www.youtube.com/watch?v=WU7XTDG4Igw'},{t:'Vertebrates',u:'https://www.youtube.com/watch?v=q68qEJ1Krq8'}]},
        {c:'SCI308',n:'Botany',h:25,v:[{t:'Botany Full',u:'https://www.youtube.com/watch?v=o7tl9NckTlE'},{t:'Plant Biology',u:'https://www.youtube.com/watch?v=UdM1TNEbV4I'},{t:'Plant Physiology',u:'https://www.youtube.com/watch?v=VK6oiTiN6rg'}]},
        {c:'SCI401',n:'Calculus I',h:30,v:[{t:'Calculus 1',u:'https://www.youtube.com/watch?v=WUvTyaaNkzM'},{t:'Limits Derivatives',u:'https://www.youtube.com/watch?v=WUvTyaaNkzM'},{t:'Integration',u:'https://www.youtube.com/watch?v=rfG8ce4nNh0'}]},
        {c:'SCI402',n:'Calculus II',h:30,v:[{t:'Calculus 2',u:'https://www.youtube.com/watch?v=7gigNsz4Oe8'},{t:'Integration Tech',u:'https://www.youtube.com/watch?v=pT8LX43riZA'},{t:'Series Sequences',u:'https://www.youtube.com/watch?v=8F7wuWaP32s'}]},
        {c:'SCI403',n:'Linear Algebra',h:25,v:[{t:'Linear Algebra',u:'https://www.youtube.com/watch?v=JnTa9XtvmfI'},{t:'Matrices Vectors',u:'https://www.youtube.com/watch?v=fNk_zzaMoSs'},{t:'Eigenvalues',u:'https://www.youtube.com/watch?v=PFDu9oVAE-g'}]},
        {c:'SCI404',n:'Mathematical Statistics',h:30,v:[{t:'Statistics Full',u:'https://www.youtube.com/watch?v=xxpc-HPKN28'},{t:'Probability',u:'https://www.youtube.com/watch?v=uzkc-qNVoOk'},{t:'Inference',u:'https://www.youtube.com/watch?v=SzZ6GpcfoQY'}]},
        {c:'SCI405',n:'Discrete Mathematics',h:25,v:[{t:'Discrete Math',u:'https://www.youtube.com/watch?v=rdXw7Ps9vxc'},{t:'Logic Proofs',u:'https://www.youtube.com/watch?v=q2eyZZK-OIk'},{t:'Graph Theory',u:'https://www.youtube.com/watch?v=eIb1cz06UwI'}]},
        {c:'SCI501',n:'Intro to Computer Science',h:25,v:[{t:'CS50 Intro',u:'https://www.youtube.com/watch?v=8mAITcNt710'},{t:'CS Basics',u:'https://www.youtube.com/watch?v=SzJ46YA_RaA'},{t:'How Computers',u:'https://www.youtube.com/watch?v=QZwneRb-zqA'}]},
        {c:'SCI502',n:'Python Programming',h:30,v:[{t:'Python Full',u:'https://www.youtube.com/watch?v=_uQrJ0TkZlc'},{t:'Python Tutorial',u:'https://www.youtube.com/watch?v=rfscVS0vtbw'},{t:'Python Data',u:'https://www.youtube.com/watch?v=LHBE6Q9XlzI'}]},
        {c:'SCI503',n:'Data Science',h:30,v:[{t:'Data Science Full',u:'https://www.youtube.com/watch?v=ua-CiDNNj30'},{t:'Data Analysis',u:'https://www.youtube.com/watch?v=r-uOLxNrNk8'},{t:'ML Basics',u:'https://www.youtube.com/watch?v=GwIo3gDZCVQ'}]}
      ],
      BUS: [
        {c:'BUS101',n:'Principles of Accounting I',h:30,v:[{t:'Accounting Basics',u:'https://www.youtube.com/watch?v=yYX4bvQSqbo'},{t:'Financial Accounting',u:'https://www.youtube.com/watch?v=5CQWrFcNzF0'},{t:'Debits Credits',u:'https://www.youtube.com/watch?v=VhwZ9t2b3Zk'}]},
        {c:'BUS102',n:'Principles of Accounting II',h:30,v:[{t:'Accounting 2',u:'https://www.youtube.com/watch?v=dBUzLvDHr6E'},{t:'Advanced Accounting',u:'https://www.youtube.com/watch?v=0VWpXMJqJRU'},{t:'Financial Statements',u:'https://www.youtube.com/watch?v=WEDIj9JBTC8'}]},
        {c:'BUS103',n:'Cost Accounting',h:30,v:[{t:'Cost Accounting',u:'https://www.youtube.com/watch?v=1SV5K_HTBss'},{t:'Cost Classification',u:'https://www.youtube.com/watch?v=H4rLwJFJPIA'},{t:'Job Process Costing',u:'https://www.youtube.com/watch?v=fNvT5dh5AjQ'}]},
        {c:'BUS104',n:'Management Accounting',h:25,v:[{t:'Management Accounting',u:'https://www.youtube.com/watch?v=a1EZcvWMNfQ'},{t:'Budgeting',u:'https://www.youtube.com/watch?v=UJ7FqBVJNZ4'},{t:'Variance Analysis',u:'https://www.youtube.com/watch?v=K_e4AYfHxSQ'}]},
        {c:'BUS105',n:'Auditing',h:30,v:[{t:'Auditing Full',u:'https://www.youtube.com/watch?v=yYX4bvQSqbo'},{t:'Audit Process',u:'https://www.youtube.com/watch?v=s7C0mB1fIQo'},{t:'Internal Controls',u:'https://www.youtube.com/watch?v=n-e9C-Bw3uc'}]},
        {c:'BUS106',n:'Taxation',h:30,v:[{t:'Taxation Full',u:'https://www.youtube.com/watch?v=IqWGjKprqMw'},{t:'Income Tax',u:'https://www.youtube.com/watch?v=sMsG7ZxeOHI'},{t:'Corporate Tax',u:'https://www.youtube.com/watch?v=nM6B4Kxz3Gs'}]},
        {c:'BUS107',n:'Financial Accounting',h:35,v:[{t:'Financial Accounting',u:'https://www.youtube.com/watch?v=mX1E27uxN7g'},{t:'Reporting Standards',u:'https://www.youtube.com/watch?v=gLDV8D7M2i4'},{t:'Balance Sheet',u:'https://www.youtube.com/watch?v=6CjNQx5q5V8'}]},
        {c:'BUS201',n:'Corporate Finance',h:30,v:[{t:'Corporate Finance',u:'https://www.youtube.com/watch?v=wf-ko-Oi5vA'},{t:'Capital Budgeting',u:'https://www.youtube.com/watch?v=dJ4aZTYpjl4'},{t:'Cost Capital',u:'https://www.youtube.com/watch?v=9Z8O-IVYsTs'}]},
        {c:'BUS202',n:'Financial Management',h:30,v:[{t:'Financial Management',u:'https://www.youtube.com/watch?v=GB6e0S-8Gls'},{t:'Working Capital',u:'https://www.youtube.com/watch?v=5Q4h5Z0XfKg'},{t:'Financial Planning',u:'https://www.youtube.com/watch?v=rAohJyaE_E8'}]},
        {c:'BUS203',n:'Investment Analysis',h:25,v:[{t:'Investment Analysis',u:'https://www.youtube.com/watch?v=Xn7KWR9EOGQ'},{t:'Stock Valuation',u:'https://www.youtube.com/watch?v=Z5chrxMuBoo'},{t:'Portfolio Theory',u:'https://www.youtube.com/watch?v=WU4Kg1D9tAM'}]},
        {c:'BUS204',n:'Money & Banking',h:25,v:[{t:'Money Banking',u:'https://www.youtube.com/watch?v=E-7N6haRXuQ'},{t:'Central Banking',u:'https://www.youtube.com/watch?v=mzoX7zEZ6h4'},{t:'Monetary Policy',u:'https://www.youtube.com/watch?v=1dq7mMort9o'}]},
        {c:'BUS205',n:'International Finance',h:25,v:[{t:'International Finance',u:'https://www.youtube.com/watch?v=9kSqtdHq4fE'},{t:'Forex Markets',u:'https://www.youtube.com/watch?v=I-Dv2VGZWHs'},{t:'Trade Finance',u:'https://www.youtube.com/watch?v=aVZCwPjW5yU'}]},
        {c:'BUS301',n:'Microeconomics',h:30,v:[{t:'Microeconomics',u:'https://www.youtube.com/watch?v=_OkTw766oCs'},{t:'Supply Demand',u:'https://www.youtube.com/watch?v=kIFBaaPJUO0'},{t:'Market Structures',u:'https://www.youtube.com/watch?v=cVLfbSPl_zE'}]},
        {c:'BUS302',n:'Macroeconomics',h:30,v:[{t:'Macroeconomics',u:'https://www.youtube.com/watch?v=d8uTB5XorBw'},{t:'GDP Growth',u:'https://www.youtube.com/watch?v=BcEX7i9fVBo'},{t:'Inflation Unemployment',u:'https://www.youtube.com/watch?v=7DS0XXxkljg'}]},
        {c:'BUS303',n:'Development Economics',h:25,v:[{t:'Development Economics',u:'https://www.youtube.com/watch?v=fcUvNPn46sA'},{t:'Dev Theories',u:'https://www.youtube.com/watch?v=QvXsQ9jyTMw'},{t:'Poverty Inequality',u:'https://www.youtube.com/watch?v=rvskMHn0sqQ'}]},
        {c:'BUS304',n:'Monetary Economics',h:25,v:[{t:'Monetary Economics',u:'https://www.youtube.com/watch?v=FQQb2sBQs2I'},{t:'Money Supply Demand',u:'https://www.youtube.com/watch?v=3mUi9IZb4T4'},{t:'Interest Rate',u:'https://www.youtube.com/watch?v=TrcM5exDxcc'}]},
        {c:'BUS305',n:'International Economics',h:25,v:[{t:'International Economics',u:'https://www.youtube.com/watch?v=qLxAusLvMCM'},{t:'Trade Theory',u:'https://www.youtube.com/watch?v=SKjcPOIrGy8'},{t:'Balance Payments',u:'https://www.youtube.com/watch?v=J8c3Rg_CdEI'}]},
        {c:'BUS401',n:'Principles of Management',h:25,v:[{t:'Management Principles',u:'https://www.youtube.com/watch?v=hlpuXuKeN8c'},{t:'Management Functions',u:'https://www.youtube.com/watch?v=9KFgcOHQPGg'},{t:'Planning Organizing',u:'https://www.youtube.com/watch?v=FGgLt94thCM'}]},
        {c:'BUS402',n:'Organizational Behavior',h:25,v:[{t:'Organizational Behavior',u:'https://www.youtube.com/watch?v=zlq8L7h-QWE'},{t:'Motivation',u:'https://www.youtube.com/watch?v=knVwXxPLk0E'},{t:'Leadership Teams',u:'https://www.youtube.com/watch?v=18UVXW-x2_8'}]},
        {c:'BUS403',n:'Human Resource Management',h:25,v:[{t:'HRM Full',u:'https://www.youtube.com/watch?v=szFvr3kv9ZM'},{t:'Recruitment',u:'https://www.youtube.com/watch?v=WChxbBSlWnQ'},{t:'Performance Mgmt',u:'https://www.youtube.com/watch?v=3p1KvVKI-rA'}]},
        {c:'BUS404',n:'Operations Management',h:30,v:[{t:'Operations Mgmt',u:'https://www.youtube.com/watch?v=UaH_Ewu3hrI'},{t:'Process Design',u:'https://www.youtube.com/watch?v=Z-fQ3Vq5O_8'},{t:'Inventory Mgmt',u:'https://www.youtube.com/watch?v=IzkHkBRRV-s'}]},
        {c:'BUS405',n:'Strategic Management',h:30,v:[{t:'Strategic Mgmt',u:'https://www.youtube.com/watch?v=Rk0Sj4X0j84'},{t:'Strategy Formulation',u:'https://www.youtube.com/watch?v=o77ql1a_fRU'},{t:'Competitive Analysis',u:'https://www.youtube.com/watch?v=mYF2_FBCvXw'}]},
        {c:'BUS406',n:'Project Management',h:25,v:[{t:'Project Management',u:'https://www.youtube.com/watch?v=uWPIsaYpY7U'},{t:'Project Planning',u:'https://www.youtube.com/watch?v=JJMwOvZxtPA'},{t:'Risk Management',u:'https://www.youtube.com/watch?v=bJGdPz-Xt2Y'}]},
        {c:'BUS501',n:'Marketing Principles',h:25,v:[{t:'Marketing Full',u:'https://www.youtube.com/watch?v=dLu0qLJu6NY'},{t:'Marketing Mix',u:'https://www.youtube.com/watch?v=yBG8Wqd6Xbc'},{t:'Segmentation',u:'https://www.youtube.com/watch?v=s7C0mB1fIQo'}]},
        {c:'BUS502',n:'Consumer Behavior',h:20,v:[{t:'Consumer Behavior',u:'https://www.youtube.com/watch?v=mPrmS8Q6_g4'},{t:'Buying Decision',u:'https://www.youtube.com/watch?v=ZPvJsmfCbns'},{t:'Consumer Psychology',u:'https://www.youtube.com/watch?v=F3JA8P_Y8bw'}]},
        {c:'BUS503',n:'Business Law',h:30,v:[{t:'Business Law',u:'https://www.youtube.com/watch?v=JQVNiW-n0WU'},{t:'Contract Law',u:'https://www.youtube.com/watch?v=NyVGNl5YzYY'},{t:'Company Law',u:'https://www.youtube.com/watch?v=zD4fuGh6IuI'}]},
        {c:'BUS504',n:'Business Statistics',h:30,v:[{t:'Business Stats',u:'https://www.youtube.com/watch?v=xxpc-HPKN28'},{t:'Descriptive Stats',u:'https://www.youtube.com/watch?v=SzZ6GpcfoQY'},{t:'Regression',u:'https://www.youtube.com/watch?v=WWqE7YHR4Jc'}]},
        {c:'BUS505',n:'Entrepreneurship',h:25,v:[{t:'Entrepreneurship',u:'https://www.youtube.com/watch?v=lJjILQu9sP0'},{t:'Starting Business',u:'https://www.youtube.com/watch?v=xfgMsQCXwxQ'},{t:'Business Plan',u:'https://www.youtube.com/watch?v=zlq8L7h-QWE'}]},
        {c:'BUS506',n:'Business Communication',h:20,v:[{t:'Business Communication',u:'https://www.youtube.com/watch?v=JwjAAgGi-90'},{t:'Professional Writing',u:'https://www.youtube.com/watch?v=FQH_6XjHGPw'},{t:'Presentation',u:'https://www.youtube.com/watch?v=Iwpi1Lm6dFo'}]}
      ],
      GEN: [
        {c:'GEN101',n:'Use of English I',h:25,v:[{t:'English Grammar',u:'https://www.youtube.com/watch?v=eGgj898Lbz4'},{t:'Academic Writing',u:'https://www.youtube.com/watch?v=vtIzMaLkCaM'},{t:'Essay Writing',u:'https://www.youtube.com/watch?v=dWqAfrVWlxc'}]},
        {c:'GEN102',n:'Use of English II',h:25,v:[{t:'Advanced English',u:'https://www.youtube.com/watch?v=ChZJ1Q3GSuI'},{t:'Reading Comprehension',u:'https://www.youtube.com/watch?v=y_oc4M0xoJE'},{t:'Communication',u:'https://www.youtube.com/watch?v=HAnw168huqA'}]},
        {c:'GEN103',n:'Communication Skills',h:20,v:[{t:'Communication Skills',u:'https://www.youtube.com/watch?v=HAnw168huqA'},{t:'Public Speaking',u:'https://www.youtube.com/watch?v=i5mYphUoOCs'},{t:'Interpersonal',u:'https://www.youtube.com/watch?v=YUq1NTBuIxA'}]},
        {c:'GEN104',n:'Essay Writing',h:20,v:[{t:'Essay Masterclass',u:'https://www.youtube.com/watch?v=dWqAfrVWlxc'},{t:'Comprehension',u:'https://www.youtube.com/watch?v=WuGsRmEEx64'},{t:'Critical Reading',u:'https://www.youtube.com/watch?v=EYk7svP3NuA'}]},
        {c:'GEN201',n:'Nigerian History & Culture',h:20,v:[{t:'History Nigeria',u:'https://www.youtube.com/watch?v=tH-GX-5dkVE'},{t:'Cultural Heritage',u:'https://www.youtube.com/watch?v=L6sxT5OJn7U'},{t:'Pre-Colonial',u:'https://www.youtube.com/watch?v=aWbh8TyPXF8'}]},
        {c:'GEN202',n:'Citizenship Education',h:15,v:[{t:'Civic Education',u:'https://www.youtube.com/watch?v=9_B0xLpEbHs'},{t:'Rights Responsibilities',u:'https://www.youtube.com/watch?v=1MZX6H5Ljo4'},{t:'Constitution',u:'https://www.youtube.com/watch?v=vM3N3F_D4cw'}]},
        {c:'GEN203',n:'Philosophy & Logic',h:25,v:[{t:'Philosophy Intro',u:'https://www.youtube.com/watch?v=1A_CAkYt3GY'},{t:'Logic Critical Thinking',u:'https://www.youtube.com/watch?v=oI2yo1HeHTM'},{t:'Logical Fallacies',u:'https://www.youtube.com/watch?v=Qf03U04rqGQ'}]},
        {c:'GEN204',n:'Introduction to Sociology',h:20,v:[{t:'Sociology Full',u:'https://www.youtube.com/watch?v=ylXVn-wh9eQ'},{t:'Social Structures',u:'https://www.youtube.com/watch?v=DbTt_ySTjaY'},{t:'Socialization',u:'https://www.youtube.com/watch?v=hXvKKrDFJfo'}]},
        {c:'GEN205',n:'Introduction to Psychology',h:25,v:[{t:'Psychology Full',u:'https://www.youtube.com/watch?v=vo4pMVb0R6M'},{t:'Human Behavior',u:'https://www.youtube.com/watch?v=4Zr7ixNqwGU'},{t:'Mental Processes',u:'https://www.youtube.com/watch?v=xrFl6lvWKo0'}]},
        {c:'GEN206',n:'Peace & Conflict Studies',h:15,v:[{t:'Peace Studies',u:'https://www.youtube.com/watch?v=hU3L4Iz-cvg'},{t:'Conflict Resolution',u:'https://www.youtube.com/watch?v=KY5TWVz5ZDU'},{t:'Mediation',u:'https://www.youtube.com/watch?v=vN3AHoNGCBc'}]},
        {c:'GEN207',n:'Environmental Studies',h:20,v:[{t:'Environmental Science',u:'https://www.youtube.com/watch?v=eDZT3ryBJwY'},{t:'Climate Change',u:'https://www.youtube.com/watch?v=dcBXmj1nMTQ'},{t:'Sustainable Dev',u:'https://www.youtube.com/watch?v=zx04Kl8y4dE'}]},
        {c:'GEN301',n:'Introduction to Computers',h:20,v:[{t:'Computer Basics',u:'https://www.youtube.com/watch?v=tIfL4S_idK4'},{t:'How Computers Work',u:'https://www.youtube.com/watch?v=QZwneRb-zqA'},{t:'OS Basics',u:'https://www.youtube.com/watch?v=9GDX-IyZ_C8'}]},
        {c:'GEN302',n:'Computer Applications',h:25,v:[{t:'Microsoft Office',u:'https://www.youtube.com/watch?v=Qgc9KjE1dnw'},{t:'Word Tutorial',u:'https://www.youtube.com/watch?v=S-nHYzK-BVg'},{t:'Excel Full',u:'https://www.youtube.com/watch?v=Vl0H-qTclOg'}]},
        {c:'GEN303',n:'Digital Literacy',h:15,v:[{t:'Digital Literacy',u:'https://www.youtube.com/watch?v=n2Y1StGz0e8'},{t:'Internet Safety',u:'https://www.youtube.com/watch?v=aO858HyFbKI'},{t:'Online Research',u:'https://www.youtube.com/watch?v=1KbT9O-Qb2M'}]},
        {c:'GEN401',n:'Research Methods',h:25,v:[{t:'Research Methods',u:'https://www.youtube.com/watch?v=b8QsIOqPQMQ'},{t:'Quant vs Qual',u:'https://www.youtube.com/watch?v=2X-QSU6-hPU'},{t:'Data Collection',u:'https://www.youtube.com/watch?v=ygL4tn5c1Q8'}]},
        {c:'GEN402',n:'Study Skills & Time Management',h:15,v:[{t:'Study Skills',u:'https://www.youtube.com/watch?v=IlU-zDU6aQ0'},{t:'Time Management',u:'https://www.youtube.com/watch?v=iONDebHX9qk'},{t:'Active Recall',u:'https://www.youtube.com/watch?v=ukLnPbIffxE'}]},
        {c:'GEN403',n:'Critical Thinking',h:20,v:[{t:'Critical Thinking',u:'https://www.youtube.com/watch?v=Cum3k-Wglfw'},{t:'Think Clearly',u:'https://www.youtube.com/watch?v=9JhCvHDz2W4'},{t:'Problem Solving',u:'https://www.youtube.com/watch?v=QOjTJAFyNqg'}]},
        {c:'GEN404',n:'Library Studies',h:15,v:[{t:'Library Research',u:'https://www.youtube.com/watch?v=q7wFDk7MLFo'},{t:'Academic Sources',u:'https://www.youtube.com/watch?v=2pqJl4w34V0'},{t:'Citing Sources',u:'https://www.youtube.com/watch?v=MKQm3-eMT4Q'}]},
        {c:'GEN501',n:'Entrepreneurship Development',h:25,v:[{t:'Entrepreneurship Full',u:'https://www.youtube.com/watch?v=lJjILQu9sP0'},{t:'Start Business',u:'https://www.youtube.com/watch?v=Fqch5OrUPvA'},{t:'Business Model',u:'https://www.youtube.com/watch?v=IP0cUBWTgpY'}]},
        {c:'GEN502',n:'Leadership & Ethics',h:20,v:[{t:'Leadership Skills',u:'https://www.youtube.com/watch?v=18UVXW-x2_8'},{t:'Ethical Decision',u:'https://www.youtube.com/watch?v=_17HkuSJnKE'},{t:'Team Leadership',u:'https://www.youtube.com/watch?v=R0R8P7iy4jE'}]},
        {c:'GEN503',n:'Personal Development',h:15,v:[{t:'Personal Development',u:'https://www.youtube.com/watch?v=CZfznT0-oQo'},{t:'Goal Setting',u:'https://www.youtube.com/watch?v=XpKvs-apvOs'},{t:'Good Habits',u:'https://www.youtube.com/watch?v=mNeXuCYiE0U'}]}
      ]
    };

    // INSERT SUBJECTS AND VIDEOS
    console.log('📚 Inserting subjects and videos...');
    for (const [deptCode, subjects] of Object.entries(allSubjects)) {
      const deptRes = await pool.query('SELECT id FROM departments WHERE code=$1', [deptCode]);
      if (deptRes.rows.length > 0) {
        const deptId = deptRes.rows[0].id;
        for (const s of subjects) {
          await pool.query('INSERT INTO subjects (department_id,code,name,estimated_hours) VALUES ($1,$2,$3,$4)', [deptId,s.c,s.n,s.h]);
          const subjRes = await pool.query('SELECT id FROM subjects WHERE code=$1 AND department_id=$2', [s.c,deptId]);
          if (subjRes.rows.length > 0) {
            const subjId = subjRes.rows[0].id;
            for (let i=0; i<s.v.length; i++) {
              await pool.query('INSERT INTO resources (subject_id,title,url,type,sort_order) VALUES ($1,$2,$3,$4,$5)', [subjId,s.v[i].t,s.v[i].u,'Video',i+1]);
            }
          }
        }
      }
    }
    console.log('✅ Database initialized with 130 subjects and 390 videos');
  } catch (e) { console.error('❌ DB init error:', e.message); }
}

const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key'); next(); }
  catch (e) { return res.status(401).json({ error: 'Invalid token' }); }
};

const checkLock = async (req, res, next) => {
  try {
    const r = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.userId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    req.userFull = r.rows[0]; next();
  } catch (e) { return res.status(500).json({ error: 'Server error' }); }
};

app.get('/api/health', (req, res) => res.json({ status: 'ok', message: 'RNPathfinders API running', version: '2.0.0' }));
app.get('/api/test-db', async (req, res) => {
  try { const r = await pool.query('SELECT NOW()'); res.json({ status: 'ok', time: r.rows[0].now }); }
  catch (e) { res.status(500).json({ error: 'DB connection failed' }); }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, accessCode } = req.body;
    if (!email || !password || !accessCode) return res.status(400).json({ error: 'All fields required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password min 8 chars' });
    const codeR = await pool.query('SELECT * FROM access_codes WHERE code=$1 AND used=FALSE', [accessCode]);
    if (codeR.rows.length === 0) return res.status(400).json({ error: 'Invalid or used access code' });
    const existR = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (existR.rows.length > 0) return res.status(400).json({ error: 'Email already registered' });
    const hashed = await bcrypt.hash(password, 10);
    const countR = await pool.query('SELECT COUNT(*) as c FROM users');
    const isAdmin = parseInt(countR.rows[0].c) === 0;
    const newU = await pool.query('INSERT INTO users (email,password,is_admin) VALUES ($1,$2,$3) RETURNING id,email,is_admin,onboarding_complete', [email, hashed, isAdmin]);
    const userId = newU.rows[0].id;
    await pool.query('UPDATE access_codes SET used=TRUE,used_by=$1,used_at=NOW() WHERE code=$2', [userId, accessCode]);
    const token = jwt.sign({ userId, email, isAdmin }, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '7d' });
    res.json({ message: 'Registration successful', token, user: { id: userId, email, isAdmin, onboardingComplete: false } });
  } catch (e) { console.error('Register error:', e); res.status(500).json({ error: 'Registration failed' }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const uR = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    if (uR.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const user = uR.rows[0];
    if (!await bcrypt.compare(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
    await pool.query('UPDATE users SET last_activity=NOW() WHERE id=$1', [user.id]);
    const token = jwt.sign({ userId: user.id, email: user.email, isAdmin: user.is_admin }, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '7d' });
    res.json({ message: 'Login successful', token, user: { id: user.id, email: user.email, isAdmin: user.is_admin, onboardingComplete: user.onboarding_complete, primarySubjectId: user.primary_subject_id } });
  } catch (e) { console.error('Login error:', e); res.status(500).json({ error: 'Login failed' }); }
});

app.get('/api/auth/me', verifyToken, async (req, res) => {
  try {
    const r = await pool.query('SELECT u.*,s.name as primary_subject_name,s.code as primary_subject_code,d.name as department_name,d.icon as department_icon FROM users u LEFT JOIN subjects s ON u.primary_subject_id=s.id LEFT JOIN departments d ON s.department_id=d.id WHERE u.id=$1', [req.user.userId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const u = r.rows[0];
    let lockStatus = null;
    if (u.primary_subject_id) {
      const now = new Date(), lockExp = u.lock_expires_at ? new Date(u.lock_expires_at) : null;
      const daysRem = lockExp ? Math.ceil((lockExp - now) / 86400000) : 0;
      const canUnlock = lockExp && now >= lockExp && u.aar_count >= 3 && u.session_count >= 5;
      lockStatus = { isLocked: !canUnlock, daysRemaining: Math.max(0, daysRem), aarsNeeded: Math.max(0, 3 - u.aar_count), sessionsNeeded: Math.max(0, 5 - u.session_count) };
    }
    res.json({ user: { id: u.id, email: u.email, isAdmin: u.is_admin, onboardingComplete: u.onboarding_complete, primarySubjectId: u.primary_subject_id, primarySubjectName: u.primary_subject_name, primarySubjectCode: u.primary_subject_code, departmentName: u.department_name, departmentIcon: u.department_icon, aarCount: u.aar_count, sessionCount: u.session_count, totalStudyMinutes: u.total_study_minutes, lockStatus } });
  } catch (e) { res.status(500).json({ error: 'Failed to get user' }); }
});

app.get('/api/departments', verifyToken, async (req, res) => {
  try { const r = await pool.query('SELECT * FROM departments WHERE is_active=TRUE ORDER BY name'); res.json({ departments: r.rows }); }
  catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/departments/:id/subjects', verifyToken, async (req, res) => {
  try { const r = await pool.query('SELECT * FROM subjects WHERE department_id=$1 AND is_active=TRUE ORDER BY code', [req.params.id]); res.json({ subjects: r.rows }); }
  catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/subjects', verifyToken, async (req, res) => {
  try { const r = await pool.query('SELECT s.*,d.name as department_name,d.icon as department_icon FROM subjects s JOIN departments d ON s.department_id=d.id WHERE s.is_active=TRUE ORDER BY d.name,s.code'); res.json({ subjects: r.rows }); }
  catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/declare-subject', verifyToken, async (req, res) => {
  try {
    const { subjectId } = req.body;
    if (!subjectId) return res.status(400).json({ error: 'Subject ID required' });
    const uR = await pool.query('SELECT primary_subject_id,onboarding_complete FROM users WHERE id=$1', [req.user.userId]);
    if (uR.rows[0].primary_subject_id && uR.rows[0].onboarding_complete) return res.status(400).json({ error: 'Already have primary subject' });
    const sR = await pool.query('SELECT * FROM subjects WHERE id=$1 AND is_active=TRUE', [subjectId]);
    if (sR.rows.length === 0) return res.status(404).json({ error: 'Subject not found' });
    const lockExp = new Date(); lockExp.setDate(lockExp.getDate() + 7);
    await pool.query('UPDATE users SET primary_subject_id=$1,subject_locked_at=NOW(),lock_expires_at=$2,onboarding_complete=TRUE,last_activity=NOW() WHERE id=$3', [subjectId, lockExp, req.user.userId]);
    res.json({ message: 'Subject declared', subject: { id: sR.rows[0].id, name: sR.rows[0].name, code: sR.rows[0].code }, lockExpiresAt: lockExp });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/resources', verifyToken, checkLock, async (req, res) => {
  try {
    if (!req.userFull.primary_subject_id) return res.status(400).json({ error: 'No subject declared' });
    const r = await pool.query('SELECT r.*,COALESCE(up.completed,FALSE) as completed FROM resources r LEFT JOIN user_progress up ON r.id=up.resource_id AND up.user_id=$1 WHERE r.subject_id=$2 AND r.is_active=TRUE ORDER BY r.sort_order', [req.user.userId, req.userFull.primary_subject_id]);
    res.json({ resources: r.rows });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/sessions/start', verifyToken, checkLock, async (req, res) => {
  try {
    const { plannedDuration, sessionType } = req.body;
    if (!req.userFull.primary_subject_id) return res.status(400).json({ error: 'No subject' });
    const actR = await pool.query('SELECT * FROM study_sessions WHERE user_id=$1 AND is_completed=FALSE', [req.user.userId]);
    if (actR.rows.length > 0) return res.status(400).json({ error: 'Active session exists', activeSession: actR.rows[0] });
    const r = await pool.query('INSERT INTO study_sessions (user_id,subject_id,session_type,planned_duration) VALUES ($1,$2,$3,$4) RETURNING *', [req.user.userId, req.userFull.primary_subject_id, sessionType || 'active_recall', plannedDuration || 25]);
    res.json({ message: 'Session started', session: r.rows[0] });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/sessions/:id/complete', verifyToken, async (req, res) => {
  try {
    const sR = await pool.query('SELECT * FROM study_sessions WHERE id=$1 AND user_id=$2', [req.params.id, req.user.userId]);
    if (sR.rows.length === 0) return res.status(404).json({ error: 'Session not found' });
    const s = sR.rows[0];
    if (s.is_completed) return res.status(400).json({ error: 'Already completed' });
    const dur = Math.round((new Date() - new Date(s.started_at)) / 60000);
    if (dur < 5) return res.status(400).json({ error: 'Min 5 minutes' });
    await pool.query('UPDATE study_sessions SET is_completed=TRUE,completed_at=NOW(),actual_duration=$1 WHERE id=$2', [dur, req.params.id]);
    await pool.query('UPDATE users SET session_count=session_count+1,total_study_minutes=total_study_minutes+$1,last_activity=NOW() WHERE id=$2', [dur, req.user.userId]);
    res.json({ message: 'Session completed', actualDuration: dur, requiresAAR: true });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/sessions/active', verifyToken, async (req, res) => {
  try {
    const r = await pool.query('SELECT ss.*,s.name as subject_name FROM study_sessions ss LEFT JOIN subjects s ON ss.subject_id=s.id WHERE ss.user_id=$1 AND ss.is_completed=FALSE ORDER BY ss.started_at DESC LIMIT 1', [req.user.userId]);
    res.json({ activeSession: r.rows[0] || null });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/aar/submit', verifyToken, checkLock, async (req, res) => {
  try {
    const { whatWorked, whatBlocked, tomorrowPlan } = req.body;
    if (!whatWorked || !whatBlocked || !tomorrowPlan) return res.status(400).json({ error: 'All fields required' });
    const wc = (whatWorked + whatBlocked + tomorrowPlan).split(/\s+/).length;
    if (wc < 20) return res.status(400).json({ error: 'AAR must be 20+ words' });
    const r = await pool.query('INSERT INTO aar_entries (user_id,subject_id,what_worked,what_blocked,tomorrow_plan) VALUES ($1,$2,$3,$4,$5) RETURNING *', [req.user.userId, req.userFull.primary_subject_id, whatWorked, whatBlocked, tomorrowPlan]);
    await pool.query('UPDATE users SET aar_count=aar_count+1,last_activity=NOW() WHERE id=$1', [req.user.userId]);
    res.json({ message: 'AAR submitted', aar: r.rows[0] });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/progress', verifyToken, checkLock, async (req, res) => {
  try {
    const u = req.userFull;
    let resStats = { total: 0, completed: 0 };
    if (u.primary_subject_id) {
      const rR = await pool.query('SELECT COUNT(*) as total,COUNT(CASE WHEN up.completed=TRUE THEN 1 END) as completed FROM resources r LEFT JOIN user_progress up ON r.id=up.resource_id AND up.user_id=$1 WHERE r.subject_id=$2 AND r.is_active=TRUE', [req.user.userId, u.primary_subject_id]);
      resStats = rR.rows[0];
    }
    const wkR = await pool.query("SELECT COUNT(*) as sessions_this_week,COALESCE(SUM(actual_duration),0) as minutes_this_week FROM study_sessions WHERE user_id=$1 AND is_completed=TRUE AND completed_at>=NOW()-INTERVAL '7 days'", [req.user.userId]);
    const strR = await pool.query('SELECT DATE(completed_at) as d FROM study_sessions WHERE user_id=$1 AND is_completed=TRUE GROUP BY DATE(completed_at) ORDER BY d DESC', [req.user.userId]);
    let streak = 0; const today = new Date(); today.setHours(0,0,0,0);
    for (let i = 0; i < strR.rows.length; i++) {
      const sd = new Date(strR.rows[i].d); sd.setHours(0,0,0,0);
      const exp = new Date(today); exp.setDate(exp.getDate() - i);
      if (sd.getTime() === exp.getTime()) streak++; else break;
    }
    const lp = { days: u.subject_locked_at ? Math.floor((new Date() - new Date(u.subject_locked_at)) / 86400000) : 0, daysRequired: 7, aars: u.aar_count, aarsRequired: 3, sessions: u.session_count, sessionsRequired: 5 };
    res.json({ progress: { totalSessions: u.session_count, totalAARs: u.aar_count, totalStudyMinutes: u.total_study_minutes, resourcesCompleted: parseInt(resStats.completed), resourcesTotal: parseInt(resStats.total), sessionsThisWeek: parseInt(wkR.rows[0].sessions_this_week), minutesThisWeek: parseInt(wkR.rows[0].minutes_this_week), currentStreak: streak, lockProgress: lp } });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/admin/codes', verifyToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin required' });
    const { count = 1, prefix = 'OP' } = req.body;
    const codes = [];
    for (let i = 0; i < Math.min(count, 50); i++) {
      const c = `${prefix}-${Math.random().toString(36).substring(2,10).toUpperCase()}`;
      await pool.query('INSERT INTO access_codes (code) VALUES ($1)', [c]);
      codes.push(c);
    }
    res.json({ message: `${codes.length} codes generated`, codes });
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
    const r = await pool.query('SELECT u.id,u.email,u.is_admin,u.session_count,u.aar_count,u.total_study_minutes,u.onboarding_complete,u.created_at,s.name as primary_subject FROM users u LEFT JOIN subjects s ON u.primary_subject_id=s.id ORDER BY u.created_at DESC');
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

app.post('/api/admin/subjects', verifyToken, async (req, res) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin required' });
    const { departmentId, name, code, estimatedHours } = req.body;
    if (!departmentId || !name || !code) return res.status(400).json({ error: 'All fields required' });
    const r = await pool.query('INSERT INTO subjects (department_id,name,code,estimated_hours) VALUES ($1,$2,$3,$4) RETURNING *', [departmentId, name, code.toUpperCase(), estimatedHours || 20]);
    res.json({ message: 'Subject added', subject: r.rows[0] });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

const PORT = process.env.PORT || 5000;
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ RNPathfinders API v2.0 running on port ${PORT}`);
    console.log(`📚 130 Subjects with 390 Videos`);
  });
});
