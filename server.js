import express from 'express';
import cors from 'cors';
import { Low, JSONFile } from 'lowdb';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import fs from 'fs';

const SECRET_KEY = 'a8f92kLm#29xQp!7sD1@zR';
const app = express();
const PORT = 3000;

// Ensure db.json exists
if (!fs.existsSync('db.json')) {
  fs.writeFileSync('db.json', JSON.stringify({ users: [] }, null, 2));
} else {
  try {
    const content = fs.readFileSync('db.json', 'utf8');
    if (!content.trim()) throw new Error();
    JSON.parse(content);
  } catch {
    fs.writeFileSync('db.json', JSON.stringify({ users: [] }, null, 2));
  }
}

const adapter = new JSONFile('db.json');
const db = new Low(adapter);
await db.read();
if (!db.data || !db.data.users) db.data = { users: [] };

// No hardcoded users – users must register themselves

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('.'));

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (db.data.users.find(u => u.username === username))
    return res.status(400).json({ error: 'User exists' });
  const hashed = await bcrypt.hash(password, 10);
  const newUser = {
    id: (db.data.users.reduce((max, u) => Math.max(max, u.id), 0)) + 1,
    username,
    password: hashed,
    routes: [],
    nextId: 1
  };
  db.data.users.push(newUser);
  await db.write();
  const token = jwt.sign({ userId: newUser.id, username }, SECRET_KEY, { expiresIn: '24h' });
  res.json({ token, username });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = db.data.users.find(u => u.username === username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ userId: user.id, username }, SECRET_KEY, { expiresIn: '24h' });
  res.json({ token, username });
});

// GET summary with distance
app.get('/api/routes', authenticate, (req, res) => {
  const user = db.data.users.find(u => u.id === req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const summary = user.routes.map(r => ({
    id: r.id,
    startTime: r.startTime,
    endTime: r.endTime,
    stopCount: r.stops?.length || 0,
    pointsCount: r.points?.length || 0,
    totalDistanceKm: r.totalDistanceKm || 0
  }));
  res.json(summary);
});

app.get('/api/routes/:id', authenticate, (req, res) => {
  const id = parseInt(req.params.id);
  const user = db.data.users.find(u => u.id === req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const route = user.routes.find(r => r.id === id);
  if (!route) return res.status(404).json({ error: 'Route not found' });
  res.json(route);
});

// POST – now accepts totalDistanceKm
app.post('/api/routes', authenticate, async (req, res) => {
  const { startTime, endTime, points, stops, totalDistanceKm } = req.body;
  if (!points || points.length === 0)
    return res.status(400).json({ error: 'No points provided' });
  const user = db.data.users.find(u => u.id === req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const newRoute = {
    id: user.nextId++,
    startTime,
    endTime,
    points,
    stops: stops || [],
    totalDistanceKm: totalDistanceKm || 0
  };
  user.routes.push(newRoute);
  await db.write();
  res.status(201).json({ id: newRoute.id });
});

app.delete('/api/routes/:id', authenticate, async (req, res) => {
  const id = parseInt(req.params.id);
  const user = db.data.users.find(u => u.id === req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const idx = user.routes.findIndex(r => r.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Route not found' });
  user.routes.splice(idx, 1);
  await db.write();
  res.json({ message: 'Route deleted' });
});

app.listen(PORT, () => console.log(`✅ Server at http://localhost:${PORT}`));