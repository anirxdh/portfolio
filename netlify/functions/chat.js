import { streamChatCompletion } from './utils/openai.js';

/**
 * Netlify serverless function for AI chat
 * Simple system-prompt-based chatbot (no RAG/vector search)
 */

// Limits to bound cost/abuse of the OpenAI-backed endpoint
const MAX_MESSAGE_CHARS = 4000;
const MAX_HISTORY_ITEMS = 10;
const MAX_HISTORY_CHARS = 4000;

// Allow the production site and its Netlify deploy previews; default to prod otherwise.
const ALLOWED_ORIGIN = 'https://anirudhvasudevan.netlify.app';
const ORIGIN_PATTERN = /^https:\/\/([a-z0-9-]+--)?anirudhvasudevan\.netlify\.app$/;

const resolveAllowedOrigin = (event) => {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  return ORIGIN_PATTERN.test(origin) ? origin : ALLOWED_ORIGIN;
};

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': resolveAllowedOrigin(event),
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };

  // Handle preflight request
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    // Parse request body
    const { message, conversationHistory = [] } = JSON.parse(event.body || '{}');

    if (!message || typeof message !== 'string') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Message is required' }),
      };
    }

    if (message.length > MAX_MESSAGE_CHARS) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Message is too long' }),
      };
    }

    // Sanitize client-supplied history: only keep valid user/assistant turns,
    // cap the number of turns and their length. This blocks injected `system`
    // messages and oversized payloads.
    const safeHistory = (Array.isArray(conversationHistory) ? conversationHistory : [])
      .filter(
        (m) =>
          m &&
          (m.role === 'user' || m.role === 'assistant') &&
          typeof m.content === 'string',
      )
      .slice(-MAX_HISTORY_ITEMS)
      .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_HISTORY_CHARS) }));

    console.log(`Chat request received (${message.length} chars, ${safeHistory.length} history turns)`);

    const messages = [...safeHistory, { role: 'user', content: message }];

    // Get streaming response from OpenAI
    const stream = await streamChatCompletion(messages);

    // Collect the stream
    let fullResponse = '';
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      fullResponse += content;
    }

    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ response: fullResponse }),
    };
  } catch (error) {
    // Log full detail server-side; return a generic message to the client.
    console.error('Error in chat function:', error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to process chat request' }),
    };
  }
};
