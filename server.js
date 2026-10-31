const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const apiKey = process.env.GEMINI_API_KEY;
const defaultModelName = 'gemini-3.8-flash';
const modelName = (process.env.GEMINI_MODEL || defaultModelName).trim();
const maxOutputTokens = Number(process.env.GEMINI_MAX_TOKENS || 6000);
const normalizeModel = (name) => {
  const raw = String(name || defaultModelName).trim().replace(/^models\//i, '');
  const legacyMap = {
    'gemini-2.0-flash': 'gemini-3.8-flash',
    'gemini-2.5-flash': 'gemini-3.8-flash',
    'gemini-1.5-flash': 'gemini-3.8-flash',
  };
  const resolved = legacyMap[raw] || raw || defaultModelName;
  return `models/${resolved}`;
};

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, model: modelName });
});

app.post('/api/generate', async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server' });
    }

    const resolvedModel = normalizeModel(modelName);
    const url = `https://generativelanguage.googleapis.com/v1beta/${resolvedModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
    console.log(`[AI] generating with model=${resolvedModel} promptChars=${prompt.length}`);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.25,
          topP: 0.95,
          maxOutputTokens: Number.isFinite(maxOutputTokens) && maxOutputTokens > 0 ? maxOutputTokens : 6000,
        },
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = data?.error?.message || 'Gemini request failed';
      return res.status(response.status).json({ error: message });
    }

    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map((p) => p?.text || '')
        .join('') || '';

    if (!text) {
      return res.status(502).json({ error: 'Gemini returned an empty response' });
    }

    const words = (text.match(/\S+/g) || []).length;
    console.log(`[AI] done model=${resolvedModel} chars=${text.length} words=${words}`);
    return res.json({ text });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Server error' });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`AI server running on http://0.0.0.0:${port}`);
});
