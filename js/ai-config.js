/* Optional: connect the "Generate with AI" buttons (Preliminary / Final report) to a live AI provider.

   Recommended production setup: keep the API key on a small backend server and expose a POST /api/generate
   endpoint. The app expects a JSON response shaped like { "text": "..." }.

   You can also connect directly to Google Gemini from the browser by setting GEMINI_API_KEY below.
   For production, prefer a backend so the key is not exposed in client code.

   Contract expected by the app:
     request : POST  { "prompt": "<text>" }
     response: 200   { "text": "<html fragment: h1/h2/p/ul/table only>" }
   The app sanitises the HTML it receives (clean() in js/10-bills-final-report.js), so the server only
   needs to return the model's text.

   Leave all values empty to keep AI generation disabled; the "Use data-based draft" button still works. */
const aiHost = window.location && window.location.hostname ? window.location.hostname : 'localhost';
/* /api/generate lives on the server that served the page; a fixed port 3000 would be
   cross-origin anywhere else, and the server only answers same-origin requests. */
const aiOrigin =
  window.location.protocol === 'http:' || window.location.protocol === 'https:'
    ? window.location.origin
    : `http://${aiHost}:3000`;
window.SURVEY_AI_ENDPOINT = `${aiOrigin}/api/generate`;
window.SURVEY_AI_MODEL = 'gemini-3.8-flash';
window.SURVEY_AI_API_KEY = ''; // backend is preferred for live web use

function normalizeGeminiModel(model) {
  const raw = String(model || 'gemini-3.8-flash')
    .trim()
    .replace(/^models\//i, '');
  const legacyMap = {
    'gemini-2.0-flash': 'gemini-3.8-flash',
    'gemini-2.5-flash': 'gemini-3.8-flash',
    'gemini-1.5-flash': 'gemini-3.8-flash',
  };
  const resolved = legacyMap[raw] || raw || 'gemini-3.8-flash';
  return `models/${resolved}`;
}

function extractGeminiText(data) {
  const candidates = data && data.candidates;
  if (!Array.isArray(candidates) || !candidates.length) return '';
  const parts =
    candidates[0].content && Array.isArray(candidates[0].content.parts)
      ? candidates[0].content.parts
      : [];
  return parts.map((p) => (p && p.text ? p.text : '')).join('');
}

if (window.SURVEY_AI_ENDPOINT) {
  window.SURVEY_AI = async (prompt, opts = {}) => {
    const r = await fetch(window.SURVEY_AI_ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        model: normalizeGeminiModel(window.SURVEY_AI_MODEL || 'gemini-3.8-flash'),
      }),
    });
    if (!r.ok) {
      // The server forwards Gemini's own message; without it every failure looks identical here.
      const err = await r.json().catch(() => ({}));
      throw Object.assign(new Error((err && err.error) || 'AI request failed (' + r.status + ')'), {
        code: 'http_' + r.status,
      });
    }
    const payload = await r.json();
    const text =
      payload && typeof payload.text === 'string'
        ? payload.text
        : (payload && payload.output) || '';
    if (!text) throw Object.assign(new Error('AI response was empty'), { code: 'empty_response' });
    if (opts.onText) opts.onText({ text });
    return { text };
  };
} else if (window.SURVEY_AI_API_KEY) {
  window.SURVEY_AI = async (prompt, opts = {}) => {
    const model = normalizeGeminiModel(window.SURVEY_AI_MODEL || 'gemini-3.8-flash');
    const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${encodeURIComponent(window.SURVEY_AI_API_KEY)}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2000 },
      }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw Object.assign(
        new Error(err.error && err.error.message ? err.error.message : 'AI request failed'),
        {
          code: 'http_' + r.status,
        }
      );
    }
    const data = await r.json();
    const text = extractGeminiText(data);
    if (!text)
      throw Object.assign(new Error('Gemini returned no text'), { code: 'empty_response' });
    if (opts.onText) opts.onText({ text });
    return { text };
  };
}
