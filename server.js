import express from 'express';
import cors from 'cors';
import { Low, JSONFile } from 'lowdb';

const app = express();
const PORT = 3000;

// Initialize database
const adapter = new JSONFile('db.json');
const db = new Low(adapter);
await db.read();
db.data ||= { routes: [], nextId: 1 };
await db.write();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('.'));  // serves index.html

// Routes
app.get('/api/routes', (req, res) => {
  const summary = db.data.routes.map(r => ({
    id: r.id,
    startTime: r.startTime,
    endTime: r.endTime,
    stopCount: r.stops?.length || 0,
    pointsCount: r.points?.length || 0
  }));
  res.json(summary);
});

app.get('/api/routes/:id', (req, res) => {
  const route = db.data.routes.find(r => r.id == req.params.id);
  if (!route) return res.status(404).json({ error: 'Route not found' });
  res.json(route);
});

app.post('/api/routes', (req, res) => {
  const { startTime, endTime, points, stops } = req.body;
  if (!points || points.length === 0) {
    return res.status(400).json({ error: 'No points provided' });
  }
  const newRoute = {
    id: db.data.nextId++,
    startTime,
    endTime,
    points,
    stops: stops || []
  };
  db.data.routes.push(newRoute);
  db.write();
  res.status(201).json({ id: newRoute.id });
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  console.log(`👉 Open that URL in your browser`);
});