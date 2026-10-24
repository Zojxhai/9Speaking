require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/evaluate', async (req, res) => {
  console.log('\n----------------------------------------');
  console.log('[Backend] Received new evaluation request.');

  try {
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();

    if (!apiKey || apiKey.includes('YourActualSecretKeyHere')) {
      console.error('[Backend Error] GEMINI_API_KEY is missing or unchanged in .env file!');
      return res.status(400).json({
        error: 'Your Gemini API key is missing. Please set GEMINI_API_KEY in your .env file.'
      });
    }

    const { promptContext, candidateText, audioBase64, mimeType } = req.body;
    console.log(`[Backend] Audio attached: ${Boolean(audioBase64)} | Text provided: ${Boolean(candidateText)}`);

    const systemInstruction = `You are a certified IELTS Speaking Examiner.
Your task:
1. If audio is provided, TRANSCRIBE every word the candidate spoke verbatim into the "transcript" field. If no audio is provided, mirror the candidate text in "transcript".
2. Evaluate their IELTS Speaking performance strictly according to the 4 official IELTS criteria (Bands 1.0 - 9.0 in 0.5 increments):
   - Fluency and Coherence (FC)
   - Lexical Resource (LR)
   - Grammatical Range and Accuracy (GRA)
   - Pronunciation (PR)

Respond with ONLY valid JSON:
{
  "transcript": "Verbatim transcript of candidate speech...",
  "overallBand": 7.5,
  "criteria": {
    "fc": { "band": 7.5, "rationale": "Examiner evaluation..." },
    "lr": { "band": 7.0, "rationale": "Examiner evaluation..." },
    "gra": { "band": 7.5, "rationale": "Examiner evaluation..." },
    "pr": { "band": 7.5, "rationale": "Examiner evaluation..." }
  },
  "errors": [
    {
      "original": "candidate phrase",
      "errorType": "Grammar / Lexical / Collocation",
      "upgrade": "Band 8/9 native phrasing",
      "explanation": "Why this upgrade is necessary"
    }
  ],
  "modelAnswer": "A full Band 9 exemplar response addressing the specific question."
}`;

    const parts = [];

    if (audioBase64) {
      parts.push({
        inlineData: {
          mimeType: (mimeType || 'audio/webm').split(';')[0],
          data: audioBase64
        }
      });
    }

    parts.push({
      text: `${promptContext}\nCandidate Transcript (if available): "${candidateText || ''}". Transcribe audio verbatim and evaluate.`
    });

    // Directly target active gemini-3.8-flash with a 120-second window
    const model = 'gemini-3.8-flash';
    console.log(`[Backend] Calling Google Gemini (${model})...`);

    const startTime = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); // 120s timeout

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          systemInstruction: { parts: [{ text: systemInstruction }] },
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
            thinkingConfig: {
              thinkingLevel: 'LOW' // Minimizes latency on Gemini 3.8 Flash
            }
          }
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (response.ok) {
        const data = await response.json();
        const resultJson = JSON.parse(data.candidates[0].content.parts[0].text);
        resultJson.engineName = `Gemini AI (${model} Multimodal)`;
        console.log(`[Backend] Evaluation successful in ${elapsed}s!`);
        return res.json(resultJson);
      } else {
        const errData = await response.json().catch(() => ({}));
        const errMsg = errData.error?.message || `Google returned HTTP ${response.status}`;
        console.error(`[Backend Error] ${model} rejected: ${errMsg}`);
        return res.status(response.status).json({ error: errMsg });
      }
    } catch (err) {
      clearTimeout(timeout);
      const errMsg = err.name === 'AbortError' ? 'Request timed out after 120 seconds' : err.message;
      console.error(`[Backend Error]: ${errMsg}`);
      return res.status(504).json({ error: errMsg });
    }
  } catch (error) {
    console.error('[Backend Uncaught Error]:', error);
    return res.status(500).json({ error: error.message || 'Server error' });
  }
});

app.listen(PORT, () => {
  console.log(`9Speaking server running on http://localhost:${PORT}`);
});