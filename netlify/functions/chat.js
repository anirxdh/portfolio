import { streamChatCompletion } from './utils/openai.js';

/**
 * Netlify serverless function for AI chat
 * Simple system-prompt-based chatbot (no RAG/vector search)
 */
export const handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  // Handle preflight request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  try {
    // Parse request body
    const { message, conversationHistory = [] } = JSON.parse(event.body);

    if (!message || typeof message !== 'string') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Message is required' }),
      };
    }

    console.log(`Received message: "${message.substring(0, 50)}..."`);

    // Build message history (keep last 6 messages for context)
    const messages = [
      ...conversationHistory.slice(-6),
      { role: 'user', content: message },
    ];

    // Get streaming response from OpenAI
    const stream = await streamChatCompletion(messages);

    // Collect the stream
    let fullResponse = '';
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      fullResponse += content;
    }

    // Return the complete response
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        response: fullResponse,
      }),
    };
  } catch (error) {
    console.error('Error in chat function:', error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to process chat request',
        message: error.message,
      }),
    };
  }
};

