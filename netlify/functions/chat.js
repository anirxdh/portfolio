import { streamChatCompletion } from './utils/openai.js';

/**
 * Netlify function (v2) for AI chat — streams the OpenAI response token-by-token
 * so the frontend can render real typing without a client-side timer.
 */

const MAX_MESSAGE_CHARS = 4000;
const MAX_HISTORY_ITEMS = 10;
const MAX_HISTORY_CHARS = 4000;

// Allow the production site and its Netlify deploy previews; default to prod otherwise.
const ALLOWED_ORIGIN = 'https://anirudhvasudevan.netlify.app';
const ORIGIN_PATTERN = /^https:\/\/([a-z0-9-]+--)?anirudhvasudevan\.netlify\.app$/;

const corsHeaders = (req) => {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': ORIGIN_PATTERN.test(origin) ? origin : ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
};

const json = (data, status, headers) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });

export default async (req) => {
  const headers = corsHeaders(req);

  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, headers);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request' }, 400, headers);
  }

  const { message, conversationHistory = [] } = body || {};

  if (!message || typeof message !== 'string') {
    return json({ error: 'Message is required' }, 400, headers);
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return json({ error: 'Message is too long' }, 400, headers);
  }

  // Sanitize client history: only valid user/assistant turns, capped in count and length.
  const safeHistory = (Array.isArray(conversationHistory) ? conversationHistory : [])
    .filter(
      (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
    )
    .slice(-MAX_HISTORY_ITEMS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_HISTORY_CHARS) }));

  const messages = [...safeHistory, { role: 'user', content: message }];

  let openaiStream;
  try {
    openaiStream = await streamChatCompletion(messages);
  } catch (error) {
    console.error('Error in chat function:', error);
    return json({ error: 'Failed to process chat request' }, 500, headers);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of openaiStream) {
          const content = chunk.choices?.[0]?.delta?.content || '';
          if (content) controller.enqueue(encoder.encode(content));
        }
      } catch (error) {
        console.error('Error while streaming:', error);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...headers,
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
};
