require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve static assets from any possible folder structure
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, '9speaking-app', 'public')));
app.use(express.static(__dirname));

// Smart route for Homepage (checks all common locations for index.html)
app.get('/', (req, res) => {
  const candidatePaths = [
    path.join(__dirname, 'public', 'index.html'),
    path.join(__dirname, '9speaking-app', 'public', 'index.html'),
    path.join(__dirname, 'index.html'),
    path.join(__dirname, '9speaking-app', 'index.html')
  ];

  for (const filePath of candidatePaths) {
    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }
  }

  res.status(404).send('Server is running, but index.html could not be found. Please check your GitHub repository files.');
});

// Evaluation API
app.post('/api/evaluate', async (req, res) => {
  console.log('\n[Backend] Received evaluation request.');

  try {
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();

    if (!apiKey) {
      return res.status(400).json({
        error: 'GEMINI_API_KEY is missing on Render. Please add it under Environment Variables in Render dashboard.'
      });
    }

    const { promptContext, candidateText, audioBase64, mimeType } = req.body;

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

    const model = 'gemini-3.8-flash';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

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
              thinkingLevel: 'LOW'
            }
          }
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        const resultJson = JSON.parse(data.candidates[0].content.parts[0].text);
        resultJson.engineName = `Gemini AI (${model} Multimodal)`;
        return res.json(resultJson);
      } else {
        const errData = await response.json().catch(() => ({}));
        const errMsg = errData.error?.message || `Google returned HTTP ${response.status}`;
        return res.status(response.status).json({ error: errMsg });
      }
    } catch (err) {
      clearTimeout(timeout);
      const errMsg = err.name === 'AbortError' ? 'Request timed out after 120 seconds' : err.message;
      return res.status(504).json({ error: errMsg });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Server error' });
  }
});

app.listen(PORT, () => {
  console.log(`9Speaking server running on port ${PORT}`);
});
