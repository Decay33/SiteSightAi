import express from 'express';
import { createServer as createViteServer } from 'vite';
import cors from 'cors';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Stripe from 'stripe';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import rateLimit from 'express-rate-limit';

dotenv.config();

const app = express();
const PORT = 3000;

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-for-dev';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_123';
const stripe = new Stripe(STRIPE_SECRET_KEY);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Database setup
const db = new Database('database.sqlite');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password_hash TEXT,
    plan TEXT DEFAULT 'free',
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT
  );
  CREATE TABLE IF NOT EXISTS usage (
    user_id INTEGER,
    date TEXT,
    count INTEGER,
    PRIMARY KEY (user_id, date)
  );
  CREATE TABLE IF NOT EXISTS cache (
    url TEXT PRIMARY KEY,
    summary TEXT,
    timestamp INTEGER
  );
`);

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again after 15 minutes' }
});

const analyzeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 analyze/chat requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many analysis requests, please slow down' }
});

app.use(cors());

// Webhook needs raw body, so we place it before express.json()
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req: any, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    if (endpointSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } else {
      // For local testing without a webhook secret
      event = JSON.parse(req.body.toString());
    }
  } catch (err: any) {
    console.error(`Webhook Error: ${err.message}`);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as any;
    const userId = session.client_reference_id;
    const subscriptionId = session.subscription;
    const customerId = session.customer;

    if (userId) {
      const stmt = db.prepare('UPDATE users SET plan = ?, stripe_customer_id = ?, stripe_subscription_id = ? WHERE id = ?');
      stmt.run('pro', customerId, subscriptionId, userId);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as any;
    const stmt = db.prepare('UPDATE users SET plan = ? WHERE stripe_subscription_id = ?');
    stmt.run('free', subscription.id);
  }

  res.send();
});

app.use(express.json());
app.use('/api/', apiLimiter);

// Auth Middleware
const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.sendStatus(403);
    // Token only contains id and email. Plan is fetched from DB.
    req.user = user;
    next();
  });
};

// API Routes
app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    const stmt = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)');
    const info = stmt.run(email, hash);
    const token = jwt.sign({ id: info.lastInsertRowid, email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token });
  } catch (error: any) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(400).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
  const user = stmt.get(email) as any;

  if (!user) return res.status(400).json({ error: 'User not found' });

  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) return res.status(400).json({ error: 'Invalid password' });

  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token });
});

// Extension Login Redirect Handler
app.get('/api/auth/extension-callback', (req, res) => {
  const { token, extensionId } = req.query;
  if (!token || !extensionId) {
    return res.status(400).send('Missing token or extension ID');
  }
  // Redirect back to the extension with the token
  res.redirect(`https://${extensionId}.chromiumapp.org/?token=${token}`);
});

app.get('/api/user/me', authenticateToken, (req: any, res) => {
  const stmt = db.prepare('SELECT id, email, plan FROM users WHERE id = ?');
  const user = stmt.get(req.user.id);
  
  // Get today's usage
  const today = new Date().toISOString().split('T')[0];
  const usageStmt = db.prepare('SELECT count FROM usage WHERE user_id = ? AND date = ?');
  const usage = usageStmt.get(req.user.id, today) as any;
  
  res.json({ ...user, usageToday: usage ? usage.count : 0 });
});

// Helper to check usage limits
const checkUsageLimit = (userId: number, plan: string) => {
  const today = new Date().toISOString().split('T')[0];
  
  // Insert or ignore
  const insertStmt = db.prepare('INSERT OR IGNORE INTO usage (user_id, date, count) VALUES (?, ?, 0)');
  insertStmt.run(userId, today);
  
  const getStmt = db.prepare('SELECT count FROM usage WHERE user_id = ? AND date = ?');
  const usage = getStmt.get(userId, today) as any;
  
  // Free tier limit: 10 per day
  if (plan === 'free' && usage.count >= 10) {
    return false;
  }
  
  // Pro tier soft limit: 500 per day (to prevent abuse)
  if (plan === 'pro' && usage.count >= 500) {
    return false;
  }
  
  return true;
};

const incrementUsage = (userId: number) => {
  const today = new Date().toISOString().split('T')[0];
  const updateStmt = db.prepare('UPDATE usage SET count = count + 1 WHERE user_id = ? AND date = ?');
  updateStmt.run(userId, today);
};

app.post('/api/analyze', authenticateToken, analyzeLimiter, async (req: any, res) => {
  const { url } = req.body;
  
  const userStmt = db.prepare('SELECT plan FROM users WHERE id = ?');
  const user = userStmt.get(req.user.id) as any;
  
  if (!checkUsageLimit(req.user.id, user.plan)) {
    return res.status(403).json({ error: user.plan === 'free' ? 'Free tier limit reached. Please upgrade to Pro.' : 'Daily limit reached.' });
  }

  // Check cache first (24 hour TTL)
  const cacheStmt = db.prepare('SELECT summary, timestamp FROM cache WHERE url = ?');
  const cached = cacheStmt.get(url) as any;
  const ONE_DAY = 24 * 60 * 60 * 1000;
  
  if (cached && (Date.now() - cached.timestamp < ONE_DAY)) {
    incrementUsage(req.user.id);
    return res.json({ summary: cached.summary, cached: true });
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Please provide a comprehensive summary of this website: ${url}. What is it about? What are its main features or offerings? Who is the target audience? Keep it concise and easy to read.`,
      config: {
        tools: [{ urlContext: {} }, { googleSearch: {} }]
      }
    });
    
    const summary = response.text;
    
    // Save to cache
    const insertCacheStmt = db.prepare('INSERT OR REPLACE INTO cache (url, summary, timestamp) VALUES (?, ?, ?)');
    insertCacheStmt.run(url, summary, Date.now());
    
    incrementUsage(req.user.id);
    res.json({ summary });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to analyze website' });
  }
});

app.post('/api/chat', authenticateToken, analyzeLimiter, async (req: any, res) => {
  const { url, query, history } = req.body;
  
  const userStmt = db.prepare('SELECT plan FROM users WHERE id = ?');
  const user = userStmt.get(req.user.id) as any;
  
  if (!checkUsageLimit(req.user.id, user.plan)) {
    return res.status(403).json({ error: user.plan === 'free' ? 'Free tier limit reached. Please upgrade to Pro.' : 'Daily limit reached.' });
  }

  try {
    const chatHistory = history.map((m: any) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
    const prompt = `Context: The user is asking about the website ${url}.\n\nPrevious conversation:\n${chatHistory}\n\nUser's new question: ${query}\n\nPlease answer the user's question based on the website context.`;
    
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ urlContext: {} }, { googleSearch: {} }]
      }
    });
    
    incrementUsage(req.user.id);
    res.json({ answer: response.text });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to get answer' });
  }
});

app.post('/api/stripe/create-checkout-session', authenticateToken, async (req: any, res) => {
  try {
    const stmt = db.prepare('SELECT email FROM users WHERE id = ?');
    const user = stmt.get(req.user.id) as any;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: user.email,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'SiteSight AI Pro',
              description: 'Unlimited website analysis and chat',
            },
            unit_amount: 1000, // $10.00
            recurring: {
              interval: 'month',
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.APP_URL}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL}`,
      client_reference_id: req.user.id.toString(),
    });

    res.json({ url: session.url });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Vite middleware for development
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
