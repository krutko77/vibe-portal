import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(join(__dirname, 'public')));

// Битрикс24 открывает приложение через POST (iframe-протокол)
// Отвечаем тем же index.html что и на GET
app.post('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// Сюда добавляй API-маршруты:
// import dealsRouter from './routes/deals.js';
// app.use('/api/deals', dealsRouter);

app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});

export default app;
